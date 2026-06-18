export type UserProfile = {
  id: string
  name: string
  initials: string
  goal: string
  streak: string
}

export type ExercisePlan = {
  id: string
  canonicalExerciseId?: string
  programExerciseId?: string
  name: string
  muscleGroup: string
  prescription: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  previous: string
  todayGoal: string
  coachFocus: string
  alternatives: { name: string; reason: string; badge?: string }[]
  instruction: string
  commonMistakes: string[]
}

export type WorkoutDay = {
  id: string
  name: string
  label: string
  description: string
  exercises: ExercisePlan[]
}

export const users: UserProfile[] = [
  { id: 'vyacheslav', name: 'Вячеслав', initials: 'В', goal: 'сила и мышечная масса', streak: '4 недели' },
  { id: 'oleg', name: 'Олег', initials: 'О', goal: 'регулярность и техника', streak: '0 недель' },
]

export const dayA: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  label: 'Грудь/спина',
  description: 'Жим лёжа, тяга блока, жим гантелей, разведения, планка',
  exercises: [
    {
      id: 'bench-press',
      name: 'Жим лёжа',
      muscleGroup: 'Грудь',
      prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 60,
      weightStep: 2.5,
      restSeconds: 120,
      previous: '60×10/9/8',
      todayGoal: '60×10/9/9',
      coachFocus: 'не гонимся за +2.5 кг. Нужно добрать качество: 10/9/9 без боли и с контролем паузы внизу.',
      alternatives: [
        { name: 'Жим гантелей лёжа', reason: 'больше свободы плеча', badge: 'лучше' },
        { name: 'Отжимания на брусьях', reason: 'если нет боли в плече' },
        { name: 'Жим в тренажёре', reason: 'стабильнее траектория' },
      ],
      instruction: 'Сведи лопатки, поставь стопы устойчиво, опускай штангу под контролем к нижней части груди и жми без отрыва таза.',
      commonMistakes: ['отбив штанги от груди', 'потеря лопаток', 'слишком широкий хват'],
    },
    {
      id: 'lat-pulldown',
      name: 'Тяга верхнего блока',
      muscleGroup: 'Спина',
      prescription: '3×10–12 · рекомендовано 45 кг · отдых 90 сек',
      setsCount: 3,
      repMin: 10,
      repMax: 12,
      targetWeight: 45,
      weightStep: 2.5,
      restSeconds: 90,
      previous: '45×12/11/10',
      todayGoal: '45×12/12/11',
      coachFocus: 'тяни локтями вниз, не раскачивай корпус. Если 12/12/12 получится чисто — на следующей тренировке +2.5 кг.',
      alternatives: [
        { name: 'Подтягивания в гравитроне', reason: 'та же вертикальная тяга' },
        { name: 'Тяга нейтральным хватом', reason: 'мягче для плеч' },
      ],
      instruction: 'Слегка отклонись назад, зафиксируй корпус, тяни рукоять к верхней части груди локтями вниз.',
      commonMistakes: ['раскачка корпусом', 'тяга руками вместо спины', 'плечи к ушам'],
    },
    {
      id: 'incline-db-press',
      name: 'Жим гантелей на наклонной',
      muscleGroup: 'Грудь/плечи',
      prescription: '3×8–10 · рекомендовано 18 кг · отдых 90 сек',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 18,
      weightStep: 2,
      restSeconds: 90,
      previous: '18×10/10/9',
      todayGoal: '18×10/10/10',
      coachFocus: 'сохраняй одинаковую амплитуду и не своди гантели ударом вверху.',
      alternatives: [
        { name: 'Наклонный жим в тренажёре', reason: 'проще держать траекторию' },
        { name: 'Отжимания с ногами на возвышении', reason: 'если заняты скамьи' },
      ],
      instruction: 'Угол скамьи 25–35°, локти чуть ниже плеч, движение плавное.',
      commonMistakes: ['слишком вертикальная скамья', 'переразгиб локтей', 'потеря контроля внизу'],
    },
    {
      id: 'cable-row',
      name: 'Горизонтальная тяга',
      muscleGroup: 'Спина',
      prescription: '3×10–12 · рекомендовано 50 кг · отдых 90 сек',
      setsCount: 3,
      repMin: 10,
      repMax: 12,
      targetWeight: 50,
      weightStep: 2.5,
      restSeconds: 90,
      previous: '50×12/11/11',
      todayGoal: '50×12/12/12',
      coachFocus: 'в конце движения сведи лопатки, но не отклоняйся назад всем корпусом.',
      alternatives: [{ name: 'Тяга гантели в наклоне', reason: 'если блок занят' }],
      instruction: 'Держи нейтральную спину, тяни рукоять к поясу, локти веди назад.',
      commonMistakes: ['рывок корпусом', 'круглая спина', 'неполная амплитуда'],
    },
    {
      id: 'plank',
      name: 'Планка',
      muscleGroup: 'Кор',
      prescription: '3×40–60 сек · вес тела · отдых 60 сек',
      setsCount: 3,
      repMin: 40,
      repMax: 60,
      targetWeight: 0,
      weightStep: 0,
      restSeconds: 60,
      previous: '50/45/40 сек',
      todayGoal: '55/50/45 сек',
      coachFocus: 'держи таз нейтрально и не проваливай поясницу.',
      alternatives: [{ name: 'Dead bug', reason: 'мягче для поясницы' }],
      instruction: 'Локти под плечами, рёбра вниз, ягодицы и пресс напряжены.',
      commonMistakes: ['провисание поясницы', 'задранный таз', 'задержка дыхания'],
    },
  ],
}

