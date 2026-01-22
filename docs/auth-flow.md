# Авторизация через launcher token

## Цель
Сайт открывается из лаунчера через WebView:

```
https://mysite.com/?token=TokenFromLauncher
```

Сайт обменивает `token` на данные пользователя через основной API и получает `discord.id`.

## Поток авторизации
1. WebView передаёт `token` через query string.
2. Frontend вызывает Backend сайта:
   - `POST /api/auth/launcher`
   - body: `{ "token": "..." }`
3. Backend сайта вызывает основной API:
   - `GET http://ApiServer.test/Key/AccountData/{token}`
4. Backend сайта сохраняет:
   - `discord.id` (ключевой идентификатор)
   - опционально `minecraft.uuid`, `lastMinecraftServer.serverId`
5. Backend выдаёт сессионный токен (HTTP-only cookie) для сайта.

## Минимально нужные поля
На текущем этапе **достаточно `discord.id`**, но желательно сохранить также:
- `minecraft.uuid` (для будущей связки с сервером)
- `lastMinecraftServer.serverId` (для дефолтного выбора объекта)

## Важные замечания
- Query token должен быть одноразовым или иметь TTL.
- Нельзя хранить launcher token на клиенте после обмена.
- Ответы внешнего API протоколируются как событие `auth_success/auth_failed`.

