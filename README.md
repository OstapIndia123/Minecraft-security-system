# Minecraft Security System

Документация по архитектуре и авторизации через дискорд или launcher token.

## Быстрый старт (UI + backend демо + аккаунты)
```bash, НЕ выполнять одновременно!!
git clone https://github.com/OstapIndia123/Minecraft-security-system.git
cd Minecraft-security-system
nano docker-compose.yml # настроить обязательно!
docker compose build # если падает на этом моменте, проверьте настроина ли у вас сеть в вашем докер клиенте, а именно DNS
docker compose up -d                        
docker compose exec app node backend/seed.js # запускаем seed
docker compose restart app # чтобы применилось
```

Примечание: `docker compose exec app node backend/seed.js` пересоздаёт таблицы и сбрасывает данные.

По умолчанию контейнер поднимает:
- UI + backend: http://localhost:8080
- Hub API: http://localhost:8090 — это только внутри контейнера, пох пох пох
- WebSocket модов: ws://localhost:5080?token=dev-secret-change-me

При необходимости задайте свои значения через переменные окружения в `docker-compose.yml`
или файле `.env` в папке с исходниками. Например:
```
WEBHOOK_TOKEN=change-me
WS_AUTH_TOKEN=change-me
WEBHOOK_URL=http://127.0.0.1:8080/api/hub/events
POSTGRES_PASSWORD=postgres
# (но лучше этой хуйнёй не занимайтесь, я просто сделал)
```

> ℹ️ `docker-compose.yml` использует `${POSTGRES_PASSWORD}` и `${POSTGRES_DB}` для `DATABASE_URL`,
> поэтому удобнее всего (нет) задавать их через `.env` рядом с `docker-compose.yml`.

### Если контейнер падает с `password authentication failed`
Postgres сохраняет пароль в volume при первом запуске. Если вы поменяли `POSTGRES_PASSWORD`
после инициализации volume, контейнер продолжит требовать старый пароль и сидинг упадёт.
Та же проблема проявляется в `docker compose logs app` как `code: '28P01'` после авторизации.

Варианты решения:
```bash
# Полный сброс БД (удалит данные в pgdata)
docker compose down -v
docker compose up -d --build
docker compose exec app node backend/seed.js
```

Либо выставьте `POSTGRES_PASSWORD` равным старому паролю (который был при первом запуске volume).

Для безопасного доступа извне рекомендуется проксировать WebSocket через любой удобный вам web server
и держать порты 5080/8090 закрытыми на фаерволе, оставив доступ только к 8080.

## Админ-панель (пароль, отдельная ссылка)
Админ-панель доступна по отдельной странице:
```
/admin-panel-9f3c.html
```
Если хотите сменить секретный URL, переименуйте файл `web/admin-panel-9f3c.html`
и сохраните атрибут `data-admin="true"` в теге `<body>`.

Пароль задаётся в docker-compose

### Настройка wsUrl для мода
Токен WS передаётся через query‑параметр `token`.
Пример для локального подключения:
```
wsUrl: ws://127.0.0.1:5080?token=dev-secret-change-me
```
Для продакшена рекомендуется TLS‑прокси и `wss`:
```
wsUrl: wss://security.example.com/ws?token=YOUR_TOKEN
```
В этом случае прокси должен проксировать `wss://.../ws` на `ws://app:5080`.

Вход выполняется только через Discord OAuth (email/пароль были отключены, если найдёте огрызки не ручаюсь).

## Discord OAuth (минимальная интеграция)
Нужно создать приложение в Discord Developer Portal и добавить redirect URI:
```
http://localhost:8080/api/auth/discord/callback
```

Затем заполнить в `docker-compose.yml`

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
Эт тоже в docker-compose файле есть

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

И не забудьте сменить токен Webhook.

## Содержание
- [Архитектура и модели](docs/architecture.md)
- [Авторизация через launcher token](docs/auth-flow.md)
- [API черновик](docs/api-draft.md)
