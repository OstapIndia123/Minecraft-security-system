// ============================================================================
// ДИАГНОСТИЧЕСКИЕ ЛОГИ ДЛЯ ОТЛАДКИ HUB_EXTENSION
// ============================================================================
// 
// ПРОБЛЕМА:
// Модуль расширения не уходит в оффлайн при обработке PORT_IN событий,
// но корректно работает для SET_OUTPUT событий.
//
// АНАЛИЗ КОДА:
// 1. В строке 2550-2584 есть блок обработки isExtensionEvent
// 2. Проверка checkHubExtensionLink() вызывается ТОЛЬКО на строке 2581
// 3. Проверка НЕ вызывается для PORT_IN с тестовой стороны (isTestSideEvent)
// 4. Условие isTestSideEvent (строка 2572-2576) блокирует все PORT_IN 
//    с extensionSide, включая НЕ тестовые события
//
// ПРОБЛЕМА В ЛОГИКЕ:
// - isTestSideEvent проверяет только совпадение стороны (eventSide === extensionSide)
// - НЕ проверяет, является ли событие тестовым (level 0/15 + импульс)
// - Все PORT_IN с extensionSide игнорируются как "тестовые", даже если это
//   обычные события от зон
//
// ПУТЬ РЕШЕНИЯ:
// 1. Добавить детальные логи для понимания потока событий
// 2. Различать тестовые PORT_IN (для связи hub-extension) от обычных PORT_IN от зон
// 3. Вызывать checkHubExtensionLink() перед обработкой ВСЕХ нетестовых событий
// ============================================================================

// Патч для добавления в backend/server.js после строки 2550

// ============================================================================
// БЛОК 1: Логи в начале обработки isExtensionEvent (после строки 2550)
// ============================================================================

/*
ВСТАВИТЬ ПОСЛЕ СТРОКИ 2550:
*/

console.log('\n=== [HUB_EXT DEBUG] Начало обработки события ===');
console.log('[HUB_EXT DEBUG] type:', type);
console.log('[HUB_EXT DEBUG] hubId:', hubId);
console.log('[HUB_EXT DEBUG] isExtensionEvent:', isExtensionEvent);
console.log('[HUB_EXT DEBUG] payload:', JSON.stringify(payload, null, 2));

