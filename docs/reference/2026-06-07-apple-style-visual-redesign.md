# Apple-Style Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use plain bullet syntax for tracking.

**Goal:** Make the personal trainer PWA feel more mature, calm, and iOS-native while preserving the current product behavior.

**Architecture:** Keep React state and domain logic unchanged. Introduce a small design-token layer, component-level visual classes, icon-based navigation, and screen-specific layout refinements for Home, Plan, and Gym flows. Avoid a full design-system rewrite; this is a focused visual maturity pass.

**Tech Stack:** React 19, TypeScript, Vite, CSS, Vitest, Testing Library. Optional icon dependency: `lucide-react`.

---

## Target Direction

The app should feel like a native iOS fitness coach:

- Calm neutral background, white grouped surfaces, subtle separators.
- One clear primary action per screen.
- Less border-heavy card stacking.
- System-like typography: strong hierarchy, less extreme font weight.
- Bottom tab bar with icons and blur/material feel.
- Fitness-specific visual status: readiness, weekly completion, next workout.

Do not copy Apple Fitness directly. Use Apple HIG principles: hierarchy, consistency, platform familiarity, legible typography, restrained color, clear affordances.

## Files

- Modify: `package.json`
  - Add `lucide-react` if icons are not already available.
- Modify: `src/index.css`
  - Add global design tokens and app background.
- Modify: `src/App.css`
  - Replace the current warm beige/orange visual language with iOS-like tokens and screen styles.
- Modify: `src/components/BottomNav.tsx`
  - Convert text-only navigation to icon + label tab bar.
- Modify: `src/components/CoachHome.tsx`
  - Recompose Home into a Today dashboard with one primary CTA.
- Modify: `src/components/PlanCalendar.tsx`
  - Make planning screen less admin-like: compact week rail, system list rows, fewer exposed actions.
- Modify: `src/components/GymScreen.tsx`
  - Improve workout flow hierarchy: current exercise, progress, large numeric target, compact toolbar.
- Modify: `src/components/GymActions.tsx`
  - Convert quick actions to compact icon/segmented controls where appropriate.
- Test: `src/App.test.tsx`
- Test: existing component tests in `src/components/*.test.tsx`

## Visual Tokens

Use these as the first-pass tokens:

```css
:root {
  --app-bg: #f5f5f7;
  --surface: rgba(255, 255, 255, 0.86);
  --surface-solid: #ffffff;
  --surface-secondary: #f2f2f7;
  --separator: rgba(60, 60, 67, 0.18);
  --text-primary: #1d1d1f;
  --text-secondary: rgba(60, 60, 67, 0.72);
  --text-tertiary: rgba(60, 60, 67, 0.48);
  --accent: #34c759;
  --accent-pressed: #28a745;
  --warning: #ff9f0a;
  --danger: #ff3b30;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 22px;
  --radius-xl: 28px;
  --shadow-soft: 0 18px 45px rgba(0, 0, 0, 0.08);
}
```

---

### Task 1: Add Icons And Stabilize Baseline

**Files:**
- Modify: `package.json`
- Verify: `package-lock.json`
- Test: `npm run build`

- **Reference step 1: Add lucide-react**

Run:

```bash
npm install lucide-react
```

Expected:

```text
added 1 package
```

- **Reference step 2: Verify dependency is present**

Run:

```bash
node -e "console.log(require('./package.json').dependencies['lucide-react'])"
```

Expected:

```text
^...
```

- **Reference step 3: Run the current build before visual changes**

Run:

```bash
npm run build
```

Expected:

```text
✓ built
```

- **Reference step 4: Commit baseline dependency**

```bash
git add package.json package-lock.json
git commit -m "chore: add icon library for visual redesign"
```

---

### Task 2: Create iOS-Like Global Tokens

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.css`
- Test: `npm run build`

- **Reference step 1: Replace global root styles in `src/index.css`**

Use:

```css
* {
  box-sizing: border-box;
}

