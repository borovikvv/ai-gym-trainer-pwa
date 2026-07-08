# Warm Editorial — внедрение в ai-gym-trainer-pwa

Три патча. 1 и 2 — низкий риск (только CSS/токены). 3 — правка компонентов «Зала».

---

## Патч 1 — Тема (перекрашивает ~90% приложения)

**1a. Шрифты** — в `index.html`, в `<head>`:
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**1b. Токены** — ⚠ **порядок критичен.** Импортируйте `warm-editorial-theme.css` **последним**, то есть ПОСЛЕ `import './App.css'` в `App.tsx`:
```tsx
import './App.css'
import './warm-editorial-theme.css'   // ← обязательно после App.css
```
Если тема грузится раньше `App.css`, то `:root`-токены применятся (акцент станет оранжевым), НО компонентные правила `App.css` перебьют тему — останутся зелёные чипы и пунктирные карточки. Это и есть причина «половина элементов из старого интерфейса» на скриншоте.

Компоненты `HeroStatus / MetricPair / SectionList / WorkoutRow / BottomNav`, чипы и календарь уже читают `var(--accent)/var(--surface)/var(--hero-bg)`, поэтому Дом/Прогресс/План перекрасятся без правок разметки.

**1c. Зелёные хардкоды** — в `App.css` `systemGreen` местами вписан числами. Файл темы уже переопределяет ключевые (`.primary`, `.recommended-weight`, active-чипы, `.day-card.selected`, `.bar`, `.e1rm-trend--up`). Проверьте поиском `52, 199, 89` и добейте остальные на `--success`.

---

## Патч 2 — Разделение смысла цвета (UX-фикс)

Введён токен `--success` (оливковый). Акцент оставляем ТОЛЬКО за действиями, а «рост/выполнено/тренд вверх» переводим на `--success`:

- `src/components/ProgressScreen.tsx` — `SparklineSVG`: `trendDirection === 'up'` → цвет `var(--success)` вместо `var(--accent)`.
- Бейджи «растёт», `.week-day.completed` — на оливковый (уже в теме).

---

## Патч 3 — Экран «Зал»: крупный ввод первым

### 3a. `src/components/WorkoutSetList.tsx` — заменить функцию `CurrentSetEditor` целиком:

