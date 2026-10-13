import { readFileSync, unlinkSync } from 'node:fs'
import sharp from 'sharp'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: node scripts/convert-exercise-guides-to-webp.mjs <image.png> [...]')
  process.exit(1)
}

for (const png of paths) {
  const webp = png.replace(/\.png$/i, '.webp')
  await sharp(readFileSync(png)).webp({ quality: 82 }).toFile(webp)
  unlinkSync(png)
  console.log(`converted ${png} -> ${webp}`)
}