:root {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif;
  color: #1d1d1f;
  background: #f5f5f7;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;

  --app-bg: #f5f5f7;
  --surface: rgba(255, 255, 255, 0.86);
  --surface-solid: #ffffff;
  --surface-secondary: #f2f2f7;
  --separator: rgba(60, 60, 67, 0.18);
  --text-primary: #1d1d1f;
  --text-secondary: rgba(60, 60, 67, 0.72);
  --text-tertiary: rgba(60, 60, 67, 0.48);
  --accent: #34c759;
  --accent-pressed: #28a745;
  --warning: #ff9f0a;
  --danger: #ff3b30;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 22px;
  --radius-xl: 28px;
  --shadow-soft: 0 18px 45px rgba(0, 0, 0, 0.08);
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 50% -10%, rgba(52, 199, 89, 0.12), transparent 34%),
    var(--app-bg);
  color: var(--text-primary);
}

button,
input,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- **Reference step 2: Update shared typography and surfaces in `src/App.css`**

Replace the base definitions for these classes:

```css
.phone {
  width: 100%;
  max-width: 430px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 18px 16px calc(118px + env(safe-area-inset-bottom));
  background: transparent;
  color: var(--text-primary);
  overflow-x: hidden;
}

.kicker {
  font-size: 13px;
  color: var(--text-secondary);
  letter-spacing: 0;
  text-transform: none;
  font-weight: 600;
}

.title {
  font-size: 34px;
  line-height: 1.05;
  font-weight: 750;
  letter-spacing: 0;
}

.card,
.stat,
.focus {
  background: var(--surface);
  border: 0.5px solid var(--separator);
  border-radius: var(--radius-lg);
  box-shadow: none;
}

.primary {
  border: 0;
  width: 100%;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font-weight: 700;
  padding: 15px 18px;
  font-size: 17px;
  margin-top: 16px;
  box-shadow: 0 14px 30px rgba(52, 199, 89, 0.24);
}

.primary:active {
  background: var(--accent-pressed);
}

.secondary {
  border: 0.5px solid var(--separator);
  background: var(--surface-solid);
  color: var(--text-primary);
  border-radius: 999px;
  padding: 11px 14px;
  font-weight: 650;
}

.muted {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.42;
}

.badge {
  background: var(--surface-secondary);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 650;
}
```

- **Reference step 3: Run build**

Run:

```bash
npm run build
```

Expected:

```text
✓ built
```

- **Reference step 4: Commit tokens**

```bash
git add src/index.css src/App.css
git commit -m "style: introduce ios-inspired visual tokens"
```

---

### Task 3: Redesign Bottom Navigation

**Files:**
- Modify: `src/components/BottomNav.tsx`
- Modify: `src/App.css`
- Test: `src/App.test.tsx`

- **Reference step 1: Replace `BottomNav.tsx`**

Use:

```tsx
import { CalendarDays, ChartNoAxesColumn, Dumbbell, Sparkles } from 'lucide-react'

type Screen = 'home' | 'preview' | 'session' | 'review' | 'progress' | 'plan' | 'profile' | 'library'

type BottomNavProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
  onStartWorkout: () => void
}

export function BottomNav({ screen, onNavigate, onStartWorkout }: BottomNavProps) {
  if (screen === 'session') return null

  return (
    <nav className="nav" aria-label="Основная навигация">
      <button className={screen === 'home' ? 'active' : ''} onClick={() => onNavigate('home')}>
        <Sparkles aria-hidden="true" />
        <span>Тренер</span>
      </button>
      <button onClick={onStartWorkout}>
        <Dumbbell aria-hidden="true" />
        <span>Зал</span>
      </button>
      <button className={screen === 'progress' ? 'active' : ''} onClick={() => onNavigate('progress')}>
        <ChartNoAxesColumn aria-hidden="true" />
        <span>Прогресс</span>
      </button>
      <button className={screen === 'plan' ? 'active' : ''} onClick={() => onNavigate('plan')}>
        <CalendarDays aria-hidden="true" />
        <span>План</span>
      </button>
    </nav>
  )
}
```

- **Reference step 2: Replace `.nav` styles in `src/App.css`**

Use:

```css
.nav {
  position: fixed;
  z-index: 40;
  left: 50%;
  bottom: calc(10px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  width: min(402px, calc(100vw - 18px));
  max-width: 402px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 8px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.78);
  border: 0.5px solid rgba(60, 60, 67, 0.16);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(22px) saturate(160%);
}

.nav button {
  min-width: 0;
  display: grid;
  place-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 20px;
  padding: 8px 4px 7px;
  font-size: 11px;
  line-height: 1;
  font-weight: 650;
}

.nav svg {
  width: 21px;
  height: 21px;
  stroke-width: 2.2;
}

.nav button.active {
  background: rgba(52, 199, 89, 0.14);
  color: var(--accent);
}
```

