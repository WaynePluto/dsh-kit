/** 顶栏会话标题的双击识别。 */

/**
 * 双击是否落在会话顶栏的「当前会话标题」上。
 *
 * dsh 的面包屑标题没有专用 data 钩子（`ConversationSessionHeader` 只给
 * tab 条与 corner 留了 data 属性），识别依据两层结构事实：
 *
 * 1. 标题元素带 CSS module 类名后缀 `crumbCurrent`（构建后形如
 *    `wSkVaW_crumbCurrent`，哈希前缀随构建变化、后缀随版本）。该类只出现在
 *    「当前会话」的 crumb（含列表缺失时的裸 id 兜底 span）上；祖先 crumb 是
 *    可点击 button，类只有 `crumb`，双击命中不了这里。
 * 2. 命中元素必须位于会话顶栏 `header[data-window-drag]` 内，排除其他表面
 *    （侧栏、设置页）同名类巧合。
 *
 * 契约出处：`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
 * （crumb 渲染分支）与 `ConversationHeader.tsx`（data-window-drag）。
 * 上游类名后缀变更时本判定静默失效（双击无反应），dsh-upgrade 适配时需复核。
 * @param target - dblclick 事件的 target。
 * @returns 命中当前会话标题时 true。
 */
export function isConversationTitleTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const title = target.closest('[class*="crumbCurrent"]')
  if (title === null) return false
  return title.closest('header[data-window-drag]') !== null
}
