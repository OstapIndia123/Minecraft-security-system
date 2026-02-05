/*
 * ============================================================================
 * ДИАГНОСТИЧЕСКИЙ ПАТЧ ДЛЯ BACKEND/SERVER.JS
 * ============================================================================
 * 
 * ЦЕЛЬ: Добавить детальные логи для отладки проблемы с hub_extension PORT_IN
 * 
 * ПРОБЛЕМА: Модуль расширения не уходит в оффлайн при обработке PORT_IN,
 *           но корректно работает для SET_OUTPUT
 * 
 * ПРИМЕНЕНИЕ:
 * 1. Открыть backend/server.js
 * 2. Найти функции и блоки кода по комментариям
 * 3. ЗАМЕНИТЬ или ДОБАВИТЬ код из этого патча
 * 4. Перезапустить: docker-compose restart app
 * 5. Проверить логи: docker-compose logs -f app | grep "HUB_EXT\|CHECK_LINK\|UPDATE_STATUS\|RESOLVE_WAITER"
 * 
 * ============================================================================
 */

// ============================================================================
// ПАТЧ 1: Логи в начале обработки isExtensionEvent
// НАЙТИ: строку 2550 с "if (isExtensionEvent) {"
// ЗАМЕНИТЬ: весь блок до строки 2584
// ============================================================================

  console.log('\n' + '='.repeat(80));
  console.log('[HUB_EXT DEBUG] Начало обработки события');
  console.log('[HUB_EXT DEBUG] Timestamp:', new Date().toISOString());
  console.log('[HUB_EXT DEBUG] type:', type);
  console.log('[HUB_EXT DEBUG] hubId:', hubId);
  console.log('[HUB_EXT DEBUG] isExtensionEvent:', isExtensionEvent);
  console.log('[HUB_EXT DEBUG] payload:', JSON.stringify(payload, null, 2));
  console.log('='.repeat(80));

  if (isExtensionEvent) {
    normalizedExtensionId = normalizeHubExtensionId(hubId);
    console.log('[HUB_EXT DEBUG] → normalizedExtensionId:', normalizedExtensionId);
    
    if (!normalizedExtensionId) {
      console.log('[HUB_EXT DEBUG] ❌ normalizedExtensionId пустой - ИГНОРИРУЕМ');
      return res.status(202).json({ ok: true, ignored: true });
    }
    
    const extensionResult = await query(
      "SELECT * FROM devices WHERE LOWER(type) = ANY($1) AND config->>'extensionId' = $2 LIMIT 1",
      [HUB_EXTENSION_TYPES, normalizedExtensionId],
    );
    
    console.log('[HUB_EXT DEBUG] → extensionResult.rows.length:', extensionResult.rows.length);
    
    if (!extensionResult.rows.length) {
      console.log('[HUB_EXT DEBUG] ❌ Модуль расширения НЕ найден в БД - ИГНОРИРУЕМ');
      return res.status(202).json({ ok: true, ignored: true });
    }
    
    extensionDevice = extensionResult.rows[0];
    console.log('[HUB_EXT DEBUG] ✅ Модуль расширения найден:');
    console.log('[HUB_EXT DEBUG]   - id:', extensionDevice.id);
    console.log('[HUB_EXT DEBUG]   - name:', extensionDevice.name);
    console.log('[HUB_EXT DEBUG]   - status:', extensionDevice.status);
    console.log('[HUB_EXT DEBUG]   - config.extensionId:', extensionDevice.config?.extensionId);
    console.log('[HUB_EXT DEBUG]   - config.hubSide:', extensionDevice.config?.hubSide);
    console.log('[HUB_EXT DEBUG]   - config.extensionSide:', extensionDevice.config?.extensionSide);
    
    const extensionSide = normalizeSideValue(extensionDevice?.config?.extensionSide);
    const mirrorExtensionSide = extensionSide ? mirrorOutputSide(extensionSide) : null;
    const eventSide = normalizeSideValue(payload?.side);
    const eventLevel = Number(payload?.level);
    
    console.log('[HUB_EXT DEBUG] → Анализ сторон:');
    console.log('[HUB_EXT DEBUG]   - extensionSide (тестовая сторона модуля):', extensionSide);
    console.log('[HUB_EXT DEBUG]   - mirrorExtensionSide:', mirrorExtensionSide);
    console.log('[HUB_EXT DEBUG]   - eventSide (сторона из события):', eventSide);
    console.log('[HUB_EXT DEBUG]   - eventLevel (уровень из события):', eventLevel);
    
    // ========================================================================
    // КРИТИЧЕСКАЯ ПРОВЕРКА: Определяем тестовые события
    // ========================================================================
    
    const isTestSetOutput = Boolean(
      type === 'SET_OUTPUT'
      && eventSide
      && extensionSide
      && (eventSide === extensionSide || eventSide === mirrorExtensionSide),
    );
    
    console.log('[HUB_EXT DEBUG] → Проверка isTestSetOutput:', isTestSetOutput);
    if (isTestSetOutput) {
      console.log('[HUB_EXT DEBUG]   ✓ type === SET_OUTPUT:', type === 'SET_OUTPUT');
      console.log('[HUB_EXT DEBUG]   ✓ eventSide:', eventSide);
      console.log('[HUB_EXT DEBUG]   ✓ extensionSide:', extensionSide);
      console.log('[HUB_EXT DEBUG]   ✓ стороны совпадают:', (eventSide === extensionSide || eventSide === mirrorExtensionSide));
    }
    
    // ⚠️ ПРОБЛЕМНОЕ МЕСТО!
    const isTestSideEvent = Boolean(
      eventSide
      && extensionSide
      && eventSide === extensionSide,
    );
    
    console.log('[HUB_EXT DEBUG] → Проверка isTestSideEvent (⚠️ ПРОБЛЕМНОЕ!):', isTestSideEvent);
    if (isTestSideEvent) {
      console.log('[HUB_EXT DEBUG]   ⚠️ eventSide === extensionSide:', eventSide === extensionSide);
      console.log('[HUB_EXT DEBUG]   ⚠️ ВНИМАНИЕ: Это игнорирует ВСЕ события с extensionSide!');
      console.log('[HUB_EXT DEBUG]   ⚠️ Для PORT_IN это НЕПРАВИЛЬНО - зоны могут быть на этой стороне!');
    }
    
    if (isTestSetOutput || isTestSideEvent) {
      console.log('[HUB_EXT DEBUG] ❌ Событие помечено как ТЕСТОВОЕ - ИГНОРИРУЕМ');
      console.log('[HUB_EXT DEBUG] ❌ isTestSetOutput:', isTestSetOutput);
      console.log('[HUB_EXT DEBUG] ❌ isTestSideEvent:', isTestSideEvent);
      console.log('[HUB_EXT DEBUG] ❌ checkHubExtensionLink() НЕ БУДЕТ ВЫЗВАН!');
      console.log('='.repeat(80) + '\n');
      return res.status(202).json({ ok: true, ignored: true });
    }
    
    // ========================================================================
    // Проверка связи hub-extension
    // ========================================================================
    
    spaceId = extensionDevice.space_id;
    console.log('[HUB_EXT DEBUG] → spaceId:', spaceId);
    console.log('[HUB_EXT DEBUG] 🔍 Вызываем checkHubExtensionLink()...');
    
    const checkStartTime = Date.now();
    const isOnline = await checkHubExtensionLink(spaceId, extensionDevice);
    const checkDuration = Date.now() - checkStartTime;
    
    console.log('[HUB_EXT DEBUG] ✅ checkHubExtensionLink() завершён');
    console.log('[HUB_EXT DEBUG]   - результат isOnline:', isOnline);
    console.log('[HUB_EXT DEBUG]   - время проверки:', checkDuration, 'ms');
    console.log('[HUB_EXT DEBUG]   - текущий статус:', extensionDevice.status);
    
    if (!isOnline) {
      console.log('[HUB_EXT DEBUG] ❌ Модуль НЕ в сети - событие ИГНОРИРУЕТСЯ');
      console.log('='.repeat(80) + '\n');
      return res.json({ ok: true, extensionOffline: true });
    }
    
    console.log('[HUB_EXT DEBUG] ✅ Модуль В сети - событие ОБРАБАТЫВАЕТСЯ');
    console.log('='.repeat(80) + '\n');
  }