if (isExtensionEvent) {
    normalizedExtensionId = normalizeHubExtensionId(hubId);
    console.log('[HUB_EXT DEBUG] normalizedExtensionId:', normalizedExtensionId);
    
    if (!normalizedExtensionId) {
        console.log('[HUB_EXT DEBUG] ❌ normalizedExtensionId пустой - игнорируем');
        return res.status(202).json({ ok: true, ignored: true });
    }
    
    const extensionResult = await query(
        "SELECT * FROM devices WHERE LOWER(type) = ANY($1) AND config->>'extensionId' = $2 LIMIT 1",
        [HUB_EXTENSION_TYPES, normalizedExtensionId],
    );
    
    console.log('[HUB_EXT DEBUG] extensionResult.rows.length:', extensionResult.rows.length);
    
    if (!extensionResult.rows.length) {
        console.log('[HUB_EXT DEBUG] ❌ Модуль расширения не найден в БД - игнорируем');
        return res.status(202).json({ ok: true, ignored: true });
    }
    
    extensionDevice = extensionResult.rows[0];
    console.log('[HUB_EXT DEBUG] extensionDevice.id:', extensionDevice.id);
    console.log('[HUB_EXT DEBUG] extensionDevice.status:', extensionDevice.status);
    console.log('[HUB_EXT DEBUG] extensionDevice.config:', JSON.stringify(extensionDevice.config, null, 2));
    
    const extensionSide = normalizeSideValue(extensionDevice?.config?.extensionSide);
    const mirrorExtensionSide = extensionSide ? mirrorOutputSide(extensionSide) : null;
    const eventSide = normalizeSideValue(payload?.side);
    
    console.log('[HUB_EXT DEBUG] extensionSide (тестовая сторона модуля):', extensionSide);
    console.log('[HUB_EXT DEBUG] mirrorExtensionSide:', mirrorExtensionSide);
    console.log('[HUB_EXT DEBUG] eventSide (сторона из события):', eventSide);
    
    // ========================================================================
    // КРИТИЧЕСКАЯ ПРОВЕРКА: Определяем, является ли событие тестовым
    // ========================================================================
    
    const isTestSetOutput = Boolean(
        type === 'SET_OUTPUT'
        && eventSide
        && extensionSide
        && (eventSide === extensionSide || eventSide === mirrorExtensionSide),
    );
    
    console.log('[HUB_EXT DEBUG] isTestSetOutput:', isTestSetOutput);
    console.log('[HUB_EXT DEBUG]   - условие type === SET_OUTPUT:', type === 'SET_OUTPUT');
    console.log('[HUB_EXT DEBUG]   - условие eventSide:', eventSide);
    console.log('[HUB_EXT DEBUG]   - условие extensionSide:', extensionSide);
    console.log('[HUB_EXT DEBUG]   - условие совпадение сторон:', (eventSide === extensionSide || eventSide === mirrorExtensionSide));
    
    // ========================================================================
    // ⚠️ ПРОБЛЕМНОЕ МЕСТО: isTestSideEvent НЕ проверяет, является ли PORT_IN тестовым!
    // Он просто проверяет совпадение стороны события с тестовой стороной модуля
    // ========================================================================
    
    const isTestSideEvent = Boolean(
        eventSide
        && extensionSide
        && eventSide === extensionSide,
    );
    
    console.log('[HUB_EXT DEBUG] isTestSideEvent (ПРОБЛЕМНОЕ УСЛОВИЕ):', isTestSideEvent);
    console.log('[HUB_EXT DEBUG]   - условие eventSide === extensionSide:', eventSide === extensionSide);
    console.log('[HUB_EXT DEBUG]   ⚠️ ВНИМАНИЕ: Это условие игнорирует ВСЕ PORT_IN с тестовой стороны!');
    console.log('[HUB_EXT DEBUG]   ⚠️ НЕ различает тестовые импульсы от обычных событий зон!');
    
    if (isTestSetOutput || isTestSideEvent) {
        console.log('[HUB_EXT DEBUG] ❌ Событие помечено как тестовое - игнорируем');
        console.log('[HUB_EXT DEBUG] ❌ ПРОБЛЕМА: Для PORT_IN это неправильно!');
        return res.status(202).json({ ok: true, ignored: true });
    }
    
    // ========================================================================
    // БЛОК 2: Проверка связи hub-extension (checkHubExtensionLink)
    // ========================================================================
    
    spaceId = extensionDevice.space_id;
    console.log('[HUB_EXT DEBUG] spaceId:', spaceId);
    console.log('[HUB_EXT DEBUG] 🔍 Вызываем checkHubExtensionLink...');
    
    const checkStartTime = Date.now();
    const isOnline = await checkHubExtensionLink(spaceId, extensionDevice);
    const checkDuration = Date.now() - checkStartTime;
    
    console.log('[HUB_EXT DEBUG] ✅ checkHubExtensionLink завершён');
    console.log('[HUB_EXT DEBUG]   - isOnline:', isOnline);
    console.log('[HUB_EXT DEBUG]   - время проверки:', checkDuration, 'ms');
    console.log('[HUB_EXT DEBUG]   - текущий статус модуля:', extensionDevice.status);
    
    if (!isOnline) {
        console.log('[HUB_EXT DEBUG] ❌ Модуль расширения не в сети - игнорируем событие');
        return res.json({ ok: true, extensionOffline: true });
    }
    
    console.log('[HUB_EXT DEBUG] ✅ Модуль расширения в сети - обрабатываем событие');
}

// ============================================================================
// БЛОК 3: Логи для обработки PORT_IN от хаба (после строки 2593)
// ============================================================================

/*
ВСТАВИТЬ ПОСЛЕ СТРОКИ 2593 (if (!isExtensionEvent && type === 'PORT_IN')):
*/

