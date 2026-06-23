# Issues — AI Gym Trainer PWA

Статус на 23 июня 2026. Синхронизировано с GitHub.

---

## OPEN

### #12 — Exercise library audit: coverage, metadata, instructions quality
🏷️ `enhancement`

Полный аудит базы упражнений: достаточно ли упражнений по группам мышц, разнообразие (типы оборудования, типы движений), метаданные для тренера (target_muscles, movement_pattern, equipment, exercise_type), качество описаний.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/12)

---

### #13 — Update coach logic to use new exercise metadata
🏷️ `enhancement` `backend`

Научить coachEngine и coachPlanner использовать новые поля из #12: подбор замен по movement_pattern + equipment, автоматическая генерация alternatives, фильтрация по анкете пользователя. Блокируется #12.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/13)

---

### #9 — Replace SVG exercise diagrams with generated images
🏷️ `enhancement`

Заменить 15 SVG-схем на сгенерированные GPT PNG (как уже сделано для 30+ упражнений) + догенерировать для 3 упражнений, использующих `generic.svg` fallback.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/9)

---

### #8 — Gravitron exercises: weight should decrease on progression, not increase
🏷️ `bug`

Для упражнений на гравитроне (подтягивания с противовесом) прогрессия весов инвертирована — при улучшении результатов вес растёт, а должен уменьшаться (чем сильнее пользователь, тем меньше противовес).

Затрагивает: `adaptiveVolumeLandmarks.js`, `coachPlanner.js`.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/8)

---

### #6 — Интеграция adaptiveVolumeLandmarks в coachState + schema migration
🏷️ `enhancement` `backend` `database`

Движок автокоррекции MEV/MAV/MRV из коммита `3b42f5b` не подключён к продакшену. Нужно:
1. Schema migration (таблица `volume_landmark_overrides`)
2. Snapshot builder (сбор статистики из истории)
3. Интеграция в coachState
4. Применение overrides в coachPlanner
5. Персистенция в БД

Оценка: ~2 дня.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/6)

---

### #5 — Декомпозиция App.tsx на Context API
🏷️ `enhancement` `refactor`

App.tsx — 630+ строк, 15+ useState, проп-дриллинг в GymScreen (20+ пропсов). План: 6 контекстов по доменам (Program, Workout, Readiness, Coach, Navigation, User), сократить App.tsx до <100 строк.

Оценка: ~2-3 дня.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/5)

---

### #4 — Полная миграция бэкенда на TypeScript
🏷️ `enhancement` `tech-debt`

Phase 3 мигрировал 3 модуля. Осталось 35 .js файлов. План: 5 tier-ов (от стабильных к сложным), один модуль = один коммит, после миграции всех — strict mode.

Оценка: ~3-5 дней.

[Открыть на GitHub](https://github.com/borovikvv/ai-gym-trainer-pwa/issues/4)

---

## Ранее закрытые

### #7 — Dark theme: hero cards text invisible on dark background
🏷️ `bug` ✅ Closed by [#10](https://github.com/borovikvv/ai-gym-trainer-pwa/pull/10) (merged)

Текст на hero cards сливался с фоном в тёмной теме. Исправлено введением 4 новых CSS-переменных (`--hero-bg`, `--hero-text`, `--hero-text-muted`, `--hero-text-tertiary`), которые остаются тёмными/светлыми независимо от темы. +7 регрессионных тестов.

---
