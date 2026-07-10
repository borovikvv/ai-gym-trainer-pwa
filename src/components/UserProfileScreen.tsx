import type { ReactNode } from 'react'
import type { ExercisePlan  } from '../../shared/types'
import type { UserQuestionnaire } from '../data/programApi'
import { ScreenHeader } from './ui'
import { CoachMemorySection } from './CoachMemorySection'

type UserProfileScreenProps = {
  users: Array<{ id: string; name: string; initials: string }>
  activeUserId: string
  activeUser: { id: string; name: string; initials: string }
  activeProfile: UserQuestionnaire
  exerciseLibrary: ExercisePlan[]
  onSelectUser: (userId: string) => void
  onUpdateQuestionnaire: (patch: Partial<UserQuestionnaire>) => void
  onSaveQuestionnaire: () => void
}

type ChoiceOption = {
  value: string
  label: string
  hint?: string
}

const goalOptions: ChoiceOption[] = [
  { value: 'сила', label: 'Сила', hint: 'ниже повторы, больше контроль нагрузки' },
  { value: 'мышечная масса', label: 'Мышечная масса', hint: 'объём и прогрессия без лишнего риска' },
  { value: 'сила и мышечная масса', label: 'Сила + масса', hint: 'баланс базовых и объёмных упражнений' },
  { value: 'похудение / тонус', label: 'Похудение / тонус', hint: 'умеренный объём и плотность тренировки' },
  { value: 'общая форма и здоровье', label: 'Общая форма', hint: 'стабильный прогресс и баланс мышц' },
  { value: 'бережная нагрузка', label: 'Бережно', hint: 'акцент на безопасность и восстановление' },
]

const levelOptions: ChoiceOption[] = [
  { value: 'beginner', label: 'Новичок' },
  { value: 'intermediate', label: 'Средний' },
  { value: 'advanced', label: 'Опытный' },
  { value: 'returning', label: 'После перерыва' },
]

const workoutFrequencyOptions = [1, 2, 3, 4]
const workoutDurationOptions = [40, 45, 60, 75]

const equipmentOptions = ['Зал', 'Штанга', 'Гантели', 'Тренажёры', 'Блочные тренажёры', 'Турник / брусья', 'Скамья', 'Только вес тела']
const weekdayOptions = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const focusAreaOptions = ['Грудь', 'Спина', 'Ноги', 'Плечи', 'Руки', 'Кор', 'Общая форма']
const injuryOptions = ['Плечо', 'Локоть', 'Запястье', 'Поясница', 'Колено', 'Голеностоп', 'Шея']

const exerciseStyleOptions: ChoiceOption[] = [
  { value: 'mixed', label: 'Смешанно' },
  { value: 'free_weights', label: 'Больше свободные веса' },
  { value: 'machines', label: 'Больше тренажёры' },
  { value: 'bodyweight', label: 'Больше вес тела' },
]

const intensityOptions: ChoiceOption[] = [
  { value: 'avoid_max', label: 'Без отказа', hint: 'не хочу подходы “на пределе”' },
  { value: 'rare_max', label: 'На пределе редко', hint: 'тяжело можно, но не часто' },
  { value: 'normal', label: 'Умеренно', hint: 'стабильный рабочий режим' },
  { value: 'aggressive', label: 'Можно тяжело', hint: 'если восстановление позволяет' },
]

const sessionStyleOptions: ChoiceOption[] = [
  { value: 'heavy_short', label: 'Тяжелее и короче' },
  { value: 'moderate_stable', label: 'Умеренно и стабильно' },
  { value: 'volume_light', label: 'Легче, но больше объёма' },
]

const getStringArrayPreference = (profile: UserQuestionnaire, key: string) => {
  const value = profile.preferences?.[key]
  return Array.isArray(value) ? value.map(String) : []
}

const getStringPreference = (profile: UserQuestionnaire, key: string, fallback: string) => {
  const value = profile.preferences?.[key]
  return typeof value === 'string' ? value : fallback
}

const includesNormalized = (items: string[], value: string) => items.some((item) => item.toLowerCase() === value.toLowerCase())

function toggleString(items: string[], value: string) {
	return includesNormalized(items, value) ? items.filter((item) => item.toLowerCase() !== value.toLowerCase()) : [...items, value]
}

