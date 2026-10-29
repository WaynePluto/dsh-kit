/**
 * 两半共享的 contract：RPC channel、endpoint、wire shape 和纯校验/裁剪函数。
 * 本模块同时编译到 Host 与 browser，不能导入 `node:*` 或 dsh package；
 * 文件系统逻辑只在 `./store.ts`（宿主半），浏览器不会加载。
 *
 * @module @dsh-kit/dsh-plugin-task-board/shared
 */

/**
 * 本插件的 identity；RPC channel、文案 namespace、`main` 面板 key 与
 * `sidebar.panellist` 行 id 都从包名后缀派生，因此单一字符串是名称的唯一来源。
 */
export const SELF_NAMESPACE = 'dsh-plugin-task-board'

/**
 * Host 注册、页面调用的 kit 通道。浏览器经官方 `/api` 共享桥 POST `/api/task-board`
 * （kit 信封 `{ endpoint, payload }`，D16，见 packages/plugin-rpc）。
 */
export const CHANNEL = '/task-board'

/** 本 channel 提供的全部 endpoint。 */
export const ENDPOINTS = ['get', 'put'] as const

/** 一个 endpoint 名称。 */
export type Endpoint = typeof ENDPOINTS[number]

/**
 * 判断解码后的 endpoint 是否属于本 channel。
 * @param endpoint - 相对 channel 的 endpoint 名称。
 * @returns 本插件是否提供该 endpoint。
 */
export function isTaskBoardEndpoint(endpoint: string): endpoint is Endpoint {
  return (ENDPOINTS as readonly string[]).includes(endpoint)
}

/** 本 channel 不提供 endpoint 时的错误码。 */
export const UNKNOWN_ENDPOINT_CODE = 'task-board/unknown-endpoint'

/** payload 不满足 endpoint contract 时的错误码。 */
export const BAD_PAYLOAD_CODE = 'task-board/bad-payload'

/** Host 侧意外抛错时的错误码。 */
export const INTERNAL_CODE = 'task-board/internal'

/** 看板一张卡片。 */
export interface BoardCard {
  readonly id: string
  /** 任务文本；展示与发送到新对话的正文。 */
  readonly text: string
  /** 目标工作区；缺省 = 默认落点（跟随 dsh 新会话的当前/最近工作区）。 */
  readonly workspaceId?: string
  /** ISO-8601 创建时间。 */
  readonly createdAt: string
  /** ISO-8601 最后修改时间。 */
  readonly updatedAt: string
}

/** 看板一列。 */
export interface BoardList {
  readonly id: string
  readonly title: string
  /** 本列卡片，自上而下的顺序。 */
  readonly cards: readonly BoardCard[]
}

/** 看板文档；整份读、整份写。 */
export interface BoardDocument {
  readonly version: 1
  readonly lists: readonly BoardList[]
}

// ── 有界上限：写路径与 RPC payload 都不许无界增长 ──────────────────────────

/** 列数上限。 */
export const MAX_LISTS = 16

/** 单列卡片数上限。 */
export const MAX_CARDS_PER_LIST = 200;

/** 全板卡片总数上限。 */
export const MAX_TOTAL_CARDS = 2000;

/** 单张卡片文本长度上限（UTF-16 code unit）。 */
export const MAX_CARD_TEXT_LENGTH = 8000;

/** 列标题长度上限（UTF-16 code unit）。 */
export const MAX_LIST_TITLE_LENGTH = 80;

/**
 * `get` 的 payload。
 */
export interface BoardGetPayload {
  /** 文件不存在时按该语言播种初始三列；缺省 zh。 */
  readonly seed?: 'zh' | 'en'
}

/** `get` 的返回。 */
export interface BoardGetResult {
  readonly board: BoardDocument
  /** 本次调用是否新播种了初始看板（文件此前不存在）。 */
  readonly seeded: boolean
}

/** `put` 的 payload：整份看板原文写回。 */
export interface BoardPutPayload {
  readonly board: BoardDocument
}

/** `put` 的返回。 */
export interface BoardPutResult {
  /** 写盘后的列数/卡片数摘要，供页面诊断。 */
  readonly lists: number
  readonly cards: number
}

/**
 * 判断 `get` payload 是否良构。
 * @param value - 解码后的 payload。
 */
export function isGetPayload(value: unknown): value is BoardGetPayload {
  if (value === null || typeof value !== 'object') return false
  const seed = (value as Partial<BoardGetPayload>).seed
  return seed === undefined || seed === 'zh' || seed === 'en'
}

