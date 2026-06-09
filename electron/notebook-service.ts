import { shell } from 'electron'
import path from 'node:path'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import MarkdownIt from 'markdown-it'

export type NotebookCourse = {
  courseKey: string
  courseCode: string
  courseName: string
}

export type NoteSourceType = 'markdown' | 'html-import' | 'richtext'

export type NotebookItem = {
  id: string
  title: string
  file: string
  htmlFile: string
  sourceType: NoteSourceType
  editor: 'markdown' | 'external-html' | 'richtext'
  importMode?: 'copy' | 'mirror'
  sourcePath?: string
  sourceDir?: string
  syncedAt?: string
  createdAt: string
  updatedAt: string
}

export type NotebookIndex = {
  version: 1
  course: NotebookCourse
  items: NotebookItem[]
  updatedAt: string
}

export type ImportHtmlResult = {
  items: NotebookItem[]
  copiedAssets: string[]
}

export type SyncSourcesResult = {
  index: NotebookIndex
  synced: number
  skipped: number
  missing: Array<{ id: string; title: string; sourcePath: string }>
  copiedAssets: string[]
}

const INDEX_FILE = 'index.json'
const COURSE_HTML_FILE = 'course.html'
const NOTE_CSS_FILE = 'note.css'
const SAFE_ID_RE = /[^a-z0-9-]/g
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

const nowIso = () => new Date().toISOString()

function toSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(SAFE_ID_RE, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || `note-${Date.now().toString(36)}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseFrontmatter(source: string) {
  const hit = source.match(FRONTMATTER_RE)
  if (!hit) return { attrs: {} as Record<string, string>, body: source }
  const attrs: Record<string, string> = {}
  for (const line of hit[1].split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep <= 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) attrs[key] = value
  }
  return { attrs, body: source.slice(hit[0].length) }
}

function noteCss() {
  return `
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: #f5f7fb;
  color: #1f2937;
}
body {
  margin: 0;
  background: #f5f7fb;
}
.note-shell {
  max-width: 860px;
  margin: 0 auto;
  padding: 44px 28px 72px;
}
.note-page {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 36px 44px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.note-page + .note-page {
  margin-top: 24px;
}
.note-meta {
  color: #64748b;
  font-size: 13px;
  margin-bottom: 18px;
}
h1, h2, h3, h4 {
  color: #111827;
  line-height: 1.28;
  margin: 1.4em 0 0.55em;
}
h1 {
  font-size: 30px;
  margin-top: 0;
}
h2 {
  font-size: 23px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.25em;
}
h3 {
  font-size: 18px;
}
p, li {
  font-size: 15px;
  line-height: 1.75;
}
a {
  color: #2563eb;
}
blockquote {
  margin: 18px 0;
  padding: 12px 16px;
  border-left: 4px solid #93c5fd;
  background: #eff6ff;
  color: #334155;
}
code {
  padding: 2px 5px;
  border-radius: 4px;
  background: #f1f5f9;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}
pre {
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
}
pre code {
  padding: 0;
  background: transparent;
  color: inherit;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 18px 0;
}
th, td {
  border: 1px solid #e5e7eb;
  padding: 8px 10px;
  text-align: left;
}
th {
  background: #f8fafc;
}
img {
  max-width: 100%;
  height: auto;
}
@media print {
  body {
    background: #fff;
  }
  .note-shell {
    max-width: none;
    padding: 0;
  }
  .note-page {
    border: 0;
    box-shadow: none;
    page-break-after: always;
  }
}
`.trim()
}

function renderHtmlDocument(input: {
  title: string
  courseTitle: string
  body: string
  cssHref?: string
}) {
  const title = escapeHtml(input.title)
  const courseTitle = escapeHtml(input.courseTitle)
  const css = input.cssHref ? `<link rel="stylesheet" href="${escapeHtml(input.cssHref)}">` : `<style>${noteCss()}</style>`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  ${css}
</head>
<body>
  <main class="note-shell" data-course-title="${courseTitle}">
${input.body}
  </main>
</body>
</html>
`
}

function pathToFileHref(filePath: string) {
  return `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

function injectBaseHref(html: string, baseHref: string) {
  const baseTag = `<base href="${escapeHtml(baseHref)}">`
  if (/<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${baseTag}`)
  }
  return `<!doctype html>
<html>
<head>${baseTag}</head>
<body>
${html}
</body>
</html>`
}

function readHtmlTitle(source: string, fallback: string) {
  const hit = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = hit?.[1]?.replace(/\s+/g, ' ').trim()
  return title || fallback
}

