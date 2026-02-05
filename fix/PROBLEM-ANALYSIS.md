# АНАЛИЗ ПРОБЛЕМЫ HUB_EXTENSION - PORT_IN НЕ УХОДИТ В ОФФЛАЙН

## 📊 СТАТУС
**Проблема:** Модуль расширения не помечается как "Не в сети" при обработке PORT_IN событий, но корректно работает для SET_OUTPUT событий.

**Дата анализа:** 2026-02-05  
**Файлы:** `backend/server.js`, `hub-backend/server.js`

---

## 🔍 ГЛУБОКИЙ АНАЛИЗ ПРОБЛЕМЫ

### 1. Что происходит (из логов)

```
18:05:23 Модуль расширения снова в сети HUB_EXT-c84fff32-8895-43d3-ace6-86dcd58675f3
[EV] {"type":"SET_OUTPUT","hubId":"HUB_EXT-...","ts":1770221122957,"payload":{"side":"east","level":15,"enabled":true}}
[EV] {"type":"SET_OUTPUT","hubId":"HUB_EXT-...","ts":1770221123263,"payload":{"side":"east","level":0,"enabled":false}}

[EV] {"type":"PORT_IN","hubId":"HUB_EXT-...","ts":1770221131108,"payload":{"side":"east","level":0,...}}
[EV] {"type":"SET_OUTPUT","hubId":"HUB_EXT-...","ts":1770221131527,"payload":{"side":"east","level":15,"enabled":true}}
[EV] {"type":"SET_OUTPUT","hubId":"HUB_EXT-...","ts":1770221131832,"payload":{"side":"east","level":0,"enabled":false}}

18:05:33 Модуль расширения не в сети HUB_EXT-c84fff32-8895-43d3-ace6-86dcd58675f3
```

**Наблюдения:**
- ✅ SET_OUTPUT события приводят к корректному обнаружению оффлайна
- ❌ PORT_IN события НЕ приводят к обнаружению оффлайна
- ⚠️ Модуль продолжает отправлять PORT_IN даже когда "не в сети"

---

### 2. Корневая причина (CODE ROOT CAUSE)

#### 📍 Файл: `backend/server.js`, строки 2550-2584

```javascript
if (isExtensionEvent) {
    // ... получение extensionDevice из БД ...
    
    const extensionSide = normalizeSideValue(extensionDevice?.config?.extensionSide);
    const mirrorExtensionSide = extensionSide ? mirrorOutputSide(extensionSide) : null;
    const eventSide = normalizeSideValue(payload?.side);
    
    // ✅ Это работает для SET_OUTPUT
    const isTestSetOutput = Boolean(
        type === 'SET_OUTPUT'
        && eventSide
        && extensionSide
        && (eventSide === extensionSide || eventSide === mirrorExtensionSide),
    );
    
    // ❌ ЭТО ПРОБЛЕМА! Для PORT_IN
    const isTestSideEvent = Boolean(
        eventSide
        && extensionSide
        && eventSide === extensionSide,  // ← ТОЛЬКО проверка стороны!
    );
    
    if (isTestSetOutput || isTestSideEvent) {
        return res.status(202).json({ ok: true, ignored: true });  // ← PORT_IN игнорируется!
    }
    
    spaceId = extensionDevice.space_id;
    const isOnline = await checkHubExtensionLink(spaceId, extensionDevice);  // ← НИКОГДА НЕ ВЫЗЫВАЕТСЯ для PORT_IN!
    
    if (!isOnline) {
        return res.json({ ok: true, extensionOffline: true });
    }
}
```

---

### 3. ПРОБЛЕМА В ДЕТАЛЯХ

#### ❌ Проблема №1: `isTestSideEvent` слишком широкая

**Что происходит:**
```javascript
const isTestSideEvent = Boolean(
    eventSide && extensionSide && eventSide === extensionSide
);
```

**Проблема:**
- Проверяет ТОЛЬКО совпадение стороны события с `extensionSide`
- НЕ различает:
  - Тестовые PORT_IN (импульсы 0→15→0 для проверки связи)
  - Обычные PORT_IN от зон модуля расширения
- Результат: **ВСЕ PORT_IN с `extensionSide` игнорируются**

**Пример:**
```
extensionSide = "east"  (тестовая сторона модуля)

PORT_IN с side="east", level=15 → isTestSideEvent=true → ignored ❌
PORT_IN с side="east", level=5  → isTestSideEvent=true → ignored ❌
PORT_IN с side="west", level=15 → isTestSideEvent=false → обрабатывается ✅
```