- **Reference step 3: Run nav-related tests**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected:

```text
PASS
```

- **Reference step 4: Commit navigation**

```bash
git add src/components/BottomNav.tsx src/App.css src/App.test.tsx
git commit -m "style: make bottom navigation feel native"
```

---

### Task 4: Recompose Home As A Today Dashboard

**Files:**
- Modify: `src/components/CoachHome.tsx`
- Modify: `src/App.css`
- Test: existing home coverage through `src/App.test.tsx`

- **Reference step 1: Add dashboard-specific classes in `CoachHome.tsx`**

Keep data logic unchanged. Change class names and hierarchy:

```tsx
<section className="screen active home-screen">
  <div className="top home-top">
    <div>
      <div className="kicker">Сегодня</div>
      <div className="title">Твой тренер</div>
    </div>
    <div className="profile-control">
      ...
    </div>
  </div>

  <div className="today-hero">
    <div className="today-hero-copy">
      <div className="kicker">{nextTimelineItem ? `Следующая · ${formatDateOnly(nextTimelineItem.scheduledDate)}` : 'Следующая тренировка'}</div>
      <h1>{activeWorkoutDay.label}</h1>
      <p>{activeWorkoutDay.exercises.length} упражнений · ~{activeWorkoutDay.exercises.length * 10} минут</p>
    </div>
    <div className="readiness-ring" aria-hidden="true">
      <span>{activeWorkoutDay.exercises.length}</span>
      <small>упр.</small>
    </div>
    <p className="today-hero-note">
      {firstExercise ? `Начнём с ${firstExercise.name}: ${formatWeight(nextTargets[firstExercise.id] ?? firstExercise.targetWeight ?? 0)} кг.` : 'Выбери дату тренировки, я соберу план.'}
    </p>
    <button className="primary" onClick={() => onStartWorkout()}>Начать тренировку</button>
  </div>
```

- **Reference step 2: Add Home styles**

Add:

```css
.home-screen {
  display: grid;
  gap: 14px;
}

.home-top {
  margin-bottom: 2px;
}

.today-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 86px;
  gap: 14px;
  align-items: center;
  padding: 20px;
  border-radius: 30px;
  background:
    linear-gradient(145deg, rgba(29, 29, 31, 0.96), rgba(58, 58, 60, 0.92)),
    var(--text-primary);
  color: #ffffff;
  box-shadow: var(--shadow-soft);
}

.today-hero h1 {
  margin: 8px 0 6px;
  font-size: 30px;
  line-height: 1.03;
  font-weight: 760;
  letter-spacing: 0;
}

.today-hero p {
  margin: 0;
  color: rgba(255, 255, 255, 0.74);
}

.today-hero .kicker {
  color: rgba(255, 255, 255, 0.62);
}

.today-hero-note {
  grid-column: 1 / -1;
  font-size: 15px;
  line-height: 1.4;
}

.today-hero .primary {
  grid-column: 1 / -1;
  margin-top: 0;
}

.readiness-ring {
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
  align-content: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, rgba(255,255,255,0.08) 52%, transparent 53%),
    conic-gradient(var(--accent) 0 72%, rgba(255,255,255,0.18) 72% 100%);
}

.readiness-ring span {
  font-size: 24px;
  font-weight: 760;
  line-height: 1;
}

.readiness-ring small {
  color: rgba(255,255,255,0.66);
  font-size: 11px;
  font-weight: 650;
}
```

- **Reference step 3: Simplify secondary Home cards**

Update library and history cards so they use list-row styling:

```css
.library-entry-card,
.timeline-card,
.history-item {
  background: var(--surface-solid);
}

.timeline {
  margin-top: 4px;
  display: grid;
  gap: 10px;
}

.day-card.selected {
  border-color: rgba(52, 199, 89, 0.35);
  box-shadow: 0 12px 28px rgba(52, 199, 89, 0.12);
}
```

- **Reference step 4: Run tests**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected:

```text
PASS
```

- **Reference step 5: Commit Home redesign**

