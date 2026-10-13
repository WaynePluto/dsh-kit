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

  it('guidance defaults to direct calls and reserves run_code for multi-call steps', () => {
    expect(GUIDANCE_SECTION).toBe('run-code:guidance')
    expect(GUIDANCE_TEXT).toContain('Call tools directly whenever a step is a single call')
    expect(GUIDANCE_TEXT).toContain('Never wrap a single tool call')
    expect(GUIDANCE_TEXT).toContain('`Promise.all`')
    expect(GUIDANCE_TEXT).toContain('intermediate results stay out of the conversation')
    // 指引不得把 run_code 说成唯一通道（那是 ptc 模式的规则），也不得再写「优先写程序」的旧措辞。
    expect(GUIDANCE_TEXT).not.toContain('only tool')
    expect(GUIDANCE_TEXT).not.toContain('Prefer `run_code`')
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
          // 规则落在 dsh 自己的模式规则槽位之后、工具指引与 SDK 之前。
          expect(slot).toBe('PTC_ONLY')
          return 800
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

  it('registers the guidance rule before the tool sections and the SDK', () => {
    const { sections } = mount()
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('run-code:guidance')
    // PTC_ONLY(800)+10：早于 TOOL_PWSH(1010) 等工具指引与 TOOLS_SDK(5000)。
    expect(sections[0]?.order).toBe(810)
    expect(sections[0]?.text).toBe(GUIDANCE_TEXT)
  })
})