// ============================================================================
// ПАТЧ 2: Логи для PORT_IN от хаба
// НАЙТИ: строку 2593 с "if (!isExtensionEvent && type === 'PORT_IN') {"
// ЗАМЕНИТЬ: весь блок до строки 2618
// ============================================================================

  if (!isExtensionEvent && type === 'PORT_IN') {
    console.log('\n' + '='.repeat(80));
    console.log('[HUB PORT_IN DEBUG] Обработка PORT_IN от хаба');
    console.log('[HUB PORT_IN DEBUG] Timestamp:', new Date().toISOString());
    
    const normalizedSide = normalizeSideValue(payload?.side);
    const inputLevel = Number(payload?.level);
    
    console.log('[HUB PORT_IN DEBUG] → normalizedSide:', normalizedSide);
    console.log('[HUB PORT_IN DEBUG] → inputLevel:', inputLevel);
    
    if (normalizedSide && !Number.isNaN(inputLevel)) {
      const extensionTestDevices = await getHubExtensionTestDevices(spaceId);
      console.log('[HUB PORT_IN DEBUG] → extensionTestDevices.length:', extensionTestDevices.length);
      
      if (extensionTestDevices.length) {
        console.log('[HUB PORT_IN DEBUG] 🔍 Проверяем тестовые устройства hub_extension...');
        
        extensionTestDevices.forEach((device, idx) => {
          const hubSide = normalizeSideValue(device.hub_side);
          const matches = hubSide === normalizedSide;
          
          console.log(`[HUB PORT_IN DEBUG]   device[${idx}]:`, {
            id: device.id,
            extension_id: device.extension_id,
            hub_side: hubSide,
            совпадает: matches ? '✓' : '✗',
          });
          
          if (hubSide && hubSide === normalizedSide) {
            const extensionKey = device.id ?? normalizeHubExtensionId(device.extension_id);
            console.log(`[HUB PORT_IN DEBUG]   → extensionKey:`, extensionKey);
            
            if (extensionKey) {
              console.log(`[HUB PORT_IN DEBUG]   → Резолвим waiter...`);
              const resolved = resolveHubPortWaiter(spaceId, extensionKey, normalizedSide, inputLevel, Date.now());
              console.log(`[HUB PORT_IN DEBUG]   → resolveHubPortWaiter вернул:`, resolved);
            }
          }
        });
        
        // Проверка тестовых событий
        if (inputLevel === 0 || inputLevel === 15) {
          const isTestPortEvent = extensionTestDevices.some(
            (device) => normalizeSideValue(device.hub_side) === normalizedSide,
          );
          
          console.log('[HUB PORT_IN DEBUG] → inputLevel в [0, 15], проверяем isTestPortEvent:', isTestPortEvent);
          
          if (isTestPortEvent) {
            console.log('[HUB PORT_IN DEBUG] ❌ Это ТЕСТОВОЕ PORT_IN - ИГНОРИРУЕМ');
            console.log('='.repeat(80) + '\n');
            return res.status(202).json({ ok: true, ignored: true });
          } else {
            console.log('[HUB PORT_IN DEBUG] ✅ Это НЕ тестовое PORT_IN - обрабатываем');
          }
        } else {
          console.log('[HUB PORT_IN DEBUG] ✅ inputLevel не в [0, 15] - обрабатываем обычное событие');
        }
      } else {
        console.log('[HUB PORT_IN DEBUG] ℹ️ Нет модулей расширения в пространстве');
      }
    }
    
    console.log('='.repeat(80) + '\n');
  }

