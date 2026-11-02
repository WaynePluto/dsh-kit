// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MenuSurface: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div ref={ref} {...props} />
  )),
  IconEditOutlineMedium: () => null,
  IconTrashOutlineMedium: () => null,
}))

import { QuickCommandsPanel } from '../src/client/panel.js'
import { en } from '../src/client/locales.js'
import type { QuickCommandDocument } from '../src/shared.js'

const t = (key: keyof typeof en): string => en[key]

function doc(commands: Array<{ id: string, text: string }>): QuickCommandDocument {
  const now = '2026-11-02T00:00:00.000Z'
  return {
    version: 1,
    commands: commands.map(item => ({ id: item.id, text: item.text, createdAt: now, updatedAt: now })),
  }
}

interface Fixture {
  load: ReturnType<typeof vi.fn<() => Promise<QuickCommandDocument>>>
  save: ReturnType<typeof vi.fn<(document: QuickCommandDocument) => Promise<void>>>
  insert: ReturnType<typeof vi.fn<(text: string) => boolean>>
  onClose: ReturnType<typeof vi.fn<() => void>>
  anchor: HTMLElement
}

/** composer 卡片内放一个锚点按钮（place() 与外点关闭的例外区域都依赖它）。 */
function setup(initial: QuickCommandDocument, options: { insertOk?: boolean, loadError?: boolean } = {}): Fixture {
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-card', '')
  const anchor = document.createElement('button')
  composer.appendChild(anchor)
  document.body.appendChild(composer)

  const load = options.loadError === true
    ? vi.fn(async () => { throw new Error('host down') })
    : vi.fn(async () => initial)
  const save = vi.fn(async (_document: QuickCommandDocument) => {})
  const insert = vi.fn(() => options.insertOk !== false)
  const onClose = vi.fn()
  render(
    <QuickCommandsPanel
      load={load}
      save={save}
      insert={insert}
      t={t}
      anchorRef={{ current: anchor }}
      onClose={onClose}
    />,
  )
  return { load, save, insert, onClose, anchor }
}

afterEach(() => {
  cleanup()
  document.body.querySelector('[data-composer-card]')?.remove()
})

describe('QuickCommandsPanel', () => {
  it('装载后渲染指令行，点击指令插入并关闭', async () => {
    const fixture = setup(doc([{ id: 'a', text: '总结这段代码' }, { id: 'b', text: '跑测试' }]))
    await waitFor(() => expect(screen.getByText('总结这段代码')).toBeDefined())
    fireEvent.click(screen.getByText('总结这段代码'))
    expect(fixture.insert).toHaveBeenCalledWith('总结这段代码')
    expect(fixture.onClose).toHaveBeenCalledTimes(1)
  })

  it('插入失败面板不关闭', async () => {
    const fixture = setup(doc([{ id: 'a', text: '总结' }]), { insertOk: false })
    await waitFor(() => expect(screen.getByText('总结')).toBeDefined())
    fireEvent.click(screen.getByText('总结'))
    expect(fixture.insert).toHaveBeenCalledTimes(1)
    expect(fixture.onClose).not.toHaveBeenCalled()
  })

  it('新增：输入回车写回并清空输入框', async () => {
    const fixture = setup(doc([]))
    await waitFor(() => expect(screen.getByText('No quick commands yet — add one below.')).toBeDefined())
    const input = screen.getByPlaceholderText('Add a quick command…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  新指令  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1))
    const saved = fixture.save.mock.calls[0]?.[0]
    expect(saved?.commands.map(command => command.text)).toEqual(['新指令'])
    expect((screen.getByPlaceholderText('Add a quick command…') as HTMLInputElement).value).toBe('')
  })

  it('新增空文本（纯空白）不写回', async () => {
    const fixture = setup(doc([{ id: 'a', text: '已有' }]))
    await waitFor(() => expect(screen.getByText('已有')).toBeDefined())
    const input = screen.getByPlaceholderText('Add a quick command…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(fixture.save).not.toHaveBeenCalled()
  })

  it('编辑：铅笔打开行内输入框，回车提交修改', async () => {
    const fixture = setup(doc([{ id: 'a', text: '旧文本' }]))
    await waitFor(() => expect(screen.getByText('旧文本')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }))
    const editor = screen.getByPlaceholderText('Edit command') as HTMLInputElement
    expect(editor.value).toBe('旧文本')
    fireEvent.change(editor, { target: { value: '新文本' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1))
    expect(fixture.save.mock.calls[0]?.[0]?.commands[0]?.text).toBe('新文本')
    expect(screen.getByText('新文本')).toBeDefined()
  })

  it('编辑 Escape 取消不写回', async () => {
    const fixture = setup(doc([{ id: 'a', text: '保持' }]))
    await waitFor(() => expect(screen.getByText('保持')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }))
    const editor = screen.getByPlaceholderText('Edit command') as HTMLInputElement
    fireEvent.change(editor, { target: { value: '草稿' } })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(fixture.save).not.toHaveBeenCalled()
    expect(screen.getByText('保持')).toBeDefined()
  })

  it('删除立即写回', async () => {
    const fixture = setup(doc([{ id: 'a', text: '删我' }, { id: 'b', text: '留下' }]))
    await waitFor(() => expect(screen.getByText('删我')).toBeDefined())
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete command' })[0]!)
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1))
    expect(fixture.save.mock.calls[0]?.[0]?.commands.map(command => command.id)).toEqual(['b'])
  })

  it('Escape 关闭面板', async () => {
    const fixture = setup(doc([{ id: 'a', text: '行' }]))
    await waitFor(() => expect(screen.getByText('行')).toBeDefined())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(fixture.onClose).toHaveBeenCalledTimes(1)
  })

  it('点弹窗外任何位置都关闭：输入框本体与会话区关闭，触发按钮不重复关（toggle 自管）', async () => {
    const fixture = setup(doc([{ id: 'a', text: '行' }]))
    await waitFor(() => expect(screen.getByText('行')).toBeDefined())
    // 触发按钮豁免：mousedown 不关（开关由按钮自身 onClick 切换）。
    fireEvent.mouseDown(fixture.anchor, { bubbles: true })
    expect(fixture.onClose).not.toHaveBeenCalled()
    // composer 卡片内的输入框本体：关闭。
    const composer = fixture.anchor.closest('[data-composer-card]')!
    const inputArea = document.createElement('div')
    composer.appendChild(inputArea)
    fireEvent.mouseDown(inputArea, { bubbles: true })
    expect(fixture.onClose).toHaveBeenCalledTimes(1)
    // 会话区（composer 卡片外）：关闭。
    fireEvent.mouseDown(document.body, { bubbles: true })
    expect(fixture.onClose).toHaveBeenCalledTimes(2)
    inputArea.remove()
  })

  it('装载失败亮错误并可重试', async () => {
    const fixture = setup(doc([]), { loadError: true })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('host down')
    expect(fixture.load).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Retry'))
    expect(fixture.load).toHaveBeenCalledTimes(2)
  })

  it('达到条数上限后新增被拒并在占位符提示', async () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ id: `c${String(index)}`, text: `指令 ${String(index)}` }))
    const fixture = setup(doc(many))
    await waitFor(() => expect(screen.getByText('指令 0')).toBeDefined())
    const input = screen.getByPlaceholderText('Add a quick command…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '超限' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(fixture.save).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Add a quick command…' }) as HTMLInputElement).placeholder)
        .toBe('Up to 100 commands.'))
  })
})
