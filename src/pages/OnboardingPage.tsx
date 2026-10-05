import { OnboardingScreen } from '../components/OnboardingScreen'

const ONBOARDING_STORAGE_KEY = 'ai-gym-trainer:v0.1:onboarding-completed'

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
