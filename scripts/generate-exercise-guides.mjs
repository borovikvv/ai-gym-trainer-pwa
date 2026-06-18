import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'public', 'exercise-guides')
mkdirSync(outDir, { recursive: true })

const colors = {
  bg: '#fff7ec', ink: '#211b16', skin: '#f0a67d', accent: '#ff7a3d', muted: '#8a7b6b', line: '#5c4a3c', equip: '#2b2621', bench: '#d8cab7', shirt: '#3b82f6', shorts: '#1f2937', green: '#44a36f'
}

function svg(id, title, muscle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" role="img" aria-label="${title}: техника выполнения">
  <rect width="960" height="640" rx="48" fill="${colors.bg}"/>
  <rect x="42" y="42" width="876" height="556" rx="38" fill="#fffaf2" stroke="#eadfce" stroke-width="4"/>
  <text x="72" y="96" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="800" fill="${colors.ink}">${title}</text>
  <text x="72" y="132" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="${colors.muted}">${muscle}</text>
  ${body}
</svg>`
}

function arrow(x1, y1, x2, y2, label = '') {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2 - 12
  return `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${colors.accent}"/></marker></defs>
  <path d="M${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${colors.accent}" stroke-width="12" stroke-linecap="round" marker-end="url(#arrow)"/>
  ${label ? `<text x="${midX}" y="${midY - 14}" text-anchor="middle" font-family="Inter, Arial" font-size="20" font-weight="800" fill="${colors.accent}">${label}</text>` : ''}`
}

function cue(x, y, text) {
  return `<rect x="${x}" y="${y}" width="300" height="42" rx="21" fill="#fff2df" stroke="#ead7a2" stroke-width="2"/>
  <circle cx="${x + 22}" cy="${y + 21}" r="7" fill="${colors.accent}"/>
  <text x="${x + 40}" y="${y + 28}" font-family="Inter, Arial" font-size="18" font-weight="750" fill="${colors.ink}">${text}</text>`
}

function personStanding(cx, cy, opts = {}) {
  const lean = opts.lean ?? 0
  return `<circle cx="${cx + lean}" cy="${cy}" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M${cx} ${cy+32} L${cx+lean*1.4} ${cy+128}" stroke="${colors.ink}" stroke-width="16" stroke-linecap="round"/>
  <path d="M${cx-46} ${cy+72} L${cx+46} ${cy+72}" stroke="${colors.ink}" stroke-width="14" stroke-linecap="round"/>
  <path d="M${cx-8} ${cy+128} L${cx-52} ${cy+220}" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M${cx+8} ${cy+128} L${cx+52} ${cy+220}" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>`
}

const files = {}

files['bench-press.svg'] = svg('bench-press', 'Жим лёжа', 'Грудь · плечи · трицепс', `
  <rect x="210" y="410" width="390" height="32" rx="16" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <rect x="250" y="442" width="26" height="86" rx="8" fill="${colors.line}"/><rect x="520" y="442" width="26" height="86" rx="8" fill="${colors.line}"/>
  <circle cx="330" cy="350" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M360 370 L500 410" stroke="${colors.ink}" stroke-width="18" stroke-linecap="round"/>
  <path d="M410 386 L390 450 M470 403 L520 450" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M392 370 L450 324 M500 378 L548 324" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <line x1="330" y1="314" x2="630" y2="314" stroke="${colors.equip}" stroke-width="12" stroke-linecap="round"/>
  <circle cx="306" cy="314" r="26" fill="${colors.equip}"/><circle cx="654" cy="314" r="26" fill="${colors.equip}"/>
  ${arrow(478, 306, 478, 220, 'жми вверх')}
  ${cue(620, 390, 'лопатки сведены')}${cue(620, 444, 'стопы в пол')}${cue(620, 498, 'штанга к нижней груди')}`)

