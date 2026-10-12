// 开发链的状态文件读写：单个 JSON 文件，原子替换，读失败按「无状态」处理。
// 供 dev-runtime.mjs 缓存解析校验结果等使用；不承载发行信息。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export function readBuildStamp(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { return undefined }
}

export function writeBuildStamp(path, stamp) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(stamp, undefined, 2)}\n`)
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}