```tsx
function CurrentSetEditor({
  activeExercise,
  set,
  setNumber,
  totalSets,
  formatWeight,
  updateSetWeight,
  updateSetReps,
  updateSet,
  markSetDone,
}: CurrentSetEditorProps) {
  const unitLabel = effortUnitLabel(activeExercise)
  const timed = isTimedExercise(activeExercise)
  const canSaveSet = set.reps > 0
  const step = activeExercise.weightStep || 2.5
  const currentWeight = set.weightInput != null ? Number(set.weightInput) || set.weight : set.weight
  const currentReps = set.repsInput != null ? Number(set.repsInput) || set.reps : set.reps
  return (
    <div className="set current-set">
      <div className="set-head">
        <b>Подход {setNumber} из {totalSets}</b>
        <span className="muted">цель {activeExercise.repMin}–{activeExercise.repMax}{timed ? ' сек' : ''} · {difficultyLabel(set.rpe).toLowerCase()}</span>
      </div>

      {!timed && (
        <div className="big-stepper">
          <span className="big-stepper__label">кг</span>
          <div className="big-stepper__row">
            <button type="button" className="big-stepper__btn" aria-label="Меньше вес"
              onClick={() => updateSetWeight(String(Math.max(0, currentWeight - step)))}>−</button>
            <input
              className="big-stepper__value"
              aria-label={`Вес, подход ${setNumber}`}
              value={set.weightInput ?? formatWeight(set.weight)}
              inputMode="decimal"
              onChange={(event) => updateSetWeight(event.target.value)}
            />
            <button type="button" className="big-stepper__btn big-stepper__btn--plus" aria-label="Больше вес"
              onClick={() => updateSetWeight(String(currentWeight + step))}>+</button>
          </div>
        </div>
      )}

      <div className="big-stepper">
        <span className="big-stepper__label">{unitLabel}</span>
        <div className="big-stepper__row">
          <button type="button" className="big-stepper__btn" aria-label="Меньше повторов"
            onClick={() => updateSetReps(String(Math.max(0, currentReps - 1)))}>−</button>
          <input
            className="big-stepper__value"
            aria-label={`Повторы, подход ${setNumber}`}
            value={set.repsInput ?? (set.reps || '')}
            placeholder={unitLabel === 'сек' ? 'сек' : 'повт.'}
            inputMode="numeric"
            onChange={(event) => updateSetReps(event.target.value)}
          />
          <button type="button" className="big-stepper__btn big-stepper__btn--plus" aria-label="Больше повторов"
            onClick={() => updateSetReps(String(currentReps + 1))}>+</button>
        </div>
      </div>

      <button className="check check--wide" aria-label={`Записать подход ${setNumber}`} disabled={!canSaveSet} onClick={markSetDone}>Готово ✓</button>

      <div className="difficulty" aria-label={`Сложность подхода ${setNumber}`}>
        {difficultyOptions.map((option) => (
          <button key={option.label} type="button"
            className={set.rpe === option.value ? 'active' : ''}
            aria-label={`Сложность: ${option.label}, подход ${setNumber}`}
            title={option.hint} onClick={() => updateSet({ rpe: option.value })}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

> Гибрид: кнопки `−`/`+` меняют вес на `weightStep` (повторы на 1), а по тапу на центральное число открывается клавиатура — можно вбить произвольное значение (напр. 62.5). `weightInput/repsInput` (черновик строки ввода) уже поддержаны в `SetDraft`.

### 3b. CSS для степпера — добавить в `App.css` (или в тему):

```css
.big-stepper { margin-top: 14px; }
.big-stepper__label {
  display: block; font-size: 11px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-tertiary);
}
.big-stepper__row {
  display: grid; grid-template-columns: 56px 1fr 56px;
  align-items: center; gap: 10px; margin-top: 8px;
}
.big-stepper__btn {
  height: 56px; border-radius: var(--radius-md); border: 1px solid var(--border);
  background: var(--surface-muted); color: var(--text-primary);
  font-size: 26px; font-weight: 600;
}
.big-stepper__btn--plus { border: 0; background: var(--hero-bg); color: var(--hero-text); }
.big-stepper__value {
  width: 100%; min-width: 0; text-align: center; padding: 0;
  border: 0; background: transparent; color: var(--text-primary);
  font-family: var(--font-display, inherit);
  font-variant-numeric: tabular-nums; font-size: 56px; font-weight: 600; line-height: 1;
}
.big-stepper__value:focus { outline: none; }
.big-stepper__value:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 8px; }
.check.check--wide { width: 100%; margin-top: 16px; padding: 16px; font-size: 17px; font-weight: 700; }
```

### 3c. `src/components/GymScreen.tsx` — поднять ввод наверх, ужать hero:

В `return (...)` перенесите блок `<SectionList title="Подходы"> … </SectionList>` **выше** `<HeroStatus />` и `<MetricPair />`. `HeroStatus` ужмите до компактного заголовка (название упражнения + prescription), а «Техника»/«Замена» оставьте маленькими кнопками рядом. Порядок сверху вниз:

1. `session-header` (прогресс-бар + «Выйти» + «N из M»)
2. Заголовок: название упражнения + prescription + мелкие «Техника»/«Замена»
3. **`SectionList "Подходы"`** (крупный степпер) + инлайн-подсказка тренера
4. Компактная строка «Прошлый раз / Цель» (бывший `MetricPair`)
5. `SessionActions`, `next-card`, `gym-action-bar`

Логику/пропсы не трогаем — только порядок JSX и классы.

---

## Патч 4 — Фиксы по скриншоту живого билда

На скрине три дефекта. Всё лечится обновлённым `warm-editorial-theme.css` (уже содержит блоки ниже) + одной правкой `GymScreen.tsx`.

### 4a. «Старый» вид (зелёный чип, пунктирная карточка подхода)
Причина — **порядок импорта**. Тема грузится раньше `App.css`. Исправьте импорт (см. Патч 1b): `warm-editorial-theme.css` — **последним**. После этого олив-чипы и сплошные тёплые карточки подходов из темы победят. В теме добавлены:
```css
.set-collapsed { border-style: solid; border-color: var(--border); background: var(--surface); }
.set-collapsed.completed { border-color: rgba(78,122,91,0.28); background: rgba(78,122,91,0.10); }
.set-collapsed.completed .set-head b { color: var(--success-pressed); }
```

### 4b. Наезд кнопки «удалить» и обрезка текста
Виновник — фиксированная `.theme-toggle` (top:56px, right:16px) поверх карточки подхода. В теме она скрыта в режиме зала:
```css
.app-shell--gym .theme-toggle, .phone.gym-mode .theme-toggle { display: none; }
```
Плюс заголовок подхода больше не ужимает кнопки (`.set-collapsed .set-head` → перенос, кнопки `flex:0 0 auto; white-space:nowrap`).

### 4c. Название упражнения ушло под степпер (большой тёмный «Подтягивания…»)
Причина: в 3c `HeroStatus` остался полноразмерным hero и уехал вниз. Замените его на компактную шапку **над** `SectionList "Подходы"`, а нижний `HeroStatus` **удалите**:

```tsx
{/* НАД <SectionList title="Подходы"> */}
<div className="gym-exercise-head">
  <div className="gym-exercise-head__copy">
    <span className="eyebrow">{activeExercise.prescription}</span>
    <h2>{activeExercise.name}</h2>
  </div>
  <div className="gym-exercise-head__actions">
    <button className="secondary compact" type="button" onClick={openExerciseGuide}>Техника</button>
    <button className="secondary compact" type="button" onClick={openReplacementSheet}>Замена</button>
  </div>
