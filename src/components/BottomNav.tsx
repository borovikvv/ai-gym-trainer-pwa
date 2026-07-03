import { CalendarDays, ChartNoAxesColumn, Dumbbell, Sparkles } from 'lucide-react'
import { useNavigation, type Screen } from '../contexts'

type BottomNavProps = {
  screen?: Screen
  onNavigate?: (screen: Screen) => void
  onStartWorkout: () => void
}

export function BottomNav({ screen: screenProp, onNavigate, onStartWorkout }: BottomNavProps) {
  // Phase 3 issue #5: prefer context, fall back to props for backward compat
  // (tests that render <BottomNav> directly without a provider still work).
  let screen: Screen
  let navigate: (s: Screen) => void
  try {
    const nav = useNavigation()
    screen = screenProp ?? nav.screen
    navigate = onNavigate ?? ((s: Screen) => nav.navigate(s))
  } catch {
    screen = screenProp ?? 'home'
    navigate = onNavigate ?? (() => {})
  }

  if (screen === 'session') return null

  return (
    <nav className="nav" aria-label="Основная навигация">
      <button className={screen === 'home' ? 'active' : ''} onClick={() => navigate('home')}>
        <Sparkles aria-hidden="true" />
        <span>Тренер</span>
      </button>
      <button onClick={onStartWorkout}>
        <Dumbbell aria-hidden="true" />
        <span>Зал</span>
      </button>
      <button className={screen === 'progress' ? 'active' : ''} onClick={() => navigate('progress')}>
        <ChartNoAxesColumn aria-hidden="true" />
        <span>Прогресс</span>
      </button>
      <button className={screen === 'plan' ? 'active' : ''} onClick={() => navigate('plan')}>
        <CalendarDays aria-hidden="true" />
        <span>План</span>
      </button>
    </nav>
  )
}
