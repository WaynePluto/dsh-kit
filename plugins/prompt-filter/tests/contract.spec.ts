import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Config, apply, name } from '../src/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

interface Section {
  name: string
  text: string
}

interface Assembly {
  sections: Section[]
  contexts: { name: string; text: string }[]
  tools: unknown[]
  variables: Record<string, string>
}

type Listener = (assembly: Assembly, context: unknown, next: () => Promise<Assembly>) => Promise<Assembly>

/** 假 ctx：只记录 effect 与注册的 assemble 监听器，对应 dsh 里本行 fiber 上的两件事。 */
function mount(dropSections: string[]) {
  const effects: string[] = []
  let listener: Listener | undefined
  const ctx = {
    effect: (run: () => () => void, label: string) => {
      effects.push(label)
      return run()
    },
    on: (_event: string, handler: Listener) => {
      listener = handler
      return () => undefined
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0], { dropSections })
  if (listener === undefined) throw new Error('apply registered no system-prompt/assemble listener')
  return { effects, listener }
}

function assemblyOf(names: string[]): Assembly {
  return {
    sections: names.map(section => ({ name: section, text: section + ' text' })),
    contexts: [{ name: 'sandbox:policy', text: 'policy' }],
    tools: [{ name: 'read' }],
    variables: { model: 'test-model' },
  }
}

async function filtered(dropSections: string[], names: string[]) {
  const { listener } = mount(dropSections)
  const assembly = assemblyOf(names)
  const result = await listener(assembly, {}, () => Promise.resolve(assembly))
  return { assembly, result }
}

const DEPLOYMENT = ['harness:identity', 'context:file-reference', 'ui:deliverable-file-references', 'harness:source', 'app:web-surface']
const KEPT = ['deployment:persona-prefix', 'deployment:persona-suffix', 'tool:pwsh', 'tool:pty', 'tools:ptc-only', 'tools:sdk', 'run-code:guidance']

describe('prompt-filter package contract', () => {
  it('is a preset-nested plugin package, not a standalone Bundle', () => {
    const manifest = JSON.parse(read('package.json')) as {
      main?: string
      files?: string[]
      dsh?: unknown
    }
    // 不是独立 Bundle：没有 dsh.bundle patch，仅由预设行按裸包名引用。
    expect(manifest.dsh).toBeUndefined()
    expect(manifest.main).toBe('./dist/index.js')
    expect(manifest.files).toEqual(['dist'])
    expect(name).toBe('dsh-kit-prompt-filter')
  })

  it('requires a non-empty dropSections list', () => {
    expect(Config({ dropSections: ['harness:identity'] })).toEqual({ dropSections: ['harness:identity'] })
    expect(() => Config({})).toThrow(/dropSections/u)
    // schema 放行空数组（显式配置），装载期再响亮失败。
    expect(() => mount([])).toThrow(/dropSections/u)
  })
})

describe('prompt-filter apply', () => {
  it('drops the named deployment sections and keeps every other section in order', async () => {
    const names = [...DEPLOYMENT.slice(0, 2), ...KEPT, ...DEPLOYMENT.slice(2)]
    const { assembly, result } = await filtered(DEPLOYMENT, names)
    expect(result.sections.map(section => section.name)).toEqual(KEPT)
    // 只换 sections：contexts / tools / variables 原样带走。
    expect(result.contexts).toBe(assembly.contexts)
    expect(result.tools).toBe(assembly.tools)
    expect(result.variables).toBe(assembly.variables)
  })

  it('returns the same assembly reference when no name matches', async () => {
    const { assembly, result } = await filtered(['harness:identity'], KEPT)
    expect(result).toBe(assembly)
    const unknown = await filtered(['does:not-exist'], KEPT)
    expect(unknown.result).toBe(unknown.assembly)
  })

  it('registers the listener as an owned effect', async () => {
    const { effects } = mount(DEPLOYMENT)
    expect(effects).toEqual(['prompt-filter.dropSections()'])
  })
})
