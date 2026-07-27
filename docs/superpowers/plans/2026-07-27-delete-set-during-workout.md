# Кнопка удаления подхода во время тренировки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить кнопку «Удалить подход N» в карточку `CurrentStepCard` (под «Добавить подход») и пробросить пропсы через `GymScreen` и `GymPage`.

**Architecture:** UI-wiring + маленький фикс гарда в хуке. Меняются 4 файла: `useWorkoutSession.ts` (гард), `CurrentStepCard.tsx` (кнопка), `GymScreen.tsx` + `GymPage.tsx` (проброс), `warm-editorial-theme.css` (селектор к существующему классу).

**Tech Stack:** React + TypeScript, Vitest + Testing Library, CSS

## Global Constraints

- Тесты НЕ зависят от текста UI (использовать `data-testid`, `aria-label`, роль элемента)
- Компоненты: функциональные, типизированные
- Стили: CSS-классы, без CSS-in-JS
- Кнопка видна только когда подходов > 1
- Иконка: `Trash2` из `lucide-react`
- **Один коммит на всю фичу** — `GymScreen` без `GymPage` не проходит `tsc`, а кнопка без CSS выглядит сломанной

## Решения по итогам ревью (2026-07-27)

| Что | Почему |
|---|---|
| Подпись `Удалить подход {setNumber}`, а не «Удалить подход» | `activeSetIndex = findIndex(!completed)` (`useActiveWorkoutContext.ts:109`) — это **первый невыполненный**, а не последний добавленный. Кнопка под «Добавить подход» без номера читается как undo добавления и молча снесёт подход с уже введённым весом. Номер совпадает с eyebrow «Подход N из M» — двусмысленности нет, кода столько же. |
| Индекс остаётся `activeSetIndex` (не последний подход) | Удаление последнего было бы честным undo, но при `editCompletedSet` последний подход может быть выполненным — снесёт данные. Текущий подход всегда невыполненный. |
| Гард `sets.length <= 1` выносится из updater'а | Сейчас гард внутри `setLogs`, а `notify('Подход удалён')` снаружи → тост врёт при заблокированном удалении. Скрытие кнопки лечит симптом в UI; чинить надо в хуке, там же где все вызовы. |
| Отдельного `.gym-remove-set-btn` блока нет | `.gym-remove-exercise-btn` (`warm-editorial-theme.css:1555`) — байт в байт то же самое. `flex`/`gap` не нужны: соседняя кнопка (`GymScreen.tsx:238`) рендерит `<Trash2/> текст` без них. |
| Без `aria-label` | Дублировал бы видимый текст. У соседней кнопки его нет, и тест (`GymScreen.test.tsx:224`) находит её по имени из текста. |
| Теста проброса в `GymScreen` нет | Это ловит `tsc` (Task 3, Step 1). 50 строк пропсов ради проверки типа — не окупается. |
| Теста на гард в хуке нет | Для `useWorkoutSession` нет тестового харнесса; поднимать `renderHook` ради двух строк дороже фикса. Поведение косвенно закрыто тестом «кнопка не показывается при ≤ 1». |

---

### Task 1: `useWorkoutSession` — вынести гард из updater'а

**Files:**
- Modify: `src/hooks/useWorkoutSession.ts:170-180`

**Interfaces:**
- Consumes: `logs`, `activeExercise`, `createExerciseLog` (уже в скоупе хука)
- Produces: `removeSet` больше не показывает тост при заблокированном удалении

- [ ] **Step 1: Переписать `removeSet`**

Было:
```ts
function removeSet(setIndex: number) {
  setLogs((current) => {
    const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
    if (existing.sets.length <= 1) return current
    const sets = existing.sets.filter((_, index) => index !== setIndex)
    const nextLogs = { ...current, [activeExercise.id]: { ...existing, sets } }
    persistWorkoutDraft(nextLogs)
    return nextLogs
  })
  notify('Подход удалён')
}
```

Стало (паттерн как в `markSetDone`, строка 184 — читает `logs` до `setLogs`):
```ts
function removeSet(setIndex: number) {
  const existing = logs[activeExercise.id] ?? createExerciseLog(activeExercise)
  if (existing.sets.length <= 1) return
  setLogs((current) => {
    const nextLogs = {
      ...current,
      [activeExercise.id]: { ...existing, sets: existing.sets.filter((_, index) => index !== setIndex) },
    }
    persistWorkoutDraft(nextLogs)
    return nextLogs
  })
  notify('Подход удалён')
}
```

- [ ] **Step 2: Типы зелёные**

```bash
npx tsc -b --noEmit
```

### Task 2: `CurrentStepCard` — проп `removeSet`, кнопка и стиль

**Files:**
- Modify: `src/components/CurrentStepCard.tsx:1-226`
- Modify: `src/components/CurrentStepCard.test.tsx:1-178`
- Modify: `src/warm-editorial-theme.css:1555-1565`

**Interfaces:**
- Consumes: nothing new
- Produces: `removeSet: (setIndex: number) => void` prop on CurrentStepCard

- [ ] **Step 1: Добавить тесты**

В конец `describe('CurrentStepCard', ...)` (`baseProps` даёт 3 подхода и `activeSetIndex: 1`):

