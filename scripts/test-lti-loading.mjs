import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { compileScript, parse } from 'vue/compiler-sfc'

const require = createRequire(import.meta.url)
const Vue = require('vue')
const filename = new URL('../src/components/MoodleLtiBrowser.vue', import.meta.url)
const { descriptor } = parse(await readFile(filename, 'utf8'))
// Reparse with the webview custom-element option during inline compilation.
descriptor.template.ast = undefined
const compiled = ts.transpileModule(compileScript(descriptor, {
  id: 'lti-loading-test', inlineTemplate: true,
  templateOptions: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } },
}).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

const element = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
const remove = (node) => {
  if (!node.parent) return
  const siblings = node.parent.children
  siblings.splice(siblings.indexOf(node), 1)
  node.parent = null
}
const renderer = Vue.createRenderer({
  createElement: element,
  createText: (text) => element('#text', text),
  createComment: (text) => element('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert: (node, parent, anchor) => {
    remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove,
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})
const walk = (node) => [node, ...node.children.flatMap(walk)]
const text = (node) => node.text + node.children.map(text).join('')

async function mount(t, launch = async () => 'https://moodle.example/mod/lti/launch.php?id=123') {
  let calls = 0
  const timers = new Map()
  let timerId = 0
  const module = { exports: {} }
  const empty = Vue.defineComponent(() => () => null)
  const mockRequire = (id) => {
    if (id.endsWith('AiHomeworkAssistant.vue')) return { default: empty }
    if (id === '@element-plus/icons-vue') return { Back: empty, Link: empty, Refresh: empty }
    return require(id)
  }
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', compiled)(
    mockRequire, module, module.exports,
    (callback) => { timers.set(++timerId, callback); return timerId },
    (id) => timers.delete(id),
  )
  globalThis.window = { electronAPI: { moodleLtiLaunchUrl: async (payload) => { calls++; return launch(payload) } } }
  const root = element('root')
  const app = renderer.createApp(module.exports.default, { cmid: 123, title: 'WeBWorK', courseName: 'Calculus' })
  app.component('el-icon', empty)
  app.mount(root)
  t.after(() => { app.unmount(); delete globalThis.window })
  const settle = async () => { await Promise.resolve(); await Vue.nextTick(); await Vue.nextTick() }
  await settle()
  const all = () => walk(root)
  const webview = () => all().find((node) => node.type === 'webview')
  const fire = async (name, details = {}) => {
    const listener = webview().props[`on${name.replace(/(^|-)(\w)/g, (_match, _dash, letter) => letter.toUpperCase())}`]
    listener?.(details)
    await settle()
  }
  return {
    root, timers, app, settle, fire, webview,
    calls: () => calls,
    overlay: () => all().some((node) => node.props.class?.includes('lti-loading')),
    error: () => all().some((node) => node.props.class?.includes('lti-error')),
    busy: () => all().find((node) => node.props['aria-busy'] !== undefined)?.props['aria-busy'],
    reconnect: async () => {
      all().find((node) => node.type === 'button' && text(node).includes('重新连接')).props.onClick()
      await settle()
    },
  }
}

test('initial document readiness reveals the page without waiting for all resources', async (t) => {
  const h = await mount(t)
  assert.equal(h.calls(), 1)
  assert.equal(h.overlay(), true)
  assert.ok(h.webview())
  await h.fire('dom-ready')
  assert.equal(h.overlay(), false)
  assert.equal(h.busy(), false)
  assert.equal(h.timers.size, 0)
})

test('problem navigation keeps the page visible and never requests another Moodle launch', async (t) => {
  const h = await mount(t)
  await h.fire('dom-ready')
  for (let i = 0; i < 3; i++) {
    await h.fire('did-start-navigation', { isMainFrame: true, isInPlace: false })
    assert.equal(h.busy(), true)
    assert.equal(h.overlay(), false)
    assert.match(text(h.root), /正在加载作业页面/)
    await h.fire('dom-ready')
    assert.equal(h.busy(), false)
  }
  assert.equal(h.calls(), 1)
})

test('subframes, resources, and hash changes do not restart connection UI', async (t) => {
  const h = await mount(t)
  await h.fire('dom-ready')
  await h.fire('did-start-navigation', { isMainFrame: false })
  await h.fire('did-start-navigation', { isMainFrame: true, isInPlace: true })
  await h.fire('did-start-loading')
  assert.equal(h.busy(), false)
  assert.equal(h.overlay(), false)
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls(), 1)
})

test('slow loads become nonblocking without reloading or resubmitting the page', async (t) => {
  const h = await mount(t)
  for (const callback of h.timers.values()) callback()
  await h.settle()
  assert.equal(h.overlay(), false)
  assert.match(text(h.root), /页面响应较慢/)
  assert.equal(h.calls(), 1)
  await h.fire('dom-ready')
  assert.equal(h.timers.size, 0)
  assert.equal(h.busy(), false)
})

test('redirect aborts and subresource failures are ignored; real failures allow reconnection', async (t) => {
  const h = await mount(t)
  await h.fire('did-fail-load', { errorCode: -3, isMainFrame: true })
  await h.fire('did-fail-load', { errorCode: -105, isMainFrame: false })
  assert.equal(h.error(), false)
  await h.fire('did-fail-load', { errorCode: -105, isMainFrame: true, errorDescription: 'Network error' })
  assert.equal(h.error(), true)
  assert.equal(h.busy(), false)
  await h.reconnect()
  assert.equal(h.calls(), 2)
  assert.equal(h.error(), false)
  assert.equal(h.overlay(), true)
})

test('unmount discards a late launch response and clears the loading timer', async (t) => {
  let complete
  const h = await mount(t, () => new Promise((resolve) => { complete = resolve }))
  assert.equal(h.webview(), undefined)
  h.app.unmount()
  complete('https://moodle.example/late-launch')
  await h.settle()
  assert.equal(h.webview(), undefined)
  assert.equal(h.timers.size, 0)
})
