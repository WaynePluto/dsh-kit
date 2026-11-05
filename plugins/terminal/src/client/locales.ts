/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。（涉及：`en`、`zh`、`src/notes.ts`） */

/** 设置写入契约：此处说明命名空间、校验、回读确认和草稿保留。 */
export const en = {
  title: 'AI Terminal',
  guideTitle: 'New terminal',
  guideDescription: 'Start a fresh interactive terminal for this session',
  connecting: 'Connecting to the terminal…',
  spawnFailed: 'Failed to open the terminal: {message}',
  missing: 'This terminal no longer exists',
  missingHint: 'It was closed (by you or the model). Start a new one when needed.',
  newTerminal: 'New terminal',
  exited: 'The shell has exited ({code})',
  exitedNoCode: 'The shell has exited',
  closeTitle: 'Close this interactive terminal?',
  closeText: 'Closing it ends the processes running inside (such as interactive commands). The model can open a new one when needed.',
  closeConfirm: 'Close terminal',
  cancel: 'Cancel',
  retry: 'Retry',
} as const

/** 设置写入契约：此处说明命名空间、校验、回读确认和草稿保留。 */
export type TerminalKey = keyof typeof en

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
export const zh: Record<TerminalKey, string> = {
  title: 'AI交互终端',
  guideTitle: '新终端',
  guideDescription: '为当前会话开启一个全新的交互终端',
  connecting: '正在连接终端…',
  spawnFailed: '打开终端失败：{message}',
  missing: '这个终端已经不存在了',
  missingHint: '它已被关闭（被你或模型）。需要时可以再开一个新的。',
  newTerminal: '新建终端',
  exited: 'shell 已退出（{code}）',
  exitedNoCode: 'shell 已退出',
  closeTitle: '关闭这个交互终端？',
  closeText: '关闭将结束终端里正在运行的进程（如交互式命令）。之后可以让模型再开一个新的。',
  closeConfirm: '关闭终端',
  cancel: '取消',
  retry: '重试',
}

/** 实现说明：此处记录相关接口、边界和生命周期约束。（涉及：`{name}`） */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}