function keepKnownOptions(items: string[], options: string[]) {
	return options.filter((option) => includesNormalized(items, option))
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="questionnaire-section">
      <div className="section-headline">
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ChoiceGrid({ options, value, onChange }: { options: ChoiceOption[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="choice-grid">
      {options.map((option) => (
        <button key={option.value} type="button" className={`choice-card ${value === option.value ? 'active' : ''}`} onClick={() => onChange(option.value)}>
          <b>{option.label}</b>
          {option.hint && <span>{option.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function ChipGroup({ options, selected, onToggle, maxSelected }: { options: string[]; selected: string[]; onToggle: (value: string) => void; maxSelected?: number }) {
  return (
    <div className="profile-chip-grid">
      {options.map((option) => {
        const active = includesNormalized(selected, option)
        const disabled = !active && maxSelected !== undefined && selected.length >= maxSelected
        return (
          <button key={option} type="button" className={`profile-chip ${active ? 'active' : ''}`} disabled={disabled} onClick={() => onToggle(option)}>
            {option}
          </button>
        )
      })}
    </div>
  )
}

function ExerciseMultiSelect({
  title,
  hint,
  selected,
  exercises,
  onChange,
}: {
  title: string
  hint: string
  selected: string[]
  exercises: ExercisePlan[]
  onChange: (items: string[]) => void
}) {
  const exerciseOptions = exercises.map((exercise) => exercise.name)
  return (
    <Section title={title} hint={hint}>
      <textarea key={`${title}-${selected.join('|')}`} className="sr-only" aria-label={title} defaultValue={selected.join('\n')} onBlur={(event) => onChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} />
      <div className="profile-chip-grid exercise-choice-grid">
        {exerciseOptions.map((name) => {
          const active = includesNormalized(selected, name)
          return (
            <button key={name} type="button" className={`profile-chip ${active ? 'active' : ''}`} onClick={() => onChange(toggleString(selected, name))}>
              {name}
            </button>
          )
        })}
      </div>
    </Section>
  )
}

export function UserProfileScreen({
  users,
  activeUserId,
  activeUser,
  activeProfile,
  exerciseLibrary,
  onSelectUser,
  onUpdateQuestionnaire,
	onSaveQuestionnaire,
}: UserProfileScreenProps) {
	const focusAreas = getStringArrayPreference(activeProfile, 'focusAreas')
	const visibleFocusAreas = keepKnownOptions(focusAreas, focusAreaOptions)
	const exerciseStyle = getStringPreference(activeProfile, 'exerciseStyle', 'mixed')
	const intensityTolerance = getStringPreference(activeProfile, 'intensityTolerance', 'normal')
	const sessionStyle = getStringPreference(activeProfile, 'sessionStyle', 'moderate_stable')
  const updatePreferences = (patch: Record<string, unknown>) => onUpdateQuestionnaire({ preferences: { ...activeProfile.preferences, ...patch } })

  return (
    <section className="screen active">
      <ScreenHeader
        eyebrow="Профиль"
        title="Анкета пользователя"
        trailing={(
          <div className="profile-control">
          <label className="user-select">
            <span className="sr-only">Пользователь</span>
            <select aria-label="Пользователь" value={activeUserId} onChange={(event) => onSelectUser(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
            <span className="avatar">{activeUser.initials}</span>
          </label>
          </div>
        )}
      />

      <div className="card top-gap profile-questionnaire-card">
        <div className="set-head">
          <div>
            <b>{activeUser.name}</b>
            <div className="muted">{activeProfile.workoutsPerWeek} тренировки/нед · {activeProfile.targetWorkoutMinutes} мин · {activeProfile.level}</div>
          </div>
          <span className="badge">анкета</span>
        </div>

        <Section title="Базовое" hint="Нужно для расчёта нагрузки и восстановления.">
          <div className="inputs edit-grid questionnaire-grid compact-grid">
            <label>
              <span>Возраст</span>
              <input aria-label="Возраст" inputMode="numeric" value={activeProfile.age ?? ''} onChange={(event) => onUpdateQuestionnaire({ age: Number(event.target.value) || null })} />
            </label>
            <label>
              <span>Рост, см</span>
              <input aria-label="Рост" inputMode="numeric" value={activeProfile.heightCm ?? ''} onChange={(event) => onUpdateQuestionnaire({ heightCm: Number(event.target.value) || null })} />
            </label>
            <label>
              <span>Вес, кг</span>
              <input aria-label="Вес пользователя" inputMode="decimal" value={activeProfile.weightKg ?? ''} onChange={(event) => onUpdateQuestionnaire({ weightKg: Number(event.target.value) || null })} />
            </label>
          </div>
          <ChoiceGrid options={levelOptions} value={activeProfile.level} onChange={(level) => onUpdateQuestionnaire({ level })} />
        </Section>

        <Section title="Цель" hint="Влияет на повторы, объём, интенсивность и выбор упражнений.">
          <input key={`goal-${activeUser.id}`} className="sr-only" aria-label="Цель" defaultValue={activeProfile.goal} onBlur={(event) => onUpdateQuestionnaire({ goal: event.target.value })} />
          <ChoiceGrid options={goalOptions} value={activeProfile.goal} onChange={(goal) => onUpdateQuestionnaire({ goal })} />
        </Section>

        <Section title="Тренировки" hint="Частота — плановая. Реальные даты выбираются в календаре.">
          <input key={`workouts-${activeUser.id}`} className="sr-only" aria-label="Тренировок в неделю" inputMode="numeric" value={activeProfile.workoutsPerWeek || ''} onChange={(event) => onUpdateQuestionnaire({ workoutsPerWeek: Number(event.target.value) || 0 })} />
          <textarea key={`days-${activeUser.id}`} className="sr-only" aria-label="Обычно удобные дни" defaultValue={activeProfile.trainingDays.join('\n')} onBlur={(event) => onUpdateQuestionnaire({ trainingDays: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} />
          <div className="mini-choice-row">
            {workoutFrequencyOptions.map((count) => (
              <button key={count} type="button" className={`mini-choice ${activeProfile.workoutsPerWeek === count ? 'active' : ''}`} onClick={() => onUpdateQuestionnaire({ workoutsPerWeek: count })}>
                {count}×/нед
              </button>
            ))}
          </div>
          <div className="mini-choice-row">
            {workoutDurationOptions.map((minutes) => (
              <button key={minutes} type="button" className={`mini-choice ${activeProfile.targetWorkoutMinutes === minutes ? 'active' : ''}`} onClick={() => onUpdateQuestionnaire({ targetWorkoutMinutes: minutes })}>
                {minutes} мин
              </button>
            ))}
          </div>
          <div className="section-headline subtle"><b>Обычно удобные дни</b><span>Это дефолт, а не жёсткое расписание.</span></div>
          <ChipGroup options={weekdayOptions} selected={activeProfile.trainingDays} onToggle={(day) => onUpdateQuestionnaire({ trainingDays: toggleString(activeProfile.trainingDays, day) })} />
        </Section>

        <Section title="Оборудование" hint="Тренер будет выбирать только подходящие упражнения.">
          <textarea key={`equipment-${activeUser.id}`} className="sr-only" aria-label="Оборудование" defaultValue={activeProfile.equipment.join('\n')} onBlur={(event) => onUpdateQuestionnaire({ equipment: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} />
          <select className="sr-only" aria-label="Тип упражнений" value={exerciseStyle} onChange={(event) => updatePreferences({ exerciseStyle: event.target.value })}>
            {exerciseStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ChipGroup options={equipmentOptions} selected={activeProfile.equipment} onToggle={(item) => onUpdateQuestionnaire({ equipment: toggleString(activeProfile.equipment, item) })} />
          <ChoiceGrid options={exerciseStyleOptions} value={exerciseStyle} onChange={(value) => updatePreferences({ exerciseStyle: value })} />
        </Section>

        <Section title="Ограничения" hint="Нужно для безопасности. Если ограничений нет — ничего не выбирай.">
          <textarea key={`injuries-${activeUser.id}`} className="sr-only" aria-label="Ограничения и травмы" defaultValue={activeProfile.injuries.join('\n')} onBlur={(event) => onUpdateQuestionnaire({ injuries: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} />
          <ChipGroup options={injuryOptions} selected={activeProfile.injuries} onToggle={(injury) => onUpdateQuestionnaire({ injuries: toggleString(activeProfile.injuries, injury) })} />
        </Section>

        <Section title="Фокус" hint="Выбери до 3 зон, которые тренеру стоит учитывать чаще.">
	          <textarea key={`focus-${activeUser.id}`} className="sr-only" aria-label="Фокусные зоны" defaultValue={visibleFocusAreas.join('\n')} onBlur={(event) => updatePreferences({ focusAreas: keepKnownOptions(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean), focusAreaOptions) })} />
	          <ChipGroup options={focusAreaOptions} selected={visibleFocusAreas} maxSelected={3} onToggle={(area) => updatePreferences({ focusAreas: toggleString(visibleFocusAreas, area) })} />
	        </Section>

        <Section title="Интенсивность" hint="Как жёстко можно вести прогрессию.">
          <select className="sr-only" aria-label="Допустимая интенсивность" value={intensityTolerance} onChange={(event) => updatePreferences({ intensityTolerance: event.target.value })}>
            {intensityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className="sr-only" aria-label="Стиль тренировки" value={sessionStyle} onChange={(event) => updatePreferences({ sessionStyle: event.target.value })}>
            {sessionStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ChoiceGrid options={intensityOptions} value={intensityTolerance} onChange={(value) => updatePreferences({ intensityTolerance: value })} />
          <ChoiceGrid options={sessionStyleOptions} value={sessionStyle} onChange={(value) => updatePreferences({ sessionStyle: value })} />
        </Section>

        <ExerciseMultiSelect
          title="Любимые упражнения"
          hint="Тренер будет повышать их приоритет, если они уместны. Необязательно."
          selected={activeProfile.preferredExercises}
          exercises={exerciseLibrary}
          onChange={(preferredExercises) => onUpdateQuestionnaire({ preferredExercises })}
        />

        <ExerciseMultiSelect
          title="Нежелательные или запрещённые упражнения"
          hint="Тренер будет избегать их при генерации тренировок."
          selected={activeProfile.bannedExercises}
          exercises={exerciseLibrary}
          onChange={(bannedExercises) => onUpdateQuestionnaire({ bannedExercises })}
        />

        <label className="coach-edit">
          <span className="muted">Дополнительно для тренера</span>
          <textarea aria-label="Комментарий анкеты" value={activeProfile.notes} onChange={(event) => onUpdateQuestionnaire({ notes: event.target.value })} placeholder="Например: не люблю присед, часто болит плечо после жима, хочу больше спины, тренируюсь вечером." />
        </label>

        <button className="sr-only" type="button">Профиль</button>
        <button className="primary" onClick={onSaveQuestionnaire}>Сохранить анкету</button>
      </div>

      <CoachMemorySection userId={activeUserId} />
    </section>
  )
}
