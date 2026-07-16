# Warm Editorial — reference for the redesign issues

Single source of truth for the `warm-editorial` issues. Each issue links here.
You (the implementing agent) start cold — read this first.

## Goal

Bring the app to match the Claude Design prototype **«Тренер — прототип»**.
Full local copy (design source of truth): [`prototype.html`](./prototype.html) —
open it in a browser to inspect markup, state and interactions. It contains all
screens: Home (Тренер), Progress (Прогресс), Plan (План), Review, Gym session,
plus sheets (goal / technique-info / readiness / library) and bottom nav.

The design language is already ~75% applied via `src/warm-editorial-theme.css`
(loaded last, after `src/App.css`). We are closing **structural + behavioral**
gaps per screen, not re-theming from scratch.

## Design language

- Warm "paper" background; **vermilion accent = action only**; olive `--success`
  for growth/done/up-trend.
- Display serif **Newsreader** for headings + exercise names (`--font-display`);
  **Space Grotesk** for UI; `tabular-nums` for weights/reps/counts.
- Cards: rounded, soft shadow; dark "espresso" **hero** card for the primary CTA.

## Token map (prototype var → app var)

The app keeps its own token names; use these, not the prototype's raw names.

| Prototype            | App                                   |
|----------------------|---------------------------------------|
| `--ink / --ink2 / --ink3` | `--text-primary / --text-secondary / --text-tertiary` |
| `--paper`            | `--bg`                                |
| `--surface`, `--surface-muted`, `--border`, `--separator` | same names |
| `--accent`, `--accent-press` | `--accent`, `--accent-pressed`  |
| `--success`, `--warning`, `--danger` | same names             |
| `--hero-bg`, `--hero-text` | same names                       |
| `--hero-muted`, `--hero-tert` | `--hero-text-muted`, `--hero-text-tertiary` |

**Prototype LIGHT values** (make app tokens match these): app-bg `#E4DCCB`,
paper `#F1E9DB`, surface `#FFFDF9`, surface-muted `#EAE0CF`,
border `rgba(34,32,27,.12)`, separator `rgba(34,32,27,.09)`,
ink `#22201B`, ink2 `#6E665A`, ink3 `#A79D8B`,
accent `#DA5326`, accent-press `#B8431C`, success `#4E7A5B`, warning `#C67A2E`,
danger `#C23B2E`, hero-bg `#2A2018`, hero-2 `#3A2C20`, hero-text `#F1E9DB`,
hero-muted `rgba(241,233,219,.72)`, hero-tert `rgba(241,233,219,.5)`.

**Prototype DARK values** (`:root[data-theme="dark"]`): app-bg `#0B0805`,
paper `#171209`, surface `#221A11`, surface-muted `#2E2417`,
ink `#F1E9DB`, ink2 `rgba(241,233,219,.7)`, ink3 `rgba(241,233,219,.44)`,
accent `#EC6C3F`, accent-press `#DA5326`, success `#7CA98A`, warning `#D89A54`,
danger `#DE6B58`, hero-bg `#251C13`, hero-2 `#31251A`, hero-text `#F4EDE0`.

## RPE ↔ RIR mapping (Gym logger, issue #9)

The prototype's **«Сколько ещё сделаешь?»** scale (4 dots) is a re-presentation of
the existing `difficultyOptions` in `src/components/gymTypes.ts`. Write into the
**same `rpe` field** via `updateSet(setIndex, { rpe })`. **Do NOT add a schema.**

| Dot (RIR) | Label prototype | `difficultyOptions` label | `rpe` value | tone |
|-----------|-----------------|---------------------------|-------------|------|
| `4+`      | запас           | Легко                     | 6           | success |
| `3`       |                 | Нормально                 | 7           | success |
| `1–2`     |                 | Тяжело                    | 8           | warning |
| `0`       | отказ           | На пределе                | 10          | danger  |

## UI kit — reuse, don't inline

The prototype uses inline styles; the app uses **classes + CSS variables**. Reuse
`src/components/ui`: `HeroStatus`, `ScreenHeader`, `MetricPair`, `SectionList`,
`WorkoutRow`, `AppShell`, `ActionMenu`. Issue #1 adds shared primitives
`Stepper` (± number), `SegmentedControl`, `Pill` — use them in later issues.
`HeroStatus` is shared by Home / Plan / Progress — don't regress the others.

## Definition of Done (every issue)

- Screen matches [`prototype.html`](./prototype.html) in **both light and dark**.
- `npm test`, `npm run lint`, and `tsc -b` (or `npm run build`) all pass.
- Tests updated alongside markup/behavior changes (redesign breaks text/DOM asserts).
- No unrelated screen regressed.
- **Commit directly on `feat/warm-editorial-prototype`** (no per-issue PR), one or
  more commits per issue, with `Closes #N` in the message. Keep the branch green.

## Verify recipe

1. Dev server via `.claude/launch.json` (config `web`, port 5173) → `npm run dev`.
2. Viewport **mobile 375×812**.
3. Skip onboarding: in devtools console
   `localStorage.setItem('ai-gym-trainer:v0.1:onboarding-completed','1')`, reload.
4. Navigate: bottom nav **Тренер / Зал / Прогресс / План**; start a workout via
   the hero **«Начать»** → readiness → **«Начать тренировку»**.
5. Compare against [`prototype.html`](./prototype.html) (and design screenshots).

## Issue order

**#1 Foundations lands first** (later issues use its tokens + primitives). The
rest are largely independent by screen; the recommended order is the issue number.
The full task list with success criteria is in [`issues.md`](./issues.md).
