// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Modal: ({ title, footer, children, onClose, closeLabel }: {
    title: string
    footer?: ReactNode
    children?: ReactNode
    onClose: () => void
    closeLabel: string
  }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button type="button" aria-label={closeLabel} onClick={onClose}>×</button>
      {children}
      <div>{footer}</div>
    </div>
  ),
}))

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRenameDialogProps } from '../src/client/SessionRenameDialog.js'
import { SessionRenameDialog } from '../src/client/SessionRenameDialog.js'
import { en } from '../src/client/locales.js'
import type { SessionRenameRequest } from '../src/client/rename.js'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]
const SESSION = 'sess-1' as SessionId

/** 与渲染层同一订阅语义的请求 hook：store 变化驱动重渲染。 */
function useRequest(store: ReturnType<typeof createSnapshotStore<SessionRenameRequest | null>>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

function Harness({ store, settle, rename }: {
  store: ReturnType<typeof createSnapshotStore<SessionRenameRequest | null>>
  settle: SessionRenameDialogProps['settleSessionRename']
  rename: SessionRenameDialogProps['renameSession']
}) {
  const request = useRequest(store)
  const props = {
    useRenameRequest: (select: (value: SessionRenameRequest | null) => SessionRenameRequest | null) => select(request),
    settleSessionRename: settle,
    renameSession: rename,
    t,
  } as unknown as SessionRenameDialogProps
  return <SessionRenameDialog {...props} />
}

function setup(request: SessionRenameRequest | null, rename?: SessionRenameDialogProps['renameSession']) {
  const store = createSnapshotStore<SessionRenameRequest | null>(request)
  const settle = vi.fn()
  const renameSession = rename ?? vi.fn(async () => {})
  render(<Harness store={store} settle={settle} rename={renameSession} />)
  return { store, settle, renameSession }
}

describe('SessionRenameDialog', () => {
  it('无请求时不渲染', () => {
    setup(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('草稿按请求播种，聚焦全选，确认键初始可用', () => {
    setup({ sessionId: SESSION, currentTitle: '旧标题' })
    const input = screen.getByLabelText('Session name') as HTMLInputElement
    expect(input.value).toBe('旧标题')
    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('旧标题'.length)
    expect((screen.getByText('Rename') as HTMLButtonElement).disabled).toBe(false)
  })

  it('空白或纯空白草稿禁用确认键', () => {
    setup({ sessionId: SESSION, currentTitle: '' })
    const rename = screen.getByText('Rename') as HTMLButtonElement
    expect(rename.disabled).toBe(true)
    const input = screen.getByLabelText('Session name')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(rename.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '新标题' } })
    expect(rename.disabled).toBe(false)
  })

  it('回车提交 trim 后的标题并关闭弹窗', async () => {
    const { store, renameSession, settle } = setup({ sessionId: SESSION, currentTitle: '旧标题' })
    const input = screen.getByLabelText('Session name')
    fireEvent.change(input, { target: { value: '  新标题  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(settle).toHaveBeenCalledTimes(1))
    expect(renameSession).toHaveBeenCalledWith(SESSION, '新标题')
    store.set(null)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('IME 组合中的 Enter 不提交', () => {
    const { renameSession } = setup({ sessionId: SESSION, currentTitle: '旧标题' })
    const input = screen.getByLabelText('Session name')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameSession).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameSession).toHaveBeenCalled()
  })

  it('失败时错误就地显示且弹窗保留，继续输入清除错误', async () => {
    const { settle } = setup(
      { sessionId: SESSION, currentTitle: '旧标题' },
      vi.fn(async () => { throw new Error('session title must contain visible characters') }),
    )
    const input = screen.getByLabelText('Session name')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'session title must contain visible characters')
    expect(settle).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.change(input, { target: { value: '改一下' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('取消直接关闭且不调用重命名', () => {
    const { settle, renameSession } = setup({ sessionId: SESSION, currentTitle: '旧标题' })
    fireEvent.click(screen.getByText('Cancel'))
    expect(settle).toHaveBeenCalledTimes(1)
    expect(renameSession).not.toHaveBeenCalled()
  })

  it('提交中取消与确认均禁用', async () => {
    let release: (() => void) | undefined
    const rename = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }) })
    setup({ sessionId: SESSION, currentTitle: '旧标题' }, rename as SessionRenameDialogProps['renameSession'])
    const input = screen.getByLabelText('Session name')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Rename')).toBeDefined()
    expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Rename') as HTMLButtonElement).disabled).toBe(true)
    release?.()
  })
})
