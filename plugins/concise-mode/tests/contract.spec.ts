import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('concise mode profile bundle', () => {
  it('declares a pure bundle with one inline agent-preset row', () => {
    const manifest = JSON.parse(read('package.json')) as {
      main?: string
      files?: string[]
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.main).toBeUndefined()
    expect(manifest.files).toEqual(['cordis.patch.yml', 'locale'])
    const patch = read('cordis.patch.yml')
    // dsh 0.1.7：预设是一行 `@deepseek-ai/dsh-agent-preset` 声明，config.plugins 即子插件行。
    expect(patch).toContain(`name: '@deepseek-ai/dsh-agent-preset'`)
    expect(patch).toContain('id: concise')
    expect(patch).not.toContain('concise-ptc')
    // 绿色包可移植性：不携带开发机绝对路径，也不引用本包 dist。
    expect(patch).not.toMatch(/[A-Za-z]:\\/)
    expect(patch).not.toContain('dshStationConcisePresetRoot')
    expect(patch).not.toContain('./dist/')
  })
})

const selectedRows = [
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-compaction-basic',
  'includeRuntimeContext: false',
  'enableRunInBackground: false',
  'allowParallelInProgress: true',
  'compaction: true',
  'toolResultPruner: true',
]
const omittedRows = [
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-subagent-control',
  'subagent_fork',
  'maxDepth:',
]

/** 从 patch 里取出 concise 预设行的 config.plugins 段（到文件尾为止）。 */
function presetSection(patch: string, id: string): string {
  const start = patch.indexOf(`        id: ${id}`)
  const end = patch.indexOf('    - id: preset-', start + 1)
  return patch.slice(start, end === -1 ? undefined : end)
}

describe('concise composition', () => {
  const patch = read('cordis.patch.yml')

  it('keeps native tools callable and adds run_code side by side (both)', () => {
    const section = presetSection(patch, 'concise')
    for (const row of selectedRows) expect(section).toContain(row)
    for (const omitted of [...omittedRows, 'mode: ptc', 'complete: true']) {
      expect(section).not.toContain(omitted)
    }
    expect(section).toContain('name: 简洁模式')
    // run_code 双通道由嵌套行 run-code 提供；persona 必须 complete:false，
    // 否则 tools:sdk 的 SDK 声明会被完整 persona 过滤。
    expect(section).toContain('complete: false')
    expect(section).toContain(`name: '@dsh-kit/dsh-plugin-run-code'`)
  })

  it('drops deployment-level prompt sections through the nested prompt-filter row', () => {
    const section = presetSection(patch, 'concise')
    // dsh 部署级 section 名：persona 的 complete 开关关不掉，只能按名摘除；名单变化必须响亮失败。
    expect(section).toContain(`name: '@dsh-kit/dsh-plugin-prompt-filter'`)
    for (const dropped of [
      'harness:identity',
      'context:file-reference',
      'ui:deliverable-file-references',
      'harness:source',
      'app:web-surface',
    ]) {
      expect(section).toContain(`- '${dropped}'`)
    }
  })
})
