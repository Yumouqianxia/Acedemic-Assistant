import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const targets = ['dist', 'dist-electron', 'release']

await Promise.all(
  targets.map(async (target) => {
    const fullPath = path.join(rootDir, target)
    await rm(fullPath, { recursive: true, force: true })
    console.log(`[clean] removed ${target}`)
  }),
)