```bash
git add src/components/CoachHome.tsx src/App.css
git commit -m "style: recompose home as today dashboard"
```

---

### Task 5: Make Plan Screen Less Admin-Like

**Files:**
- Modify: `src/components/PlanCalendar.tsx`
- Modify: `src/App.css`
- Test: `src/App.test.tsx`

- **Reference step 1: Rename the planning section classes**

In `PlanCalendar.tsx`, make the main section:

```tsx
<section className="screen active plan-screen">
```

Make the date picker card:

```tsx
<div className="plan-picker top-gap">
```

Make planned workout items:

```tsx
<div key={workout.id} className={`plan-workout-row ${workout.workoutDay.id === activeWorkoutDay.id ? 'selected' : ''}`}>
```

- **Reference step 2: Keep only primary visible actions on workout rows**

For non-edit mode, expose `открыть` and move the rest into quieter buttons below only if needed. First pass:

```tsx
<div className="action-row top-gap plan-row-actions">
  <button className="primary compact-action" onClick={() => onStartWorkout(workout.workoutDay)}>Открыть</button>
  <button className="secondary compact" onClick={() => onBeginEditPlannedDate(workout.id, workout.scheduledDate)}>Перенести</button>
  <button className="secondary compact" onClick={() => onRegeneratePlannedWorkout(workout.id)}>Обновить</button>
  <button className="secondary compact danger-soft" onClick={() => onCancelPlannedWorkout(workout.id)}>Убрать</button>
</div>
```

- **Reference step 3: Add Plan styles**

Use:

```css
.plan-screen {
  display: grid;
  gap: 14px;
}

.plan-picker {
  padding: 16px;
  border-radius: var(--radius-xl);
  background: var(--surface-solid);
  border: 0.5px solid var(--separator);
}

.two-week-picker {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 7px;
}

.week-day {
  min-height: 56px;
  padding: 8px 4px;
  border-radius: 16px;
  background: var(--surface-secondary);
  border: 0;
  color: var(--text-primary);
}

.week-day.active {
  background: var(--accent);
  color: #ffffff;
  border-color: transparent;
}

.plan-workout-row {
  display: grid;
  gap: 10px;
  padding: 14px 0;
  border-top: 0.5px solid var(--separator);
}

.plan-workout-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.plan-workout-row.selected h3 {
  color: var(--accent);
}

.plan-row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
```

- **Reference step 4: Verify mobile layout**

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Check at 390x844:

- Date buttons do not overlap.
- Bottom nav does not cover workout row actions.
- Primary button is visually strongest.
- No button text clips.

- **Reference step 5: Run build**

Run:

```bash
npm run build
```

Expected:

```text
✓ built
```

- **Reference step 6: Commit Plan redesign**

```bash
git add src/components/PlanCalendar.tsx src/App.css
git commit -m "style: simplify plan screen hierarchy"
```

---

### Task 6: Mature The Workout / Gym Flow

**Files:**
- Modify: `src/components/GymScreen.tsx`
- Modify: `src/components/GymActions.tsx`
- Modify: `src/App.css`
- Test: `src/components/GymScreen.test.tsx`

- **Reference step 1: Change Gym header copy hierarchy**

In `GymScreen.tsx`, use:

```tsx
<section className="screen active session-screen">
  <div className="session-header">
    <button className="back" onClick={() => navigate('home')}>Тренер</button>
    <span className="badge">{activeExerciseIndex + 1} из {activeWorkoutDay.exercises.length}</span>
  </div>

  <div className="focus workout-focus">
    <div className="kicker">{activeWorkoutDay.name}</div>
    <button
      type="button"
      className="exercise-title-button"
      onClick={openExerciseGuide}
      aria-label={`Открыть описание упражнения: ${activeExercise.name}`}
    >
      <h2>{activeExercise.name}</h2>
      <span>техника</span>
    </button>
    <div className="muted">{activeExercise.prescription}</div>
    <div className="target-metric">
      <span>{formatWeight(activeLog.sets[0]?.weight ?? activeExercise.targetWeight)}</span>
      <small>кг сегодня</small>
    </div>
    <div className="coach-note"><div className="muted"><b>Фокус:</b> {activeExercise.coachFocus}</div></div>
  </div>
```

