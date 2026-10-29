/**
 * 看板页面的本地状态与防抖持久化。
 * 所有改动先落在本地（乐观更新，拖拽动画不被 RPC 往返打断），再以 400ms 防抖整份写回；
 * 写失败保留本地状态并亮出错误文案（用户手上的操作不回滚），下一次改动重试。
 * 面板随时可能被切走卸载，卸载时把尚未落盘的最新文档直接 fire-and-forget 写回。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/use-board-store
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardDocument } from '../shared.js'

/** 防抖窗口（ms）：拖拽 onDragOver 会高频触发，写盘必须合并。 */
const SAVE_DEBOUNCE_MS = 400

/** 保存进度。 */
export type BoardSaveState = 'idle' | 'pending' | 'saving' | 'error'

/**
 * @param initial - Host `get` 返回的初始文档。
 * @param save - 整份写回的 RPC 调用。
 * @returns 文档、进度与更新入口。
 */
export function useBoardStore(
  initial: BoardDocument,
  save: (board: BoardDocument) => Promise<void>,
): {
  board: BoardDocument
  saveState: BoardSaveState
  saveError: string | undefined
  update: (next: BoardDocument) => void
} {
  const [board, setBoard] = useState<BoardDocument>(initial)
  const [saveState, setSaveState] = useState<BoardSaveState>('idle')
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const boardRef = useRef(initial)
  const timerRef = useRef<number | undefined>(undefined)
  const saveRef = useRef(save)
  saveRef.current = save
  const seqRef = useRef(0)

  const persist = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    const snapshot = boardRef.current
    const seq = seqRef.current + 1
    seqRef.current = seq
    setSaveState('saving')
    void (async () => {
      try {
        await saveRef.current(snapshot)
        // 过期的成功不清除更新的错误/进行中状态。
        if (seqRef.current === seq) {
          setSaveState('idle')
          setSaveError(undefined)
        }
      } catch (error: unknown) {
        if (seqRef.current === seq) {
          setSaveState('error')
          setSaveError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }, [])

  const update = useCallback((next: BoardDocument) => {
    boardRef.current = next
    setBoard(next)
    setSaveState(previous => previous === 'error' ? 'error' : 'pending')
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { persist() }, SAVE_DEBOUNCE_MS)
  }, [persist])

  // 卸载兜底：防抖窗口未到就要卸载时，直接写最新文档（fetch 不随组件卸载中止）。
  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    if (boardRef.current !== initial) void saveRef.current(boardRef.current).then(undefined, () => {})
  }, [initial])

  return { board, saveState, saveError, update }
}