#### ❌ Проблема №2: `checkHubExtensionLink()` не вызывается

**Поток выполнения для PORT_IN:**
```
1. PORT_IN от HUB_EXT приходит
2. isExtensionEvent = true
3. eventSide = "east" (из payload)
4. extensionSide = "east" (из config)
5. isTestSideEvent = true (eventSide === extensionSide)
6. return ignored ← ВЫХОД ИЗ ФУНКЦИИ
7. checkHubExtensionLink() НЕ ВЫЗЫВАЕТСЯ ← ПРОБЛЕМА!
```

**Поток выполнения для SET_OUTPUT:**
```
1. SET_OUTPUT от HUB_EXT приходит
2. isExtensionEvent = true
3. eventSide = "west" (например, сторона выхода)
4. extensionSide = "east" (тестовая сторона)
5. isTestSetOutput = false (type=SET_OUTPUT, но side не совпадает)
6. isTestSideEvent = false (side не совпадает)
7. checkHubExtensionLink() ВЫЗЫВАЕТСЯ ← РАБОТАЕТ!
8. if (!isOnline) return extensionOffline ← МОДУЛЬ УХОДИТ В ОФФЛАЙН!
```

---

### 4. ПОЧЕМУ SET_OUTPUT РАБОТАЕТ, А PORT_IN НЕТ?

#### ✅ SET_OUTPUT работает потому что:

1. **Разные стороны:**
   - `extensionSide = "east"` (тестовая сторона модуля)
   - SET_OUTPUT обычно на `side = "west"`, "north", etc (стороны выходов/сирен)
   - `eventSide !== extensionSide` → `isTestSideEvent = false`
   - `checkHubExtensionLink()` выполняется

2. **Тестовые SET_OUTPUT фильтруются правильно:**
   ```javascript
   const isTestSetOutput = Boolean(
       type === 'SET_OUTPUT'
       && eventSide === extensionSide  // или mirror
   );
   ```
   - Проверяет type И сторону
   - Игнорирует ТОЛЬКО тестовые импульсы на тестовой стороне

#### ❌ PORT_IN не работает потому что:

1. **Зоны могут быть на той же стороне:**
   - Зона подключена к `extensionSide = "east"`
   - PORT_IN приходит с `side = "east"`
   - `isTestSideEvent = true` → игнорируется
   - Но это НЕ тестовое событие, это событие от зоны!

2. **isTestSideEvent не проверяет тип события:**
   ```javascript
   const isTestSideEvent = Boolean(
       eventSide && extensionSide && eventSide === extensionSide
   );
   ```
   - Не проверяет `type === 'PORT_IN'`
   - Не проверяет `level in [0, 15]`
   - Не проверяет, является ли это импульсом

---

### 5. КАК ДОЛЖНО БЫТЬ (ПРАВИЛЬНАЯ ЛОГИКА)

#### 🎯 Цель: Различать тестовые и обычные события

**Тестовые события (для проверки связи hub↔extension):**
- PORT_IN на `hubSide` с `level in [0, 15]` в рамках импульса 1500ms
- SET_OUTPUT на `extensionSide` (или mirror) с `level in [0, 15]`

**Обычные события (от устройств):**
- PORT_IN от зон модуля расширения (любой side, любой level)
- SET_OUTPUT к выходам модуля (любой side, любой level)

#### ✅ Исправленная логика:

