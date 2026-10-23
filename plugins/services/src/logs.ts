/**
 * Node-only 日志与文件读取辅助：日志以 dsh home 为作用域（`$DSH_HOME/dsh-kit/logs/`），
 * 与服务本身一样是机器级资源；项目内 `.agents/logs/` 只作为 D17 前旧日志的回捞来源。
 * 读取失败统一按空内容处理，保证服务退出后仍能安全查看日志。
 *
 * @module @dsh-kit/dsh-plugin-services/logs
 */

import fs from 'node:fs'
import path from 'node:path'
import { isValidName, tailText } from './shared.js'

/**
 * home 日志目录：每个服务名一份当前运行的日志（每次启动截断），总量随服务数有界。
 * @param home - dsh home。
 * @returns 日志目录绝对路径。
 */
export function homeLogsDir(home: string): string {
  return path.join(home, 'dsh-kit', 'logs')
}

/**
 * 一个服务日志文件的绝对路径。
 * @param home - dsh home。
 * @param name - 服务名称。
 * @returns home 日志目录下的日志路径。
 */
export function logPath(home: string, name: string): string {
  return path.join(homeLogsDir(home), `${name}.log`)
}

/**
 * 列出 home 中仍有日志文件的服务名称。一次扫描既告诉调用方哪些已停止服务仍有日志，
 * 也提供 `service_logs` 所需的名称。
 * @param home - dsh home。
 * @returns 排序后的合法名称；目录不存在时为空数组。
 */
export function listLogNames(home: string): string[] {
  return scanLogDir(homeLogsDir(home))
}

/**
 * 旧版（D17 前）项目内日志目录。
 * @param cwd - 项目目录。
 * @returns 项目 `.agents/logs/` 路径。
 */
export function legacyLogsDir(cwd: string): string {
  return path.join(cwd, '.agents', 'logs')
}

/**
 * 旧版项目内日志路径；仅用于回捞迁移前留下的日志文件。
 * @param cwd - 项目目录。
 * @param name - 服务名称。
 * @returns 项目 `.agents/logs/` 下的日志路径。
 */
export function legacyLogPath(cwd: string, name: string): string {
  return path.join(legacyLogsDir(cwd), `${name}.log`)
}

/**
 * 列出一个项目内旧版日志的服务名称（回捞来源）。
 * @param cwd - 项目目录。
 * @returns 排序后的合法名称；目录不存在时为空数组。
 */
export function listLegacyLogNames(cwd: string): string[] {
  return scanLogDir(legacyLogsDir(cwd))
}

/**
 * 扫描一个日志目录，返回合法服务名。
 * @param dir - 日志目录。
 * @returns 排序后的合法名称；目录不存在时为空数组。
 */
function scanLogDir(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.log'))
      .map(entry => entry.name.slice(0, -'.log'.length))
      .filter(name => isValidName(name))
      .toSorted()
  } catch {
    // 目录不存在表示没有日志；这是结果，不是错误。
    return []
  }
}

/**
 * 按顺序在多个项目目录中回捞某个服务名留下的旧版日志文件。
 * 新服务的日志都在 home，不需要候选列表；这里只为 D17 前的存量日志服务。
 * @param roots - 候选项目目录（调用方负责排序：会话项目优先）。
 * @param name - 服务名称。
 * @returns 第一个存在的旧版日志绝对路径；都不存在时为 undefined。
 */
export function findExistingLog(roots: readonly string[], name: string): string | undefined {
  if (!isValidName(name)) return undefined
  for (const root of roots) {
    const file = legacyLogPath(root, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      // 这个项目没有该日志；继续找下一个。
    }
  }
  return undefined
}

/**
 * 读取文件；任何失败都按“无内容”处理。
 * @param file - 绝对路径。
 * @returns 文件内容，或空字符串。
 */
export function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** tail 读取的最大字节窗口：日志是只增文件，行数需求（≤500 行）远小于任意服务器日志的体量。 */
const TAIL_MAX_BYTES = 262_144

/**
 * 只读取日志末尾的若干行。先取文件尾 {@link TAIL_MAX_BYTES} 字节再找行边界——
 * 长跑服务的日志可达数百 MB，整文件读入再 split 会把宿主卡住数秒；
 * 窗口内的首个不完整行（截断边界）被丢弃。
 * @param file - 绝对路径。
 * @param lines - 保留的末尾行数。
 * @returns tail，或空字符串。
 */
export function tailFile(file: string, lines: number): string {
  try {
    const handle = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(handle).size
      const length = Math.min(size, TAIL_MAX_BYTES)
      const buffer = Buffer.alloc(length)
      fs.readSync(handle, buffer, 0, length, size - length)
      let text = buffer.toString('utf8')
      if (length < size && text.includes('\n')) {
        // 头部截断：丢掉窗口里第一个不完整的行（可能还劈开了多字节字符）。
        text = text.slice(text.indexOf('\n') + 1)
      }
      return tailText(text, lines)
    } finally {
      fs.closeSync(handle)
    }
  } catch {
    // 读取失败（含文件不存在）按无内容处理，服务退出后仍能安全查看。
    return ''
  }
}
