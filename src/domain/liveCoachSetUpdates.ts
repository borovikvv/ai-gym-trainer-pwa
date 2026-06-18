type EditableSet = {
  weight: number
  weightInput?: string
  reps: number
  repsInput?: string
  completed?: boolean
}

type LiveCoachSetUpdate = {
  setOffset: number
  recommendedWeight: number
  recommendedReps: number
  recommendedRestSeconds?: number
}

type LiveCoachRecommendation = {
  weight: number
  reps: number
  restSeconds?: number
  reason?: string
  action?: string
  remainingSetUpdates?: LiveCoachSetUpdate[]
}

type ApplyLiveCoachSetUpdatesInput<TSet extends EditableSet> = {
  sets: TSet[]
  recommendation: LiveCoachRecommendation
  formatWeight: (weight: number) => string
}

export function applyLiveCoachSetUpdates<TSet extends EditableSet>({
  sets,
  recommendation,
  formatWeight,
}: ApplyLiveCoachSetUpdatesInput<TSet>): TSet[] {
  const unfinishedIndexes = sets
    .map((set, index) => ({ set, index }))
    .filter(({ set }) => !set.completed)
    .map(({ index }) => index)

  const updates = recommendation.remainingSetUpdates?.length
    ? recommendation.remainingSetUpdates
    : [{ setOffset: 0, recommendedWeight: recommendation.weight, recommendedReps: recommendation.reps }]

  const updatesByIndex = new Map(
    updates
      .map((update) => {
        const setIndex = unfinishedIndexes[update.setOffset]
        return setIndex === undefined ? null : [setIndex, update] as const
      })
      .filter((entry): entry is readonly [number, LiveCoachSetUpdate] => entry !== null),
  )

  return sets.map((set, index) => {
    const update = updatesByIndex.get(index)
    if (!update) return set
    return {
      ...set,
      weight: update.recommendedWeight,
      weightInput: formatWeight(update.recommendedWeight),
      reps: update.recommendedReps,
      repsInput: String(update.recommendedReps),
    }
  })
}
