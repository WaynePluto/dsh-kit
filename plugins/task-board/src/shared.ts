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

/** dsh 原生接受的图片附件 MIME（ui-conversation 的 isImageMediaType）。 */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** 看板卡片支持存入的图片 MIME。 */
export type BoardImageMediaType = typeof IMAGE_MEDIA_TYPES[number]

/**
 * 判断一个 MIME 是否可存入看板并直接作为 dsh 图片草稿附件。
 * @param value - 待判定的字符串。
 */
export function isBoardImageMediaType(value: string): value is BoardImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/** 看板卡片上的一张图片；自包含 data URL，随整份看板 JSON 落盘。 */
export interface BoardCardImage {
  readonly id: string
  /** 原始文件名，仅用于展示与还原成 File 时的名字。 */
  readonly name: string
  readonly mediaType: BoardImageMediaType
  /** `data:<mediaType>;base64,<payload>`。 */
  readonly dataUrl: string
}

/** 看板一张卡片。 */
export interface BoardCard {
  readonly id: string
  /** 任务文本；展示与发送到新对话的正文。 */
  readonly text: string
  /** 卡片标题：纯展示用，可自由编辑，不填入新对话。 */
  readonly title?: string
  /** 卡片图片；展示、复制与填入新对话时一并作为附件加入。 */
  readonly images?: readonly BoardCardImage[]
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

/** 卡片标题长度上限（UTF-16 code unit）；标题只是展示用摘要。 */
export const MAX_CARD_TITLE_LENGTH = 200;

/** 列标题长度上限（UTF-16 code unit）。 */
export const MAX_LIST_TITLE_LENGTH = 80;

/** 单张卡片的图片数上限。 */
export const MAX_IMAGES_PER_CARD = 8;

/** 单张图片原始字节上限（4 MiB）；data URL 明文约膨胀 4/3。 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 单个图片 data URL 的长度上限（UTF-16 code unit）。 */
export const MAX_IMAGE_DATA_URL_LENGTH = 5_600_000;

/** 图片文件名长度上限（UTF-16 code unit）。 */
export const MAX_IMAGE_NAME_LENGTH = 200;

/** 整板图片 data URL 的总长度上限，约束整份 JSON 的写盘体积。 */
export const MAX_TOTAL_IMAGE_CHARS = 24_000_000;

/**
 * `get` 的 payload。
 */
export interface BoardGetPayload {
  /** 文件不存在时按该语言播种初始四列；缺省 zh。 */
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

function isCardImage(value: unknown): value is BoardCardImage {
  if (value === null || typeof value !== 'object') return false
  const image = value as Partial<BoardCardImage>
  if (typeof image.id !== 'string' || image.id === '') return false
  if (typeof image.name !== 'string' || image.name.length > MAX_IMAGE_NAME_LENGTH) return false
  if (typeof image.mediaType !== 'string' || !isBoardImageMediaType(image.mediaType)) return false
  if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return false
  const prefix = `data:${image.mediaType};base64,`
  if (!image.dataUrl.startsWith(prefix)) return false
  // 只允许规范 base64 字符，避免手写文件里塞进任意内容（展示走 img src、还原走 atob）。
  const payload = image.dataUrl.slice(prefix.length)
  return /^[A-Za-z0-9+/]*={0,2}$/u.test(payload)
}

function isCard(value: unknown): value is BoardCard {
  if (value === null || typeof value !== 'object') return false
  const card = value as Partial<BoardCard>
  return typeof card.id === 'string' && card.id !== ''
    && typeof card.text === 'string'
    && (card.title === undefined || (typeof card.title === 'string' && card.title.length <= MAX_CARD_TITLE_LENGTH))
    && (card.images === undefined || (Array.isArray(card.images) && card.images.length <= MAX_IMAGES_PER_CARD && card.images.every(isCardImage)))
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
  let totalCards = 0
  let totalImageChars = 0
  for (const list of document.lists) {
    if (list.cards.length > MAX_CARDS_PER_LIST || list.title.length > MAX_LIST_TITLE_LENGTH) return false
    totalCards += list.cards.length
    for (const card of list.cards) {
      if (card.text.length > MAX_CARD_TEXT_LENGTH) return false
      for (const image of card.images ?? []) totalImageChars += image.dataUrl.length
    }
  }
  return totalCards <= MAX_TOTAL_CARDS && totalImageChars <= MAX_TOTAL_IMAGE_CHARS
}

/** 宽容读取单张卡片的图片：非数组按无图片处理，坏图片逐张丢弃。 */
function normalizeCardImages(value: unknown, budget: () => number): readonly BoardCardImage[] {
  const images: BoardCardImage[] = []
  if (!Array.isArray(value)) return images
  const seen = new Set<string>()
  for (const candidate of value) {
    if (images.length >= MAX_IMAGES_PER_CARD) break
    if (!isCardImage(candidate) || seen.has(candidate.id)) continue
    if (candidate.dataUrl.length > budget()) continue
    seen.add(candidate.id)
    images.push({ id: candidate.id, name: candidate.name, mediaType: candidate.mediaType, dataUrl: candidate.dataUrl })
  }
  return images
}

/** 宽容读取时只看结构（长度/图片等越界由后续逐字段裁剪处理）。 */
function isCardShape(card: unknown): card is BoardCard {
  if (card === null || typeof card !== 'object') return false
  const value = card as Partial<BoardCard>
  return typeof value.id === 'string' && value.id !== ''
    && typeof value.text === 'string'
    && (value.title === undefined || typeof value.title === 'string')
    && (value.workspaceId === undefined || (typeof value.workspaceId === 'string' && value.workspaceId !== ''))
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

/**
 * 宽容读取：磁盘上的历史文档可能字段不全或轻微越界，逐条丢弃坏行并按上限裁剪，
 * 而不是把整个看板判死。重复 id 的列/卡片/图片保留首个（id 是 React key 与拖拽地址）。
 * 旧版文档没有 title/images，按缺省处理；坏图片逐张丢弃，卡片本身保留。
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
  let imageChars = 0
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
      if (!isCardShape(cardCandidate) || seenCards.has(cardCandidate.id)) continue
      seenCards.add(cardCandidate.id)
      const rawImages = (cardCandidate as { images?: unknown }).images
      const images = normalizeCardImages(rawImages, () => MAX_TOTAL_IMAGE_CHARS - imageChars)
      imageChars += images.reduce((sum, image) => sum + image.dataUrl.length, 0)
      cards.push({
        id: cardCandidate.id,
        text: cardCandidate.text.slice(0, MAX_CARD_TEXT_LENGTH),
        ...cardCandidate.title === undefined
          ? {}
          : { title: cardCandidate.title.slice(0, MAX_CARD_TITLE_LENGTH) },
        ...images.length === 0 ? {} : { images },
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

/** 播种初始看板的四列标题（四列正好铺满 358px 列宽的一行）。 */
const SEED_TITLES = {
  zh: ['待办', '进行中', '待验证', '已完成'],
  en: ['To do', 'Doing', 'To verify', 'Done'],
} as const

/**
 * 构造初始看板：空的四列。
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
