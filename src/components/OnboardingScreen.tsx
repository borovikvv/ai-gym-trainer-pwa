import { useState } from 'react'
import { ArrowRight, BookOpen, ChevronLeft, Dumbbell, HeartPulse, Sparkles } from 'lucide-react'
import { ScreenHeader } from './ui'

type OnboardingScreenProps = {
  onFinish: () => void
  onSkip: () => void
}

type Slide = {
  id: string
  icon: typeof BookOpen
  title: string
  body: string
  bullets?: string[]
}

const SLIDES: Slide[] = [
  {
    id: 'intro',
    icon: Sparkles,
    title: 'ИИ-тренер вместо таблиц',
    body: 'Это приложение — персональный тренер, который планирует каждую тренировку под ваше восстановление, усталость и цели. Не нужно вести Excel-таблицу или смотреть чужие программы — тренер подстраивается сам.',
    bullets: [
      'Учитывает сон, энергию и стресс перед тренировкой',
      'Адаптирует объём к возрасту и опыту',
      'Планирует мезоциклы: загрузка → пик → разгрузка',
    ],
  },
  {
    id: 'readiness',
    icon: HeartPulse,
    title: 'Readiness-чекин перед тренировкой',
    body: 'Перед каждой тренировкой тренер спрашивает, как вы себя чувствуете. Это не формальность — ответы реально меняют план: снижается вес, объём или время отдыха, если вы не выспались или стрессовый день.',
    bullets: [
      'Сон 1-5: ниже 3 — тренер снижает нагрузку',
      'Энергия 1-5: ниже 3 — объём уменьшается',
      'Стресс 1-5: выше 4 — без отказа в подходах',
      'Боль/болезненность: блокирует прогрессию веса',
    ],
  },
  {
    id: 'rpe',
    icon: Dumbbell,
    title: 'RPE — шкала усилия',
    body: 'RPE (Rate of Perceived Exertion) — это ваша оценка тяжести подхода от 1 до 10. 10 — максимум, ничего не осталось. 7-8 — рабочий подход с 2-3 повторениями в запасе. Тренер использует RPE, чтобы понять: можно ли повышать вес или нужно закрепить текущий.',
    bullets: [
      'RPE 6-7: легко, можно повышать вес',
      'RPE 8: рабочий подход, 2 повтора в запасе',
      'RPE 9: тяжело, 1 повтор до отказа',
      'RPE 10: максимум, следующая тренировка легче',
    ],
  },
  {
    id: 'progression',
    icon: BookOpen,
    title: 'Как тренер адаптирует программу',
    body: 'Тренер мыслит не одной тренировкой, а мезоциклом из 4-5 недель. Каждую неделю он решает: повышать вес, закреплять или разгружать. Если две группы мышц одновременно на пределе — разгрузка может прийти раньше.',
    bullets: [
      'Прогрессия: вес + шаг (2.5 кг) при RPE ≤ 8',
      'Закрепление: тот же вес, фокус на технике',
      'Разгрузка: -10-15% веса, -40-50% объёма',
      'Замена упражнения: если мышца не восстановилась',
    ],
  },
]

export function OnboardingScreen({ onFinish, onSkip }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]
  const isLast = index === SLIDES.length - 1
  const Icon = slide.icon

  function next() {
    if (isLast) {
      onFinish()
    } else {
      setIndex((i) => i + 1)
    }
  }

  function prev() {
    if (index > 0) setIndex((i) => i - 1)
  }

  return (
    <section className="screen active onboarding-screen">
      <ScreenHeader
        eyebrow={`Шаг ${index + 1} из ${SLIDES.length}`}
        title="Знакомство с тренером"
      />

      <button className="back" onClick={onSkip} aria-label="Пропустить онбординг">
        Пропустить
      </button>

      <div className="onboarding-card">
        <div className="onboarding-card__icon" aria-hidden="true">
          <Icon size={40} />
        </div>
        <h2>{slide.title}</h2>
        <p className="onboarding-card__body">{slide.body}</p>
        {slide.bullets && (
          <ul className="onboarding-card__bullets">
            {slide.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="onboarding-dots" role="tablist" aria-label="Прогресс онбординга">
        {SLIDES.map((s, i) => (
          <span
            key={s.id}
            className={`onboarding-dot ${i === index ? 'onboarding-dot--active' : ''}`}
            role="tab"
            aria-selected={i === index}
            aria-label={`Шаг ${i + 1}`}
          />
        ))}
      </div>

      <div className="onboarding-actions">
        {index > 0 && (
          <button className="secondary" type="button" onClick={prev}>
            <ChevronLeft size={16} aria-hidden="true" /> Назад
          </button>
        )}
        <button className="primary" type="button" onClick={next}>
          {isLast ? 'Начать тренироваться' : 'Дальше'}
          {!isLast && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
    </section>
  )
}
