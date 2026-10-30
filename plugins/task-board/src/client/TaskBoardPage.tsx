/**
 * 「任务看板」全局面板正文：`sidebar.panellist` 行经 `layout.selectPanel` 打开的
 * `main` keyed 页面。装载时读一次 Host 文档，其后全部本地乐观更新 + 防抖写回
 * （见 use-board-store）；看板交互本体在 {@link Board}。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/TaskBoardPage
 */

import { useCallback, useEffect, useState } from 'react'
import type { BoardCard, BoardDocument } from '../shared.js'
import { Board, type BoardDeps, type WorkspaceOption } from './Board.js'
import { useBoardStore } from './use-board-store.js'
import { installBoardStyles } from './styles.js'
import { fill, type TaskBoardKey } from './locales.js'

/** 页面注入的动作面（由 client/index 的 register inject 工厂提供）。 */
export interface TaskBoardActions {
  /** 读取看板；`seedLocale` 决定文件缺失时的初始列语言。 */
  onLoad: (seedLocale: 'zh' | 'en') => Promise<{ board: BoardDocument, seeded: boolean }>
  /** 整份写回。 */
  onSave: (board: BoardDocument) => Promise<void>
  /** 现取工作区清单。 */
  workspaces: () => readonly WorkspaceOption[]
  /** 复制文本到剪贴板；返回是否成功。 */
  copyText: (text: string) => Promise<boolean>
  /** 把任务文本发送到目标工作区的新对话；失败 reject。 */
  sendTask: (text: string, workspaceId: string | undefined) => Promise<void>
}

/** 页面 props：注入动作 + 文案 thunk（PropsLocale）。 */
export interface TaskBoardPageProps {
  onLoad: TaskBoardActions['onLoad']
  onSave: TaskBoardActions['onSave']
  workspaces: TaskBoardActions['workspaces']
  copyText: TaskBoardActions['copyText']
  sendTask: TaskBoardActions['sendTask']
  t?: (key: TaskBoardKey) => string
}

/**
 * 页面框架：标题、状态行与看板。
 * @param props - 注入动作与文案。
 */
export function TaskBoardPage(props: TaskBoardPageProps) {
  const translate = useCallback((key: TaskBoardKey): string => props.t?.(key) ?? key, [props.t])
  const [initial, setInitial] = useState<BoardDocument | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [sendError, setSendError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const dispose = installBoardStyles()
    return dispose
  }, [])

  useEffect(() => {
    let alive = true
    // 界面语言决定初始三列的播种语言；Host 只在文件不存在时才用它。
    const seedLocale = document.documentElement.lang.startsWith('en') ? 'en' : 'zh'
    void (async () => {
      try {
        const result = await props.onLoad(seedLocale)
        if (alive) setInitial(result.board)
      } catch (error: unknown) {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { alive = false }
  }, [props.onLoad])

  const save = useCallback((board: BoardDocument) => props.onSave(board).then(undefined), [props.onSave])

  const sendCard = useCallback(async (card: BoardCard) => {
    setSendError(undefined)
    try {
      await props.sendTask(card.text, card.workspaceId)
    } catch (error: unknown) {
      setSendError(fill(translate('sendFailed'), { message: error instanceof Error ? error.message : String(error) }))
    }
  }, [props.sendTask, translate])

  if (initial === undefined) {
    return (
      <section className="dsh-task-board-page" data-dsh-task-board-page="" aria-label={translate('title')}>
        <header className="dsh-task-board-heading">
          <h1 className="dsh-task-board-title">{translate('title')}</h1>
        </header>
        <p className="dsh-task-board-status">
          {loadError === undefined ? translate('loading') : fill(translate('loadFailed'), { message: loadError })}
        </p>
      </section>
    )
  }

  return <TaskBoardLoaded initial={initial} save={save} translate={translate} workspaces={props.workspaces} copyText={props.copyText} sendCard={sendCard} sendError={sendError} />
}

/** 已装载文档后的正文；独立一层让 useBoardStore 的 initial 引用保持稳定。 */
function TaskBoardLoaded({ initial, save, translate, workspaces, copyText, sendCard, sendError }: {
  initial: BoardDocument
  save: (board: BoardDocument) => Promise<void>
  translate: (key: TaskBoardKey) => string
  workspaces: () => readonly WorkspaceOption[]
  copyText: (text: string) => Promise<boolean>
  sendCard: (card: BoardCard) => Promise<void>
  sendError: string | undefined
}) {
  const { board, saveState, saveError, update } = useBoardStore(initial, save)
  const deps: BoardDeps = { translate, workspaces, copyText, sendCard }
  const statusText = sendError !== undefined
    ? sendError
    : saveState === 'error'
      ? fill(translate('saveFailed'), { message: saveError ?? '' })
      : saveState === 'pending' || saveState === 'saving'
        ? translate('savedLocally')
        : ''
  return (
    <section className="dsh-task-board-page" data-dsh-task-board-page="" aria-label={translate('title')}>
      <header className="dsh-task-board-heading">
        <h1 className="dsh-task-board-title">{translate('title')}</h1>
        <p className="dsh-task-board-hint">{translate('hint')}</p>
      </header>
      {/* 常驻占位（高度固定）：提示出现/消失只换文字，不挤压下方卡片列。 */}
      <p
        className={`dsh-task-board-status${saveState === 'error' || sendError !== undefined ? ' dsh-task-board-statusError' : ''}`}
        aria-live="polite"
      >
        {statusText}
      </p>
      <div className="dsh-task-board-board">
        <div className="dsh-task-board-columns">
          <Board board={board} onChange={update} deps={deps} />
        </div>
      </div>
    </section>
  )
}