files['lat-pulldown.svg'] = svg('lat-pulldown', 'Тяга верхнего блока', 'Широчайшие · верх спины', `
  <rect x="180" y="184" width="34" height="340" rx="12" fill="${colors.line}"/><rect x="180" y="184" width="390" height="24" rx="12" fill="${colors.line}"/>
  <line x1="520" y1="208" x2="520" y2="292" stroke="${colors.equip}" stroke-width="7"/>
  <line x1="410" y1="292" x2="630" y2="292" stroke="${colors.equip}" stroke-width="12" stroke-linecap="round"/>
  <rect x="380" y="468" width="220" height="34" rx="17" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <circle cx="490" cy="350" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M490 382 L490 468" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M436 404 L410 292 M544 404 L630 292" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M475 468 L450 538 M505 468 L530 538" stroke="${colors.ink}" stroke-width="14" stroke-linecap="round"/>
  ${arrow(660, 290, 598, 368, 'локти вниз')}${cue(650, 398, 'корпус стабилен')}${cue(650, 452, 'плечи не к ушам')}${cue(650, 506, 'тяни к верхней груди')}`)

files['barbell-squat.svg'] = svg('barbell-squat', 'Присед со штангой', 'Ноги · ягодицы · кор', `
  <line x1="300" y1="250" x2="650" y2="250" stroke="${colors.equip}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="276" cy="250" r="34" fill="${colors.equip}"/><circle cx="674" cy="250" r="34" fill="${colors.equip}"/>
  <circle cx="470" cy="204" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M470 236 L448 338" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M390 260 L550 260" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M448 338 L386 430 L335 520" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M452 338 L548 428 L620 516" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M290 528 L370 528 M595 528 L670 528" stroke="${colors.ink}" stroke-width="11" stroke-linecap="round"/>
  ${arrow(705, 260, 705, 390, 'вниз под контролем')}${cue(74, 392, 'колени по линии стоп')}${cue(74, 446, 'спина нейтрально')}${cue(74, 500, 'давление всей стопой')}`)

files['seated-cable-row.svg'] = svg('seated-cable-row', 'Горизонтальная тяга', 'Средняя спина · широчайшие', `
  <rect x="176" y="486" width="310" height="32" rx="16" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <rect x="680" y="250" width="54" height="270" rx="18" fill="${colors.line}"/>
  <line x1="704" y1="350" x2="448" y2="386" stroke="${colors.equip}" stroke-width="7"/>
  <circle cx="330" cy="296" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M345 325 L415 455" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M400 392 L448 386 M390 405 L448 386" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M415 455 L330 520 M420 455 L535 520" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  ${arrow(650, 330, 500, 384, 'тяни локтями')}${cue(70, 392, 'грудь открыта')}${cue(70, 446, 'лопатки назад')}${cue(70, 500, 'без рывка корпусом')}`)

files['plank.svg'] = svg('plank', 'Планка', 'Кор · пресс · стабилизация', `
  <rect x="192" y="514" width="560" height="14" rx="7" fill="#eadfce"/>
  <circle cx="290" cy="355" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M320 374 L560 430" stroke="${colors.ink}" stroke-width="20" stroke-linecap="round"/>
  <path d="M350 390 L295 492 M525 424 L720 500" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M275 492 L330 492 M690 500 L760 500" stroke="${colors.ink}" stroke-width="12" stroke-linecap="round"/>
  <line x1="275" y1="330" x2="705" y2="440" stroke="${colors.accent}" stroke-width="6" stroke-dasharray="14 12"/>
  ${cue(72, 196, 'тело одной линией')}${cue(72, 250, 'таз не провисает')}${cue(72, 304, 'дыши спокойно')}`)