if (!isExtensionEvent && type === 'PORT_IN') {
    console.log('\n=== [HUB PORT_IN DEBUG] Обработка PORT_IN от хаба ===');
    const normalizedSide = normalizeSideValue(payload?.side);
    const inputLevel = Number(payload?.level);
    
    console.log('[HUB PORT_IN DEBUG] normalizedSide:', normalizedSide);
    console.log('[HUB PORT_IN DEBUG] inputLevel:', inputLevel);
    
    if (normalizedSide && !Number.isNaN(inputLevel)) {
        const extensionTestDevices = await getHubExtensionTestDevices(spaceId);
        console.log('[HUB PORT_IN DEBUG] extensionTestDevices.length:', extensionTestDevices.length);
        
        if (extensionTestDevices.length) {
            console.log('[HUB PORT_IN DEBUG] 🔍 Проверяем, является ли это тестовым PORT_IN для hub_extension...');
            
            extensionTestDevices.forEach((device, idx) => {
                const hubSide = normalizeSideValue(device.hub_side);
                console.log(`[HUB PORT_IN DEBUG] device[${idx}]:`, {
                    id: device.id,
                    extension_id: device.extension_id,
                    hub_side: hubSide,
                    совпадает_с_событием: hubSide === normalizedSide,
                });
                
                if (hubSide && hubSide === normalizedSide) {
                    const extensionKey = device.id ?? normalizeHubExtensionId(device.extension_id);
                    console.log(`[HUB PORT_IN DEBUG] ✅ Совпадение! Резолвим ожидание для extensionKey:`, extensionKey);
                    
                    if (extensionKey) {
                        const resolved = resolveHubPortWaiter(spaceId, extensionKey, normalizedSide, inputLevel, Date.now());
                        console.log(`[HUB PORT_IN DEBUG]   - resolveHubPortWaiter returned:`, resolved);
                    }
                }
            });
            
            // ====================================================================
            // ПРОВЕРКА: Является ли это тестовым событием?
            // ====================================================================
            
            if (inputLevel === 0 || inputLevel === 15) {
                const isTestPortEvent = extensionTestDevices.some(
                    (device) => normalizeSideValue(device.hub_side) === normalizedSide,
                );
                
                console.log('[HUB PORT_IN DEBUG] inputLevel === 0 или 15, проверяем isTestPortEvent:', isTestPortEvent);
                
                if (isTestPortEvent) {
                    console.log('[HUB PORT_IN DEBUG] ❌ Это тестовое PORT_IN событие - игнорируем');
                    return res.status(202).json({ ok: true, ignored: true });
                }
            }
        }
    }
}

// ============================================================================
// БЛОК 4: Логи внутри checkHubExtensionLink (заменить функцию)
// ============================================================================

/*
ЗАМЕНИТЬ ФУНКЦИЮ checkHubExtensionLink (строка 2438-2486):
*/

