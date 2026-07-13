# Warm Editorial — task list (issues)

All 12 tasks for matching the app to the prototype. Read
[`README.md`](./README.md) first — it holds the token map, RPE↔RIR mapping, UI-kit
list, Definition of Done, and the verify recipe that every task relies on.

Work order: **task 1 first**, then by number. Commit directly on
`feat/warm-editorial-prototype` with `Closes #N`.

**GitHub issues:** task N → issue **#(114 + N)** (task 1 = #115 … task 12 = #126).
Tracking checklist: **#127**. Use the real issue number in each `Closes #N`.

---

## 1 · #115 — Foundations: token parity + shared primitives

**Files:** `src/warm-editorial-theme.css`, `src/App.css` (reconcile, don't
duplicate), `src/components/ui/*`, `src/components/ui/index.ts`, `src/components/ui/ui.test.tsx`.

**What to do**
- Align CSS token values in `warm-editorial-theme.css` to the prototype for
  **both** light and `:root[data-theme="dark"]` (see the value tables in README).
- Add reusable primitives to `src/components/ui`, exported from `index.ts`:
  - `Stepper` — `− [value] +` numeric control (props: value, step, min, onChange, big variant).
  - `SegmentedControl` — pill segmented toggle (options + value + onChange).
  - `Pill` — capsule label/badge (tone variants: neutral / accent / success / on-hero).

**Success criteria**
- [ ] Light + dark token values match the prototype tables in README.
- [ ] `Stepper`, `SegmentedControl`, `Pill` exist, exported from `ui/index.ts`, with basic tests.
- [ ] Existing screens render unchanged (smoke in browser, light + dark).
- [ ] `npm test` / `npm run lint` / `tsc -b` green.

---

## 2 · #116 — Home: profile avatar + dropdown menu

**Files:** `src/components/CoachHome.tsx` (the `ScreenHeader` `trailing` block),
`src/components/CoachHome.test.tsx`, `warm-editorial-theme.css`.

**What to do**
- Replace the `<select>` + separate avatar button with **one** avatar button
  (user initial) that opens a dropdown listing users with a checkmark on the
  active one (prototype "Профиль" menu). Keep `onSelectUser`.
- Header eyebrow: `Сегодня · DD <месяц>` (localized date).

**Success criteria**
- [ ] Header shows a single avatar; no raw `<select>`.
- [ ] Tapping the avatar opens the user menu; selecting a user switches profile and closes the menu.
- [ ] a11y: `aria-expanded`, closes on Escape and outside click.
- [ ] Tests updated; suite green.

---

## 3 · #117 — Home: hero card

**Files:** `src/components/ui/HeroStatus.tsx` (extend), `src/components/CoachHome.tsx`,
`warm-editorial-theme.css`. Note `HeroStatus` is reused by Plan/Progress — keep them working.

**What to do**
- Metadata `N упр · ~M мин` as a **top-right pill**.
- Add a boxed "начинаем с" row: accent dot + `Начинаем с <b>{first exercise}</b>` +
  weight on the right (e.g. `60 кг`).
- **Remove** the `status-ring`.
- Button labels: `Начать тренировку` / `Тренировка вне плана`.

**Success criteria**
- [ ] Hero matches the prototype (top-right pill, "начинаем с" row, no ring, button labels).
- [ ] Plan + Progress hero cards do not regress.
- [ ] Tests + suite green.

---

## 4 · #118 — Home: mesocycle card + metric labels + section polish

**Files:** `src/components/CoachHome.tsx`, `src/components/GoalsCard.tsx` (verify),
`warm-editorial-theme.css`.

**What to do**
- Turn `MesocycleIndicator` into the prototype's mesocycle **card**:
  `Мезоцикл · {фаза}` + `неделя X / Y` + an N-segment progress bar.
- Metric labels → `Серия` (streak) and `На неделе` (completed / target).
- Align sections «Цели», «Недельный разбор», «Далее», «Библиотека», «История»
  to the prototype (serif 22px headers, spacing, row layout).

**Success criteria**
- [ ] Mesocycle card with segmented progress renders when `coachState.mesocycle` exists.
- [ ] Metrics labeled `Серия` / `На неделе`.
- [ ] Sections visually match the prototype.
- [ ] Tests + suite green.

---

## 5 · #119 — Plan: header + horizon toggle (Неделя / Мезоцикл)

**Files:** `src/components/PlanCalendar.tsx`, `src/components/PlanCalendar.test.tsx`,
`warm-editorial-theme.css`.

**What to do**
- Title `План` (not `План тренировок`); eyebrow `N тренировки / нед`.
- Fix the trailing `нет дат` pill colliding with the theme toggle.
- Add a `SegmentedControl` `Неделя | Мезоцикл · 4 нед` with local horizon state.

**Success criteria**
- [ ] Title is `План`; toggle switches state and shows the matching view.
- [ ] No header/pill collision with the theme toggle.
- [ ] Tests + suite green.

---

## 6 · #120 — Plan: week strip + readiness note + schedule (Week view)

**Files:** `src/components/PlanCalendar.tsx`, `src/components/PlanCalendar.test.tsx`,
`warm-editorial-theme.css`.

**What to do**
- Replace the large date-picker grid with the prototype's compact **7-day week
  strip** (states today / next / plan / rest + dots), a day-note chip, a
  `Готовность X/100` row, and a `Расписание` list.
- Preserve planning: tapping a future day toggles plan↔rest via existing
  `onToggleWeekDate` / `plannedWorkouts`.