files['romanian-deadlift.svg'] = svg('romanian-deadlift', 'Румынская тяга', 'Задняя поверхность бедра · ягодицы', `
  <line x1="320" y1="430" x2="640" y2="430" stroke="${colors.equip}" stroke-width="13" stroke-linecap="round"/>
  <circle cx="292" cy="430" r="28" fill="${colors.equip}"/><circle cx="668" cy="430" r="28" fill="${colors.equip}"/>
  <circle cx="430" cy="220" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M440 252 L520 360" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M500 338 L450 430 M525 352 L560 430" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M520 360 L480 520 M525 360 L585 520" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M448 520 L520 520 M560 520 L635 520" stroke="${colors.ink}" stroke-width="11" stroke-linecap="round"/>
  ${arrow(680, 300, 590, 300, 'таз назад')}${cue(72, 388, 'штанга близко к ногам')}${cue(72, 442, 'спина нейтрально')}${cue(72, 496, 'колени мягкие')}`)

files['incline-db-press.svg'] = svg('incline-db-press', 'Жим гантелей на наклонной', 'Верх груди · плечи', `
  <path d="M280 470 L520 330" stroke="${colors.bench}" stroke-width="34" stroke-linecap="round"/>
  <path d="M300 482 L270 535 M500 346 L550 522" stroke="${colors.line}" stroke-width="13" stroke-linecap="round"/>
  <circle cx="430" cy="300" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M410 330 L350 430" stroke="${colors.ink}" stroke-width="18" stroke-linecap="round"/>
  <path d="M380 345 L350 270 M430 335 L505 270" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <rect x="330" y="242" width="50" height="26" rx="10" fill="${colors.equip}"/><rect x="488" y="242" width="50" height="26" rx="10" fill="${colors.equip}"/>
  <path d="M346 430 L310 510 M370 420 L420 510" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  ${arrow(442, 270, 442, 198, 'жми вверх')}${cue(620, 388, 'угол 25–35°')}${cue(620, 442, 'локти чуть ниже плеч')}${cue(620, 496, 'без удара гантелей')}`)

files['deadlift-machine-row.svg'] = svg('deadlift-machine-row', 'Тяга в тренажёре', 'Спина · лопатки', `
  <rect x="195" y="300" width="72" height="210" rx="22" fill="${colors.line}"/>
  <rect x="280" y="430" width="210" height="34" rx="17" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <rect x="590" y="280" width="80" height="210" rx="24" fill="#d7c7b5" stroke="${colors.line}" stroke-width="4"/>
  <circle cx="395" cy="276" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M410 306 L505 415" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M490 370 L590 352 M490 398 L590 388" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M505 415 L432 520 M510 415 L575 520" stroke="${colors.ink}" stroke-width="14" stroke-linecap="round"/>
  ${arrow(684, 370, 590, 370, 'тяни назад')}${cue(72, 392, 'грудь зафиксирована')}${cue(72, 446, 'своди лопатки')}${cue(72, 500, 'без рывка')}`)

files['db-shoulder-press.svg'] = svg('db-shoulder-press', 'Жим гантелей сидя', 'Плечи · трицепс', `
  <rect x="390" y="430" width="170" height="34" rx="17" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <rect x="520" y="300" width="34" height="180" rx="16" fill="${colors.bench}" stroke="${colors.line}" stroke-width="4"/>
  <circle cx="470" cy="260" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M470 292 L470 420" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M424 330 L382 235 M516 330 L558 235" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <rect x="354" y="210" width="56" height="28" rx="10" fill="${colors.equip}"/><rect x="530" y="210" width="56" height="28" rx="10" fill="${colors.equip}"/>
  <path d="M455 420 L430 520 M485 420 L515 520" stroke="${colors.ink}" stroke-width="14" stroke-linecap="round"/>
  ${arrow(470, 240, 470, 166, 'вверх')}${cue(625, 386, 'пресс напряжён')}${cue(625, 440, 'не прогибай поясницу')}${cue(625, 494, 'контроль вниз')}`)

