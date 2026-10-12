import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDANCE_SECTION, GUIDANCE_TEXT, apply, inject, name } from '../src/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('run-code package contract', () => {
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
    expect(name).toBe('dsh-kit-run-code')
    expect(inject).toEqual(['tools', 'systemPrompt'])
  })

  it('guidance covers batching, chaining, filtering and direct calls', () => {
    expect(GUIDANCE_SECTION).toBe('run-code:guidance')
    expect(GUIDANCE_TEXT).toContain('`run_code`')
    expect(GUIDANCE_TEXT).toContain('`Promise.all`')
    expect(GUIDANCE_TEXT).toContain('intermediate results stay out of the conversation')
    expect(GUIDANCE_TEXT).toContain('invoke the tool directly')
    // 指引不得把 run_code 说成唯一通道（那是 ptc 模式的规则）。
    expect(GUIDANCE_TEXT).not.toContain('only tool')
  })
})

describe('run-code apply', () => {
  interface Section {
    name: string
    order: number
    text: string
  }

  function mount() {
    const calls: string[] = []
    const sections: Section[] = []
    const ctx = {
      inject: (deps: string[], mountInner: (inner: unknown) => void) => {
        expect(deps).toEqual(['ptcRuntime'])
        calls.push('inject')
        mountInner({
          tools: {
            presentAs: (mode: string) => {
              calls.push(`presentAs:${mode}`)
            },
          },
        })
      },
      effect: (run: () => () => void) => run(),
      systemPrompt: {
        section: (section: Section) => {
          sections.push(section)
          return () => undefined
        },
        getSectionOrder: (slot: string): number => {
          expect(slot).toBe('TOOLS_SDK')
          return 5000
        },
      },
    }
    apply(ctx as Parameters<typeof apply>[0])
    return { calls, sections }
  }

  it('waits for ptcRuntime and declares the both presentation', () => {
    const { calls } = mount()
    expect(calls).toEqual(['inject', 'presentAs:both'])
  })

  it('registers the guidance section right after the official SDK section', () => {
    const { sections } = mount()
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('run-code:guidance')
    expect(sections[0]?.order).toBe(5100)
    expect(sections[0]?.text).toBe(GUIDANCE_TEXT)
  })
})
