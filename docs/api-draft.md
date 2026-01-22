# API черновик (v1)

## Общие правила
- Все запросы от Hub/Reader подписываются server-side ключом (будущий шаг).
- Время передаётся как UNIX ms (`ts`).

## Hub → Backend (webhook)
### POST /api/hub/events
```json
{
  "type": "PORT_IN",
  "hubId": "HUB-...",
  "ts": 1768950410557,
  "payload": {
    "side": "up",
    "level": 15,
    "pos": {"x": -8, "y": 79, "z": 23}
  }
}
```

Типы:
- `PORT_IN`
- `HUB_PING`
- `TEST_OK`
- `TEST_FAILED`

## Reader → Backend
### POST /api/reader/events
```json
{
  "type": "READER_SCAN",
  "readerId": "READER-...",
  "ts": 1768950595846,
  "payload": {
    "keyName": "Наблюдатель",
    "player": "Player585",
    "pos": {"x": -15, "y": 80, "z": 25}
  }
}
```

Правила обработки:
- `player` игнорируется
- `keyName` и `readerId` используются для проверки ключа
- Поддерживается любой префикс, главное чтобы ключ содержался в имени

## Backend → Hub (управление выходами)
### POST /api/hub/command
```json
{
  "hubId": "HUB-...",
  "side": "north",
  "state": "on",
  "level": 4
}
```

## Админ API (сайт)
### Space
- `POST /api/spaces` — создать пространство
- `DELETE /api/spaces/{spaceId}` — удалить (освобождает Hub)

### Hub
- `POST /api/hubs/{hubId}/attach` — привязать к Space
- `POST /api/hubs/{hubId}/detach` — отвязать

### Zones
- `POST /api/spaces/{spaceId}/zones`
- `PATCH /api/zones/{zoneId}`
- `DELETE /api/zones/{zoneId}`

### Outputs
- `POST /api/spaces/{spaceId}/outputs`
- `PATCH /api/outputs/{outputId}`
- `DELETE /api/outputs/{outputId}`

### Readers & Keys
- `POST /api/spaces/{spaceId}/readers`
- `POST /api/readers/{readerId}/keys`

### Users & Engineers
- `POST /api/spaces/{spaceId}/members`
- `DELETE /api/spaces/{spaceId}/members/{memberId}`

