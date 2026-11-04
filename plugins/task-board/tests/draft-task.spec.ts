import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { draftTaskToWorkspace, type ConversationAttachmentFace, type DraftTaskDeps } from '../src/client/draft-task.js'
import type { BoardCardImage } from '../src/shared.js'

const s1 = 's1' as SessionId
const s2 = 's2' as SessionId

/** 1×1 PNG，用于验证 data URL → File 还原。 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

function image(over: Partial<BoardCardImage> = {}): BoardCardImage {
  return { id: 'img-1', name: 'shot.png', mediaType: 'image/png', dataUrl: PNG, ...over }
}

function deps(over: Partial<{
  create: DraftTaskDeps['sessions']['create']
  scope: DraftTaskDeps['sessions']['scope']
  openSession: DraftTaskDeps['uiWorkspace']['openSession']
  attachments: ConversationAttachmentFace | undefined
}> = {}): DraftTaskDeps {
  return {
    sessions: {
      create: over.create ?? (async () => s1),
      scope: over.scope ?? (() => ({
        get: () => ({
          input: {
            for: () => ({
              setDraft: vi.fn(),
              addAttachments: vi.fn(() => true),
            }),
          },
        }),
      })),
    },
    uiWorkspace: {
      openSession: over.openSession ?? vi.fn(),
    },
    ...over.attachments !== undefined ? { attachments: over.attachments } : {},
  }
}

describe('draftTaskToWorkspace', () => {
  it('默认落点：create 不带 workspaceId，openSession 后 setDraft、不发送、不加入附件', async () => {
    const create = vi.fn(async () => s1)
    const openSession = vi.fn()
    const setDraft = vi.fn()
    const addAttachments = vi.fn(() => true)
    const sessionId = await draftTaskToWorkspace(
      deps({ create, openSession, scope: () => ({
        get: () => ({ input: { for: () => ({ setDraft, addAttachments }) } }),
      }) }),
      { text: 'fix the bug' },
    )
    expect(sessionId).toBe(s1)
    expect(create).toHaveBeenCalledWith({})
    expect(openSession).toHaveBeenCalledWith(s1)
    expect(setDraft).toHaveBeenCalledWith('fix the bug')
    expect(addAttachments).not.toHaveBeenCalled()
  })

  it('指定工作区：create 带 workspaceId', async () => {
    const create = vi.fn(async () => s2)
    await draftTaskToWorkspace(deps({ create }), { text: 'task', workspaceId: 'w-42' })
    expect(create).toHaveBeenCalledWith({ workspaceId: 'w-42' })
  })

  it('卡片标题不进入请求，也不进入草稿', async () => {
    const setDraft = vi.fn()
    await draftTaskToWorkspace(
      deps({ scope: () => ({ get: () => ({ input: { for: () => ({ setDraft, addAttachments: vi.fn(() => true) }) } }) }) }),
      { text: '正文', images: [] },
    )
    expect(setDraft).toHaveBeenCalledWith('正文')
  })

  it('图片按官方附件契约加入草稿：createDrafts → addAttachments，不发送', async () => {
    const createDrafts = vi.fn((_sessionId: SessionId, files: readonly File[]) => {
      expect(files).toHaveLength(2)
      expect(files[0]?.type).toBe('image/png')
      expect(files[0]?.name).toBe('shot.png')
      expect(files[1]?.name).toBe('other.webp')
      return [{ id: 'draft-1' }, { id: 'draft-2' }]
    })
    const releaseDraftAttachments = vi.fn()
    const setDraft = vi.fn()
    const addAttachments = vi.fn(() => true)
    const images = [image(), image({ id: 'img-2', name: 'other.webp', mediaType: 'image/webp', dataUrl: 'data:image/webp;base64,AAAA' })]
    await draftTaskToWorkspace(
      deps({
        attachments: { createDrafts, releaseDraftAttachments },
        scope: () => ({ get: () => ({ input: { for: () => ({ setDraft, addAttachments }) } }) }),
      }),
      { text: '看这两张图', images },
    )
    expect(createDrafts).toHaveBeenCalledWith(s1, expect.any(Array))
    expect(setDraft).toHaveBeenCalledWith('看这两张图')
    expect(addAttachments).toHaveBeenCalledWith(['draft-1', 'draft-2'])
    expect(releaseDraftAttachments).not.toHaveBeenCalled()
  })

  it('addAttachments 被拒绝时释放草稿附件并抛错', async () => {
    const releaseDraftAttachments = vi.fn()
    const attachments = { createDrafts: () => [{ id: 'draft-1' }], releaseDraftAttachments }
    const bad = deps({
      attachments,
      scope: () => ({ get: () => ({ input: { for: () => ({ setDraft: vi.fn(), addAttachments: () => false }) } }) }),
    })
    await expect(draftTaskToWorkspace(bad, { text: 'task', images: [image()] }))
      .rejects.toThrow('refused image attachments')
    expect(releaseDraftAttachments).toHaveBeenCalledWith([{ id: 'draft-1' }])
  })

  it('有图片但附件服务不可用时拒绝回填（不静默丢图）', async () => {
    await expect(draftTaskToWorkspace(deps(), { text: 'task', images: [image()] }))
      .rejects.toThrow('attachment service is unavailable')
  })

  it('空文本直接拒绝', async () => {
    await expect(draftTaskToWorkspace(deps(), { text: '   ' })).rejects.toThrow('task text is empty')
  })

  it('conversation scope 缺失时抛错', async () => {
    const missing = deps({ scope: () => undefined })
    await expect(draftTaskToWorkspace(missing, { text: 'task' })).rejects.toThrow('no conversation scope')
  })

  it('create 失败原样上抛（页面转为错误文案）', async () => {
    const failing = deps({ create: async () => { throw new Error('workspace not connectable') } })
    await expect(draftTaskToWorkspace(failing, { text: 'task', workspaceId: 'w-1' })).rejects.toThrow('workspace not connectable')
  })
})
