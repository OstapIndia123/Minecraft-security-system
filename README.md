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

## Docker Compose (backend + hub-backend + Postgres)
```bash
docker compose up --build
```

По умолчанию контейнер поднимает:
- UI + backend: http://localhost:8080
- Hub API: http://localhost:8090
- WebSocket модов: ws://localhost:5080?token=dev-secret-change-me

При необходимости задайте свои значения через переменные окружения в `docker-compose.yml`
или файле `.env`. Например:
```
WEBHOOK_TOKEN=change-me
WS_AUTH_TOKEN=change-me
WEBHOOK_URL=http://127.0.0.1:8080/api/hub/events
```

Для безопасного доступа извне рекомендуется проксировать WebSocket через TLS (wss)
и держать порты 5080/8090 закрытыми на фаерволе, оставив доступ только к 8080.

Если сборка падает из-за недоступности Docker Hub, можно указать локальный/зеркальный
образ Node.js через build-arg:
```bash
docker compose build --build-arg BASE_IMAGE=registry.example.com/node:20-alpine
```

Если недоступен npm registry, можно:
1) положить `backend/node_modules` и `hub-backend/node_modules` в репозиторий/каталог сборки (они будут скопированы в образ),
2) либо указать свой npm registry:
```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org
```
Если сеть полностью недоступна, можно пропустить установку npm зависимостей (при наличии
предсобранных `node_modules`):
```bash
docker compose build --build-arg SKIP_NPM_INSTALL=true
```

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
Запустите мок‑сервер:
```bash
node backend/tools/mock-launcher-api.js
```

Можно переопределить данные через переменные окружения:
```bash
MOCK_LAUNCHER_PORT=8090 \
MOCK_NICKNAME=PlayerNickname \
MOCK_DISCORD_ID=123456789012345678 \
MOCK_DISCORD_NICKNAME=DiscordNick \
node backend/tools/mock-launcher-api.js
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
