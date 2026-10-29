/**
 * 切屏停靠的判定与安装编排：纯窗口信号，测试逐项注入依赖。
 *
 * dsh 只在会话结束时「不在 mainView」才记完成未读（`SessionStatus.completionUnread`，
 * 上游注释原话 "observed stop outside the main view"；isMain 判定与面板页挡住时同样
 * 不记未读的事实见 docs/dsh/workspace.md）。停留在运行中的会话上切屏，回来永远没有
 * 绿点。本模块在窗口失焦或隐藏持续 `PARK_DELAY_MS` 后，若当前 main 会话仍在运行，
 * 调一次 park（官方 `uiWorkspace.startSession()`，把 mainView 交给当前工作区的
 * blank 会话）——与原生「新建会话」同一条路径，之后会话结束时正常记未读。
 *
 * 出发信号：window blur 与 document visibilitychange→hidden；回来信号：window focus
 * 与 visibilitychange→visible。alt-tab 只触发 blur，最小化两者都触发，两条都要听。
 * 到点复查仍离开且仍在运行：快速往返不动作，失焦后 delay 内会话恰好结束也不停靠。
 * 一次离开（到下一次回来）最多停靠一次——停靠后没有新的出发事件，不会反复切走。
 *
 * @module @dsh-kit/dsh-plugin-session-park/client/park
 */

/** 失焦持续该时长且会话仍在运行才停靠；快速 alt-tab 拿个东西不被打断。 */
export const PARK_DELAY_MS = 3000

/** {@link installSessionPark} 的全部外部依赖，测试逐项注入。 */
export interface SessionParkDeps {
  window: Window
  document: Document
  /** 当前 main 会话是否运行中；无 main 会话时为 false。 */
  isMainSessionRunning: () => boolean
  /** 停靠动作：把 mainView 让给当前工作区的 blank 会话（uiWorkspace.startSession()）。 */
  park: () => void
  /** 失焦到停靠的等待时长；测试注入以便手动推进。 */
  delayMs: number
  setTimeout: (handler: () => void, timeout: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/**
 * 安装切屏停靠监听。blur/hidden 预约、focus/visible 取消；到点时复查「仍离开且仍在
 * 运行」后才停靠。窗口重新可见但未聚焦（visibilitychange visible 而 blur 未收回，
 * 如焦点停在另一个应用但 dsh 窗口被带到前台）仍算离开，以真实焦点为准。
 * @param deps - 外部依赖。
 * @returns 卸载函数：清除待发定时器并移除全部监听。
 */
export function installSessionPark(deps: SessionParkDeps): () => void {
  const { window, document } = deps
  let timer: unknown = undefined

  const away = (): boolean =>
    document.visibilityState === 'hidden' || !document.hasFocus()

  const disarm = (): void => {
    if (timer === undefined) return
    deps.clearTimeout(timer)
    timer = undefined
  }

  const arm = (): void => {
    if (timer !== undefined) return
    timer = deps.setTimeout(() => {
      timer = undefined
      if (!away() || !deps.isMainSessionRunning()) return
      deps.park()
    }, deps.delayMs)
  }

  const onBlur = (): void => { arm() }
  const onFocus = (): void => { disarm() }
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') arm()
    else disarm()
  }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    disarm()
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
