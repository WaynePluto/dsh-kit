// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { MenuAction } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { installContextMenuContributions } from './contextMenuContributions.js'

const writeText = vi.fn(async () => undefined)

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  writeText.mockClear()
  vi.restoreAllMocks()
})

interface Registration {
  readonly id: string
  readonly target: string
  readonly resolve: (target: { sessionId: string; path: string }, signal: AbortSignal) => MenuAction[] | Promise<MenuAction[]>
}

interface CtxFake {
  readonly registrations: Registration[]
  readonly sessions: { list: { getSnapshot: () => { byId: Record<string, { cwd: string | undefined }> } } }
  readonly contextMenus: {
    register: (input: Registration) => () => void
    notify: ReturnType<typeof vi.fn>
  }
}

function ctxWith(cwd: string | undefined): CtxFake & { unregister: string[] } {
  const registrations: Registration[] = []
  const unregister: string[] = []
  const ctx = {
    registrations,
    unregister,
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd } } }) } },
    contextMenus: {
      register: vi.fn((input: Registration) => {
        registrations.push(input)
        unregister.push(input.id)
        return () => { unregister.splice(unregister.indexOf(input.id), 1) }
      }),
      notify: vi.fn(),
    },
  }
  return ctx as unknown as CtxFake & { unregister: string[] }
}

async function resolveOf(ctx: CtxFake, target: 'file' | 'directory', path: string): Promise<MenuAction[]> {
  const registration = ctx.registrations.find(entry => entry.target === target)
  if (registration === undefined) throw new Error(`missing ${target} contribution`)
  return await registration.resolve({ sessionId: 's1', path }, new AbortController().signal)
}

describe('installContextMenuContributions', () => {
  it('注册文件与目录两个目标族', () => {
    const ctx = ctxWith('C:\\work')
    const dispose = installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    expect(ctx.contextMenus.register).toHaveBeenCalledTimes(2)
    expect(ctx.registrations.map(entry => entry.id).toSorted())
      .toEqual(['dsh-kit-files.directory', 'dsh-kit-files.file'])
    dispose()
    expect(ctx.unregister).toEqual([])
  })

  it('文件行补充查看 Git 变更（带分隔线）与复制完整/相对路径', async () => {
    const ctx = ctxWith('C:\\work')
    installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    const items = await resolveOf(ctx, 'file', 'C:\\work/src\\a.md')
    expect(items.map(item => item.id)).toEqual(['git-review', 'copy-absolute-path', 'copy-relative-path'])
    expect(items[0]?.separatorBefore).toBe(true)
    expect(items[0]?.label).toBe('gitReviewMenu')
    expect(items[1]?.label).toBe('copyAbsolutePath')
    expect(items[2]?.label).toBe('copyRelativePath')
    expect(items[2]?.failureLabel).toBe('copyFailed')
  })

  it('复制完整路径用根的分隔符归一拼接，不混用斜杠', async () => {
    const ctx = ctxWith('C:\\work')
    const notify = ctx.contextMenus.notify
    installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    // 目标路径本身混用分隔符（官方目录菜单的拼接产物形态）
    const items = await resolveOf(ctx, 'directory', 'C:\\work/plugins/suite')
    await items[0]?.run?.()
    expect(writeText).toHaveBeenCalledWith('C:\\work\\plugins\\suite')
    expect(notify).toHaveBeenCalledWith('copied', true)
  })

  it('复制相对路径写入剪贴板并给出原生反馈', async () => {
    const ctx = ctxWith('C:\\work')
    const notify = ctx.contextMenus.notify
    installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    const items = await resolveOf(ctx, 'file', 'C:\\work/src/a.md')
    await items[2]?.run?.()
    expect(writeText).toHaveBeenCalledWith('src/a.md')
    expect(notify).toHaveBeenCalledWith('copied', true)
  })

  it('查看 Git 变更携带会话与相对路径', async () => {
    const ctx = ctxWith('C:\\work')
    const openGitReview = vi.fn()
    installContextMenuContributions(ctx as unknown as Context, { openGitReview, t: key => key })
    const items = await resolveOf(ctx, 'file', 'C:\\work/src/a.md')
    items[0]?.run?.()
    expect(openGitReview).toHaveBeenCalledWith('s1', 'src/a.md')
  })

  it('目录行补充复制完整/相对路径；根行只给完整路径', async () => {
    const ctx = ctxWith('C:\\work')
    installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    expect((await resolveOf(ctx, 'directory', 'C:\\work/src')).map(item => item.id))
      .toEqual(['copy-absolute-path', 'copy-relative-path'])
    const root = await resolveOf(ctx, 'directory', 'C:\\work')
    expect(root.map(item => item.id)).toEqual(['copy-absolute-path'])
    expect(root[0]?.separatorBefore).toBe(true)
    expect((await resolveOf(ctx, 'directory', 'C:\\other\\outside'))).toEqual([])
  })

  it('会话无工作区或路径越出根时放弃条目', async () => {
    const ctx = ctxWith(undefined)
    installContextMenuContributions(ctx as unknown as Context, { openGitReview: vi.fn(), t: key => key })
    expect(await resolveOf(ctx, 'file', 'C:\\work/src/a.md')).toEqual([])
  })
})