const checkHubExtensionLink = async (spaceId, extensionDevice) => {
    const config = extensionDevice.config ?? {};
    const extensionId = normalizeHubExtensionId(config.extensionId);
    const hubSide = normalizeSideValue(config.hubSide);
    const extensionSide = normalizeSideValue(config.extensionSide);
    const cacheKey = extensionDevice.id ?? extensionId;
    const now = Date.now();
    const cached = extensionLinkChecks.get(cacheKey);
    
    console.log('\n=== [CHECK_LINK DEBUG] Начало checkHubExtensionLink ===');
    console.log('[CHECK_LINK DEBUG] extensionDevice.id:', extensionDevice.id);
    console.log('[CHECK_LINK DEBUG] extensionId:', extensionId);
    console.log('[CHECK_LINK DEBUG] hubSide (тестовая сторона хаба):', hubSide);
    console.log('[CHECK_LINK DEBUG] extensionSide (тестовая сторона модуля):', extensionSide);
    console.log('[CHECK_LINK DEBUG] cacheKey:', cacheKey);
    console.log('[CHECK_LINK DEBUG] cached:', cached ? {
        lastCheckAt: new Date(cached.lastCheckAt).toISOString(),
        ageMs: now - cached.lastCheckAt,
        lastResult: cached.lastResult,
        hasPromise: !!cached.promise,
    } : 'нет кэша');
    
    if (cached?.promise) {
        console.log('[CHECK_LINK DEBUG] ⏳ Используем уже запущенную проверку (promise)');
        return cached.promise;
    }
    
    if (cached && now - cached.lastCheckAt < EXTENSION_TEST_WINDOW_MS && cached.lastResult !== undefined) {
        console.log('[CHECK_LINK DEBUG] ✅ Используем кэшированный результат:', cached.lastResult);
        console.log('[CHECK_LINK DEBUG]   - возраст кэша:', now - cached.lastCheckAt, 'ms');
        console.log('[CHECK_LINK DEBUG]   - окно кэша:', EXTENSION_TEST_WINDOW_MS, 'ms');
        return cached.lastResult;
    }
    
    console.log('[CHECK_LINK DEBUG] 🔍 Запускаем новую проверку связи...');
    
    const promise = (async () => {
        if (!extensionId || !hubSide || !extensionSide) {
            console.log('[CHECK_LINK DEBUG] ❌ Недостаточно данных для проверки');
            console.log('[CHECK_LINK DEBUG]   - extensionId:', extensionId);
            console.log('[CHECK_LINK DEBUG]   - hubSide:', hubSide);
            console.log('[CHECK_LINK DEBUG]   - extensionSide:', extensionSide);
            await updateExtensionStatus(spaceId, extensionDevice, false);
            extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
            return false;
        }
        
        const checkStartedAt = Date.now();
        console.log('[CHECK_LINK DEBUG] 🚀 Тест начат в:', new Date(checkStartedAt).toISOString());
        
        // Ожидаем HIGH сигнал (level=15) на hubSide
        console.log('[CHECK_LINK DEBUG] 📡 Шаг 1: Ожидаем HIGH (15) на hubSide:', hubSide);
        const waitForHigh = waitForHubPort(
            spaceId,
            cacheKey,
            hubSide,
            15,
            EXTENSION_TEST_WINDOW_MS,
            checkStartedAt,
        );
        
        // Отправляем импульс HIGH на extensionSide модуля
        console.log('[CHECK_LINK DEBUG] 📤 Шаг 2: Отправляем импульс HIGH (15) на extensionSide:', extensionSide);
        await pulseHubOutput(extensionId, extensionSide, 15).catch((err) => {
            console.log('[CHECK_LINK DEBUG] ⚠️ Ошибка при отправке импульса:', err.message);
            return null;
        });
        
        console.log('[CHECK_LINK DEBUG] ⏳ Шаг 3: Ожидаем получение HIGH на хабе...');
        const highAt = await waitForHigh;
        
        if (!highAt) {
            const elapsed = Date.now() - checkStartedAt;
            console.log('[CHECK_LINK DEBUG] ❌ НЕ получили HIGH сигнал');
            console.log('[CHECK_LINK DEBUG]   - время ожидания:', elapsed, 'ms');
            console.log('[CHECK_LINK DEBUG]   - таймаут:', EXTENSION_TEST_WINDOW_MS, 'ms');
            console.log('[CHECK_LINK DEBUG] ❌ ТЕСТ ПРОВАЛЕН: Связь не установлена');
            await updateExtensionStatus(spaceId, extensionDevice, false);
            extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
            return false;
        }
        
        console.log('[CHECK_LINK DEBUG] ✅ Получили HIGH сигнал в:', new Date(highAt).toISOString());
        console.log('[CHECK_LINK DEBUG]   - время до получения:', highAt - checkStartedAt, 'ms');
        
        // Ожидаем LOW сигнал (level=0)
        const remainingMs = Math.max(0, EXTENSION_TEST_WINDOW_MS - (Date.now() - checkStartedAt));
        console.log('[CHECK_LINK DEBUG] 📡 Шаг 4: Ожидаем LOW (0) на hubSide:', hubSide);
        console.log('[CHECK_LINK DEBUG]   - оставшееся время:', remainingMs, 'ms');
        
        const lowAt = await waitForHubPort(spaceId, cacheKey, hubSide, 0, remainingMs, highAt);
        
        const ok = Boolean(lowAt);
        const totalTime = Date.now() - checkStartedAt;
        
        if (ok) {
            console.log('[CHECK_LINK DEBUG] ✅ Получили LOW сигнал в:', new Date(lowAt).toISOString());
            console.log('[CHECK_LINK DEBUG]   - время до получения:', lowAt - highAt, 'ms');
            console.log('[CHECK_LINK DEBUG] ✅ ТЕСТ УСПЕШЕН: Связь установлена');
            console.log('[CHECK_LINK DEBUG]   - общее время теста:', totalTime, 'ms');
        } else {
            console.log('[CHECK_LINK DEBUG] ❌ НЕ получили LOW сигнал');
            console.log('[CHECK_LINK DEBUG]   - время ожидания:', remainingMs, 'ms');
            console.log('[CHECK_LINK DEBUG] ❌ ТЕСТ ПРОВАЛЕН: Импульс неполный');
            console.log('[CHECK_LINK DEBUG]   - общее время теста:', totalTime, 'ms');
        }
        
        await updateExtensionStatus(spaceId, extensionDevice, ok);
        extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: ok });
        
        console.log('[CHECK_LINK DEBUG] 💾 Результат сохранён в кэш:', ok);
        
        return ok;
    })();
    
    extensionLinkChecks.set(cacheKey, { lastCheckAt: now, promise });
    console.log('[CHECK_LINK DEBUG] 💾 Promise сохранён в кэш');
    
    return promise;
};

