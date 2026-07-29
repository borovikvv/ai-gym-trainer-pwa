// Issue #163: словарь канала боли — зоны тела и красные флаги.
// Лежит в shared, потому что списком пользуются оба конца: анкета рисует по
// нему подписи, сервер по нему же валидирует пришедший pain_log. Хранится и
// передаётся id, подпись — только для показа: переименование зоны не ломает
// ни тесты (data-testid строится из id), ни уже накопленные данные.

export const PAIN_ZONES = [
  { id: 'chest', label: 'грудь' },
  { id: 'back', label: 'спина' },
  { id: 'shoulder', label: 'плечо' },
  { id: 'neck', label: 'шея' },
  { id: 'lower-back', label: 'поясница' },
  { id: 'hip', label: 'таз/бедро' },
  { id: 'knee', label: 'колено' },
  { id: 'shin-foot', label: 'голень/стопа' },
  { id: 'arm-hand', label: 'рука/кисть' },
] as const

export const RED_FLAGS = [
  { id: 'numbness', label: 'онемение' },
  { id: 'tingling', label: 'покалывание' },
  { id: 'radiating-pain', label: 'простреливающая боль по конечности' },
  { id: 'pain-at-rest', label: 'боль в покое' },
  { id: 'dizziness', label: 'головокружение' },
  { id: 'breathlessness', label: 'одышка не по нагрузке' },
] as const

export const PAIN_ZONE_IDS: readonly string[] = PAIN_ZONES.map((zone) => zone.id)
export const RED_FLAG_IDS: readonly string[] = RED_FLAGS.map((flag) => flag.id)

// То, что ложится в workout_sessions.pain_log и в painDetails обучающей
// записи: одна запись на упражнение, ключ — exerciseId.
export type PainLogEntry = {
  pain: boolean
  painLocation?: string
  painIntensity?: number
  redFlags?: string[]
}

export type PainLog = Record<string, PainLogEntry>
