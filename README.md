# Minecraft Security System

Документация по стартовой архитектуре и авторизации (launcher token), ориентированная на UX как у Ajax.

## Быстрый старт (UI + backend демо + аккаунты)
```bash
# 1. Запуск Postgres (порт 5433, чтобы не конфликтовать с локальной БД)
docker compose up -d

# 2. Установка зависимостей и сидинг данных
cd backend
npm install
cp .env.example .env
npm run seed

# 3. Запуск backend + UI
npm run dev
```

Примечание: `npm run seed` пересоздаёт таблицы и сбрасывает данные.

Откройте:
- Вход: http://localhost:8080/login.html
- PRO (Режим ПЦН): http://localhost:8080/index.html
- Инженер (полный режим): http://localhost:8080/main.html
- Пользователь: http://localhost:8080/user.html

Вход выполняется только через Discord OAuth (email/пароль отключены).

## Discord OAuth (минимальная интеграция)
Нужно создать приложение в Discord Developer Portal и добавить redirect URI:
```
http://localhost:8080/api/auth/discord/callback
```

Затем заполнить в `.env`:
```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=http://localhost:8080/api/auth/discord/callback
```

После этого на странице входа появится кнопка входа/регистрации через Discord.

## Авторизация через лаунчер
Сайт можно открывать из лаунчера через WebView по URL:
```
https://your-domain.com/login.html?token=LAUNCHER_TOKEN
```

Backend обменяет `token` на данные пользователя через внешний API:
```
GET {LAUNCHER_API_URL}/Key/AccountData/{token}
```

В `.env` для backend укажите:
```
LAUNCHER_API_URL=http://127.0.0.1:8090
```

### Эмуляция лаунчера локально
Запустите простой мок‑сервер:
```bash
node -e "require('http').createServer((req,res)=>{ if(req.url.startsWith('/Key/AccountData/')){ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ minecraft:{ uuid:'00000000-0000-0000-0000-000000000000', nickname:'PlayerNickname', skin:{ url:'https://example.com/skin.png', variant:'classic'} }, discord:{ id:'123456789012345678', nickname:'DiscordNick', avatar:{ url:'https://cdn.discordapp.com/avatars/.../....png'} }, device:{ hwid:'123' }, lastMinecraftServer:{ serverId:'Satirize' }, servers:[] })); } else { res.writeHead(404); res.end(); } }).listen(8090,()=>console.log('Mock launcher API on :8090'))"
```

Далее откройте:
```
http://localhost:8080/login.html?token=TEST_TOKEN
```

## Webhook от модов
Хабы и читатели присылают события на:
- `POST /api/hub/events`
- `POST /api/reader/events`

Если backend слушает не на `8080`, задайте порт через `PORT`, например:
```
PORT=8090 npm run dev
```

В мод‑backend укажите правильный URL, например:
```
WEBHOOK_URL=http://127.0.0.1:8080/api/hub/events
```

Если нужно отправлять команды на hub‑backend (сирена/светодиод/reader выходы), укажите:
```
HUB_API_URL=http://127.0.0.1:8090
```

Если указан `WEBHOOK_TOKEN`, передавайте заголовок (поддерживаются оба варианта):
```
X-Webhook-Token: dev-secret-change-me
X-Hub-Token: dev-secret-change-me
```

## Ключи и считыватели
Ключи добавляются через вкладку "Оборудование" (тип устройства: "Ключ").
При событии `READER_SCAN` backend сопоставляет ключ по имени и снимает объект с охраны.

## Содержание
- [Архитектура и модели](docs/architecture.md)
- [Авторизация через launcher token](docs/auth-flow.md)
- [API черновик](docs/api-draft.md)
