// Issue #176: ряд измерений веса тела для экранов.
//
// Двое потребителей: экран перед тренировкой (спросить вес, если пора) и
// прогресс (показать тренд). Оба берут ряд отсюда, чтобы после записи замера
// тренд обновлялся без перезагрузки.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  bodyWeightTrend,
  shouldAskForBodyWeight,
  type BodyWeightMeasurement,
  type BodyWeightTrend,
} from '../../shared/bodyWeight'
import { fetchBodyWeightLogFromApi, isProgramApiConfigured, recordBodyWeightInApi } from '../data/programApi'

export interface UseBodyWeightLogResult {
  measurements: BodyWeightMeasurement[]
  trend: BodyWeightTrend | null
  /** Пора спрашивать вес: замеров нет или последний старше недели. */
  shouldAsk: boolean
  isSaving: boolean
  record: (weightKg: number) => Promise<void>
}

export function useBodyWeightLog(userId: string | undefined, today = new Date()): UseBodyWeightLogResult {
  const [measurements, setMeasurements] = useState<BodyWeightMeasurement[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const todayKey = today.toISOString().slice(0, 10)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchBodyWeightLogFromApi(userId)
      .then((loaded) => { if (!cancelled) setMeasurements(loaded) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  const record = useCallback(async (weightKg: number) => {
    if (!userId) return
    setIsSaving(true)
    try {
      setMeasurements(await recordBodyWeightInApi(userId, weightKg))
    } finally {
      setIsSaving(false)
    }
  }, [userId])

  const trend = useMemo(() => bodyWeightTrend(measurements), [measurements])

  return {
    measurements,
    trend,
    // Без бэкенда записывать замер некуда — карточка стала бы тупиком,
    // который не закрывается сохранением.
    shouldAsk: isProgramApiConfigured && shouldAskForBodyWeight(measurements, todayKey),
    isSaving,
    record,
  }
}