```typescript
  it('кнопка удаления подхода вызывает removeSet с индексом текущего подхода', async () => {
    const user = userEvent.setup()
    const removeSet = vi.fn()
    render(<CurrentStepCard {...baseProps({ removeSet })} />)
    await user.click(screen.getByRole('button', { name: /удалить подход/i }))
    expect(removeSet).toHaveBeenCalledWith(1) // activeSetIndex = 1
  })

  it('кнопка удаления подхода не показывается, когда подход один', () => {
    render(
      <CurrentStepCard
        {...baseProps({
          removeSet: vi.fn(),
          activeLog: {
            exerciseId: 'bench-press',
            pain: false,
            sets: [{ weight: 60, reps: 8, rpe: 7, completed: false }],
          },
          activeSetIndex: 0,
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /удалить подход/i })).not.toBeInTheDocument()
  })
```

Также добавить `removeSet: vi.fn(),` в `baseProps` (строка 35-53), чтобы остальные тесты не падали на отсутствующем пропе.

- [ ] **Step 2: Запустить тесты — должны упасть**

```bash
npx vitest run src/components/CurrentStepCard.test.tsx
```
Ожидаемый результат: 2 новых теста FAIL — кнопка не рендерится.

- [ ] **Step 3: Кнопка в `CurrentStepCard.tsx`**

1. Импорт после строки 10 (`import { useEffect, useState } from 'react'`):
```typescript
import { Trash2 } from 'lucide-react'
```

2. В `type CurrentStepCardProps` после `skipRest: () => void` (строка 31):
```typescript
  removeSet: (setIndex: number) => void
```

3. В деструктуризацию пропсов после `skipRest,` (строка 48):
```typescript
  removeSet,
```

4. После кнопки «Добавить подход» (строки 215-221), перед закрывающим `</div>`:
```tsx
      {activeLog.sets.length > 1 && (
        <button
          className="gym-remove-set-btn"
          type="button"
          onClick={() => removeSet(activeSetIndex)}
        >
          <Trash2 size={14} aria-hidden="true" /> Удалить подход {setNumber}
        </button>
      )}
```

- [ ] **Step 4: CSS — добавить селектор к существующему классу**

В `src/warm-editorial-theme.css` (строки 1555 и 1565) — **не** заводить новый блок, а расширить существующий:

```css
.gym-remove-exercise-btn,
.gym-remove-set-btn {
  width: 100%;
  padding: 10px;
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: 13px;
  cursor: pointer;
  opacity: 0.7;
}
.gym-remove-exercise-btn:hover,
.gym-remove-set-btn:hover { opacity: 1; }
```

- [ ] **Step 5: Запустить тесты — должны пройти**

```bash
npx vitest run src/components/CurrentStepCard.test.tsx
```

### Task 3: Проброс `GymScreen` → `GymPage`

**Files:**
- Modify: `src/components/GymScreen.tsx:1-297`
- Modify: `src/pages/GymPage.tsx:130-171`

**Interfaces:**
- Consumes: `onRemoveSet: (setIndex: number) => void` — уже есть в `GymPageProps` (строка 61), уже прокинут из `App.tsx:533`
- Produces: `removeSet` prop on GymScreen → CurrentStepCard

Оба файла в одном шаге: `GymScreen` с новым обязательным пропом ломает `tsc`, пока `GymPage` его не передаёт.

- [ ] **Step 1: Проверить типы — должен быть type-error**

```bash
npx tsc -b --noEmit 2>&1 | head -20
```
Ожидаемый результат: error в `GymScreen.tsx` — `CurrentStepCard` требует `removeSet`.

- [ ] **Step 2: `GymScreen.tsx`**

1. В `type GymScreenProps` после `removeCurrentExercise: () => void` (строка 39):
```typescript
  removeSet: (setIndex: number) => void
```

2. В деструктуризацию пропсов после `removeCurrentExercise,`:
```typescript
  removeSet,
```

3. В `<CurrentStepCard ...>` (строки 169-184), после `skipRest={clearRestTimer}`:
```tsx
        removeSet={removeSet}
```

- [ ] **Step 3: `GymPage.tsx`**

В JSX `<GymScreen ...>` после `removeCurrentExercise={props.onRemoveCurrentExercise}` (строка 156):
```tsx
          removeSet={props.onRemoveSet}
```

- [ ] **Step 4: Обновить тесты GymScreen — добавить `removeSet={vi.fn()}`**

В `src/components/GymScreen.test.tsx` три места:

1. `renderGym` — после `removeCurrentExercise={vi.fn()}` (строка ~80):
```typescript
        removeSet={vi.fn()}
```

2. Первый полный список пропсов (строка ~165):
```typescript
        removeSet={vi.fn()}
```

3. Второй полный список пропсов (строка ~217):
```typescript
        removeSet={vi.fn()}
```

- [ ] **Step 5: Проверить типы**

```bash
npx tsc -b --noEmit
```
Ожидаемый результат: exit 0.

- [ ] **Step 6: Все тесты**

```bash
npm test
```
Ожидаемый результат: все тесты PASS (+2 новых).

- [ ] **Step 7: Визуальная проверка (ручная)**

```bash
npm run dev
```
Начать тренировку → под «Добавить подход» видна красная кнопка с корзиной «Удалить подход N», где N — номер текущего подхода. При наведении opacity → 1. Удаление уменьшает число чипсов в ряду «Подходы».

- [ ] **Step 8: Коммит**

```bash
git add src/hooks/useWorkoutSession.ts src/components/CurrentStepCard.tsx src/components/CurrentStepCard.test.tsx src/components/GymScreen.tsx src/components/GymScreen.test.tsx src/pages/GymPage.tsx src/warm-editorial-theme.css
```

```bash
git commit -m "feat(gym): кнопка удаления подхода во время тренировки"
```