// ============================================================================
// ПАТЧ 3: Замена функции checkHubExtensionLink
// НАЙТИ: функцию checkHubExtensionLink (строка ~2438)
// ЗАМЕНИТЬ: всю функцию
// ============================================================================

const checkHubExtensionLink = async (spaceId, extensionDevice) => {
  const config = extensionDevice.config ?? {};
  const extensionId = normalizeHubExtensionId(config.extensionId);
  const hubSide = normalizeSideValue(config.hubSide);
  const extensionSide = normalizeSideValue(config.extensionSide);
  const cacheKey = extensionDevice.id ?? extensionId;
  const now = Date.now();
  const cached = extensionLinkChecks.get(cacheKey);
  
  console.log('\n' + '='.repeat(80));
  console.log('[CHECK_LINK DEBUG] checkHubExtensionLink()');
  console.log('[CHECK_LINK DEBUG] Timestamp:', new Date().toISOString());
  console.log('[CHECK_LINK DEBUG] → extensionDevice.id:', extensionDevice.id);
  console.log('[CHECK_LINK DEBUG] → extensionDevice.name:', extensionDevice.name);
  console.log('[CHECK_LINK DEBUG] → extensionId:', extensionId);
  console.log('[CHECK_LINK DEBUG] → hubSide (тестовая сторона хаба):', hubSide);
  console.log('[CHECK_LINK DEBUG] → extensionSide (тестовая сторона модуля):', extensionSide);
  console.log('[CHECK_LINK DEBUG] → cacheKey:', cacheKey);
  
  if (cached) {
    const ageMs = now - cached.lastCheckAt;
    console.log('[CHECK_LINK DEBUG] → Кэш найден:');
    console.log('[CHECK_LINK DEBUG]   - lastCheckAt:', new Date(cached.lastCheckAt).toISOString());
    console.log('[CHECK_LINK DEBUG]   - возраст:', ageMs, 'ms');
    console.log('[CHECK_LINK DEBUG]   - окно кэша:', EXTENSION_TEST_WINDOW_MS, 'ms');
    console.log('[CHECK_LINK DEBUG]   - lastResult:', cached.lastResult);
    console.log('[CHECK_LINK DEBUG]   - hasPromise:', !!cached.promise);
  } else {
    console.log('[CHECK_LINK DEBUG] → Кэш НЕ найден');
  }
  
  if (cached?.promise) {
    console.log('[CHECK_LINK DEBUG] ⏳ Используем уже запущенную проверку (promise)');
    console.log('='.repeat(80) + '\n');
    return cached.promise;
  }
  
  if (cached && now - cached.lastCheckAt < EXTENSION_TEST_WINDOW_MS && cached.lastResult !== undefined) {
    console.log('[CHECK_LINK DEBUG] ✅ Используем КЭШИРОВАННЫЙ результат:', cached.lastResult);
    console.log('[CHECK_LINK DEBUG]   - возраст:', now - cached.lastCheckAt, 'ms < ', EXTENSION_TEST_WINDOW_MS, 'ms');
    console.log('='.repeat(80) + '\n');
    return cached.lastResult;
  }
  
  console.log('[CHECK_LINK DEBUG] 🚀 Запускаем НОВУЮ проверку связи...');
  
  const promise = (async () => {
    if (!extensionId || !hubSide || !extensionSide) {
      console.log('[CHECK_LINK DEBUG] ❌ Недостаточно данных для проверки:');
      console.log('[CHECK_LINK DEBUG]   - extensionId:', extensionId ?? 'MISSING');
      console.log('[CHECK_LINK DEBUG]   - hubSide:', hubSide ?? 'MISSING');
      console.log('[CHECK_LINK DEBUG]   - extensionSide:', extensionSide ?? 'MISSING');
      await updateExtensionStatus(spaceId, extensionDevice, false);
      extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
      console.log('='.repeat(80) + '\n');
      return false;
    }
    
    const checkStartedAt = Date.now();
    console.log('[CHECK_LINK DEBUG] 📅 Тест начат:', new Date(checkStartedAt).toISOString());
    console.log('[CHECK_LINK DEBUG] 📡 Шаг 1/4: Создаём waiter для HIGH (15) на hubSide:', hubSide);
    
    const waitForHigh = waitForHubPort(
      spaceId,
      cacheKey,
      hubSide,
      15,
      EXTENSION_TEST_WINDOW_MS,
      checkStartedAt,
    );
    
    console.log('[CHECK_LINK DEBUG] 📤 Шаг 2/4: Отправляем импульс HIGH (15) на extensionSide:', extensionSide);
    await pulseHubOutput(extensionId, extensionSide, 15).catch((err) => {
      console.log('[CHECK_LINK DEBUG] ⚠️ Ошибка отправки импульса:', err?.message ?? err);
      return null;
    });
    
    console.log('[CHECK_LINK DEBUG] ⏳ Шаг 3/4: Ожидаем HIGH на хабе (таймаут:', EXTENSION_TEST_WINDOW_MS, 'ms)...');
    const highAt = await waitForHigh;
    
    if (!highAt) {
      const elapsed = Date.now() - checkStartedAt;
      console.log('[CHECK_LINK DEBUG] ❌ НЕ получили HIGH сигнал!');
      console.log('[CHECK_LINK DEBUG]   - время ожидания:', elapsed, 'ms');
      console.log('[CHECK_LINK DEBUG]   - таймаут:', EXTENSION_TEST_WINDOW_MS, 'ms');
      console.log('[CHECK_LINK DEBUG] ❌ ТЕСТ ПРОВАЛЕН: Связь НЕ установлена');
      await updateExtensionStatus(spaceId, extensionDevice, false);
      extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
      console.log('='.repeat(80) + '\n');
      return false;
    }
    
    const highDelay = highAt - checkStartedAt;
    console.log('[CHECK_LINK DEBUG] ✅ Получили HIGH в:', new Date(highAt).toISOString());
    console.log('[CHECK_LINK DEBUG]   - задержка:', highDelay, 'ms');
    
    const remainingMs = Math.max(0, EXTENSION_TEST_WINDOW_MS - (Date.now() - checkStartedAt));
    console.log('[CHECK_LINK DEBUG] 📡 Шаг 4/4: Ожидаем LOW (0) на hubSide:', hubSide);
    console.log('[CHECK_LINK DEBUG]   - оставшееся время:', remainingMs, 'ms');
    
    const lowAt = await waitForHubPort(spaceId, cacheKey, hubSide, 0, remainingMs, highAt);
    
    const ok = Boolean(lowAt);
    const totalTime = Date.now() - checkStartedAt;
    
    if (ok) {
      const lowDelay = lowAt - highAt;
      console.log('[CHECK_LINK DEBUG] ✅ Получили LOW в:', new Date(lowAt).toISOString());
      console.log('[CHECK_LINK DEBUG]   - задержка после HIGH:', lowDelay, 'ms');
      console.log('[CHECK_LINK DEBUG] ✅✅ ТЕСТ УСПЕШЕН: Связь УСТАНОВЛЕНА ✅✅');
      console.log('[CHECK_LINK DEBUG]   - общее время:', totalTime, 'ms');
    } else {
      console.log('[CHECK_LINK DEBUG] ❌ НЕ получили LOW сигнал!');
      console.log('[CHECK_LINK DEBUG]   - оставшееся время:', remainingMs, 'ms');
      console.log('[CHECK_LINK DEBUG] ❌ ТЕСТ ПРОВАЛЕН: Импульс НЕПОЛНЫЙ');
      console.log('[CHECK_LINK DEBUG]   - общее время:', totalTime, 'ms');
    }
    
    await updateExtensionStatus(spaceId, extensionDevice, ok);
    extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: ok });
    
    console.log('[CHECK_LINK DEBUG] 💾 Результат сохранён в кэш:', ok ? '✅ ОНЛАЙН' : '❌ ОФФЛАЙН');
    console.log('='.repeat(80) + '\n');
    
    return ok;
  })();
  
  extensionLinkChecks.set(cacheKey, { lastCheckAt: now, promise });
  console.log('[CHECK_LINK DEBUG] 💾 Promise сохранён в кэш');
  
  return promise;
};

