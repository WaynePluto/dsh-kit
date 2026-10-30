/** task-board 面板文案；中文遵循 `docs/01-decisions.md` 词表。 */

/** 英文文案；同时作为本 namespace 的 key 集合。 */
export const en = {
  panel: 'Task board',
  title: 'Task board',
  hint: 'Drag cards across lists, drag list headers to reorder. Cards in the first list can be sent to a new conversation.',
  loading: 'Loading board…',
  loadFailed: 'Failed to load the board: {message}',
  saveFailed: 'Board changes could not be saved: {message}',
  savedLocally: 'Some changes are still being saved…',
  addList: 'Add a list',
  newListPlaceholder: 'List title',
  addListAction: 'Add',
  cancel: 'Cancel',
  listTitlePlaceholder: 'Untitled',
  cardCount: '{count}',
  addCard: 'Add a card',
  cardPlaceholder: 'What needs to be done?',
  saveCard: 'Save',
  deleteList: 'Delete list',
  deleteListConfirm: 'Delete the list “{title}” and its {count} cards?',
  delete: 'Delete',
  deleteCard: 'Delete card',
  copyCard: 'Copy card text',
  copied: 'Copied',
  sendCard: 'Send to a new conversation in {workspace}',
  sendFailed: 'Could not start the conversation: {message}',
  workspaceDefault: 'Default workspace',
  workspacePicker: 'Target workspace',
  workspaceNone: 'No workspaces yet — the default target will be used.',
  untitledWorkspace: 'Untitled workspace',
} as const

/** 本 namespace 的文案 key 类型。 */
export type TaskBoardKey = keyof typeof en

/** 中文文案，按 `en` 的 key 集合实现。 */
export const zh: Record<TaskBoardKey, string> = {
  panel: '任务看板',
  title: '任务看板',
  hint: '拖动卡片跨列整理，拖动列标题调换位置；第一列的卡片可发送到工作区的新对话。',
  loading: '正在读取看板…',
  loadFailed: '看板读取失败：{message}',
  saveFailed: '看板改动尚未保存成功：{message}',
  savedLocally: '部分改动仍在保存中…',
  addList: '添加列表',
  newListPlaceholder: '列表标题',
  addListAction: '添加',
  cancel: '取消',
  listTitlePlaceholder: '未命名',
  cardCount: '{count}',
  addCard: '添加卡片',
  cardPlaceholder: '要做什么？',
  saveCard: '保存',
  deleteList: '删除列表',
  deleteListConfirm: '删除列表「{title}」及其中 {count} 张卡片？',
  delete: '删除',
  deleteCard: '删除卡片',
  copyCard: '复制卡片文本',
  copied: '已复制',
  sendCard: '发送到 {workspace} 的新对话',
  sendFailed: '无法开始新对话：{message}',
  workspaceDefault: '默认工作区',
  workspacePicker: '目标工作区',
  workspaceNone: '还没有工作区——将使用默认落点。',
  untitledWorkspace: '未命名工作区',
}

/** 填充 `{name}` 等文案占位符；未知占位符保持原样。 */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}