```javascript
if (isExtensionEvent) {
    // ... получение extensionDevice ...
    
    const hubSide = normalizeSideValue(extensionDevice?.config?.hubSide);
    const extensionSide = normalizeSideValue(extensionDevice?.config?.extensionSide);
    const mirrorExtensionSide = extensionSide ? mirrorOutputSide(extensionSide) : null;
    const eventSide = normalizeSideValue(payload?.side);
    const eventLevel = Number(payload?.level);
    
    // ========================================================================
    // ИСПРАВЛЕНИЕ: Более точное определение тестовых событий
    // ========================================================================
    
    // Тестовые SET_OUTPUT - это импульсы на тестовой стороне модуля
    const isTestSetOutput = Boolean(
        type === 'SET_OUTPUT'
        && eventSide
        && extensionSide
        && (eventSide === extensionSide || eventSide === mirrorExtensionSide)
        && (eventLevel === 0 || eventLevel === 15)  // ← ДОБАВИТЬ!
    );
    
    // Тестовые PORT_IN - это события на тестовой стороне хаба
    // НО мы их обрабатываем на хабе (строки 2593-2617), не здесь!
    // Поэтому для модуля расширения мы НЕ игнорируем PORT_IN
    
    const isTestSideEvent = false;  // ← УБРАТЬ ПРОВЕРКУ для PORT_IN от HUB_EXT!
    
    // ИЛИ, если нужно игнорировать какие-то специфические PORT_IN:
    // const isTestPortInFromExtension = Boolean(
    //     type === 'PORT_IN'
    //     && eventSide === extensionSide
    //     && (eventLevel === 0 || eventLevel === 15)
    //     && /* дополнительная логика для определения импульса */
    // );
    
    if (isTestSetOutput) {
        return res.status(202).json({ ok: true, ignored: true });
    }
    
    // ========================================================================
    // ВАЖНО: checkHubExtensionLink() ТЕПЕРЬ ВЫЗЫВАЕТСЯ для ВСЕХ PORT_IN!
    // ========================================================================
    
    spaceId = extensionDevice.space_id;
    const isOnline = await checkHubExtensionLink(spaceId, extensionDevice);
    
    if (!isOnline) {
        return res.json({ ok: true, extensionOffline: true });
    }
}
```

---

### 6. ГДЕ ОБРАБАТЫВАЮТСЯ ТЕСТОВЫЕ PORT_IN

#### 📍 Файл: `backend/server.js`, строки 2593-2617

**Правильная обработка тестовых PORT_IN от хаба:**

```javascript
if (!isExtensionEvent && type === 'PORT_IN') {
    const normalizedSide = normalizeSideValue(payload?.side);
    const inputLevel = Number(payload?.level);
    
    if (normalizedSide && !Number.isNaN(inputLevel)) {
        // Получаем список модулей расширения с их тестовыми сторонами
        const extensionTestDevices = await getHubExtensionTestDevices(spaceId);
        
        if (extensionTestDevices.length) {
            // Резолвим ожидания для checkHubExtensionLink()
            extensionTestDevices.forEach((device) => {
                const hubSide = normalizeSideValue(device.hub_side);
                if (hubSide && hubSide === normalizedSide) {
                    const extensionKey = device.id ?? normalizeHubExtensionId(device.extension_id);
                    if (extensionKey) {
                        resolveHubPortWaiter(spaceId, extensionKey, normalizedSide, inputLevel, Date.now());
                    }
                }
            });
            
            // Игнорируем тестовые PORT_IN (level 0 или 15 на тестовой стороне хаба)
            if (inputLevel === 0 || inputLevel === 15) {
                const isTestPortEvent = extensionTestDevices.some(
                    (device) => normalizeSideValue(device.hub_side) === normalizedSide,
                );
                if (isTestPortEvent) {
                    return res.status(202).json({ ok: true, ignored: true });
                }
            }
        }
    }
}
```

**Эта логика работает правильно!** Она:
1. ✅ Резолвит ожидания для `waitForHubPort()` в `checkHubExtensionLink()`
2. ✅ Игнорирует тестовые PORT_IN (level 0/15 на hubSide)
3. ✅ Пропускает обычные PORT_IN от зон хаба

---

## 🛠️ ПЛАН ИСПРАВЛЕНИЯ

### Шаг 1: Добавить диагностические логи

1. Скопировать код из файла `diagnostic-logs-patch.js`
2. Добавить логи в `backend/server.js` в соответствующие места
3. Перезапустить контейнер
4. Отключить модуль от хаба
5. Проверить логи

**Что мы увидим:**
- Какие события приходят от HUB_EXT
- Какие условия срабатывают (isTestSetOutput, isTestSideEvent)
- Вызывается ли `checkHubExtensionLink()`
- Результаты проверки связи
- Обновления статуса

### Шаг 2: Исправить логику `isTestSideEvent`

**Вариант A: Убрать проверку для PORT_IN**

```javascript
const isTestSideEvent = Boolean(
    type !== 'PORT_IN'  // ← ДОБАВИТЬ: не применять к PORT_IN
    && eventSide
    && extensionSide
    && eventSide === extensionSide
);
```

**Вариант B: Проверять только SET_OUTPUT**

