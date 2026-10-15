import { describe, expect, it } from 'vitest'
import { EN_UNITS, ZH_UNITS, formatThreePart, upgradeSessionStatsDuration } from '../src/client/duration.js'

describe('upgradeSessionStatsDuration', () => {
  it('中文两档不足一小时保持原样', () => {
    expect(upgradeSessionStatsDuration('3.8秒')).toBeNull()
    expect(upgradeSessionStatsDuration('2分42秒')).toBeNull()
    expect(upgradeSessionStatsDuration('59分59秒')).toBeNull()
  })

  it('中文两档达到一小时改写为三档', () => {
    expect(upgradeSessionStatsDuration('60分0秒')).toBe('1小时0分0秒')
    expect(upgradeSessionStatsDuration('62分5秒')).toBe('1小时2分5秒')
    expect(upgradeSessionStatsDuration('125分3秒')).toBe('2小时5分3秒')
    expect(upgradeSessionStatsDuration('600分0秒')).toBe('10小时0分0秒')
  })

  it('中文两档带小数秒时四舍五入到整秒', () => {
    expect(upgradeSessionStatsDuration('62分5.4秒')).toBe('1小时2分5秒')
    expect(upgradeSessionStatsDuration('62分5.6秒')).toBe('1小时2分6秒')
  })

  it('英文两档不足一小时保持原样', () => {
    expect(upgradeSessionStatsDuration('45.2s')).toBeNull()
    expect(upgradeSessionStatsDuration('2m42s')).toBeNull()
    expect(upgradeSessionStatsDuration('59m59s')).toBeNull()
  })

  it('英文两档达到一小时改写为三档', () => {
    expect(upgradeSessionStatsDuration('60m0s')).toBe('1h 0m 0s')
    expect(upgradeSessionStatsDuration('62m5s')).toBe('1h 2m 5s')
    expect(upgradeSessionStatsDuration('125m3s')).toBe('2h 5m 3s')
  })

  it('已是三档的文本不再改写（防循环）', () => {
    expect(upgradeSessionStatsDuration('1小时2分5秒')).toBeNull()
    expect(upgradeSessionStatsDuration('1h 2m 5s')).toBeNull()
    expect(upgradeSessionStatsDuration('10小时0分0秒')).toBeNull()
  })

  it('非时长文本（TPS、token 数等）不匹配', () => {
    expect(upgradeSessionStatsDuration('')).toBeNull()
    expect(upgradeSessionStatsDuration('12.3 tok/s')).toBeNull()
    expect(upgradeSessionStatsDuration('1,234 tok')).toBeNull()
    expect(upgradeSessionStatsDuration('3 轮 8 步')).toBeNull()
    expect(upgradeSessionStatsDuration('62分5秒，工具调用')).toBeNull()
  })
})

describe('formatThreePart', () => {
  it('三档全显，不省略零档', () => {
    expect(formatThreePart(3600, ZH_UNITS)).toBe('1小时0分0秒')
    expect(formatThreePart(3725, ZH_UNITS)).toBe('1小时2分5秒')
    expect(formatThreePart(3725, EN_UNITS)).toBe('1h 2m 5s')
  })

  it('负数钳制为零、小数四舍五入', () => {
    expect(formatThreePart(-5, ZH_UNITS)).toBe('0小时0分0秒')
    expect(formatThreePart(3599.6, ZH_UNITS)).toBe('1小时0分0秒')
  })
})
