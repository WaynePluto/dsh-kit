import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  computeTrust,
  defaultMachineSlug,
  isBareAuthority,
  processRecordPath,
  readProcessRecord,
  readStationConfig,
  runtimeStatus,
  tokenFromAuthenticatedUrl,
  trustedAuthorities,
  writeProcessRecord,
  writeTokenFile,
} from '../src/shared.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-remote-runtime-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('isBareAuthority / trustedAuthorities', () => {
  it('接受裸 host 与 host:port，拒绝带 scheme、路径或结尾冒号', () => {
    expect(isBareAuthority('pc2.dsh.example.com')).toBe(true)
    expect(isBareAuthority('10.1.2.87:30810')).toBe(true)
    expect(isBareAuthority('https://x.invalid')).toBe(false)
    expect(isBareAuthority('x.invalid/')).toBe(false)
    expect(isBareAuthority('x.invalid:')).toBe(false)
  })

  it('合并去重并过滤非法条目', () => {
    expect(trustedAuthorities({
      lanAddress: '10.1.2.87',
      publicAuthority: 'pc1.dsh.example.com',
      hubAuthority: '10.1.2.87:30810',
    })).toEqual(['127.0.0.1', 'localhost', '10.1.2.87', 'pc1.dsh.example.com', '10.1.2.87:30810'])
    expect(trustedAuthorities({ hubAuthority: 'https://bad.invalid' })).toEqual(['127.0.0.1', 'localhost'])
  })
})

describe('computeTrust', () => {
  it('域名模式使用子域名并忽略局域网地址', () => {
    writeFileSync(join(home, 'dsh-remote.config.json'), JSON.stringify({ relay: { domain: 'dsh.example.com' } }))
    const authorities = computeTrust(home).authorities
    expect(authorities).toContain(`${defaultMachineSlug()}.dsh.example.com`)
    expect(authorities).not.toContain('127.0.0.1:0')
  })

  it('membership 提供入口 authority', () => {
    writeFileSync(join(home, 'membership.json'), JSON.stringify({ hub: { browserAuthority: '10.9.9.9:30809' } }))
    expect(computeTrust(home).authorities).toContain('10.9.9.9:30809')
  })
})

describe('readStationConfig', () => {
  it('缺省时回退局域网默认', () => {
    const config = readStationConfig(join(home, 'not-exists'))
    expect(config.relayPort).toBe(30_809)
    expect(config.domain).toBeUndefined()
  })
})

describe('进程注册表与令牌文件', () => {
  it('记录读写往返，字段非法时视为无记录', () => {
    writeProcessRecord(home, { name: 'relay', pid: 4242, startedAtMs: 1_700_000_000_000 })
    expect(readProcessRecord(home, 'relay')).toEqual({ name: 'relay', pid: 4242, startedAtMs: 1_700_000_000_000 })
    expect(readProcessRecord(home, 'connector')).toBeUndefined()
    writeProcessRecord(home, { name: 'connector', pid: Number.NaN, startedAtMs: 1 })
    expect(readProcessRecord(home, 'connector')).toBeUndefined()
    expect(processRecordPath(home, 'relay')).toContain(join('processes', 'relay.json'))
  })

  it('L1 写入的无 name 记录可读取（认领与状态依赖此格式）', () => {
    writeFileSync(processRecordPath(home, 'relay'), '{"pid":424242,"startedAtMs":1791562832189}')
    expect(readProcessRecord(home, 'relay')).toEqual({ name: 'relay', pid: 424_242, startedAtMs: 1_791_562_832_189 })
    rmSync(processRecordPath(home, 'relay'))
  })

  it('令牌仅在变化时写入', () => {
    expect(writeTokenFile(home, 'token-a')).toBe(true)
    expect(writeTokenFile(home, 'token-a')).toBe(false)
    expect(writeTokenFile(home, 'token-b')).toBe(true)
  })
})

describe('tokenFromAuthenticatedUrl', () => {
  it('提取 token，非法输入返回 undefined', () => {
    expect(tokenFromAuthenticatedUrl('http://127.0.0.1:3199/?token=abc')).toBe('abc')
    expect(tokenFromAuthenticatedUrl('http://127.0.0.1:3199/')).toBeUndefined()
    expect(tokenFromAuthenticatedUrl('not a url')).toBeUndefined()
  })
})

describe('runtimeStatus', () => {
  it('无进程记录时报告未运行，局域网模式给出 loopback 管理页', () => {
    rmSync(join(home, 'dsh-remote.config.json'), { force: true })
    const status = runtimeStatus(home)
    expect(status.relayRunning).toBe(false)
    expect(status.connectorRunning).toBe(false)
    expect(status.mode).toBe('lan')
    expect(status.adminUrl).toBe(`http://127.0.0.1:${String(readStationConfig(home).relayPort)}/_admin`)
    expect(status.entryUrl).toMatch(/^http:\/\/[^/]+:\d+$/u)
  })

  it('域名模式给出公网管理页与本机子域名入口', () => {
    writeFileSync(join(home, 'dsh-remote.config.json'), JSON.stringify({ relay: { port: 30809, domain: 'dsh.example.com' } }), 'utf8')
    const status = runtimeStatus(home)
    expect(status.mode).toBe('domain')
    expect(status.adminUrl).toBe('https://dsh.example.com/_admin')
    expect(status.entryUrl).toBe(`https://${defaultMachineSlug()}.dsh.example.com`)
    rmSync(join(home, 'dsh-remote.config.json'))
  })
})
