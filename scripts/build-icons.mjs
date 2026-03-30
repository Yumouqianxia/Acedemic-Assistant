import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const preferredSource = process.argv[2] || process.env.ICON_SOURCE || 'assets/icon-source.png'
const OUT_DIR = process.env.ICON_OUT_DIR || 'build/icons'
const PNG_DIR = path.join(OUT_DIR, 'png')
const FALLBACK_SOURCE = 'src/assets/vue.svg'

const ALL_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function main() {
  let source = preferredSource
  if (!(await fileExists(source))) {
    if (await fileExists(FALLBACK_SOURCE)) {
      source = FALLBACK_SOURCE
      console.warn(`[icons] "${preferredSource}" not found, fallback to "${source}"`)
    } else {
      throw new Error(
        `Icon source not found: ${preferredSource}\n` +
        'Please provide a PNG/SVG file, for example:\n' +
        '  pnpm icons:build -- assets/icon-source.png\n' +
        'or set ICON_SOURCE env var.',
      )
    }
  }
  await fs.mkdir(PNG_DIR, { recursive: true })

  // Keep aspect ratio and place artwork on transparent 1024x1024 canvas.
  const master1024 = await sharp(source)
    .resize(1024, 1024, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await fs.writeFile(path.join(OUT_DIR, 'icon-1024.png'), master1024)

  const icoInputs = []
  for (const size of ALL_SIZES) {
    const pngPath = path.join(PNG_DIR, `${size}.png`)
    await sharp(master1024).resize(size, size).png().toFile(pngPath)
    if (ICO_SIZES.includes(size)) icoInputs.push(pngPath)
  }

  const icoBuffer = await pngToIco(icoInputs)
  await fs.writeFile(path.join(OUT_DIR, 'icon.ico'), icoBuffer)

  // Linux/Desktop icon fallback.
  await fs.copyFile(path.join(PNG_DIR, '512.png'), path.join(OUT_DIR, '512x512.png'))

  console.log(`Icons generated from "${source}" -> "${OUT_DIR}"`)
}

main().catch((error) => {
  console.error('[icons] build failed:', error)
  process.exit(1)
})
