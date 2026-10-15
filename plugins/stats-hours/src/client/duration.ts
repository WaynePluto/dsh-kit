/**
 * dsh 会话统计弹窗时长的两档识别与三档改写。
 *
 * dsh 的 StatsPills `formatDuration`（packages/client/ui-chat/src/client/chat/StatsPills.tsx）
 * 只有两档：`duration.compactSeconds`（{seconds}秒 / {seconds}s）与
 * `duration.compactMinutes`（{minutes}分{seconds}秒 / {minutes}m{seconds}s），
 * 超过一小时的会话统计显示成「62分5秒」。本组件把 ≥1 小时的两档文本
 * 改写成与 dsh 自家 `formatRunDuration`（message-chrome.ts，turn-tail 用时与
 * 运行指示已用 `duration.hourUnit`）一致的三档：中文「1小时2分5秒」、
 * 英文「1h 2m 5s」。纯函数、无 DOM 依赖，供浏览器半与测试共用。
 */

/** dsh ≥60s 两档输出的中文形态：{minutes}分{seconds}秒（formatDuration 已取整秒）。 */
const ZH_TWO_PART = /^(\d+)分(\d+(?:\.\d+)?)秒$/u

/** dsh ≥60s 两档输出的英文形态：{minutes}m{seconds}s（无空格，duration.compactMinutes）。 */
const EN_TWO_PART = /^(\d+)m(\d+(?:\.\d+)?)s$/u

/** 一小时的秒数；达到即改写，不足保持 dsh 原生两档。 */
const HOUR_SECONDS = 3600

/** dsh locale 的时长单位文案（locale.ts 的 duration.hourUnit/minuteUnit/secondUnit）。 */
export interface DurationUnits {
  hour: string
  minute: string
  second: string
}

/** 中文单位：三档全显，无空格（与 formatRunDuration 的中文输出一致）。 */
export const ZH_UNITS: DurationUnits = { hour: '小时', minute: '分', second: '秒' }

/** 英文单位：小时与分钟带尾随空格（'h '、'm '），秒无（'s'）。 */
export const EN_UNITS: DurationUnits = { hour: 'h ', minute: 'm ', second: 's' }

/**
 * 按三档全显格式拼时长文本（与 dsh formatRunDuration 的档位展示一致，不省略零档）。
 * @param totalSeconds - 总秒数；四舍五入到整秒。
 * @param units - 单位文案。
 * @returns 如「1小时2分5秒」或「1h 2m 5s」。
 */
export function formatThreePart(totalSeconds: number, units: DurationUnits): string {
  const whole = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(whole / HOUR_SECONDS)
  const minutes = Math.floor(whole / 60) % 60
  const seconds = whole % 60
  return `${hours}${units.hour}${minutes}${units.minute}${seconds}${units.second}`
}

/**
 * 把 dsh 会话统计弹窗里 ≥1 小时的两档时长改写成三档。
 * 识别失败的文本（含已是三档、token 用量、TPS 等）与不足一小时的
 * 两档文本都返回 null——调用方保持原样，这也保证改写结果不会再被
 * 本函数改写（三档文本整串不匹配两档模式），不会形成改写循环。
 * @param text - 弹窗明细行当前文本。
 * @returns 三档文本，或 null 表示不需要改写。
 */
export function upgradeSessionStatsDuration(text: string): string | null {
  const zh = ZH_TWO_PART.exec(text)
  const en = zh === null ? EN_TWO_PART.exec(text) : null
  const match = zh ?? en
  if (match === null) return null
  const totalSeconds = Number(match[1]) * 60 + Number(match[2])
  if (totalSeconds < HOUR_SECONDS) return null
  return formatThreePart(totalSeconds, zh !== null ? ZH_UNITS : EN_UNITS)
}
