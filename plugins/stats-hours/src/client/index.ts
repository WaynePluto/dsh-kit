/** browser half：常驻观察 dsh 会话统计弹窗，把 ≥1 小时的两档时长改写为三档显示。 */

import type { Context } from '@deepseek-ai/cordis'
import { upgradeSessionStatsDuration } from './duration.js'

export { EN_UNITS, ZH_UNITS, formatThreePart, upgradeSessionStatsDuration } from './duration.js'
export type { DurationUnits } from './duration.js'

/**
 * dsh 时间弹窗明细行的 DOM 钩子：StatsPills 的 `<dl data-session-stats-details>`
 * 内每个 `<dt>/<dd>` 对。弹窗经 createPortal 挂在 document.body，槽位包装
 * 够不到，因此用 body 级 MutationObserver 跟随。契约出处：
 * packages/client/ui-chat/src/client/chat/StatsPills.tsx。
 */
const DETAILS_SELECTOR = '[data-session-stats-details] dd'

/** 统计弹窗根节点（`<dl data-session-stats-details>`）。 */
const DETAILS_ROOT_SELECTOR = '[data-session-stats-details]'

/**
 * 判定一批 mutation 是否可能来自统计弹窗：弹窗子树内的任何变更（React 覆写文本、
 * 语言切换），或含弹窗的新增节点（portal 挂载）。观察器常驻 body 全子树且监听
 * characterData，聊天流式输出的逐 token 变更批次在此被丢弃，全 body 扫描只在
 * 弹窗确实在动时执行——弹窗绝大多数时间不存在，扫描结果恒为空的阶段被整段跳过。
 */
function affectsStatsDetails(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === 'characterData') {
      if (record.target.parentElement?.closest(DETAILS_ROOT_SELECTOR) !== null) return true
      continue
    }
    if (record.target instanceof Element
      && record.target.closest(DETAILS_ROOT_SELECTOR) !== null) return true
    for (const node of record.addedNodes) {
      if (node instanceof Element
        && (node.matches(DETAILS_ROOT_SELECTOR)
          || node.querySelector(DETAILS_ROOT_SELECTOR) !== null)) return true
    }
  }
  return false
}

/**
 * 改写一棵 DOM 子树内全部统计时长行。
 * @param root - 查询起点（document.body 或更小的子树）。
 */
export function rewriteSessionStatsDurations(root: ParentNode): void {
  for (const row of root.querySelectorAll<HTMLElement>(DETAILS_SELECTOR)) {
    const text = row.textContent ?? ''
    const upgraded = upgradeSessionStatsDuration(text)
    if (upgraded !== null && upgraded !== text) row.textContent = upgraded
  }
}

/**
 * 挂常驻观察器：弹窗打开、会话统计投影更新（React 覆写文本）与语言切换
 * 都表现为弹窗子树的 DOM 变化，观察器在相关变更批次后重新改写；与弹窗无关的
 * 变更批次（聊天流式输出等）在回调内被过滤，不做全 body 扫描。
 * 改写自身写入的三档文本不匹配识别模式，不会触发无限循环。
 * @param doc - 目标文档。
 * @returns 断开观察器的 disposer。
 */
export function installSessionStatsHours(doc: Document): () => void {
  const rewrite = () => { rewriteSessionStatsDurations(doc.body) }
  const observer = new MutationObserver(records => {
    if (affectsStatsDetails(records)) rewrite()
  })
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  rewrite()
  return () => { observer.disconnect() }
}

/**
 * 浏览器半入口。无槽位、文案与连接服务需求（dsh.client.inject 可省略），
 * 只挂一个随插件行生死的 DOM 观察器。
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => installSessionStatsHours(document), 'stats-hours: session-stats dialog observer')
}
