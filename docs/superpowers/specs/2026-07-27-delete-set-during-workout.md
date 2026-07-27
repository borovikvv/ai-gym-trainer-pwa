# Удаление подхода во время тренировки

**Дата:** 2026-07-27
**Статус:** approved

## Контекст

На вкладке «Зал» во время тренировки пользователь может добавлять подходы кнопкой «Добавить подход», но не может удалить лишний/ошибочный подход.

Бэкенд-логика (`removeSet` в `useWorkoutSetActions`) уже реализована:
- удаляет подход по индексу
- не даёт удалить последний оставшийся (`sets.length <= 1`)
- сохраняет черновик через `persistWorkoutDraft`
- показывает toast-уведомление «Подход удалён»

`GymPage` уже принимает `onRemoveSet` проп, но не пробрасывает его в `GymScreen`.

## Изменения

### Файлы

| # | Файл | Что |
|---|---|---|
| 1 | `src/components/CurrentStepCard.tsx` | Добавить `removeSet` проп, кнопку «Удалить подход» под «Добавить подход» |
| 2 | `src/components/GymScreen.tsx` | Добавить `removeSet` в пропсы, пробросить в `CurrentStepCard` |
| 3 | `src/pages/GymPage.tsx` | Пробросить `onRemoveSet` в `GymScreen` |
| 4 | `src/warm-editorial-theme.css` | Стиль `.gym-remove-set-btn` — такой же как `.gym-remove-exercise-btn` |

### Детали

#### `CurrentStepCard.tsx`
- Новый проп: `removeSet: (setIndex: number) => void`
- Кнопка: после «Добавить подход», внутри `current-step--logger` карточки
- Текст: «Удалить подход»
- Иконка: `Trash2` из `lucide-react` (уже импортируется в GymScreen; нужно добавить импорт в CurrentStepCard)

#### Стиль кнопки
```css
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
.gym-remove-set-btn:hover { opacity: 1; }
```

### Состояния и edge-кейсы

| Случай | Поведение |
|---|---|
| Подходов > 1 | Кнопка показывается, удаляет текущий подход |
| Подходов = 1 | Кнопка **не показывается** (хук `removeSet` вернёт `current` без изменений + уведомит, но лучше просто скрыть) |
| Все подходы выполнены (`allSetsCompleted`) | Карточка не рендерится → кнопка не видна (ОК) |
| Режим отдыха (`resting`) | Карточка показывает таймер, кнопка не видна (ОК) |

### Тестирование

- `CurrentStepCard` — проверить, что кнопка вызывает `removeSet` с правильным индексом
- `GymScreen` — проверить проброс пропа
- Убедиться, что существующие тесты не сломаны

### Не затрагивается

- Логика удаления (уже реализована в `useWorkoutSetActions`)
- API/сервер (подходы — часть черновика, сохраняются целиком)
- Чипсы подходов в `GymScreen` — остаются без изменений