// ============================================================================
// ПАТЧ 4: Замена функции updateExtensionStatus
// НАЙТИ: функцию updateExtensionStatus (строка ~2430)
// ЗАМЕНИТЬ: всю функцию
// ============================================================================

const updateExtensionStatus = async (spaceId, extensionDevice, isOnline) => {
  const nextStatus = isOnline ? 'В сети' : 'Не в сети';
  const prevStatus = extensionDevice.status;
  
  console.log('\n' + '='.repeat(80));
  console.log('[UPDATE_STATUS DEBUG] updateExtensionStatus()');
  console.log('[UPDATE_STATUS DEBUG] Timestamp:', new Date().toISOString());
  console.log('[UPDATE_STATUS DEBUG] → extensionDevice.id:', extensionDevice.id);
  console.log('[UPDATE_STATUS DEBUG] → extensionDevice.name:', extensionDevice.name);
  console.log('[UPDATE_STATUS DEBUG] → extensionId:', extensionDevice.config?.extensionId);
  console.log('[UPDATE_STATUS DEBUG] → prevStatus:', prevStatus);
  console.log('[UPDATE_STATUS DEBUG] → nextStatus:', nextStatus);
  console.log('[UPDATE_STATUS DEBUG] → isOnline:', isOnline);
  
  if (extensionDevice.status === nextStatus) {
    console.log('[UPDATE_STATUS DEBUG] ℹ️ Статус НЕ изменился - пропускаем обновление');
    console.log('='.repeat(80) + '\n');
    return;
  }
  
  console.log('[UPDATE_STATUS DEBUG] 📝 Обновляем статус в БД:', prevStatus, '→', nextStatus);
  await query('UPDATE devices SET status = $1 WHERE id = $2', [nextStatus, extensionDevice.id]);
  
  const logText = isOnline ? 'Модуль расширения снова в сети' : 'Модуль расширения не в сети';
  console.log('[UPDATE_STATUS DEBUG] 📝 Добавляем системный лог:', logText);
  
  await appendLog(spaceId, logText, extensionDevice.config?.extensionId ?? extensionDevice.id, 'system');
  
  console.log('[UPDATE_STATUS DEBUG] ✅ Статус успешно обновлён!');
  console.log('[UPDATE_STATUS DEBUG]   ', prevStatus, '→', nextStatus);
  console.log('='.repeat(80) + '\n');
};