</div>
```
Затем удалите блок `<HeroStatus eyebrow={activeExercise.prescription} title={activeExercise.name} … />` (шаг 3 в текущем коде). Стили `.gym-exercise-head*` уже в теме. Итог: название сверху крупным серивом, «Техника/Замена» — мелкие нейтральные (больше не громкий оранжевый), тёмной плиты внизу нет.

---

## Патч 5 — «Стена текста» → сканируемый экран (по скринам живого билда)

Три причины, почему билд читается как документ. Порядок = по эффекту.

### 5a. ⚠ Главное: вы смотрите ТЁМНУЮ тему
Warm Editorial спроектирован под светлую «бумагу». Тёмный вариант в теме — минимальный, в нём контраст падает и всё сливается в коричневую массу. **Быстрый фикс — сделать светлую тему темой по умолчанию** (или не показывать тёмную, пока её не проработаем):

```ts
// там, где инициализируется тема (ThemeContext / useState / localStorage):
const initialTheme = localStorage.getItem('theme') ?? 'light'   // было 'dark' или system
```
Либо временно форсить светлую: `document.documentElement.dataset.theme = 'light'`. Это одно изменение возвращает 80% «премиального» вида со скринов-мокапов.

### 5b. AI-текст выводить свёрнутым (сводка + «Подробнее»)
Сейчас `programReview.summary`, каждый `change.rationale`, описание тренировки в Плане и рекомендации в `ProgressScreen` рендерятся целиком. Правило: **заголовок-сущность + 1 строка сути + метка; полный текст — в раскрытии.**

`CoachHome.tsx` — карточки разбора → сканируемые строки:
```tsx
{programReview.changes.map((change, i) => (
  <details key={i} className="review-row">
    <summary>
      <span className={`review-row__dot review-row__dot--${change.priority}`} aria-hidden="true" />
      <span className="review-row__title">{shortTitle(change.description)}</span>
      <span className="review-row__meta">{change.type}</span>
    </summary>
    <p className="review-row__body">{change.rationale}</p>
  </details>
))}
```
где `shortTitle` — первые ~40 симв. до первой точки. То же для `ProgressScreen` рекомендаций: заголовок + `-0.3 кг/нед` как метка, текст «Возможна перетренированность…» — в `<details>`.

Описание тренировки в Плане: замените абзац на 2-3 тега (`5 упр`, группы мышц, «лёгкая нагрузка») + короткую строку с «Подробнее» (см. мокап 2a). Раскрытие — на детальном экране «Состав».

CSS для строк (добавьте в тему):
```css
.review-row { border-bottom: 1px solid var(--separator); }
.review-row > summary {
  display: flex; align-items: center; gap: 12px; padding: 14px 2px;
  list-style: none; cursor: pointer;
}
.review-row > summary::-webkit-details-marker { display: none; }
.review-row__dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
.review-row__dot--high { background: var(--danger); }
.review-row__dot--medium { background: var(--warning); }
.review-row__dot--low { background: var(--success); }
.review-row__title { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; line-height: 1.3; }
.review-row__meta { color: var(--text-tertiary); font-size: 12px; white-space: nowrap; }
.review-row__body { margin: 0 0 12px 20px; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
```

### 5c. Обрезка и перенос по буквам
На скринах «персонал⏎ьная» ломается и режется — карточка `WorkoutRow`/timeline узкая, а кнопки съедают ширину. Фиксы (в тему):
```css
/* Текст не сжимается кнопками и обрезается многоточием, а не по буквам */
.workout-row__title, .plan-card__title, .timeline-card__title {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.workout-row__meta { min-width: 0; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* Кнопки/бейджи — своим рядом, не в одну строку с заголовком на узких картах */
.workout-row__actions, .plan-card__actions { flex: 0 0 auto; }
.plan-card { display: flex; flex-direction: column; }   /* заголовок над кнопками, не сбоку */
.plan-card__actions { display: flex; gap: 8px; margin-top: 12px; }
```

### 5d. Safe-area (статус-бар наезжает на заголовок)
На «Тренере»/«Прогрессе» контент начинается под часами. Убедитесь, что у скролл-контейнера есть верхний отступ:
```css
.screen { padding-top: max(16px, env(safe-area-inset-top)); }
```

---

## Порядок внедрения и проверка

1. Патч 1 → `npm run dev`, глазами проверить перекраску. **Проверьте импорт темы последним** (иначе останутся зелёные чипы/пунктир).
2. Патч 2 → убедиться, что акцент только на действиях.
3. Патч 3 → проверить «Зал» на телефоне (одной рукой).
4. Патч 4 → название упражнения сверху, кнопка темы не перекрывает подход, карточки подходов оливковые без пунктира.
5. **Патч 5a первым делом** — переключить дефолт на светлую тему; затем 5b (свернуть AI-текст), 5c (обрезка), 5d (safe-area).
6. `npm run lint && npx tsc -b && npm test` — прогнать перед коммитом.
5. Ветка `redesign/warm-editorial`, PR в `main`.
