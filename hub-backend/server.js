"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

/* =========================
   CONFIG
   ========================= */

const WS_HOST = process.env.WS_HOST || "0.0.0.0";
const WS_PORT = Number(process.env.WS_PORT || 5080);
const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN || "";
const WS_AUTH_QUERY = process.env.WS_AUTH_QUERY || "token";

// API
const API_HOST = process.env.API_HOST || "0.0.0.0";
const API_PORT = Number(process.env.API_PORT || 8090);

// Webhook
const WEBHOOK_URL = process.env.WEBHOOK_URL || `http://${API_HOST}:${API_PORT}/debug/webhook`;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "dev-secret-change-me";

// Буфер в RAM
const QUEUE_MAX = Number(process.env.QUEUE_MAX || 5000);
const FLUSH_BATCH = Number(process.env.FLUSH_BATCH || 100);
const FLUSH_EVERY_MS = Number(process.env.FLUSH_EVERY_MS || 200);

// Ретраи
const RETRY_BASE_MS = Number(process.env.RETRY_BASE_MS || 1000);
const RETRY_MAX_MS = Number(process.env.RETRY_MAX_MS || 30_000);

// Runtime config persisted to disk
const CFG_PATH = process.env.CFG_PATH || path.join(__dirname, "runtime-config.json");

/* =========================
   RUNTIME CONFIG
   ========================= */

let runtimeCfg = {
  testPeriodMs: 5 * 60_000,
  testFailAfterMs: 5 * 60_000,
};

function clampRuntimeCfg() {
  runtimeCfg.testPeriodMs = Math.max(5_000, Number(runtimeCfg.testPeriodMs) || 300_000);
  runtimeCfg.testFailAfterMs = Math.max(5_000, Number(runtimeCfg.testFailAfterMs) || 300_000);
}

function loadRuntimeCfg() {
  try {
    const s = fs.readFileSync(CFG_PATH, "utf8");
    const j = JSON.parse(s);
    if (j && typeof j === "object") {
      if (j.testPeriodMs !== undefined) runtimeCfg.testPeriodMs = Number(j.testPeriodMs);
      if (j.testFailAfterMs !== undefined) runtimeCfg.testFailAfterMs = Number(j.testFailAfterMs);
    }
  } catch {}
  clampRuntimeCfg();
}

function saveRuntimeCfg() {
  try {
    fs.writeFileSync(CFG_PATH, JSON.stringify(runtimeCfg, null, 2));
  } catch (e) {
    console.warn("[CFG] failed to save:", String(e?.message || e));
  }
}

loadRuntimeCfg();

/* =========================
   STATE
   ========================= */

const clients = new Set(); // WS clients (мод)
const hubToWs = new Map(); // hubId -> ws (последний виденный)
const hubs = new Map(); // hubId -> { lastSeenTs, fail:boolean, online:boolean }

// Reader mapping
const readerToWs = new Map(); // readerId -> ws (последний виденный)

const queue = []; // { event, tries, nextAttemptTs, lastError }
let flushing = false;
let lastWebhookLogTs = 0;

/* =========================
   HELPERS
   ========================= */