// ============================================================================
// БЛОК 5: Логи в updateExtensionStatus (заменить функцию)
// ============================================================================

/*
ЗАМЕНИТЬ ФУНКЦИЮ updateExtensionStatus (строка 2430-2436):
*/

const updateExtensionStatus = async (spaceId, extensionDevice, isOnline) => {
    const nextStatus = isOnline ? 'В сети' : 'Не в сети';
    const prevStatus = extensionDevice.status;
    
    console.log('\n=== [UPDATE_STATUS DEBUG] updateExtensionStatus ===');
    console.log('[UPDATE_STATUS DEBUG] extensionDevice.id:', extensionDevice.id);
    console.log('[UPDATE_STATUS DEBUG] extensionId:', extensionDevice.config?.extensionId);
    console.log('[UPDATE_STATUS DEBUG] prevStatus:', prevStatus);
    console.log('[UPDATE_STATUS DEBUG] nextStatus:', nextStatus);
    console.log('[UPDATE_STATUS DEBUG] isOnline:', isOnline);
    
    if (extensionDevice.status === nextStatus) {
        console.log('[UPDATE_STATUS DEBUG] ✅ Статус не изменился - пропускаем обновление');
        return;
    }
    
    console.log('[UPDATE_STATUS DEBUG] 📝 Обновляем статус в БД...');
    await query('UPDATE devices SET status = $1 WHERE id = $2', [nextStatus, extensionDevice.id]);
    
    const logText = isOnline ? 'Модуль расширения снова в сети' : 'Модуль расширения не в сети';
    console.log('[UPDATE_STATUS DEBUG] 📝 Добавляем лог:', logText);
    
    await appendLog(spaceId, logText, extensionDevice.config?.extensionId ?? extensionDevice.id, 'system');
    
    console.log('[UPDATE_STATUS DEBUG] ✅ Статус обновлён:', prevStatus, '->', nextStatus);
};

// ============================================================================
// БЛОК 6: Логи в resolveHubPortWaiter
// ============================================================================

/*
ЗАМЕНИТЬ ФУНКЦИЮ resolveHubPortWaiter (строка 618-634):
*/

const resolveHubPortWaiter = (spaceId, extensionKey, side, level, eventTime = Date.now()) => {
    const key = buildExtensionWaiterKey(spaceId, extensionKey, side, level);
    const waiters = extensionPortWaiters.get(key);
    
    console.log('\n=== [RESOLVE_WAITER DEBUG] resolveHubPortWaiter ===');
    console.log('[RESOLVE_WAITER DEBUG] key:', key);
    console.log('[RESOLVE_WAITER DEBUG] spaceId:', spaceId);
    console.log('[RESOLVE_WAITER DEBUG] extensionKey:', extensionKey);
    console.log('[RESOLVE_WAITER DEBUG] side:', side);
    console.log('[RESOLVE_WAITER DEBUG] level:', level);
    console.log('[RESOLVE_WAITER DEBUG] eventTime:', new Date(eventTime).toISOString());
    console.log('[RESOLVE_WAITER DEBUG] waiters:', waiters ? `есть (${waiters.length})` : 'нет');
    
    if (!waiters?.length) {
        console.log('[RESOLVE_WAITER DEBUG] ⚠️ Нет ожидающих - игнорируем');
        return false;
    }
    
    console.log('[RESOLVE_WAITER DEBUG] 🔍 Поиск подходящего waiter...');
    waiters.forEach((waiter, idx) => {
        console.log(`[RESOLVE_WAITER DEBUG]   waiter[${idx}]:`, {
            afterTimestamp: waiter.afterTimestamp ? new Date(waiter.afterTimestamp).toISOString() : null,
            подходит: waiter.afterTimestamp === null || eventTime >= waiter.afterTimestamp,
        });
    });
    
    const nextIndex = waiters.findIndex((waiter) => (
        waiter.afterTimestamp === null || eventTime >= waiter.afterTimestamp
    ));
    
    if (nextIndex === -1) {
        console.log('[RESOLVE_WAITER DEBUG] ❌ Не найден подходящий waiter');
        return false;
    }
    
    console.log('[RESOLVE_WAITER DEBUG] ✅ Найден waiter[' + nextIndex + ']');
    
    const [waiter] = waiters.splice(nextIndex, 1);
    waiter.resolve();
    
    if (waiters.length) {
        extensionPortWaiters.set(key, waiters);
        console.log('[RESOLVE_WAITER DEBUG] 📝 Осталось waiters:', waiters.length);
    } else {
        extensionPortWaiters.delete(key);
        console.log('[RESOLVE_WAITER DEBUG] 🗑️ Все waiters обработаны, удаляем из Map');
    }
    
    console.log('[RESOLVE_WAITER DEBUG] ✅ Waiter resolved успешно');
    
    return true;
};

