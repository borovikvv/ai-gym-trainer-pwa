import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const publicDir = join(process.cwd(), 'public')

const tasks = [
  { src: 'pwa-192x192.svg', out: 'pwa-192x192.png', size: 192 },
  { src: 'pwa-512x512.svg', out: 'pwa-512x512.png', size: 512 },
  { src: 'pwa-512x512.svg', out: 'pwa-512x512-maskable.png', size: 512 },
  { src: 'pwa-512x512.svg', out: 'apple-touch-icon.png', size: 180 },
]

for (const { src, out, size } of tasks) {
  await sharp(readFileSync(join(publicDir, src)))
    .resize(size, size)
    .png()
    .toFile(join(publicDir, out))
}

console.log(`generated ${tasks.length} PWA icons in ${publicDir}`)
