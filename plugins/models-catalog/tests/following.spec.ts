/** 测试契约：官方 DeepSeek 路由跟随判定与 llm-deepseek-api-key 的 resolveAdapterOptions 同判。 */

import { describe, expect, it } from 'vitest'
import { followingOfficial } from '../src/following.js'

describe('followingOfficial', () => {
  it('treats an absent endpoint and absent models as the following defaults', () => {
    expect(followingOfficial(undefined, undefined)).toBe(true)
  })

  it('follows official-origin endpoints whatever their path', () => {
    expect(followingOfficial('https://api.deepseek.com', undefined)).toBe(true)
    expect(followingOfficial('https://api.deepseek.com/v1', undefined)).toBe(true)
    expect(followingOfficial('https://api.deepseek.com/anthropic', undefined)).toBe(true)
  })

  it('stops following when the endpoint is another gateway', () => {
    expect(followingOfficial('https://gw.example.test', undefined)).toBe(false)
  })

  it('rejects a malformed endpoint instead of guessing', () => {
    expect(followingOfficial('not a url', undefined)).toBe(false)
    expect(followingOfficial('', undefined)).toBe(false)
    expect(followingOfficial(42, undefined)).toBe(false)
  })

  it('stops following once models differ from the built-in catalog', () => {
    expect(followingOfficial(undefined, [])).toBe(false)
    expect(followingOfficial(undefined, [{ id: 'custom-model', name: 'Custom' }])).toBe(false)
    expect(followingOfficial(undefined, 'default')).toBe(false)
  })

  it('ignores a null models field like an absent one', () => {
    expect(followingOfficial(undefined, null)).toBe(true)
  })
})
