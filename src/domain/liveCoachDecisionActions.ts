type WorkoutSetLike = {
  completed?: boolean
}

export function dropUnfinishedSets<TSet extends WorkoutSetLike>(sets: TSet[]): TSet[] {
  return sets.filter((set) => set.completed)
}