// ============================================================================
// ВЫВОДЫ И РЕКОМЕНДАЦИИ
// ============================================================================

/*
ВЫВОДЫ ИЗ АНАЛИЗА КОДА:

1. ПРОБЛЕМА В ЛОГИКЕ isTestSideEvent (строки 2572-2576):
   - Условие проверяет ТОЛЬКО совпадение стороны события с тестовой стороной модуля
   - НЕ проверяет, является ли PORT_IN действительно тестовым импульсом
   - Результат: ВСЕ PORT_IN с extensionSide игнорируются, включая события от зон
   
2. checkHubExtensionLink() НЕ ВЫЗЫВАЕТСЯ для PORT_IN:
   - Из-за isTestSideEvent все PORT_IN с extensionSide возвращают ignored
   - checkHubExtensionLink() на строке 2581 никогда не выполняется
   - Результат: модуль НЕ помечается как "Не в сети" при отключении
   
3. ДЛЯ SET_OUTPUT ВСЁ РАБОТАЕТ:
   - isTestSetOutput проверяет type === 'SET_OUTPUT'
   - PORT_IN события не проходят эту проверку
   - checkHubExtensionLink() успешно вызывается
   - Модуль корректно уходит в оффлайн/онлайн

4. ТЕСТОВЫЕ PORT_IN ОБРАБАТЫВАЮТСЯ ПРАВИЛЬНО на хабе (строки 2593-2617):
   - getHubExtensionTestDevices() получает список модулей с тестовыми сторонами
   - resolveHubPortWaiter() резолвит ожидания
   - Тестовые PORT_IN (level 0/15) корректно игнорируются (строки 2608-2615)

РЕКОМЕНДАЦИИ:

1. ДОБАВИТЬ ЭТИ ЛОГИ в код для диагностики
   
2. ИСПРАВИТЬ ЛОГИКУ isTestSideEvent:
   - Текущая логика: eventSide === extensionSide
   - Новая логика: eventSide === extensionSide && level в [0, 15] && это импульс
   - ИЛИ: Убрать isTestSideEvent для PORT_IN, оставить только для других событий
   
3. ВЫЗЫВАТЬ checkHubExtensionLink() ПЕРЕД ОБРАБОТКОЙ ВСЕХ PORT_IN:
   - Переместить проверку ПОСЛЕ фильтрации тестовых событий
   - Но ПЕРЕД обработкой зон (строка 2727)
   
4. РАЗЛИЧАТЬ:
   - Тестовые PORT_IN (для проверки связи hub-extension)
   - Обычные PORT_IN от зон модуля расширения

ВАЖНО:
Эти логи помогут понять:
- Какие события приходят
- Какие условия срабатывают
- Почему checkHubExtensionLink() не вызывается
- Как работает кэширование результатов
- Почему модуль не уходит в оффлайн
*/

// ============================================================================
// ИНСТРУКЦИЯ ПО ПРИМЕНЕНИЮ
// ============================================================================

/*
1. Откройте файл backend/server.js
2. Добавьте логи из БЛОКОВ 1-6 в соответствующие места
3. Перезапустите контейнер: docker-compose restart app
4. Отключите модуль расширения от хаба
5. Проверьте логи: docker-compose logs -f app
6. Анализируйте вывод по блокам:
   - [HUB_EXT DEBUG] - обработка событий модуля
   - [HUB PORT_IN DEBUG] - обработка PORT_IN от хаба
   - [CHECK_LINK DEBUG] - проверка связи
   - [UPDATE_STATUS DEBUG] - обновление статуса
   - [RESOLVE_WAITER DEBUG] - резолв ожиданий

7. Найдите место, где логика ломается
8. Сравните с SET_OUTPUT событиями (которые работают)
9. Исправьте логику на основе выводов
*/
