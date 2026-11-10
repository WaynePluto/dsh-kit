import { describe, expect, it } from 'vitest'
import { preferredEffort } from '../src/effort.js'

/** 只关心 id 的档位列表；name 由 dsh 按 id 生成。 */
const levels = (...ids: string[]) => ids.map(id => ({ id, name: id }))

describe('preferredEffort', () => {
  it('prefers high whenever the model offers it', () => {
    expect(preferredEffort(levels('off', 'low', 'high', 'max'))).toBe('high')
    expect(preferredEffort(levels('minimal', 'medium', 'high', 'xhigh'))).toBe('high')
  })

  it('falls back to the highest level below high', () => {
    expect(preferredEffort(levels('minimal', 'low', 'medium', 'xhigh'))).toBe('medium')
    expect(preferredEffort(levels('off', 'low', 'max'))).toBe('low')
  })

  it('takes the lowest offered level when every level sits above high', () => {
    expect(preferredEffort(levels('xhigh', 'max'))).toBe('xhigh')
  })

  it('never selects off and reports nothing when no thinking level exists', () => {
    expect(preferredEffort(levels('off'))).toBeUndefined()
    expect(preferredEffort([])).toBeUndefined()
    expect(preferredEffort(undefined)).toBeUndefined()
  })

  it('ignores ids outside the pi-ai ladder', () => {
    expect(preferredEffort(levels('turbo', 'high'))).toBe('high')
    expect(preferredEffort(levels('turbo'))).toBeUndefined()
  })
})
