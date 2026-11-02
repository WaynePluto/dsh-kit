/**
 * 光标位置插入：走 session 槽位标准 prop `inputActions` 的公开插入契约
 * （`ui-conversation/src/client/contract/input.ts` 的 `captureInsertion` /
 * `insertText`——上游斜杠菜单同款通道）。`TokenSpan` 对本插件不透明：
 * 捕获后原样传回，这里只定义最小结构面，便于在 node 环境单测。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client/insert
 */

/** 插入所需的 `InputActions` 最小面（结构与上游契约对齐，span 不透明）。 */
export interface InsertActions {
  /** 捕获当前光标区间的修订守卫副本。 */
  captureInsertion(): unknown
  /**
   * 在捕获区间插入纯文本（单个 undo 步）。
   * @returns 草稿已变化或提交锁定了编辑器时为 false。
   */
  insertText(text: string, span: unknown): boolean
}

/**
 * 在输入框光标位置插入文本；首次插入因草稿并发变化失败时，重取光标再试一次
 * （捕获与插入间隔极短，二次失败只剩提交锁定一种原因，交由调用方提示）。
 * @param inputActions - 当前会话的插入动作面。
 * @param text - 要插入的文本；空串直接成功（无操作）。
 * @returns 是否插入成功。
 */
export function insertAtCaret(inputActions: InsertActions, text: string): boolean {
  if (text === '') return true
  const span = inputActions.captureInsertion()
  if (inputActions.insertText(text, span)) return true
  return inputActions.insertText(text, inputActions.captureInsertion())
}
