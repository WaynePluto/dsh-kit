// 由 packages/launcher/src/media-stamp.ts 迁移（launcher 退役，D27）；逻辑不变，仅去类型。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'

/**
 * 介质根目录的内容指纹清单文件，由介质生成脚本（scripts/plugin-distributions.mjs）
 * 与介质一并写出。缺失或格式无效时调用方回退为逐字节哈希。
 */
export const MEDIA_STAMP_FILE = 'stamp.json'

/**
 * 单个介质目录的内容指纹：目录树内全部相对路径与文件字节一并哈希。
 * 目录按名称排序保证不同平台遍历顺序稳定。
 * @param directory - 要指纹的分发介质目录。
 * @returns 目录内容的 SHA-256 十六进制摘要。
 */
export function mediaDirectoryStamp(directory) {
  const hash = createHash('sha256')
  const walk = (current, prefix) => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      hash.update(`${relative}\0`)
      if (entry.isDirectory()) {
        walk(join(current, entry.name), relative)
        continue
      }
      // 符号链接按目标内容哈希（readFileSync 跟随链接），与物化复制语义一致。
      if (entry.isFile() || entry.isSymbolicLink()) hash.update(fs.readFileSync(join(current, entry.name)))
    }
  }
  walk(directory, '')
  return hash.digest('hex')
}

/**
 * 读取介质生成时写出的 stamp.json。
 * @param mediaRoot - 介质根目录（catalog.json 所在目录）。
 * @returns 包名到指纹的映射；文件缺失或格式无效时为 undefined。
 */
export function readMediaStampFile(mediaRoot) {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(join(mediaRoot, MEDIA_STAMP_FILE), 'utf8'))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const stamps = raw.stamps
  if (typeof stamps !== 'object' || stamps === null || Array.isArray(stamps)) return undefined
  for (const value of Object.values(stamps)) {
    if (typeof value !== 'string') return undefined
  }
  return stamps
}

/**
 * 序列化 stamp.json 内容；与介质生成脚本共用同一写出格式。
 * @param stamps - 包名到指纹的映射。
 * @returns 原子写出用的 JSON 文本。
 */
export function mediaStampFileContent(stamps) {
  return `${JSON.stringify({ schemaVersion: 1, stamps }, undefined, 2)}\n`
}
