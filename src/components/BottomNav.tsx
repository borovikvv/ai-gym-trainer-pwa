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