// ============================================================================
// ПАТЧ 5: Замена функции resolveHubPortWaiter
// НАЙТИ: функцию resolveHubPortWaiter (строка ~618)
// ЗАМЕНИТЬ: всю функцию
// ============================================================================

const resolveHubPortWaiter = (spaceId, extensionKey, side, level, eventTime = Date.now()) => {
  const key = buildExtensionWaiterKey(spaceId, extensionKey, side, level);
  const waiters = extensionPortWaiters.get(key);
  
  console.log('\n' + '-'.repeat(80));
  console.log('[RESOLVE_WAITER DEBUG] resolveHubPortWaiter()');
  console.log('[RESOLVE_WAITER DEBUG] Timestamp:', new Date().toISOString());
  console.log('[RESOLVE_WAITER DEBUG] → key:', key);
  console.log('[RESOLVE_WAITER DEBUG] → spaceId:', spaceId);
  console.log('[RESOLVE_WAITER DEBUG] → extensionKey:', extensionKey);
  console.log('[RESOLVE_WAITER DEBUG] → side:', side);
  console.log('[RESOLVE_WAITER DEBUG] → level:', level);
  console.log('[RESOLVE_WAITER DEBUG] → eventTime:', new Date(eventTime).toISOString());
  console.log('[RESOLVE_WAITER DEBUG] → waiters:', waiters ? `найдено: ${waiters.length}` : 'НЕТ');
  
  if (!waiters?.length) {
    console.log('[RESOLVE_WAITER DEBUG] ⚠️ Нет ожидающих waiter - ПРОПУСКАЕМ');
    console.log('-'.repeat(80) + '\n');
    return false;
  }
  
  console.log('[RESOLVE_WAITER DEBUG] 🔍 Проверяем waiters:');
  waiters.forEach((waiter, idx) => {
    const afterTs = waiter.afterTimestamp;
    const matches = afterTs === null || eventTime >= afterTs;
    console.log(`[RESOLVE_WAITER DEBUG]   [${idx}]:`, {
      afterTimestamp: afterTs ? new Date(afterTs).toISOString() : 'null',
      подходит: matches ? '✓' : '✗',
    });
  });
  
  const nextIndex = waiters.findIndex((waiter) => (
    waiter.afterTimestamp === null || eventTime >= waiter.afterTimestamp
  ));
  
  if (nextIndex === -1) {
    console.log('[RESOLVE_WAITER DEBUG] ❌ НЕ найден подходящий waiter');
    console.log('-'.repeat(80) + '\n');
    return false;
  }
  
  console.log('[RESOLVE_WAITER DEBUG] ✅ Найден подходящий waiter[' + nextIndex + ']');
  
  const [waiter] = waiters.splice(nextIndex, 1);
  waiter.resolve();
  
  if (waiters.length) {
    extensionPortWaiters.set(key, waiters);
    console.log('[RESOLVE_WAITER DEBUG] 💾 Осталось waiters:', waiters.length);
  } else {
    extensionPortWaiters.delete(key);
    console.log('[RESOLVE_WAITER DEBUG] 🗑️ Все waiters обработаны - удаляем из Map');
  }
  
  console.log('[RESOLVE_WAITER DEBUG] ✅ Waiter resolved УСПЕШНО');
  console.log('-'.repeat(80) + '\n');
  
  return true;
};

// ============================================================================
// КОНЕЦ ПАТЧА
// ============================================================================

/*
 * После применения патча:
 * 
 * 1. Перезапустить: docker-compose restart app
 * 
 * 2. Проверить логи:
 *    docker-compose logs -f app | grep -E "HUB_EXT|CHECK_LINK|UPDATE_STATUS|RESOLVE_WAITER|PORT_IN"
 * 
 * 3. Отключить модуль расширения от хаба
 * 
 * 4. Наблюдать:
 *    - [HUB_EXT DEBUG] - какие события приходят
 *    - isTestSideEvent - срабатывает ли для PORT_IN
 *    - checkHubExtensionLink() - вызывается ли
 *    - [CHECK_LINK DEBUG] - результаты тестов
 *    - [UPDATE_STATUS DEBUG] - обновления статуса
 * 
 * 5. Найти проблемное место в логах
 * 
 * 6. Исправить логику на основе анализа
 * 
 * ============================================================================
 */