export const dayB: WorkoutDay = {
  id: 'day-b',
  name: 'День B',
  label: 'Ноги',
  description: 'Присед, румынская тяга, выпады, икры',
  exercises: [
    {
      id: 'barbell-squat',
      name: 'Присед со штангой',
      muscleGroup: 'Ноги',
      prescription: '3×6–8 · рекомендовано 70 кг · отдых 150 сек',
      setsCount: 3,
      repMin: 6,
      repMax: 8,
      targetWeight: 70,
      weightStep: 2.5,
      restSeconds: 150,
      previous: '70×8/7/6',
      todayGoal: '70×8/8/7',
      coachFocus: 'держи корпус жёстким, колени веди по линии носков, не ускоряй нижнюю точку.',
      alternatives: [
        { name: 'Жим ногами', reason: 'если поясница устала', badge: 'безопаснее' },
        { name: 'Гоблет-присед', reason: 'для отработки техники' },
      ],
      instruction: 'Стопы устойчиво, вдох и брейсинг перед спуском, опускайся контролируемо и вставай без завала коленей внутрь.',
      commonMistakes: ['завал коленей', 'круглая спина', 'слишком быстрый спуск'],
    },
    {
      id: 'romanian-deadlift',
      name: 'Румынская тяга',
      muscleGroup: 'Задняя поверхность бедра',
      prescription: '3×8–10 · рекомендовано 55 кг · отдых 120 сек',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 55,
      weightStep: 2.5,
      restSeconds: 120,
      previous: '55×10/9/9',
      todayGoal: '55×10/10/9',
      coachFocus: 'таз назад, спина нейтрально, штанга скользит близко к ногам.',
      alternatives: [{ name: 'Сгибание ног лёжа', reason: 'если поясница даёт сигнал' }],
      instruction: 'Двигай таз назад, сохраняй лёгкий сгиб коленей, опускай вес до натяжения задней поверхности бедра.',
      commonMistakes: ['присед вместо наклона', 'штанга далеко от ног', 'потеря нейтральной спины'],
    },
    {
      id: 'walking-lunges',
      name: 'Выпады с гантелями',
      muscleGroup: 'Ноги/ягодицы',
      prescription: '3×10–12 · рекомендовано 14 кг · отдых 90 сек',
      setsCount: 3,
      repMin: 10,
      repMax: 12,
      targetWeight: 14,
      weightStep: 2,
      restSeconds: 90,
      previous: '14×12/10/10',
      todayGoal: '14×12/11/10',
      coachFocus: 'не проваливайся в колено, шаг стабильный, корпус чуть вперёд.',
      alternatives: [{ name: 'Болгарские сплит-приседы', reason: 'если мало места' }],
      instruction: 'Делай шаг вперёд, опускайся под контролем, отталкивайся всей стопой передней ноги.',
      commonMistakes: ['короткий шаг', 'удар коленом об пол', 'завал корпуса'],
    },
    {
      id: 'calf-raise',
      name: 'Подъёмы на икры',
      muscleGroup: 'Икры',
      prescription: '3×12–15 · рекомендовано 40 кг · отдых 60 сек',
      setsCount: 3,
      repMin: 12,
      repMax: 15,
      targetWeight: 40,
      weightStep: 5,
      restSeconds: 60,
      previous: '40×15/14/13',
      todayGoal: '40×15/15/14',
      coachFocus: 'пауза в верхней точке и полная амплитуда важнее веса.',
      alternatives: [{ name: 'Икры сидя', reason: 'другая нагрузка на голень' }],
      instruction: 'Поднимайся максимально высоко, задержись на секунду, опускай пятку медленно.',
      commonMistakes: ['пружинящие повторы', 'короткая амплитуда', 'слишком большой вес'],
    },
  ],
}

