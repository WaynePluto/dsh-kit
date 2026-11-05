/**
 * Host 侧原样展示给页面的句子，集中在此处。
 * Host 知道具体 refusal；browser 只负责自己的 label/button 文案（`src/client/locales.ts`）。
 *
 * @module @dsh-kit/dsh-plugin-terminal/notes
 */

/** 所有 Host 编写的句子集中在此处。 */
export const NOTES = {
  /** PTY registry 未挂载或仍在等待依赖注入。 */
  noService: '终端服务还没就绪。它需要 subprocess 与沙箱策略先挂上来，稍等一下再看。',
  /** conversation 没有 live agent，因此不拥有 terminal。 */
  noAgent: '这个会话当前没有在运行的 agent，所以它名下没有终端。',
  /** 找不到指定终端（可能已被关闭）。 */
  noTerminal: '这个终端已经不存在了（可能已被关闭）。',
  /** 终端已退出，不再接受输入。 */
  terminalExited: '这个终端已经退出，不能再输入。',
  /**
   * 键盘写入超过单次上限。
   * @param limit - UTF-8 字节上限。
   * @returns 展示句子。
   */
  tooLong: (limit: number): string => `一次最多写入 ${String(limit)} 字节。`,
} as const