function isCard(value: unknown): value is BoardCard {
  if (value === null || typeof value !== 'object') return false
  const card = value as Partial<BoardCard>
  return typeof card.id === 'string' && card.id !== ''
    && typeof card.text === 'string'
    && (card.workspaceId === undefined || (typeof card.workspaceId === 'string' && card.workspaceId !== ''))
    && typeof card.createdAt === 'string'
    && typeof card.updatedAt === 'string'
}

function isList(value: unknown): value is BoardList {
  if (value === null || typeof value !== 'object') return false
  const list = value as Partial<BoardList>
  return typeof list.id === 'string' && list.id !== ''
    && typeof list.title === 'string'
    && Array.isArray(list.cards)
    && list.cards.every(isCard)
}

/**
 * 判断一个值是否是完整良构的看板文档（`put` 的写盘前提）。
 * 结构良构之外还要求全部有界上限满足；越界写入按 bad payload 拒绝，
 * 而不是静默裁剪——页面是唯一写方，越界说明页面逻辑出了 bug。
 * @param value - 待校验值。
 */
export function isBoardDocument(value: unknown): value is BoardDocument {
  if (value === null || typeof value !== 'object') return false
  const document = value as Partial<BoardDocument>
  if (document.version !== 1 || !Array.isArray(document.lists)) return false
  if (document.lists.length > MAX_LISTS) return false
  if (!document.lists.every(isList)) return false
  const total = document.lists.reduce((sum, list) => sum + list.cards.length, 0)
  if (total > MAX_TOTAL_CARDS) return false
  return document.lists.every(list =>
    list.cards.length <= MAX_CARDS_PER_LIST
    && list.cards.every(card => card.text.length <= MAX_CARD_TEXT_LENGTH)
    && list.title.length <= MAX_LIST_TITLE_LENGTH)
}

/**
 * 宽容读取：磁盘上的历史文档可能字段不全或轻微越界，逐条丢弃坏行并按上限裁剪，
 * 而不是把整个看板判死。重复 id 的列/卡片保留首个（id 是 React key 与拖拽地址）。
 * @param value - 解析后的 JSON 值。
 * @returns 可用的看板文档；完全不可读时返回空板。
 */
export function normalizeBoard(value: unknown): BoardDocument {
  if (value === null || typeof value !== 'object') return { version: 1, lists: [] }
  const raw = value as Partial<BoardDocument>
  if (!Array.isArray(raw.lists)) return { version: 1, lists: [] }
  const lists: BoardList[] = []
  const seenLists = new Set<string>()
  let total = 0
  for (const candidate of raw.lists) {
    if (lists.length >= MAX_LISTS || total >= MAX_TOTAL_CARDS) break
    if (candidate === null || typeof candidate !== 'object') continue
    const list = candidate as Partial<BoardList>
    if (typeof list.id !== 'string' || list.id === '' || seenLists.has(list.id)) continue
    if (typeof list.title !== 'string') continue
    const cards: BoardCard[] = []
    const seenCards = new Set<string>()
    for (const cardCandidate of Array.isArray(list.cards) ? list.cards : []) {
      if (cards.length >= MAX_CARDS_PER_LIST || total >= MAX_TOTAL_CARDS) break
      if (!isCard(cardCandidate) || seenCards.has(cardCandidate.id)) continue
      seenCards.add(cardCandidate.id)
      cards.push({
        id: cardCandidate.id,
        text: cardCandidate.text.slice(0, MAX_CARD_TEXT_LENGTH),
        ...cardCandidate.workspaceId === undefined ? {} : { workspaceId: cardCandidate.workspaceId },
        createdAt: cardCandidate.createdAt,
        updatedAt: cardCandidate.updatedAt,
      })
      total += 1
    }
    seenLists.add(list.id)
    lists.push({ id: list.id, title: list.title.slice(0, MAX_LIST_TITLE_LENGTH), cards })
  }
  return { version: 1, lists }
}

/** 播种初始看板的三列标题。 */
const SEED_TITLES = {
  zh: ['待办', '进行中', '已完成'],
  en: ['To do', 'Doing', 'Done'],
} as const

/**
 * 构造初始看板：空的三列。
 * @param seed - 播种语言。
 * @returns 初始文档。
 */
export function seedBoard(seed: 'zh' | 'en'): BoardDocument {
  const titles = SEED_TITLES[seed]
  return {
    version: 1,
    lists: titles.map((title, index) => ({ id: `seed-${String(index)}`, title, cards: [] })),
  }
}
