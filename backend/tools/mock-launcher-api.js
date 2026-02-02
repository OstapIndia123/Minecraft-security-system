import http from 'node:http';

const port = Number(process.env.MOCK_LAUNCHER_PORT ?? process.env.PORT ?? 8090);
const baseNickname = process.env.MOCK_NICKNAME ?? 'PlayerNickname';
const discordId = process.env.MOCK_DISCORD_ID ?? '123456789012345678';
const discordNickname = process.env.MOCK_DISCORD_NICKNAME ?? 'DiscordNick';
const avatarUrl =
  process.env.MOCK_DISCORD_AVATAR_URL ?? 'https://cdn.discordapp.com/avatars/.../....png';
const skinUrl = process.env.MOCK_MINECRAFT_SKIN_URL ?? 'https://example.com/skin.png';
const serverId = process.env.MOCK_LAST_SERVER_ID ?? 'Satirize';

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/Key/AccountData/')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const token = decodeURIComponent(url.pathname.replace('/Key/AccountData/', ''));
  const payload = {
    token,
    minecraft: {
      uuid: '00000000-0000-0000-0000-000000000000',
      nickname: baseNickname,
      skin: { url: skinUrl, variant: 'classic' },
    },
    discord: {
      id: discordId,
      nickname: discordNickname,
      avatar: { url: avatarUrl },
    },
    device: { hwid: '123' },
    lastMinecraftServer: { serverId },
    servers: [],
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
});

server.listen(port, () => {
  console.log(`Mock launcher API on :${port}`);
});
