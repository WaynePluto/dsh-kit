import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { ensureDevelopmentRuntime } from './dev-runtime.mjs'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'station-runtime-'))
  temporary.push(parent)
  const root = join(parent, 'repo')
  write(join(root, 'package.json'), JSON.stringify({ pnpm: { overrides: { example: '1.0.0' } } }))
  write(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  write(join(root, 'pnpm-lock.yaml'), 'overrides:\n  example: 1.0.0\n')
  const run = vi.fn(async (args: string[]) => {
    const target = args.at(-1)!
    for (const path of ['@deepseek-ai/dsh/lib/bin.js', '@deepseek-ai/dsh/package.json', 'pnpm/bin/pnpm.cjs']) {
      write(join(target, 'node_modules', path), '{}')
    }
  })
  return { root, run, log: vi.fn(), parseYaml: vi.fn(parse) }
}

describe('development runtime validated content cache', () => {
  it('imports without filesystem writes or preparing a runtime', () => {
    const child = spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', '--input-type=module', '-e',
      `await import(${JSON.stringify(new URL('./dev-runtime.mjs', import.meta.url).href)})`,
    ], { encoding: 'utf8', windowsHide: true })
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe('')
  })

  it('skips only YAML parsing after successful validation and preserves runtime layout', async () => {
    const f = fixture()
    const first = await ensureDevelopmentRuntime(f)
    expect(await ensureDevelopmentRuntime(f)).toEqual(first)
    expect(f.parseYaml).toHaveBeenCalledTimes(2)
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(first.runtime.startsWith(join(dirname(f.root), '.repo-runtime'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(first.runtime, 'package.json'), 'utf8'))
    // 依赖清单已内联到 dev-runtime.mjs（launcher 退役）：校验关键家族成员存在。
    expect(manifest.dependencies['@deepseek-ai/dsh']).toBe('0.2.0-rc.2')
    expect(manifest.dependencies['@earendil-works/pi-ai']).toBe('0.87.1')
    expect(manifest.dependencies['@dsh-kit/plugin-ui']).toContain('file:')
    expect(Object.keys(manifest.dependencies).every(name => !name.startsWith('@dsh-kit/') || name === '@dsh-kit/plugin-ui')).toBe(true)
    expect(f.run.mock.calls[0]?.[0]).toContain('--ignore-scripts')
    expect(f.run.mock.calls[0]?.[0]).toContain('--config.node-linker=hoisted')
  })

  it('rejects lockfile drift even when size and timestamp stay identical; retries until repaired', async () => {
    const f = fixture()
    await ensureDevelopmentRuntime(f)
    const path = join(f.root, 'pnpm-lock.yaml')
    const before = statSync(path)
    write(path, 'overrides:\n  example: 2.0.0\n')
    utimesSync(path, before.atime, before.mtime)
    await expect(ensureDevelopmentRuntime(f)).rejects.toThrow('不一致')
    await expect(ensureDevelopmentRuntime(f)).rejects.toThrow('不一致')
    expect(f.parseYaml).toHaveBeenCalledTimes(6)
    expect(f.run).toHaveBeenCalledTimes(1)
    write(path, 'overrides:\n  example: 1.0.0\n')
    await ensureDevelopmentRuntime(f)
    expect(f.parseYaml).toHaveBeenCalledTimes(6)
  })

  it('hashes raw bytes even when invalid UTF-8 decodes to the same comment', async () => {
    const f = fixture()
    const path = join(f.root, 'pnpm-lock.yaml')
    const prefix = Buffer.from('overrides:\n  example: 1.0.0\n# ')
    writeFileSync(path, Buffer.concat([prefix, Buffer.from([0x80])]))
    await ensureDevelopmentRuntime(f)
    const decoded = readFileSync(path, 'utf8')
    writeFileSync(path, Buffer.concat([prefix, Buffer.from([0x81])]))
    expect(readFileSync(path, 'utf8')).toBe(decoded)
    await ensureDevelopmentRuntime(f)
    expect(f.parseYaml).toHaveBeenCalledTimes(4)
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it.each(['workspace', 'manifest', 'syntax'])('revalidates and rejects changed %s before install', async kind => {
    const f = fixture()
    await ensureDevelopmentRuntime(f)
    if (kind === 'workspace') write(join(f.root, 'pnpm-workspace.yaml'), 'overrides: {}\n')
    else if (kind === 'manifest') write(join(f.root, 'package.json'), '{"pnpm":{"overrides":{"example":"2.0.0"}}}')
    else write(join(f.root, 'pnpm-lock.yaml'), 'overrides: [\n')
    await expect(ensureDevelopmentRuntime(f)).rejects.toThrow()
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'invalid', 'schema'])('revalidates a %s cache', async kind => {
    const f = fixture()
    await ensureDevelopmentRuntime(f)
    const path = join(f.root, 'node_modules/.cache/dsh-kit/dev-runtime-validation.json')
    if (kind === 'missing') rmSync(path)
    else if (kind === 'invalid') write(path, '{')
    else write(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), schemaVersion: 0 }))
    await ensureDevelopmentRuntime(f)
    expect(f.parseYaml).toHaveBeenCalledTimes(4)
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when the injected runtime dependency list changes', async () => {
    const f = fixture()
    const before = await ensureDevelopmentRuntime(f)
    const after = await ensureDevelopmentRuntime({ ...f, runtimeDependencies: { '@deepseek-ai/dsh': '0.2.0', pnpm: '10.17.0' } })
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(f.run).toHaveBeenCalledTimes(2)
  })

  it('installs the pinned dsh runtime from the inlined dependency list', async () => {
    const f = fixture()
    const descriptor = await ensureDevelopmentRuntime(f)
    const manifest = JSON.parse(readFileSync(join(descriptor.runtime, 'package.json'), 'utf8'))
    expect(manifest.dependencies['@deepseek-ai/dsh']).toBe('0.2.0-rc.2')
    expect(manifest.dependencies['@earendil-works/pi-ai']).toBe('0.87.1')
  })

  it('does not publish a failed install and retries it without reparsing unchanged valid inputs', async () => {
    const f = fixture()
    f.run.mockRejectedValueOnce(new Error('install failed'))
    await expect(ensureDevelopmentRuntime(f)).rejects.toThrow('install failed')
    const descriptor = await ensureDevelopmentRuntime(f)
    expect(JSON.parse(readFileSync(join(f.root, '.dev/runtime.json'), 'utf8'))).toEqual(descriptor)
    expect(f.run).toHaveBeenCalledTimes(2)
    expect(f.parseYaml).toHaveBeenCalledTimes(2)
  })
})
