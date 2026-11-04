import { describe, expect, it } from 'vitest'
import {
  bytesToDataUrl, cardImageToFile, checkImageFile, dataUrlBytes, readImageFiles,
} from '../src/client/image-files.js'
import { MAX_IMAGE_BYTES } from '../src/shared.js'

describe('image-files', () => {
  it('data URL 与字节互转', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const url = bytesToDataUrl('image/png', bytes)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    expect(Array.from(dataUrlBytes(url))).toEqual([0, 1, 2, 250, 255])
  })

  it('非法 data URL 返回空字节', () => {
    expect(dataUrlBytes('data:image/png;base64,%%%bad').byteLength).toBe(0)
    expect(dataUrlBytes('no-comma').byteLength).toBe(0)
  })

  it('还原成 File 保留名字、MIME 与字节', async () => {
    const url = bytesToDataUrl('image/webp', new Uint8Array([1, 2, 3]))
    const file = cardImageToFile({ id: 'i', name: 'a.webp', mediaType: 'image/webp', dataUrl: url })
    expect(file.name).toBe('a.webp')
    expect(file.type).toBe('image/webp')
    expect(file.size).toBe(3)
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('只接受 dsh 原生四种图片 MIME，并按 4 MiB 拒绝', () => {
    expect(checkImageFile({ type: 'image/png', size: 1 }).ok).toBe(true)
    expect(checkImageFile({ type: 'image/heic', size: 1 })).toEqual({ ok: false, reason: 'imageUnsupportedType' })
    expect(checkImageFile({ type: 'text/plain', size: 1 })).toEqual({ ok: false, reason: 'imageUnsupportedType' })
    expect(checkImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toEqual({ ok: false, reason: 'imageTooLarge' })
  })

  it('readImageFiles 分类统计失败项并核对实际字节', async () => {
    const result = await readImageFiles([
      { name: 'ok.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      { name: 'bad.txt', type: 'text/plain', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      { name: 'huge.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array(MAX_IMAGE_BYTES + 1).buffer },
    ], () => 'fixed-id')
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatchObject({ id: 'fixed-id', name: 'ok.png', mediaType: 'image/png' })
    expect(result.failures).toEqual({ imageUnsupportedType: 1, imageTooLarge: 1 })
  })
})
