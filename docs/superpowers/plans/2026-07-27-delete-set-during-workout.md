# Кнопка удаления подхода во время тренировки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить кнопку «Удалить подход» в карточку `CurrentStepCard` (рядом с «Добавить подход») и пробросить пропсы через `GymScreen` и `GymPage`.

**Architecture:** Только UI-wiring — бэкенд-логика `removeSet` уже реализована в `useWorkoutSetActions`. Меняются 4 файла: `CurrentStepCard.tsx` (кнопка), `GymScreen.tsx` (пропс), `GymPage.tsx` (проброс), `warm-editorial-theme.css` (стиль).

**Tech Stack:** React + TypeScript, Vitest + Testing Library, CSS

## Global Constraints

- Тесты НЕ зависят от текста UI (использовать `data-testid`, `aria-label`, роль элемента)
- Компоненты: функциональные, типизированные
- Стили: CSS-классы, без CSS-in-JS
- Кнопка: `color: var(--danger)`, opacity 0.7, без фона, без бордера
- Кнопка видна только когда подходов > 1
- Иконка: `Trash2` из `lucide-react`

---
```

### Task 1: CurrentStepCard — добавить проп `removeSet` и кнопку

**Files:**
- Modify: `src/components/CurrentStepCard.tsx:1-226`
- Modify: `src/components/CurrentStepCard.test.tsx:1-178`

**Interfaces:**
- Consumes: nothing new
- Produces: `removeSet: (setIndex: number) => void` prop on CurrentStepCard

- [ ] **Step 1: Добавить тест на кнопку «Удалить подход»**

В конец `describe('CurrentStepCard', () => {` перед закрывающей `});` добавить:

```typescript
  it('кнопка «Удалить подход» вызывает removeSet с индексом текущего подхода', async () => {
    const user = userEvent.setup()
    const removeSet = vi.fn()
    render(<CurrentStepCard {...baseProps({ removeSet })} />)
    const removeBtn = screen.getByRole('button', { name: 'Удалить подход' })
    await user.click(removeBtn)
    expect(removeSet).toHaveBeenCalledWith(1) // activeSetIndex = 1
  })

  it('кнопка «Удалить подход» не показывается, когда подходов ≤ 1', () => {
    const removeSet = vi.fn()
    render(
      <CurrentStepCard
        {...baseProps({
          removeSet,
          activeLog: {
            exerciseId: 'bench-press',
            pain: false,
            sets: [{ weight: 60, reps: 8, rpe: 7, completed: false }],
          },
          activeSetIndex: 0,
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Удалить подход' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Запустить тесты — должны упасть**

```bash
npx vitest run src/components/CurrentStepCard.test.tsx
```
Ожидаемый результат: 2 новых теста FAIL — prop `removeSet` ещё не передан, кнопка не рендерится.

- [ ] **Step 3: Добавить `removeSet` в пропсы CurrentStepCard и импортировать Trash2**

В `src/components/CurrentStepCard.tsx`:

1. Добавить в импорт `Trash2` (строка 9):
```typescript
import { useEffect, useState } from 'react'
// добавить после 9 строки:
import { Trash2 } from 'lucide-react'
```

2. В `type CurrentStepCardProps` добавить после строки 31 (`skipRest: () => void`):
```typescript
  removeSet: (setIndex: number) => void
```

3. В деструктуризацию пропсов `CurrentStepCard` (строка 34-48) добавить после `skipRest,`:
```typescript
  removeSet,
```

4. После кнопки «Добавить подход» (строки 215-221) добавить кнопку «Удалить подход»:
```tsx
      {activeLog.sets.length > 1 && (
        <button
          className="gym-remove-set-btn"
          type="button"
          onClick={() => removeSet(activeSetIndex)}
          aria-label="Удалить подход"
        >
          <Trash2 size={14} aria-hidden="true" /> Удалить подход
        </button>
      )}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

```bash
npx vitest run src/components/CurrentStepCard.test.tsx
```
Ожидаемый результат: все тесты PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/components/CurrentStepCard.tsx src/components/CurrentStepCard.test.tsx
git commit -m "feat(CurrentStepCard): добавить кнопку удаления подхода"
```

### Task 2: GymScreen — добавить проп `removeSet` и пробросить в CurrentStepCard

**Files:**
- Modify: `src/components/GymScreen.tsx:1-297`
- Modify: `src/components/GymScreen.test.tsx:1-229`

**Interfaces:**
- Consumes: nothing new
- Produces: `removeSet: (setIndex: number) => void` prop on GymScreen, passed to CurrentStepCard

- [ ] **Step 1: Добавить тест проброса в GymScreen**

В конец `describe('GymScreen', () => {` перед закрывающей `});` добавить:

```typescript
  it('пробрасывает removeSet в CurrentStepCard', async () => {
    const user = userEvent.setup()
    const removeSet = vi.fn()
    const bench = makeExercise({ id: 'bench-press', name: 'Жим лёжа' })
    const workoutDay: WorkoutDay = {
      id: 'day-a',
      name: 'День A',
      label: 'A',
      description: '',
      exercises: [bench],
    }

    render(
      <GymScreen
        activeWorkoutDay={workoutDay}
        activeExercise={bench}
        activeExerciseIndex={0}
        activeLog={{ exerciseId: bench.id, pain: false, sets: [
          { weight: 54.5, reps: 8, rpe: 7, completed: true },
          { weight: 54.5, reps: 0, rpe: 7, completed: false },
        ]}}
        activeSetIndex={1}
        previousSetsSummary="49.5×12"
        visibleNextSetRecommendation={null}
        allSetsCompleted={false}
        restRemainingSeconds={0}
        draftStatus=""
        exerciseAddSuggestion={null}
        formatWeight={String}
        navigate={vi.fn()}
        openExerciseGuide={vi.fn()}
        openReplacementSheet={vi.fn()}
        openExercisePicker={vi.fn()}
        clearRestTimer={vi.fn()}
        extendRest={vi.fn()}
        editCompletedSet={vi.fn()}
        updateSetWeight={vi.fn()}
        updateSetReps={vi.fn()}
        markSetDone={vi.fn()}
        addSet={vi.fn()}
        removeSet={removeSet}
        removeCurrentExercise={vi.fn()}
        addSuggestedExercise={vi.fn()}
        applyCoachExerciseSuggestion={vi.fn()}
        acceptCoachDecision={vi.fn()}
        goToNextExercise={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Удалить подход' }))
    expect(removeSet).toHaveBeenCalledWith(1)
  })
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
npx vitest run src/components/GymScreen.test.tsx
```
Ожидаемый результат: новый тест FAIL — prop `removeSet` не объявлен.

- [ ] **Step 3: Добавить `removeSet` в GymScreen**

В `src/components/GymScreen.tsx`:

1. В `type GymScreenProps` после строки 39 (`removeCurrentExercise: () => void`):
```typescript
  removeSet: (setIndex: number) => void
```

2. В деструктуризацию пропсов компонента (строка 47-75) добавить после `removeCurrentExercise,`:
```typescript
  removeSet,
```

3. В `<CurrentStepCard ...` (строка 169-184) добавить проп:
```tsx
        removeSet={removeSet}
```

После строки 183 (`skipRest={clearRestTimer}`) перед `/>` закрытием тега:
```tsx
        removeSet={removeSet}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

```bash
npx vitest run src/components/GymScreen.test.tsx
```
Ожидаемый результат: все тесты PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/components/GymScreen.tsx src/components/GymScreen.test.tsx
git commit -m "feat(GymScreen): пробросить removeSet в CurrentStepCard"
```

### Task 3: GymPage — пробросить `onRemoveSet` в GymScreen

**Files:**
- Modify: `src/pages/GymPage.tsx:130-171`

**Interfaces:**
- Consumes: `onRemoveSet: (setIndex: number) => void` (уже есть в GymPageProps, строка 61)
- Produces: passed as `removeSet` prop to GymScreen

- [ ] **Step 1: Проверить типы — должен быть type-error**

```bash
npx tsc -b --noEmit 2>&1 | head -20
```
Ожидаемый результат: type error в GymPage.tsx — GymScreen ожидает `removeSet`, но он не передан.

- [ ] **Step 2: Пробросить проп**

В `src/pages/GymPage.tsx`, в JSX `<GymScreen ...>` (строки 131-170), после строки 156 (`removeCurrentExercise={props.onRemoveCurrentExercise}`) добавить:

```tsx
          removeSet={props.onRemoveSet}
```

- [ ] **Step 3: Проверить типы — ошибок нет**

```bash
npx tsc -b --noEmit
```
Ожидаемый результат: exit 0, no errors.

- [ ] **Step 4: Запустить все тесты**

```bash
npm test
```
Ожидаемый результат: все тесты PASS (658/658 или около того, +2 новых теста).

- [ ] **Step 5: Коммит**

```bash
git add src/pages/GymPage.tsx
git commit -m "feat(GymPage): пробросить onRemoveSet в GymScreen"
```

### Task 4: CSS — стиль кнопки `.gym-remove-set-btn`

**Files:**
- Modify: `src/warm-editorial-theme.css` (добавить после `.gym-remove-exercise-btn:hover`)

**Interfaces:**
- Consumes: nothing
- Produces: `.gym-remove-set-btn` CSS class

- [ ] **Step 1: Добавить CSS-класс**

В `src/warm-editorial-theme.css` после строки с `.gym-remove-exercise-btn:hover { opacity: 1; }` добавить:

```css
/* --- Кнопка удаления подхода (в CurrentStepCard) --- */
.gym-remove-set-btn {
  width: 100%;
  padding: 10px;
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: 13px;
  cursor: pointer;
  opacity: 0.7;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.gym-remove-set-btn:hover { opacity: 1; }
```

- [ ] **Step 2: Визуальная проверка (ручная)**

```bash
npm run dev
```
Открыть приложение, начать тренировку — кнопка «Удалить подход» должна быть видна под «Добавить подход», красного цвета (danger), иконка корзины слева. При наведении — opacity становится 1.

- [ ] **Step 3: Коммит**

```bash
git add src/warm-editorial-theme.css
git commit -m "style: кнопка удаления подхода (danger, transparent)"
```
