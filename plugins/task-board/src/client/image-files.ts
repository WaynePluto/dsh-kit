/**
 * 卡片图片的编解码与选择校验（纯函数，测试可直接跑在 Node）。
 * 存入看板用自包含 data URL；填入新对话时还原成浏览器 File，
 * 交给 dsh 官方 conversation 服务登记为图片草稿附件。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/image-files
 */

import {
  IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_NAME_LENGTH,
  isBoardImageMediaType, type BoardCardImage,
} from '../shared.js'

/** dsh 官方 `<input type=file>` 可用的 accept 值。 */
export const IMAGE_ACCEPT = IMAGE_MEDIA_TYPES.join(',')

/** 从图片 data URL 取回原始字节；非法格式返回空字节。 */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return new Uint8Array(0)
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

/** 把原始字节编码成 data URL（分块拼串，避免大图撑爆参数栈）。 */
export function bytesToDataUrl(mediaType: string, bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return `data:${mediaType};base64,${btoa(binary)}`
}

/** 把看板图片还原成浏览器 File（dsh 图片草稿附件要求 File 的 type 为受支持 MIME）。 */
export function cardImageToFile(image: BoardCardImage): File {
  const bytes = dataUrlBytes(image.dataUrl)
  // 拷进独立的 ArrayBuffer，避免 TS 泛型 Uint8Array<ArrayBufferLike> 与 BlobPart 冲突。
  const buffer = new ArrayBuffer(bytes.byteLength)
  const view = new Uint8Array(buffer)
  view.set(bytes)
  return new File([view], image.name, { type: image.mediaType })
}

/** 单个候选文件的校验结果；`ok` 为 false 时 `reason` 是文案 key。 */
export type ImageFileCheck = { ok: true } | { ok: false, reason: ImageFailureReason }

/** 图片读取失败的文案 key。 */
export type ImageFailureReason = 'imageUnsupportedType' | 'imageTooLarge'

/** 一批文件读取后的失败计数。 */
export type ImageFailureCounts = Record<ImageFailureReason, number>

/**
 * 校验一个待加入卡片的浏览器文件。
 * @param file - 用户选择或粘贴的文件。
 */
export function checkImageFile(file: { type: string, size: number }): ImageFileCheck {
  if (!isBoardImageMediaType(file.type)) return { ok: false, reason: 'imageUnsupportedType' }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'imageTooLarge' }
  return { ok: true }
}

/** 生成一个卡片图片 id。 */
export function newImageId(): string {
  return `img-${crypto.randomUUID()}`
}

/**
 * 读取一批文件为看板图片；逐张校验 MIME 与字节上限，失败的条目按 reason 分类返回。
 * 顺序与传入一致；并行读取字节后按原顺序组装，避免逐张 await 拖慢批量选择。
 * @param files - 选择/粘贴得到的文件。
 * @param now - id 生成器；测试可注入。
 * @returns 成功项与失败原因计数。
 */
export async function readImageFiles(
  files: readonly { type: string, size: number, name: string, arrayBuffer(): Promise<ArrayBuffer> }[],
  now: () => string = newImageId,
): Promise<{ images: BoardCardImage[], failures: ImageFailureCounts }> {
  const images: BoardCardImage[] = []
  const failures: ImageFailureCounts = { imageUnsupportedType: 0, imageTooLarge: 0 }
  const usable = files.map(file => ({ file, check: checkImageFile(file) }))
  const buffers = await Promise.all(usable.map(async ({ file, check }) =>
    check.ok ? new Uint8Array(await file.arrayBuffer()) : undefined))
  usable.forEach(({ file, check }, index) => {
    if (!check.ok) {
      failures[check.reason] += 1
      return
    }
    const bytes = buffers[index]
    // 再按实际读到的字节复核一次，防止伪造的 size。
    if (bytes === undefined || bytes.byteLength > MAX_IMAGE_BYTES) {
      failures.imageTooLarge += 1
      return
    }
    images.push({
      id: now(),
      name: file.name.slice(0, MAX_IMAGE_NAME_LENGTH),
      mediaType: file.type as BoardCardImage['mediaType'],
      dataUrl: bytesToDataUrl(file.type, bytes),
    })
  })
  return { images, failures }
}