function now() {
  return Date.now();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeSide(side) {
  if (!side) return null;
  const s = String(side).toLowerCase();
  if (["north", "south", "east", "west", "up", "down"].includes(s)) return s;
  return null;
}

function logEvent(ev) {
  console.log("[EV]", JSON.stringify(ev));
}

function makeEvent(type, hubId, ts, payload = {}) {
  return { type, hubId, ts: ts || now(), payload };
}

function makeReaderEvent(type, readerId, ts, payload = {}) {
  return { type, readerId, ts: ts || now(), payload };
}

function enqueueWebhook(event) {
  const item = { event, tries: 0, nextAttemptTs: 0, lastError: null };

  if (queue.length >= QUEUE_MAX) {
    const dropped = queue.shift();
    console.warn("[QUEUE] overflow, dropped oldest:", dropped?.event?.type);
  }
  queue.push(item);
}

function markHubSeen(hubId, ts, ws) {
  if (!hubId || hubId === "unknown") return;

  const existed = hubs.has(hubId);
  const h = hubs.get(hubId) || { lastSeenTs: 0, fail: false, online: false };

  const prevFail = !!h.fail;

  h.lastSeenTs = ts || now();
  h.online = true;
  h.fail = false;

  hubs.set(hubId, h);
  if (ws) hubToWs.set(hubId, ws);

  if (!existed) {
    logEvent({ type: "HUB_ONLINE", hubId, ts: now() });
    const ev = makeEvent("TEST_OK", hubId, now(), { lastSeenAgeMs: 0, reason: "FIRST_SEEN" });
    logEvent(ev);
    enqueueWebhook(ev);
  } else if (prevFail) {
    const ev = makeEvent("TEST_OK", hubId, now(), { lastSeenAgeMs: 0, reason: "RESTORED" });
    logEvent(ev);
    enqueueWebhook(ev);
  }
}

function markReaderSeen(readerId, ws) {
  if (!readerId || readerId === "unknown") return;
  if (ws) readerToWs.set(readerId, ws);
}

function hasValidWsToken(req) {
  if (!WS_AUTH_TOKEN) return true;
  try {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get(WS_AUTH_QUERY);
    if (!token) return false;
    const candidate = Buffer.from(token);
    const expected = Buffer.from(WS_AUTH_TOKEN);
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* =========================
   WEBHOOK SENDER
   ========================= */

function httpPostJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj);

    const opts = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + (u.search || ""),
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };

    const lib = u.protocol === "https:" ? require("https") : require("http");

    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          const err = new Error(`Webhook HTTP ${res.statusCode}: ${data?.slice(0, 300)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;

  try {
    if (queue.length === 0) return;

    const headers = { "X-Hub-Token": WEBHOOK_TOKEN };

    let sent = 0;
    for (let i = 0; i < queue.length && sent < FLUSH_BATCH; ) {
      const item = queue[i];
      if (!item) break;

      if (item.nextAttemptTs && item.nextAttemptTs > now()) {
        i++;
        continue;
      }

      try {
        await httpPostJson(WEBHOOK_URL, headers, item.event);
        queue.splice(i, 1);
        sent++;
      } catch (err) {
        item.tries++;
        item.lastError = String(err && err.message ? err.message : err);

        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(10, item.tries));
        item.nextAttemptTs = now() + delay;

        if (now() - lastWebhookLogTs > 2000) {
          console.warn("[WEBHOOK] send failed, will retry:", item.lastError);
          lastWebhookLogTs = now();
        }

        break;
      }
    }
  } finally {
    flushing = false;
  }
}

setInterval(flushQueue, FLUSH_EVERY_MS);

/* =========================
   TEST LOGIC
   ========================= */

function runTests() {
  const t = now();

  for (const [hubId, h] of hubs.entries()) {
    const age = t - (h.lastSeenTs || 0);

    if (age > runtimeCfg.testFailAfterMs) {
      if (!h.fail) {
        h.fail = true;
        h.online = false;
        hubs.set(hubId, h);

        const ev = makeEvent("TEST_FAIL", hubId, t, { lastSeenAgeMs: age });
        logEvent(ev);
        enqueueWebhook(ev);
      }
    } else {
      const ev = makeEvent("TEST_OK", hubId, t, { lastSeenAgeMs: age, reason: "PERIODIC" });
      logEvent(ev);
      enqueueWebhook(ev);
    }
  }
}

let testsTimer = null;

function restartTestsTimer() {
  if (testsTimer) clearInterval(testsTimer);
  testsTimer = setInterval(runTests, runtimeCfg.testPeriodMs);
  console.log("[CFG] tests timer:", runtimeCfg.testPeriodMs, "failAfter:", runtimeCfg.testFailAfterMs, "cfg:", CFG_PATH);
}

restartTestsTimer();

/* =========================
   WS SERVER
   ========================= */

const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT });

wss.on("connection", (ws, req) => {
  if (!hasValidWsToken(req)) {
    console.warn("[WS] unauthorized connection rejected");
    ws.close(1008, "Unauthorized");
    return;
  }

  clients.add(ws);
  console.log("[WS] client connected");

  ws.on("message", (data) => {
    const msg = safeJsonParse(data.toString());
    if (!msg || !msg.type) return;

    if (msg.type === "HELLO") {
      console.log("[IN]", msg);

      enqueueWebhook(
        makeEvent("HELLO", "unknown", msg.ts || now(), {
          client: msg.client,
          clientId: msg.clientId,
        }),
      );
      return;
    }

    // Мод присылает конфиг из hubmod.yml -> делаем его рабочим:
    // применяем как runtimeCfg + сохраняем на диск + рестартим таймер.
    if (msg.type === "CLIENT_CONFIG") {
      const tp = Number(msg.testPeriodMs);
      const tf = Number(msg.testFailAfterMs);

      if (!Number.isNaN(tp)) runtimeCfg.testPeriodMs = tp;
      if (!Number.isNaN(tf)) runtimeCfg.testFailAfterMs = tf;

      clampRuntimeCfg();
      saveRuntimeCfg();
      restartTestsTimer();

      const ev = { type: "CLIENT_CONFIG_APPLIED", ts: now(), payload: { runtimeCfg } };
      console.log("[CFG]", JSON.stringify(ev));
      enqueueWebhook(ev);

      return;
    }

    if (msg.type === "HEARTBEAT") {
      return;
    }

    // ВАЖНО: HUB_PING должен обновлять lastSeenTs, иначе будут ложные TEST_FAIL при статичном редстоуне
    if (msg.type === "HUB_PING") {
      const hubId = msg.hubId || "unknown";
      const ts = msg.ts || now();
      const pos = msg.pos || { x: msg.x, y: msg.y, z: msg.z };

      markHubSeen(hubId, ts, ws);

      const ev = makeEvent("HUB_PING", hubId, ts, { pos });
      logEvent(ev);
      enqueueWebhook(ev);
      return;
    }

    if (msg.type === "PORT_IN") {
      const hubId = msg.hubId || "unknown";
      const side = normalizeSide(msg.side);
      const level = Number(msg.level ?? 0);
      const pos = msg.pos || { x: msg.x, y: msg.y, z: msg.z };
      const ts = msg.ts || now();

      markHubSeen(hubId, ts, ws);

      const ev = makeEvent("PORT_IN", hubId, ts, { side, level, pos });
      logEvent(ev);
      enqueueWebhook(ev);
      return;
    }

    // --- READER_SCAN ---
    if (msg.type === "READER_SCAN") {
      const readerId = msg.readerId || "unknown";
      const keyName = String(msg.keyName ?? "");
      const player = String(msg.player ?? "");
      const pos = msg.pos || { x: msg.x, y: msg.y, z: msg.z };
      const ts = msg.ts || now();

      markReaderSeen(readerId, ws);

      const ev = makeReaderEvent("READER_SCAN", readerId, ts, { keyName, player, pos });
      logEvent(ev);
      enqueueWebhook(ev);
      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);

    for (const [k, v] of hubToWs.entries()) if (v === ws) hubToWs.delete(k);
    for (const [k, v] of readerToWs.entries()) if (v === ws) readerToWs.delete(k);

    console.log("[WS] client disconnected");
  });
});

console.log(`WS listening on ws://${WS_HOST}:${WS_PORT}`);
console.log(`Webhook -> ${WEBHOOK_URL}`);
console.log(`API listening on http://${API_HOST}:${API_PORT}`);

/* =========================
   HTTP API SERVER
   ========================= */

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

async function readJson(req) {
  const body = await readBody(req);
  return safeJsonParse(body);
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function sendWsJson(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

function broadcastWs(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients) {
    try {
      ws.send(s);
    } catch {}
  }
}

function parseOutputCommand(body) {
  if (!body || typeof body !== "object") return null;

  if (typeof body.enabled === "boolean") {
    const enable = body.enabled;
    const lvl = enable ? Number(body.level ?? 15) : 0;
    return { enable, level: lvl };
  }

  const mode = body.mode ?? body.state;
  if (typeof mode === "string") {
    const m = mode.trim().toLowerCase();
    if (m === "on" || m === "enable" || m === "enabled") {
      const lvl = Number(body.level ?? 15);
      return { enable: true, level: lvl };
    }
    if (m === "off" || m === "disable" || m === "disabled") {
      return { enable: false, level: 0 };
    }
  }

  if (body.level !== undefined) {
    const lvl = Number(body.level);
    if (Number.isNaN(lvl)) return null;
    return { enable: lvl > 0, level: Math.max(0, Math.min(15, lvl)) };
  }

  return null;
}

function parseReaderOutputCommand(body) {
  if (!body || typeof body !== "object") return null;

  if (typeof body.enabled === "boolean") {
    const enable = body.enabled;
    const lvl = enable ? Number(body.level ?? 15) : 0;
    return { level: enable ? lvl : 0 };
  }

  const mode = body.mode ?? body.state;
  if (typeof mode === "string") {
    const m = mode.trim().toLowerCase();
    if (m === "on" || m === "enable" || m === "enabled") {
      const lvl = Number(body.level ?? 15);
      return { level: lvl };
    }
    if (m === "off" || m === "disable" || m === "disabled") {
      return { level: 0 };
    }
  }

  if (body.level !== undefined) {
    const lvl = Number(body.level);
    if (Number.isNaN(lvl)) return null;
    return { level: Math.max(0, Math.min(15, lvl)) };
  }

  return null;
}

const apiServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/health/")) {
    sendJson(res, 200, {
      ok: true,
      wsClients: clients.size,
      hubsTracked: hubs.size,
      readersTracked: readerToWs.size,
      queue: queue.length,
      webhookUrl: WEBHOOK_URL,
      runtimeCfg,
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/api/config" || req.url === "/api/config/")) {
    sendJson(res, 200, { ok: true, runtimeCfg, cfgPath: CFG_PATH });
    return;
  }

  if (req.method === "POST" && (req.url === "/api/config" || req.url === "/api/config/")) {
    const body = await readJson(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }

    if (body.testPeriodMs !== undefined) runtimeCfg.testPeriodMs = Number(body.testPeriodMs);
    if (body.testFailAfterMs !== undefined) runtimeCfg.testFailAfterMs = Number(body.testFailAfterMs);

    clampRuntimeCfg();
    saveRuntimeCfg();
    restartTestsTimer();

    sendJson(res, 200, { ok: true, runtimeCfg });
    return;
  }

  if (req.method === "POST" && (req.url === "/debug/webhook" || req.url === "/debug/webhook/")) {
    const obj = await readJson(req);
    console.log("[WEBHOOK_IN]", JSON.stringify(obj));
    sendJson(res, 200, { ok: true });
    return;
  }

  const m = req.url.match(/^\/api\/hub\/([^/]+)\/outputs?\/?$/);

  if (req.method === "POST" && m) {
    const hubId = decodeURIComponent(m[1]);
    const body = await readJson(req);

    const side = normalizeSide(body?.side);
    if (!side) {
      sendJson(res, 400, { ok: false, error: "Invalid side (north/south/east/west/up/down)" });
      return;
    }

    const cmdParsed = parseOutputCommand(body);
    if (!cmdParsed) {
      sendJson(res, 400, {
        ok: false,
        error: "Invalid body. Use {mode:'on'|'off'} or {enabled:true|false} and optional level.",
      });
      return;
    }

    let level = Number(cmdParsed.level);
    if (Number.isNaN(level)) {
      sendJson(res, 400, { ok: false, error: "Invalid level (0..15)" });
      return;
    }
    level = Math.max(0, Math.min(15, level));

    const enable = cmdParsed.enable && level > 0;
    const cmd = { type: "SET_OUTPUT", hubId, side, level: enable ? level : 0, ts: now() };

    let ok = false;
    const ws = hubToWs.get(hubId);
    if (ws) ok = sendWsJson(ws, cmd);
    if (!ok) {
      broadcastWs(cmd);
      ok = true;
    }

    const ev = makeEvent("SET_OUTPUT", hubId, now(), { side, level: cmd.level, enabled: cmd.level > 0 });
    logEvent(ev);
    enqueueWebhook(ev);

    sendJson(res, 200, { ok: true, hubId, side, level: cmd.level, enabled: cmd.level > 0 });
    return;
  }

  const r = req.url.match(/^\/api\/reader\/([^/]+)\/output\/?$/);

  if (req.method === "POST" && r) {
    const readerId = decodeURIComponent(r[1]);
    const body = await readJson(req);

    const parsed = parseReaderOutputCommand(body);
    if (!parsed) {
      sendJson(res, 400, {
        ok: false,
        error: "Invalid body. Use {mode:'on'|'off'} or {enabled:true|false} or {level:0..15}.",
      });
      return;
    }

    let level = Number(parsed.level);
    if (Number.isNaN(level)) {
      sendJson(res, 400, { ok: false, error: "Invalid level (0..15)" });
      return;
    }
    level = Math.max(0, Math.min(15, level));

    const cmd = { type: "SET_READER_OUTPUT", readerId, level, ts: now() };

    const ws = readerToWs.get(readerId);
    let ok = false;
    if (ws) ok = sendWsJson(ws, cmd);

    if (!ok) {
      broadcastWs(cmd);
      ok = true;
    }

    const ev = makeReaderEvent("SET_READER_OUTPUT", readerId, now(), { level, enabled: level > 0 });
    logEvent(ev);
    enqueueWebhook(ev);

    sendJson(res, 200, { ok: true, readerId, level, enabled: level > 0 });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

apiServer.listen(API_PORT, API_HOST);
