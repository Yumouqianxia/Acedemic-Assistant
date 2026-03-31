import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)
const OUT_DIR = process.env.ICON_OUT_DIR || 'build/icons'
const ICONSET_DIR = path.join(OUT_DIR, 'icon.iconset')
const SOURCE_1024 = path.join(OUT_DIR, 'icon-1024.png')
const TARGET_ICNS = path.join(OUT_DIR, 'icon.icns')

const ICONSET_MAP = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

function makeRoundedMask(size, radiusRatio = 0.225) {
  const radius = Math.round(size * radiusRatio)
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white" />
    </svg>
  `
  return Buffer.from(svg)
}

async function ensureFileExists(file) {
  try {
    await fs.access(file)
  } catch {
    throw new Error(
      `Missing ${file}. Run "pnpm icons:build" first to generate base PNG assets.`,
    )
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[icons] skip mac icns generation: current platform is not macOS')
    return
  }

  await ensureFileExists(SOURCE_1024)
  await fs.rm(ICONSET_DIR, { recursive: true, force: true })
  await fs.mkdir(ICONSET_DIR, { recursive: true })

  for (const [fileName, size] of ICONSET_MAP) {
    const roundedMask = makeRoundedMask(size)
    await sharp(SOURCE_1024)
      .resize(size, size, { fit: 'cover' })
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toFile(path.join(ICONSET_DIR, fileName))
  }

  await execFileAsync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', TARGET_ICNS])
  console.log(`[icons] mac icon generated: ${TARGET_ICNS}`)
}

main().catch((error) => {
  console.error('[icons] mac build failed:', error)
  process.exit(1)
})