async function inlineLocalStyles(html: string, baseDir: string) {
  const linkRe = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi
  const links = html.match(linkRe) ?? []
  let next = html
  for (const link of links) {
    const hrefHit = link.match(/\bhref=["']([^"']+)["']/i)
    const href = hrefHit?.[1]?.trim()
    if (!href || /^(?:https?:|data:|file:|#)/i.test(href)) continue
    const [cleanHref] = href.split(/[?#]/)
    const cssPath = path.resolve(baseDir, cleanHref)
    if (cssPath !== path.resolve(baseDir) && !cssPath.startsWith(`${path.resolve(baseDir)}${path.sep}`)) continue
    try {
      const css = await readFile(cssPath, 'utf8')
      next = next.replace(link, `<style data-notebook-inline="${escapeHtml(href)}">\n${css}\n</style>`)
    } catch {
      // Keep the original link if the stylesheet cannot be read.
    }
  }
  return next
}

export class NotebookService {
  constructor(private readonly rootDir: string) {}

  private courseDir(courseKey: string) {
    return path.join(this.rootDir, toSlug(courseKey))
  }

  private async ensureCourseDirs(course: NotebookCourse) {
    const dir = this.courseDir(course.courseKey)
    await mkdir(path.join(dir, 'pages'), { recursive: true })
    await mkdir(path.join(dir, 'html'), { recursive: true })
    await mkdir(path.join(dir, 'assets'), { recursive: true })
    await writeFile(path.join(dir, NOTE_CSS_FILE), noteCss(), 'utf8')
    await this.ensureIndex(course)
    return dir
  }

  private async ensureIndex(course: NotebookCourse) {
    const dir = this.courseDir(course.courseKey)
    const indexPath = path.join(dir, INDEX_FILE)
    try {
      await access(indexPath)
    } catch {
      const index: NotebookIndex = {
        version: 1,
        course,
        items: [],
        updatedAt: nowIso(),
      }
      await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8')
    }
  }

  private async readIndex(course: NotebookCourse): Promise<NotebookIndex> {
    const dir = await this.ensureCourseDirs(course)
    const text = await readFile(path.join(dir, INDEX_FILE), 'utf8')
    const parsed = JSON.parse(text) as NotebookIndex
    return {
      version: 1,
      course: { ...course, ...parsed.course },
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updatedAt: parsed.updatedAt || nowIso(),
    }
  }

  private async writeIndex(index: NotebookIndex) {
    const dir = this.courseDir(index.course.courseKey)
    index.updatedAt = nowIso()
    await writeFile(path.join(dir, INDEX_FILE), JSON.stringify(index, null, 2), 'utf8')
  }

  private resolveInsideCourse(courseKey: string, relativePath: string) {
    const base = this.courseDir(courseKey)
    const resolved = path.resolve(base, relativePath)
    const normalizedBase = path.resolve(base)
    if (resolved !== normalizedBase && !resolved.startsWith(`${normalizedBase}${path.sep}`)) {
      throw new Error('Invalid notebook path')
    }
    return resolved
  }

  private async uniqueRelativePath(courseKey: string, dir: 'pages' | 'html', basename: string, ext: string) {
    let id = toSlug(basename)
    let relativePath = `${dir}/${id}${ext}`
    let index = 1
    while (true) {
      try {
        await access(this.resolveInsideCourse(courseKey, relativePath))
        relativePath = `${dir}/${id}-${index}${ext}`
        index += 1
      } catch {
        return relativePath
      }
    }
  }

  private async copySiblingAssets(payload: { courseKey: string; sourceDir: string; selectedHtmlPaths: Set<string> }) {
    const copied: string[] = []
    const entries = await readdir(payload.sourceDir, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return
      const sourcePath = path.join(payload.sourceDir, entry.name)
      if (payload.selectedHtmlPaths.has(path.resolve(sourcePath))) return
      if (/\.html?$/i.test(entry.name)) return
      const target = this.resolveInsideCourse(payload.courseKey, `html/${entry.name}`)
      await copyFile(sourcePath, target)
      copied.push(entry.name)
    }))
    return copied.sort((a, b) => a.localeCompare(b))
  }

  async getCourse(payload: { course: NotebookCourse }) {
    const index = await this.readIndex(payload.course)
    return {
      index,
      courseDir: this.courseDir(payload.course.courseKey),
    }
  }

  async createMarkdown(payload: { course: NotebookCourse; title: string }) {
    const index = await this.readIndex(payload.course)
    const title = payload.title.trim() || `Untitled ${index.items.length + 1}`
    const file = await this.uniqueRelativePath(payload.course.courseKey, 'pages', title, '.md')
    const htmlFile = file.replace(/^pages\//, 'html/').replace(/\.md$/i, '.html')
    const createdAt = nowIso()
    const content = `---
title: ${title}
sourceType: markdown
---

# ${title}

`
    await writeFile(this.resolveInsideCourse(payload.course.courseKey, file), content, 'utf8')
    const item: NotebookItem = {
      id: path.basename(file, '.md'),
      title,
      file,
      htmlFile,
      sourceType: 'markdown',
      editor: 'markdown',
      createdAt,
      updatedAt: createdAt,
    }
    index.items.push(item)
    await this.writeIndex(index)
    await this.renderNote({ course: payload.course, noteId: item.id })
    return item
  }

  async importHtml(payload: { course: NotebookCourse; filePath: string }) {
    const result = await this.importHtmlFiles({
      course: payload.course,
      filePaths: [payload.filePath],
    })
    return result.items[0]
  }

  async importHtmlFiles(payload: { course: NotebookCourse; filePaths: string[] }): Promise<ImportHtmlResult> {
    const index = await this.readIndex(payload.course)
    const cleanPaths = [...new Set(payload.filePaths.map((filePath) => path.resolve(filePath)))]
      .filter((filePath) => /\.html?$/i.test(filePath))
    if (!cleanPaths.length) throw new Error('No HTML files selected')
    const items: NotebookItem[] = []
    for (const sourcePath of cleanPaths) {
      const info = await stat(sourcePath)
      if (!info.isFile()) throw new Error('Selected path is not a file')
      const sourceName = path.basename(sourcePath, path.extname(sourcePath))
      const ext = path.extname(sourcePath).toLowerCase() === '.htm' ? '.htm' : '.html'
      const htmlFile = await this.uniqueRelativePath(payload.course.courseKey, 'html', sourceName, ext)
      await copyFile(sourcePath, this.resolveInsideCourse(payload.course.courseKey, htmlFile))
      const source = await readFile(sourcePath, 'utf8')
      const createdAt = nowIso()
      const item: NotebookItem = {
        id: path.basename(htmlFile, ext),
        title: readHtmlTitle(source, sourceName),
        file: htmlFile,
        htmlFile,
        sourceType: 'html-import',
        editor: 'external-html',
        importMode: 'mirror',
        sourcePath,
        sourceDir: path.dirname(sourcePath),
        syncedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      }
      index.items.push(item)
      items.push(item)
    }
    const copiedAssets = new Set<string>()
    const sourceDirs = [...new Set(cleanPaths.map((filePath) => path.dirname(filePath)))]
    await Promise.all(sourceDirs.map(async (sourceDir) => {
      const copied = await this.copySiblingAssets({
        courseKey: payload.course.courseKey,
        sourceDir,
        selectedHtmlPaths: new Set(cleanPaths),
      })
      copied.forEach((asset) => copiedAssets.add(asset))
    }))
    await this.writeIndex(index)
    return { items, copiedAssets: [...copiedAssets].sort((a, b) => a.localeCompare(b)) }
  }

  async importHtmlDirectory(payload: { course: NotebookCourse; directory: string }): Promise<ImportHtmlResult> {
    const directory = path.resolve(payload.directory)
    const info = await stat(directory)
    if (!info.isDirectory()) throw new Error('Selected path is not a directory')
    const entries = await readdir(directory, { withFileTypes: true })
    const htmlPaths = entries
      .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => {
        const aName = path.basename(a).toLowerCase()
        const bName = path.basename(b).toLowerCase()
        if (aName === 'index.html') return -1
        if (bName === 'index.html') return 1
        return aName.localeCompare(bName)
      })
    return this.importHtmlFiles({
      course: payload.course,
      filePaths: htmlPaths,
    })
  }

  async readNote(payload: { course: NotebookCourse; noteId: string }) {
    const index = await this.readIndex(payload.course)
    const item = index.items.find((note) => note.id === payload.noteId)
    if (!item) throw new Error('Note not found')
    const sourcePath = this.resolveInsideCourse(payload.course.courseKey, item.file)
    const htmlPath = this.resolveInsideCourse(payload.course.courseKey, item.htmlFile)
    const source = await readFile(sourcePath, 'utf8')
    let html = ''
    try {
      html = await readFile(htmlPath, 'utf8')
    } catch {
      if (item.sourceType === 'markdown') {
        html = await this.renderNote(payload)
      } else {
        html = source
      }
    }
    if (item.sourceType !== 'markdown') {
      const htmlDir = path.dirname(htmlPath)
      html = await inlineLocalStyles(html, htmlDir)
      html = injectBaseHref(html, pathToFileHref(htmlDir) + '/')
    }
    return { item, source, html }
  }

  async saveMarkdown(payload: { course: NotebookCourse; noteId: string; title: string; source: string }) {
    const index = await this.readIndex(payload.course)
    const item = index.items.find((note) => note.id === payload.noteId)
    if (!item) throw new Error('Note not found')
    if (item.sourceType !== 'markdown') throw new Error('Only markdown notes can be saved in the app')
    await writeFile(this.resolveInsideCourse(payload.course.courseKey, item.file), payload.source, 'utf8')
    item.title = payload.title.trim() || item.title
    item.updatedAt = nowIso()
    await this.writeIndex(index)
    const html = await this.renderNote({ course: payload.course, noteId: item.id })
    return { item, html }
  }

  async renderNote(payload: { course: NotebookCourse; noteId: string }) {
    const index = await this.readIndex(payload.course)
    const item = index.items.find((note) => note.id === payload.noteId)
    if (!item) throw new Error('Note not found')
    if (item.sourceType !== 'markdown') {
      return readFile(this.resolveInsideCourse(payload.course.courseKey, item.htmlFile), 'utf8')
    }
    const source = await readFile(this.resolveInsideCourse(payload.course.courseKey, item.file), 'utf8')
    const { attrs, body } = parseFrontmatter(source)
    const title = item.title || attrs.title
    const rendered = md.render(body)
    const document = renderHtmlDocument({
      title,
      courseTitle: index.course.courseName,
      cssHref: '../note.css',
      body: `    <article class="note-page" data-note-id="${escapeHtml(item.id)}">
      <div class="note-meta">${escapeHtml(index.course.courseCode)} / ${escapeHtml(index.course.courseName)}</div>
${rendered.split('\n').map((line) => `      ${line}`).join('\n')}
    </article>`,
    })
    await writeFile(this.resolveInsideCourse(payload.course.courseKey, item.htmlFile), document, 'utf8')
    return document
  }

  async renderCourse(payload: { course: NotebookCourse }) {
    const index = await this.readIndex(payload.course)
    const parts: string[] = []
    for (const item of index.items) {
      if (item.sourceType === 'markdown') {
        const source = await readFile(this.resolveInsideCourse(payload.course.courseKey, item.file), 'utf8')
        const { body } = parseFrontmatter(source)
        parts.push(`    <article class="note-page" data-note-id="${escapeHtml(item.id)}">
      <div class="note-meta">${escapeHtml(index.course.courseCode)} / ${escapeHtml(index.course.courseName)}</div>
${md.render(body).split('\n').map((line) => `      ${line}`).join('\n')}
    </article>`)
      } else {
        const html = await readFile(this.resolveInsideCourse(payload.course.courseKey, item.htmlFile), 'utf8')
        const bodyHit = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
        const body = bodyHit ? bodyHit[1] : html
        parts.push(`    <article class="note-page note-page--imported" data-note-id="${escapeHtml(item.id)}">
      <div class="note-meta">${escapeHtml(index.course.courseCode)} / ${escapeHtml(index.course.courseName)} / Imported HTML</div>
      <h1>${escapeHtml(item.title)}</h1>
${body.split('\n').map((line) => `      ${line}`).join('\n')}
    </article>`)
      }
    }
    const document = renderHtmlDocument({
      title: `${index.course.courseName} Notes`,
      courseTitle: index.course.courseName,
      cssHref: NOTE_CSS_FILE,
      body: parts.join('\n'),
    })
    const outputPath = this.resolveInsideCourse(payload.course.courseKey, COURSE_HTML_FILE)
    await writeFile(outputPath, document, 'utf8')
    return { html: document, filePath: outputPath }
  }

  async renameNote(payload: { course: NotebookCourse; noteId: string; title: string }) {
    const index = await this.readIndex(payload.course)
    const item = index.items.find((note) => note.id === payload.noteId)
    if (!item) throw new Error('Note not found')
    item.title = payload.title.trim() || item.title
    item.updatedAt = nowIso()
    await this.writeIndex(index)
    return item
  }

  async deleteNote(payload: { course: NotebookCourse; noteId: string }) {
    const index = await this.readIndex(payload.course)
    const itemIndex = index.items.findIndex((note) => note.id === payload.noteId)
    if (itemIndex < 0) throw new Error('Note not found')
    const [item] = index.items.splice(itemIndex, 1)
    const paths = new Set([item.file, item.htmlFile])
    await Promise.all([...paths].map(async (relativePath) => {
      await rm(this.resolveInsideCourse(payload.course.courseKey, relativePath), { force: true })
    }))
    await this.writeIndex(index)
    return index
  }

  async syncSources(payload: { course: NotebookCourse; noteIds?: string[] }): Promise<SyncSourcesResult> {
    const index = await this.readIndex(payload.course)
    const requestedIds = payload.noteIds?.length ? new Set(payload.noteIds) : null
    const targets = index.items.filter((item) =>
      item.sourceType === 'html-import'
      && item.sourcePath
      && (!requestedIds || requestedIds.has(item.id)),
    )
    const missing: Array<{ id: string; title: string; sourcePath: string }> = []
    const copiedAssets = new Set<string>()
    let synced = 0

    for (const item of targets) {
      const sourcePath = path.resolve(item.sourcePath!)
      try {
        const info = await stat(sourcePath)
        if (!info.isFile()) throw new Error('Source is not a file')
        await copyFile(sourcePath, this.resolveInsideCourse(payload.course.courseKey, item.htmlFile))
        const source = await readFile(sourcePath, 'utf8')
        item.title = readHtmlTitle(source, item.title)
        item.sourcePath = sourcePath
        item.sourceDir = path.dirname(sourcePath)
        item.importMode = 'mirror'
        item.syncedAt = nowIso()
        item.updatedAt = item.syncedAt
        synced += 1
      } catch {
        missing.push({ id: item.id, title: item.title, sourcePath })
      }
    }

    const sourceDirs = [...new Set(targets
      .filter((item) => item.sourcePath && !missing.some((missingItem) => missingItem.id === item.id))
      .map((item) => path.dirname(path.resolve(item.sourcePath!))))]
    const selectedHtmlPaths = new Set(targets
      .map((item) => item.sourcePath ? path.resolve(item.sourcePath) : '')
      .filter(Boolean))
    await Promise.all(sourceDirs.map(async (sourceDir) => {
      const copied = await this.copySiblingAssets({
        courseKey: payload.course.courseKey,
        sourceDir,
        selectedHtmlPaths,
      })
      copied.forEach((asset) => copiedAssets.add(asset))
    }))

    await this.writeIndex(index)
    const skipped = requestedIds
      ? payload.noteIds!.length - targets.length
      : index.items.filter((item) => item.sourceType === 'html-import' && !item.sourcePath).length
    return {
      index,
      synced,
      skipped,
      missing,
      copiedAssets: [...copiedAssets].sort((a, b) => a.localeCompare(b)),
    }
  }

  async reorderNotes(payload: { course: NotebookCourse; noteIds: string[] }) {
    const index = await this.readIndex(payload.course)
    const order = new Map(payload.noteIds.map((id, i) => [id, i]))
    index.items.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999))
    await this.writeIndex(index)
    return index
  }

  async openNote(payload: { course: NotebookCourse; noteId: string }) {
    const index = await this.readIndex(payload.course)
    const item = index.items.find((note) => note.id === payload.noteId)
    if (!item) throw new Error('Note not found')
    if (item.sourceType === 'markdown') await this.renderNote(payload)
    const openError = await shell.openPath(this.resolveInsideCourse(payload.course.courseKey, item.htmlFile))
    if (openError) throw new Error(openError)
    return true
  }

  async openCourse(payload: { course: NotebookCourse }) {
    const result = await this.renderCourse(payload)
    const openError = await shell.openPath(result.filePath)
    if (openError) throw new Error(openError)
    return true
  }

  async openCourseFolder(payload: { course: NotebookCourse }) {
    const dir = await this.ensureCourseDirs(payload.course)
    const openError = await shell.openPath(dir)
    if (openError) throw new Error(openError)
    return true
  }

  async moveNoteFile(payload: { course: NotebookCourse; from: string; to: string }) {
    const fromPath = this.resolveInsideCourse(payload.course.courseKey, payload.from)
    const toPath = this.resolveInsideCourse(payload.course.courseKey, payload.to)
    await mkdir(path.dirname(toPath), { recursive: true })
    await rename(fromPath, toPath)
    return true
  }
}