export const dayC: WorkoutDay = {
  id: 'day-c',
  name: 'День C',
  label: 'Спина/плечи',
  description: 'Тяги, плечи, руки',
  exercises: [
    {
      id: 'deadlift-machine-row',
      name: 'Тяга в тренажёре',
      muscleGroup: 'Спина',
      prescription: '3×8–10 · рекомендовано 55 кг · отдых 120 сек',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 55,
      weightStep: 2.5,
      restSeconds: 120,
      previous: '55×10/10/8',
      todayGoal: '55×10/10/9',
      coachFocus: 'тяни локтями, не поднимай плечи к ушам.',
      alternatives: [{ name: 'Горизонтальная тяга блока', reason: 'если тренажёр занят' }],
      instruction: 'Зафиксируй грудь, веди локти назад, в конце движения сведи лопатки.',
      commonMistakes: ['рывок корпусом', 'неполная амплитуда', 'плечи к ушам'],
    },
    {
      id: 'db-shoulder-press',
      name: 'Жим гантелей сидя',
      muscleGroup: 'Плечи',
      prescription: '3×8–10 · рекомендовано 16 кг · отдых 90 сек',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 16,
      weightStep: 2,
      restSeconds: 90,
      previous: '16×10/9/8',
      todayGoal: '16×10/9/9',
      coachFocus: 'не прогибай поясницу, контролируй нижнюю точку.',
      alternatives: [{ name: 'Жим в тренажёре', reason: 'стабильнее для плеч' }],
      instruction: 'Сядь устойчиво, держи пресс напряжённым, жми гантели вверх без удара в верхней точке.',
      commonMistakes: ['прогиб поясницы', 'слишком низкая нижняя точка', 'удар гантелей'],
    },
    {
      id: 'face-pull',
      name: 'Face pull',
      muscleGroup: 'Задняя дельта',
      prescription: '3×12–15 · рекомендовано 20 кг · отдых 60 сек',
      setsCount: 3,
      repMin: 12,
      repMax: 15,
      targetWeight: 20,
      weightStep: 2.5,
      restSeconds: 60,
      previous: '20×15/14/14',
      todayGoal: '20×15/15/14',
      coachFocus: 'локти высоко, движение к лицу, без раскачки.',
      alternatives: [{ name: 'Разведения в наклоне', reason: 'если блок занят' }],
      instruction: 'Тяни канат к лицу, разводи концы в стороны, держи плечи опущенными.',
      commonMistakes: ['тяга вниз', 'раскачка корпусом', 'слишком большой вес'],
    },
    {
      id: 'hammer-curl',
      name: 'Молотковые сгибания',
      muscleGroup: 'Руки',
      prescription: '3×10–12 · рекомендовано 12 кг · отдых 60 сек',
      setsCount: 3,
      repMin: 10,
      repMax: 12,
      targetWeight: 12,
      weightStep: 2,
      restSeconds: 60,
      previous: '12×12/11/10',
      todayGoal: '12×12/12/10',
      coachFocus: 'локти неподвижно, не раскачивай корпус.',
      alternatives: [{ name: 'Сгибания на блоке', reason: 'ровнее сопротивление' }],
      instruction: 'Держи нейтральный хват, поднимай гантели без рывка, опускай медленно.',
      commonMistakes: ['раскачка', 'локти уходят вперёд', 'короткая амплитуда'],
    },
  ],
}

export const workoutDays: WorkoutDay[] = [dayA, dayB, dayC]