```javascript
const isTestSideEvent = Boolean(
    type === 'SET_OUTPUT'  // ← ИЗМЕНИТЬ: только для SET_OUTPUT
    && eventSide
    && extensionSide
    && (eventSide === extensionSide || eventSide === mirrorExtensionSide)
    && (eventLevel === 0 || eventLevel === 15)
);

// Объединить с isTestSetOutput:
const isTestEvent = isTestSideEvent;  // isTestSetOutput можно удалить
```

**Вариант C: Точное определение тестовых PORT_IN (сложно)**

Определить тестовые PORT_IN можно только по контексту:
- Приходят ли они парами (0→15 или 15→0)?
- В рамках временного окна 1500ms?
- С правильной стороны (extensionSide)?

Но это сложно, потому что PORT_IN от зон тоже могут быть 0/15.

**РЕКОМЕНДАЦИЯ:** Использовать **Вариант A** как самый простой и надёжный.

### Шаг 3: Протестировать

1. Включить логи
2. Отключить модуль от хаба физически
3. Проверить:
   - ✅ `checkHubExtensionLink()` вызывается
   - ✅ Модуль помечается "Не в сети"
   - ✅ События игнорируются
4. Подключить модуль обратно
5. Проверить:
   - ✅ `checkHubExtensionLink()` вызывается
   - ✅ Модуль помечается "Снова в сети"
   - ✅ События обрабатываются

### Шаг 4: Убрать диагностические логи

После успешного тестирования:
1. Убрать детальные логи
2. Оставить только критичные (онлайн/оффлайн)
3. Закоммитить исправления

---

## 📝 ВЫВОДЫ

### Корневая причина проблемы:

**`isTestSideEvent` игнорирует ВСЕ PORT_IN с `extensionSide`, включая события от зон.**

### Почему SET_OUTPUT работает:

**Выходы обычно на других сторонах, поэтому `isTestSideEvent = false` и `checkHubExtensionLink()` вызывается.**

### Как исправить:

**Не применять `isTestSideEvent` к PORT_IN событиям, чтобы `checkHubExtensionLink()` всегда вызывался.**

### Тестовые PORT_IN обрабатываются правильно:

**Код на строках 2593-2617 корректно резолвит ожидания и игнорирует тестовые события на хабе.**

---

## 🚀 СЛЕДУЮЩИЕ ШАГИ

1. ✅ Добавить диагностические логи из `diagnostic-logs-patch.js`
2. 🔍 Запустить тесты и изучить логи
3. 🛠️ Исправить логику `isTestSideEvent` (Вариант A)
4. ✅ Протестировать оффлайн/онлайн модуля
5. 🗑️ Убрать избыточные логи
6. 📦 Закоммитить исправления

---

## 📎 ПРИЛОЖЕНИЯ

### A. Структура тестовой проверки связи

```
1. checkHubExtensionLink() запускается
2. Отправляет SET_OUTPUT(level=15) на extensionSide модуля
3. Ждёт PORT_IN(level=15) на hubSide хаба в течение 1500ms
4. Отправляет SET_OUTPUT(level=0) на extensionSide модуля (через MIN_INTERVAL_MS)
5. Ждёт PORT_IN(level=0) на hubSide хаба в оставшееся время
6. Если оба сигнала получены → isOnline=true
7. Если хотя бы один не получен → isOnline=false
```

### B. Кэширование результатов

```javascript
const EXTENSION_TEST_WINDOW_MS = 1500;

extensionLinkChecks.set(cacheKey, {
    lastCheckAt: Date.now(),
    lastResult: true/false,
    promise: Promise (пока выполняется)
});

// Повторная проверка НЕ запускается, если:
// - now - lastCheckAt < 1500ms
// - lastResult !== undefined
// - promise === undefined (не выполняется)
```

### C. Стороны и зеркалирование

```javascript
const mirrorOutputSide = (side) => {
    const mirrors = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
    return mirrors[side?.toLowerCase()] ?? null;
};

// Пример:
// hubSide = "west" (тестовая сторона хаба)
// extensionSide = "east" (тестовая сторона модуля)
// mirrorExtensionSide = "west" (зеркало тестовой стороны модуля)

// SET_OUTPUT на "east" или "west" модуля → тестовый
// SET_OUTPUT на "north", "south", etc → обычный
```

---

**Документ подготовлен:** 2026-02-05  
**Версия:** 1.0  
**Статус:** Готов к применению
