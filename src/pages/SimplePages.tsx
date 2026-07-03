import type { UserProfile  } from '../../shared/types'
import type { UserQuestionnaire } from '../data/programApi'
import { useProgram } from '../contexts/ProgramContext'
import { ProgressScreen } from '../components/ProgressScreen'
import { UserProfileScreen } from '../components/UserProfileScreen'
import { ExerciseLibraryScreen } from '../components/ExerciseLibraryScreen'
import { OnboardingScreen } from '../components/OnboardingScreen'

const ONBOARDING_STORAGE_KEY = 'ai-gym-trainer:v0.1:onboarding-completed'

interface ProgressPageProps {
  progressDashboard: unknown
  activeUserId: string
}

export function ProgressPage(props: ProgressPageProps) {
  return <ProgressScreen progressDashboard={props.progressDashboard as Parameters<typeof ProgressScreen>[0]['progressDashboard']} activeUserId={props.activeUserId} />
}

interface ProfilePageProps {
  activeProfile: UserQuestionnaire
  activeUser: UserProfile
  onSelectUser: (userId: string) => void
  onUpdateQuestionnaire: (patch: Partial<UserQuestionnaire>) => void
  onSaveQuestionnaire: () => void
}

export function ProfilePage(props: ProfilePageProps) {
  const program = useProgram()
  return (
    <UserProfileScreen
      users={program.users}
      activeUserId={program.activeUserId}
      activeUser={props.activeUser}
      activeProfile={props.activeProfile}
      exerciseLibrary={program.exerciseLibrary}
      onSelectUser={props.onSelectUser}
      onUpdateQuestionnaire={props.onUpdateQuestionnaire}
      onSaveQuestionnaire={props.onSaveQuestionnaire}
    />
  )
}

export function LibraryPage() {
  const program = useProgram()
  return <ExerciseLibraryScreen exerciseLibrary={program.exerciseLibrary} />
}

interface OnboardingPageProps {
  onComplete: () => void
}

export function OnboardingPage(props: OnboardingPageProps) {
  function complete() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    }
    props.onComplete()
  }
  return <OnboardingScreen onFinish={complete} onSkip={complete} />
}
