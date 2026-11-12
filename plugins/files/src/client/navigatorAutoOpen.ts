/**
 * 预览页签的目录树默认展开（DOM 级，2026-11-10 用户需求）。
 *
 * 原生 navigator 的显示状态默认 undefined（隐藏），且 Factory 是单定义注册、
 * 无法影子包装 `sidebar.files.navigator.toggle`，所以监听预览页签头部挂载的
 * 收起态开关按钮（`[data-files-navigator-toggle]`）代点一次展开。每个分栏在
 * 页面生命周期内只自动展开一次；之后用户的手动展开/收起即视为接管，不再代点。
 */

const TOGGLE_SELECTOR = '[data-files-navigator-toggle]'

/** 停靠分栏与浮动面板都带 pane id 的 data 属性。 */
function paneIdOf(element: Element): string | undefined {
  return element.closest<HTMLElement>('[data-dockkit-pane]')?.dataset.dockkitPane
    ?? element.closest<HTMLElement>('[data-dockkit-float]')?.dataset.dockkitFloat
}

export function installNavigatorAutoOpen(): () => void {
  const decided = new Set<string>()

  /** 分栏还没有树开关的决定时，代点一次收起态开关；此后交给用户。 */
  const consider = (button: Element): void => {
    if (button.getAttribute('aria-expanded') !== 'false') return
    const paneId = paneIdOf(button)
    if (paneId === undefined || decided.has(paneId)) return
    decided.add(paneId)
    ;(button as HTMLElement).click()
  }

  // 用户手动点开关（展开或收起）都算该分栏已有决定；自己代点的 click 也走这里。
  const onCaptureClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : undefined
    const button = target?.closest(TOGGLE_SELECTOR)
    if (button === null || button === undefined) return
    const paneId = paneIdOf(button)
    if (paneId !== undefined) decided.add(paneId)
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches(TOGGLE_SELECTOR)) consider(node)
        else node.querySelectorAll(TOGGLE_SELECTOR).forEach(consider)
      }
    }
  })

  document.querySelectorAll(TOGGLE_SELECTOR).forEach(consider)
  document.addEventListener('click', onCaptureClick, true)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    document.removeEventListener('click', onCaptureClick, true)
    decided.clear()
  }
}