**Success criteria**
- [ ] Week strip renders the 7 upcoming days with correct states.
- [ ] Tapping a future day toggles plan/rest; planning still works.
- [ ] Readiness note + schedule list shown, matching the prototype.
- [ ] Tests + suite green.

---

## 7 · #121 — Plan: Mesocycle view

**Files:** `src/components/PlanCalendar.tsx` (+ read mesocycle via context/prop if
needed), `warm-editorial-theme.css`.

**What to do**
- `Мезоцикл · 4 нед` view: intro note + list of mesocycle weeks
  (done / now / plan, phase tags, volume). Use `coachState.mesocycle` where
  possible; otherwise a representative fallback as in the prototype.

**Success criteria**
- [ ] Meso weeks list with phase tags + volumes renders.
- [ ] Horizon toggle shows/hides this view; empty state is clean.
- [ ] Tests + suite green.

---

## 8 · #122 — Gym: slim top bar + set chips + sticky actions

**Files:** `src/components/GymScreen.tsx`, `src/components/GymActions.tsx`,
`src/components/CurrentStepCard.tsx` (rest mode), `src/components/GymScreen.test.tsx`,
`warm-editorial-theme.css`.

**What to do**
- Replace `session-header` (ScreenHeader + «Выйти») with a **one-row bar**:
  `← Выйти` · progress bar (fraction done) · counter `i / N`.
- Add a **set-chips** row: done `k · В×П` / current `k · сейчас` / upcoming `k`;
  tapping a done chip edits that set.
- Sticky action bar `Пропустить` / `Следующее →` + `Финиш`; dashed
  `Добавить упражнение`; danger `Удалить текущее упражнение`.
- Restyle the rest timer to the prototype card (hero-bg, large timer, `+30 сек` / `Пропустить`).

**Success criteria**
- [ ] Single-row top bar; progress + counter correct.
- [ ] Set chips reflect the log; editing a done set works.
- [ ] Sticky actions + rest timer match the prototype.
- [ ] Tests + suite green.

---

## 9 · #123 — Gym: logger with ± steppers + RIR scale + coach hint

**Files:** `src/components/CurrentStepCard.tsx`, `src/components/gymTypes.ts`
(reuse `difficultyOptions`), `src/components/GymScreen.tsx` /
`src/components/GymScreen.test.tsx`, `warm-editorial-theme.css`.

**What to do**
- Promote weight and reps to **± steppers** in the main card (`Stepper`, step =
  `weightStep`).
- Below them, the **«Сколько ещё сделаешь?»** RIR scale (4 dots `4+/3/1–2/0`) →
  map to `difficultyOptions` / `rpe` per the README table.
- `Готово · подход N` is **disabled until an RIR is chosen**; on tap it records
  the set with `rpe` and starts rest.
- Coach hint line (green left border: tag / value / note) + inline `Прошлый раз / Цель`.
- Keep the "edit a recorded set" flow and the coach autofill of recommended weight/reps.

**Success criteria**
- [ ] Steppers change weight (by `weightStep`) and reps.
- [ ] `Готово` disabled until RIR chosen; choosing RIR → records set with correct `rpe` → rest starts.
- [ ] Editing a recorded set still works; coach autofill preserved.
- [ ] Tests + suite green.

---

## 10 · #124 — Progress: focus tags + strength section

**Files:** `src/components/ProgressScreen.tsx`, `src/components/ProgressScreen.test.tsx`,
`warm-editorial-theme.css`.

**What to do**
- Add tags to «Следующий фокус» rows (растёт / держим).
- Finish the «Сила» section (e1RM sparklines + delta) to the prototype using the
  existing `SparklineSVG` and `progressDashboard`. Clean empty state.

**Success criteria**
- [ ] Focus rows have tags.
- [ ] «Сила» shows per-lift sparkline + e1RM + delta when data exists; graceful empty state.
- [ ] Matches the prototype; tests + suite green.

---

## 11 · #125 — Review: redesign the debrief screen

**Files:** `src/components/WorkoutReviewScreen.tsx`,
`src/components/WorkoutReviewScreen.test.tsx`, `warm-editorial-theme.css`.

**What to do**
- Reflow `WorkoutReviewScreen` to the prototype: header `Отличная работа`, hero
  stats grid (минут / подходов / кг), «По упражнениям» list with marks, a
  «Тренер» debrief card, and a `На главную` button.
- Keep `onSaveAndExit` / `onBackToWorkout` and the `progressionSummary` /
  `totalVolume` / `debrief` data.

**Success criteria**
- [ ] Screen matches the prototype review; save/back still work.
- [ ] Tests updated; suite green.

---

## 12 · #126 — Sheets: unified bottom-sheet style

**Files:** `src/components/ExerciseGuideModal.tsx`, `src/components/ReplacementSheet.tsx`,
`src/components/ExercisePickerSheet.tsx`, `src/components/GoalsCard.tsx`,
`warm-editorial-theme.css`.

**What to do**
- Bring the modals to the prototype's bottom-sheet style (grabber, `sheetup`
  animation, header with a close ✕, scroll body): technique info
  (`ExerciseGuideModal`), library/replace (`ReplacementSheet` /
  `ExercisePickerSheet`), goal add (`GoalsCard`), and readiness (style the
  current preview if kept as-is).

**Success criteria**
- [ ] Sheets look consistent and match the prototype (grabber, animation, header).
- [ ] Open/close behavior preserved.
- [ ] Tests + suite green.
