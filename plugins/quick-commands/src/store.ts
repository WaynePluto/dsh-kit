/**
 * Node-only 指令存储：整份 JSON 文档落在 `$DSH_HOME/dsh-kit/quick-commands.json`
 * （与 services 注册表 / task-board 同一先例 D17/D23：部署级数据住 dsh home，
 * 跨工作区共享、卸载无项目残留）。读走 {@link normalizeDocument} 的宽容路径；
 * 写要求 {@link isQuickCommandDocument} 全量良构，先写临时文件再 rename，
 * 读者不会看到半写入 JSON。个人指令按 last-write-wins 写，不做跨进程串行化。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/store
 */

import fs from 'node:fs'
import path from 'node:path'
import { emptyDocument, normalizeDocument, type QuickCommandDocument } from './shared.js'

/**
 * 指令文件的绝对路径。
 * @param home - dsh home（`$DSH_HOME`，默认 `~/.dsh`）。
 * @returns home 下 `dsh-kit/` 内的指令文件路径。
 */
export function commandsPath(home: string): string {
  return path.join(home, 'dsh-kit', 'quick-commands.json')
}

/**
 * 读取指令文档。
 * @param home - dsh home。
 * @returns 文档；文件不存在、损坏或字段不全时返回 undefined（由调用方决定回退空文档）。
 */
export function readCommands(home: string): QuickCommandDocument | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(commandsPath(home), 'utf8')
  } catch {
    return undefined
  }
  try {
    return normalizeDocument(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * 读取指令文档；文件缺失或不可读时返回空文档（首次使用零播种：指令列表没有
 * 语言相关的初始内容，空态引导由面板文案承担）。
 * @param home - dsh home。
 */
export function loadOrEmpty(home: string): QuickCommandDocument {
  return readCommands(home) ?? emptyDocument()
}

/**
 * 原子替换指令文档：先写临时文件再 rename。
 * @param home - dsh home。
 * @param document - 完整的新文档（调用方已通过 {@link isQuickCommandDocument} 校验）。
 */
export function writeCommands(home: string, document: QuickCommandDocument): void {
  const file = commandsPath(home)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(document, undefined, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}
