# Minecraft Security System

Документация по стартовой архитектуре и авторизации (launcher token), ориентированная на UX как у Ajax.

## Быстрый старт (UI + backend демо)
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
Откройте: http://localhost:8080

## Содержание
- [Архитектура и модели](docs/architecture.md)
- [Авторизация через launcher token](docs/auth-flow.md)
- [API черновик](docs/api-draft.md)
