/** shared.ts 纯函数回归：版本比较与升级地址构造（升级机制 D21 的契约面）。 */
import { describe, expect, it } from 'vitest'
import { buildUpgradeUrl, compareVersions, stripLeadingV } from '../src/shared.js'

describe('stripLeadingV', () => {
  it('去掉 v 前缀', () => {
    expect(stripLeadingV('v0.0.1')).toBe('0.0.1')
  })

  it('无前缀原样返回', () => {
    expect(stripLeadingV('0.0.1')).toBe('0.0.1')
  })
})

describe('buildUpgradeUrl', () => {
  it('构造带 tag 的固定名资产地址', () => {
    expect(buildUpgradeUrl('v0.0.2')).toBe('https://github.com/WaynePluto/dsh-kit/releases/download/v0.0.2/dsh-kit.tar.gz')
  })
})

describe('compareVersions', () => {
  it('逐段数值比较', () => {
    expect(compareVersions('0.0.2', '0.0.1')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.0.1', '0.0.1')).toBe(0)
    expect(compareVersions('0.0.2', '0.0.10')).toBeLessThan(0)
  })

  it('段数不齐按 0 补齐', () => {
    expect(compareVersions('0.1', '0.1.0')).toBe(0)
    expect(compareVersions('0.1', '0.2')).toBeLessThan(0)
  })

  it('prerelease 低于同版本正式版', () => {
    expect(compareVersions('0.2.1-rc.3', '0.2.1')).toBeLessThan(0)
    expect(compareVersions('0.2.1', '0.2.1-rc.3')).toBeGreaterThan(0)
    expect(compareVersions('0.2.1-rc.3', '0.2.1-rc.3')).toBe(0)
    expect(compareVersions('0.2.1-rc.10', '0.2.1-rc.9')).toBeGreaterThan(0)
  })
})
