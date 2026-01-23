# План деплоя

## 1. Подготовка окружения
- Сервер с Docker/Compose (Linux, минимум 2 CPU / 2 GB RAM).
- Домен/поддомен для UI и API (например, `security.example.com`).
- TLS сертификат (Let’s Encrypt). Рекомендуется прокси через Caddy/Nginx.

## 2. Конфигурация переменных
Сформируйте `.env` или секреты для `docker-compose.yml`:
- `DATABASE_URL` — строка подключения к Postgres.
- `WEBHOOK_TOKEN` — общий токен для webhook событий от hub-backend.
- `WS_AUTH_TOKEN` — токен для WebSocket модов (передаётся в `wsUrl` как `?token=...`).
- `WEBHOOK_URL` — куда hub-backend отправляет события (обычно `http://127.0.0.1:8080/api/hub/events`).
- `HUB_API_URL` — куда backend отправляет команды хабам (обычно `http://127.0.0.1:8090`).

## 3. Развёртывание контейнеров
1. Собрать и поднять сервисы:
   ```bash
   docker compose up --build -d
   ```
   Если нет доступа к Docker Hub, используйте локальный/зеркальный образ:
   ```bash
   docker compose build --build-arg BASE_IMAGE=registry.example.com/node:20-alpine
   docker compose up -d
   ```
   Если нет доступа к npm registry, можно заранее положить `backend/node_modules` и
   `hub-backend/node_modules` в каталог сборки или указать свой registry:
   ```bash
   docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org
   ```
2. Инициализировать БД (единоразово):
   ```bash
   docker compose exec app node backend/seed.js
   ```

## 4. Настройка безопасности
- Оставить снаружи только порт UI/API (8080) или проксировать его на 443.
- Порты 5080/8090 держать закрытыми (доступ только внутри контейнера/VM).
- Включить `WS_AUTH_TOKEN` и прописать в `hubmod.yml`:
  `wsUrl: wss://security.example.com/ws?token=...`.

## 5. Прокси (пример)
Рекомендуется завернуть в TLS и проксировать WebSocket:
- `wss://security.example.com/ws` -> `app:5080`
- `https://security.example.com` -> `app:8080`

## 6. Проверка
- `GET /health` на hub-backend: `http://127.0.0.1:8090/health`
- UI доступна: `https://security.example.com/login.html`
- Логи WebSocket подключений появляются в `docker compose logs -f app`.

## 7. Обновления
1. Обновить код и пересобрать образ:
   ```bash
   docker compose up --build -d
   ```
2. Проверить логи и `/health`.
