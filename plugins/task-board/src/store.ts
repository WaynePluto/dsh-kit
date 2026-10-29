/**
 * Node-only 看板存储：整份 JSON 文档落在 `$DSH_HOME/dsh-kit/task-board.json`
 * （与 services 注册表同一先例 D17：部署级数据住 dsh home，跨工作区共享、卸载无项目残留）。
 * 读走 {@link normalizeBoard} 的宽容路径；写要求 {@link isBoardDocument} 全量良构，
 * 先写临时文件再 rename，读者不会看到半写入 JSON。个人看板按 last-write-wins 写，
 * 不做跨进程串行化（services 的 lockfile 针对 read-modify-write，这里没有读改写）。
 *
 * @module @dsh-kit/dsh-plugin-task-board/store
 */

import fs from 'node:fs'
import path from 'node:path'
import { normalizeBoard, seedBoard, type BoardDocument } from './shared.js'

/**
 * 看板文件的绝对路径。
 * @param home - dsh home（`$DSH_HOME`，默认 `~/.dsh`）。
 * @returns home 下 `dsh-kit/` 内的看板路径。
 */
export function boardPath(home: string): string {
  return path.join(home, 'dsh-kit', 'task-board.json')
}

/**
 * 读取看板文档。
 * @param home - dsh home。
 * @returns 文档；文件不存在、损坏或字段不全时返回 undefined（由调用方决定是否播种）。
 */
export function readBoard(home: string): BoardDocument | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(boardPath(home), 'utf8')
  } catch {
    return undefined
  }
  try {
    return normalizeBoard(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * 原子替换看板文档：先写临时文件再 rename。
 * @param home - dsh home。
 * @param board - 完整的新文档（调用方已通过 {@link isBoardDocument} 校验）。
 */
export function writeBoard(home: string, board: BoardDocument): void {
  const file = boardPath(home)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(board, undefined, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

/**
 * 读取看板；文件不存在时播种初始三列并写盘。播种语言由页面按当前界面语言传入。
 * @param home - dsh home。
 * @param seed - 播种语言。
 * @returns 文档与是否新播种。
 */
export function loadOrSeedBoard(home: string, seed: 'zh' | 'en'): { board: BoardDocument, seeded: boolean } {
  const existing = readBoard(home)
  if (existing !== undefined) return { board: existing, seeded: false }
  const board = seedBoard(seed)
  writeBoard(home, board)
  return { board, seeded: true }
}
