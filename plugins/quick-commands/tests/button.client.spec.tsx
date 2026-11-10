// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MenuSurface: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div ref={ref} {...props} />
  )),
  IconListPenOutlineMedium: () => null,
  IconWarningOutlineMedium: () => null,
  IconEditOutlineMedium: () => null,
  IconTrashOutlineMedium: () => null,
  Toast: () => null,
}))

import { QuickCommandsEntry } from '../src/client/button.js'
import type { QuickCommandsEntryProps } from '../src/client/button.js'
import { en } from '../src/client/locales.js'
import type { QuickCommandDocument } from '../src/shared.js'

const t = (key: keyof typeof en): string => en[key]

const NOW = '2026-11-02T00:00:00.000Z'
const DOC: QuickCommandDocument = {
  version: 1,
  commands: [{ id: 'a', text: '总结这段代码', createdAt: NOW, updatedAt: NOW }],
}

interface Fixture {
  insertText: ReturnType<typeof vi.fn<(text: string, span: unknown) => boolean>>
  focusInput: ReturnType<typeof vi.fn<() => void>>
}

/** 渲染槽位入口：inputActions 是编辑器插入面，focusInput 是回焦面。 */
function setup(options: { insertOk?: boolean } = {}): Fixture {
  const insertText = vi.fn((_text: string, _span: unknown) => options.insertOk !== false)
  const focusInput = vi.fn()
  const props = {
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
      insertText,
    },
    load: async () => DOC,
    save: async () => {},
    focusInput,
    t,
  } as unknown as QuickCommandsEntryProps
  render(<QuickCommandsEntry {...props} />)
  return { insertText, focusInput }
}

afterEach(cleanup)

describe('QuickCommandsEntry', () => {
  it('点选指令：插入后把键盘交回输入框，光标停在插入文本之后', async () => {
    const fixture = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Quick commands' }))
    await waitFor(() => expect(screen.getByText('总结这段代码')).toBeDefined())
    fireEvent.click(screen.getByText('总结这段代码'))
    expect(fixture.insertText).toHaveBeenCalledWith('总结这段代码', expect.anything())
    expect(fixture.focusInput).toHaveBeenCalledTimes(1)
    // 先插入后回焦：回焦依赖编辑器已把选区移到插入文本末尾
    expect(fixture.focusInput.mock.invocationCallOrder[0])
      .toBeGreaterThan(fixture.insertText.mock.invocationCallOrder[0] ?? 0)
    // 成功后关面板，键盘留在输入框里
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('插入失败不回焦：面板留在原地', async () => {
    const fixture = setup({ insertOk: false })
    fireEvent.click(screen.getByRole('button', { name: 'Quick commands' }))
    await waitFor(() => expect(screen.getByText('总结这段代码')).toBeDefined())
    fireEvent.click(screen.getByText('总结这段代码'))
    expect(fixture.focusInput).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeDefined()
  })
})
