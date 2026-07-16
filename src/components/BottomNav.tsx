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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.9 3.5 11 7l3.5 1.1L11 9.2 9.9 12.7 8.8 9.2 5.3 8.1 8.8 7z" />
          <path d="M18 3v3M19.5 4.5h-3M18 15v2M19 16h-2" />
        </svg>
        <span>Тренер</span>
      </button>
      <button onClick={onStartWorkout}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.4 14.4 9.6 9.6M18.657 21.485l2.828-2.828M3.515 5.343 6.343 2.515M21.485 18.657 18.657 21.485M2.515 6.343 5.343 3.515M6.343 2.515 21.485 17.657M17.657 6.343 6.343 17.657" />
        </svg>
        <span>Зал</span>
      </button>
      <button className={screen === 'progress' ? 'active' : ''} onClick={() => navigate('progress')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13 5v16M18 9v12M8 13v8M3 21h18" />
        </svg>
        <span>Прогресс</span>
      </button>
      <button className={screen === 'plan' ? 'active' : ''} onClick={() => navigate('plan')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2v4M16 2v4M3.5 9.5h17M5 4.5h14a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z" />
        </svg>
        <span>План</span>
      </button>
    </nav>
  )
}