- **Reference step 2: Add Gym styles**

Use:

```css
.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.back {
  border: 0;
  background: transparent;
  color: var(--accent);
  padding: 8px 0;
  font-weight: 650;
}

.workout-focus {
  display: grid;
  gap: 10px;
  padding: 18px;
  border-radius: 30px;
}

.exercise-title-button h2 {
  margin: 0;
  font-size: 32px;
  line-height: 1.02;
  letter-spacing: 0;
  font-weight: 760;
}

.exercise-title-button span {
  display: inline-flex;
  margin-top: 8px;
  border-radius: 999px;
  background: rgba(52, 199, 89, 0.12);
  color: var(--accent);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
}

.target-metric {
  display: grid;
  gap: 2px;
  width: fit-content;
  margin-top: 4px;
}

.target-metric span {
  font-size: 46px;
  line-height: 0.95;
  font-weight: 760;
}

.target-metric small {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
}
```

- **Reference step 3: Convert quick actions to calmer controls**

In `GymActions.tsx`, keep behavior but use short labels:

```tsx
<div className="quick action-toolbar">
  <button onClick={copyPrevious}>Повторить</button>
  <button onClick={() => adjustWeight(-weightStep)}>-{weightStep}</button>
  <button onClick={() => adjustWeight(weightStep)}>+{weightStep}</button>
  <button className={hasPain ? 'danger active' : 'danger'} onClick={markPain}>Боль</button>
</div>
```

Add:

```css
.action-toolbar {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 0.8fr 0.9fr;
  gap: 8px;
}

.action-toolbar button {
  min-height: 44px;
  border: 0;
  background: var(--surface-secondary);
  color: var(--text-primary);
  border-radius: 999px;
  font-weight: 700;
}

.action-toolbar .danger {
  color: var(--danger);
}

.action-toolbar .danger.active {
  background: rgba(255, 59, 48, 0.12);
}
```

- **Reference step 4: Run Gym tests**

Run:

```bash
npm run test -- src/components/GymScreen.test.tsx
```

Expected:

```text
PASS
```

- **Reference step 5: Commit Gym redesign**

```bash
git add src/components/GymScreen.tsx src/components/GymActions.tsx src/App.css
git commit -m "style: mature workout session interface"
```

---

### Task 7: Visual QA Across Mobile Screens

**Files:**
- Modify only if QA reveals layout issues.
- Test: browser at 390x844 and 430x932.

- **Reference step 1: Start app**

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

- **Reference step 2: Check Home**

At 390x844 verify:

- Today hero is visible in first viewport.
- Main CTA is clearly strongest.
- User select/profile area does not collide with title.
- Bottom nav does not hide selected timeline card.
- No text clipping in Russian labels.

- **Reference step 3: Check Plan**

At 390x844 verify:

- Two-week picker is readable.
- Selected dates have clear affordance.
- Workout row actions fit.
- The screen does not look like a form/admin panel.

- **Reference step 4: Check Gym preview and active session**

Verify:

- Exercise title wraps cleanly.
- Large weight metric does not overflow.
- Quick actions fit on 390px width.
- Rest timer and set inputs remain usable.

- **Reference step 5: Check desktop preview**

At 1280x720 verify:

- Phone shell remains centered.
- Bottom nav stays aligned to phone width.
- No huge empty visual imbalance appears.

- **Reference step 6: Run full verification**

Run:

```bash
npm run test
npm run build
```

Expected:

```text
PASS
✓ built
```

- **Reference step 7: Commit QA fixes**

```bash
git add src
git commit -m "fix: polish responsive visual details"
```

---

## Done Criteria

- Home screen reads as a polished Today dashboard, not a stack of technical cards.
- Plan screen feels like a compact iOS planning surface, not an admin form.
- Gym screen focuses attention on current exercise, target weight, and next action.
- Bottom navigation uses icons, blur/material feel, and compact labels.
- CSS has fewer competing one-off overrides.
- Russian text does not clip at 390px width.
- `npm run test` passes.
- `npm run build` passes.

## Suggested Execution Order

1. Tokens and nav first.
2. Home dashboard second.
3. Plan screen third.
4. Gym flow fourth.
5. Full visual QA last.

This keeps each commit independently reviewable and avoids redesigning every screen before the core language is proven.
