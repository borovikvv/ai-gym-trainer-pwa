import { Plus, Repeat2, Replace, Trash2, TriangleAlert } from 'lucide-react'

type SessionActionsProps = {
	activeExerciseName: string
	openReplacementSheet: () => void
	openExercisePicker: () => void
	removeCurrentExercise: () => void
}

export function SessionActions({ activeExerciseName, openReplacementSheet, openExercisePicker, removeCurrentExercise }: SessionActionsProps) {
	return (
	  <div className="session-actions" aria-label="Действия с упражнением">
	    <button className="secondary compact" onClick={openReplacementSheet} aria-label="Заменить текущее"><Replace aria-hidden="true" />Заменить</button>
	    <button className="secondary compact" onClick={openExercisePicker} aria-label="Добавить упражнение"><Plus aria-hidden="true" />Добавить</button>
	    <button className="secondary compact danger" onClick={removeCurrentExercise} aria-label={`Удалить упражнение ${activeExerciseName}`}><Trash2 aria-hidden="true" />Удалить</button>
	  </div>
	)
}

type QuickActionsProps = {
  weightStep: number
  hasPain: boolean
  copyPrevious: () => void
  adjustWeight: (delta: number) => void
  markPain: () => void
}

export function QuickActions({ weightStep, hasPain, copyPrevious, adjustWeight, markPain }: QuickActionsProps) {
  return (
    <div className="quick action-toolbar">
      <button onClick={copyPrevious} aria-label="повторить предыдущий подход"><Repeat2 aria-hidden="true" />Повторить</button>
      <button onClick={() => adjustWeight(-5)} aria-label="-5 кг">-5</button>
      <button onClick={() => adjustWeight(-weightStep)} aria-label={`-${weightStep} кг`}>-{weightStep}</button>
      <button onClick={() => adjustWeight(weightStep)} aria-label={`+${weightStep} кг`}>+{weightStep}</button>
      <button onClick={() => adjustWeight(5)} aria-label="+5 кг">+5</button>
      <button className={hasPain ? 'danger active' : 'danger'} onClick={markPain}><TriangleAlert aria-hidden="true" />Боль</button>
    </div>
  )
}