files['walking-lunges.svg'] = svg('walking-lunges', 'Выпады с гантелями', 'Ноги · ягодицы', `
  <circle cx="450" cy="206" r="28" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="4"/>
  <path d="M450 238 L430 342" stroke="${colors.ink}" stroke-width="17" stroke-linecap="round"/>
  <path d="M395 280 L355 390 M485 280 L535 390" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <rect x="332" y="386" width="48" height="28" rx="10" fill="${colors.equip}"/><rect x="512" y="386" width="48" height="28" rx="10" fill="${colors.equip}"/>
  <path d="M430 342 L335 430 L280 520" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M435 342 L535 435 L640 520" stroke="${colors.ink}" stroke-width="15" stroke-linecap="round"/>
  <path d="M250 520 L325 520 M620 520 L700 520" stroke="${colors.ink}" stroke-width="11" stroke-linecap="round"/>
  ${arrow(715, 300, 795, 300, 'шаг вперёд')}${cue(72, 392, 'длинный стабильный шаг')}${cue(72, 446, 'колено по линии стопы')}${cue(72, 500, 'отталкивайся всей стопой')}`)

files['hammer-curl.svg'] = svg('hammer-curl', 'Молотковые сгибания', 'Бицепс · предплечье', `
  ${personStanding(450, 190)}
  <path d="M404 262 L382 356 M496 262 L518 356" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <rect x="362" y="345" width="42" height="70" rx="12" fill="${colors.equip}"/><rect x="498" y="345" width="42" height="70" rx="12" fill="${colors.equip}"/>
  ${arrow(560, 390, 515, 300, 'сгибай')}${cue(72, 392, 'локти неподвижно')}${cue(72, 446, 'нейтральный хват')}${cue(72, 500, 'без раскачки')}`)

files['barbell-curl.svg'] = svg('barbell-curl', 'Сгибание рук со штангой', 'Бицепс', `
  ${personStanding(455, 185)}
  <line x1="330" y1="350" x2="580" y2="350" stroke="${colors.equip}" stroke-width="12" stroke-linecap="round"/>
  <circle cx="310" cy="350" r="22" fill="${colors.equip}"/><circle cx="600" cy="350" r="22" fill="${colors.equip}"/>
  ${arrow(625, 380, 590, 285, 'подъём')}${cue(72, 392, 'плечи неподвижно')}${cue(72, 446, 'локти у корпуса')}${cue(72, 500, 'опускай медленно')}`)

files['triceps-rope-pushdown.svg'] = svg('triceps-rope-pushdown', 'Разгибание рук на блоке', 'Трицепс', `
  <rect x="220" y="168" width="36" height="360" rx="14" fill="${colors.line}"/><rect x="220" y="168" width="320" height="24" rx="12" fill="${colors.line}"/>
  <line x1="510" y1="192" x2="510" y2="318" stroke="${colors.equip}" stroke-width="7"/>
  ${personStanding(545, 242, {lean:-15})}
  <path d="M500 330 L510 420 M558 330 L536 420" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <path d="M502 420 L475 470 M538 420 L570 470" stroke="${colors.equip}" stroke-width="9" stroke-linecap="round"/>
  ${arrow(660, 330, 660, 430, 'разгибай вниз')}${cue(72, 392, 'локти прижаты')}${cue(72, 446, 'корпус стабилен')}${cue(72, 500, 'полное разгибание')}`)

files['lateral-raise.svg'] = svg('lateral-raise', 'Разведения гантелей в стороны', 'Средняя дельта', `
  ${personStanding(455, 190)}
  <path d="M408 258 L330 315 M502 258 L580 315" stroke="${colors.ink}" stroke-width="13" stroke-linecap="round"/>
  <rect x="300" y="300" width="55" height="26" rx="10" fill="${colors.equip}"/><rect x="555" y="300" width="55" height="26" rx="10" fill="${colors.equip}"/>
  ${arrow(630, 380, 610, 300, 'до уровня плеч')}${cue(72, 392, 'локоть чуть согнут')}${cue(72, 446, 'не поднимай плечи')}${cue(72, 500, 'без рывка')}`)

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content)
}
console.log(`generated ${Object.keys(files).length} exercise guide SVGs in ${outDir}`)
