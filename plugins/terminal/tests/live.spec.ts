/** 安全与权限契约：真实 PTY 链路——tap 包装 backend、键盘直写、帧接收与 registry 互斥语义。（涉及：`dsh-subprocess-local`、`dsh-sandbox-policy`、`dsh-terminal`、`dsh-terminal-bash`、`terminal-tap`） */

import { Context } from '@deepseek-ai/cordis'
import sandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import sessionProjection from '@deepseek-ai/dsh-session-projection'
import subprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Config, mountTerminalBackend, snapshot } from '../src/index.js'
import { TerminalTapRegistry, type TapFrame } from '../src/terminal-tap.js'

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
/* oxlint-disable no-await-in-loop -- live smoke 逐项验证通道端点，顺序本身是验收契约。 */
const TIMEOUT_MS = 90_000

/** 测试契约：此处说明本测试锁定的行为和回归边界。（涉及：`apply`） */
function resolved(overrides: Record<string, unknown> = {}): Config {
  return new (Config as unknown as new (value: unknown) => Config)(overrides)
}

/** 安全与权限契约：此处说明固定权限、审批边界及异常回退。（涉及：`sessionProjections.stateOf`） */
const session = {
  id: 'live-session',
  seq: 0,
  header: { id: 'live-session', cwd: process.cwd() },
  inheritedEventCount: 0,
  snapshotEvents: () => [],
  eventAt: () => undefined,
}

let ctx: Context
let owner: { id: string, ctx: Context, session: typeof session }
const taps = new TerminalTapRegistry()

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
async function until(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true in time')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

beforeAll(async () => {
  ctx = new Context()
  owner = { id: session.id, ctx, session }
  // 实现说明：cordis 4 的 `provide(name, value)` 只有两个参数；多余的实参会让服务
  // 解析异常并拖垮整棵依赖树（terminal-bash fiber 永远 pending）。
  ;(ctx as unknown as { provide: (name: string, value: unknown) => void })
    .provide('agents', { get: (id: string) => id === owner.id ? owner : undefined })
  // dsh 0.2.1 起 terminal-bash 经 workingDirectory.ensure 解析会话目录；
  // 测试固定在进程 cwd，避免拉起整套 working-directory 依赖树。
  ;(ctx as unknown as { provide: (name: string, value: unknown) => void })
    .provide('workingDirectory', { ensure: async () => process.cwd() })
  ctx.plugin(sessionProjection)
  ctx.plugin(subprocessLocal)
  ctx.plugin(sandboxPolicy, { mode: 'danger-full-access', workspaceRoot: process.cwd() })
  // tap 包装的 backend 装载：registry + TapTerminalBackend + 启动补偿都来自本插件。
  mountTerminalBackend(ctx, resolved({ timeoutMs: 60_000 }), taps)
  await until(() => (ctx.get('terminals')?.listBackends().length ?? 0) > 0)
}, TIMEOUT_MS)

afterAll(async () => {
  taps.clear()
  await (ctx as unknown as { stop?: () => Promise<void> }).stop?.()
}, TIMEOUT_MS)

describe('a human answering a prompt the model cannot', () => {
  it('binds the tap at spawn, delivers typed text over the raw handle, and both buffer and tap see the answer', async () => {
    const terminals = ctx.get('terminals')
    if (terminals === undefined) throw new Error('ctx.terminals never appeared')

    const opened = await terminals.spawn(owner as never, { type: 'shell', name: 'live', cwd: process.cwd() })
    const id = String(opened.sessionId)
    const entry = taps.entryOf(id)
    expect(entry).toBeDefined()
    const frames: TapFrame[] = []
    const detach = entry === undefined ? () => {} : subscribeTapForTest(entry, frames)
    try {
      expect(opened.status.kind).toBe('running')

      const view = snapshot(ctx, session.id)
      expect(view.unavailable).toBeUndefined()
      expect(view.terminals.find(item => item.id === id)).toMatchObject({ name: 'live', type: 'shell', running: true })

      // 模型发起 Read-Host；等待语义由上游 startSend 的就绪契约提供。
      const ask = terminals.startSend(owner as never, id as never, {
        text: process.platform === 'win32'
          ? '$secret = Read-Host "PASSWORD"; "GOT:[$secret]"'
          : 'read -r -p "PASSWORD: " secret; echo "GOT:[$secret]"',
        submit: true,
      })
      const asked = await ask.done
      expect(['stdin_read', 'inferred_idle']).toContain(asked.waitReason)
      expect(asked.sessionStatus.kind).toBe('running')

      // 页面键盘直写：tap 句柄 write（不等价、也不经过模型 send 的互斥）。
      await entry?.handle.write('hunter2\r')

      await until(() => terminals.read(owner as never, id as never, { count: 60 }).text.includes('GOT:[hunter2]'))
      const page = terminals.read(owner as never, id as never, { count: 60 })
      expect(page.text).toContain('GOT:[hunter2]')
      expect(page.totalLines).toBeGreaterThan(0)
      // tap 帧同源可见：ring 或实时帧里能看到用户输入被回显（原始字节含 ANSI，宽松匹配）。
      await until(() => frames.some(frame => frame.kind === 'data' && textOf(frame).includes('hunter2')))
      await until(() => decodeRing(entry).includes('GOT:[hunter2]'))
    } finally {
      detach()
      await terminals.kill(owner as never, id as never, 'live test done')
      taps.remove(id)
    }
  }, TIMEOUT_MS)

  it('refuses a second model send while one is genuinely in flight, then delivers it', async () => {
    const terminals = ctx.get('terminals')
    if (terminals === undefined) throw new Error('ctx.terminals never appeared')
    const opened = await terminals.spawn(owner as never, { type: 'shell', name: 'busy', cwd: process.cwd() })
    const id = opened.sessionId
    try {
      const held = terminals.startSend(owner as never, id as never, {
        text: process.platform === 'win32' ? 'Start-Sleep -Seconds 6' : 'sleep 6',
        submit: true,
      })
      // 上游 registry 语义：同一终端同时只允许一次 send（页面直写不受此门限制）。
      expect(() => terminals.startSend(owner as never, id as never, { text: 'echo late', submit: true }))
        .toThrowError(/active send/iu)
      await held.done
      const second = terminals.startSend(owner as never, id as never, { text: 'echo late', submit: true })
      await second.done
      await until(() => terminals.read(owner as never, id as never, { count: 60 }).text.includes('late'))
    } finally {
      await terminals.kill(owner as never, id as never, 'live test done')
      taps.remove(String(id))
    }
  }, TIMEOUT_MS)
})

/** 测试用：把 tap entry 的实时帧接进数组。 */
function subscribeTapForTest(entry: NonNullable<ReturnType<TerminalTapRegistry['entryOf']>>, into: TapFrame[]): () => void {
  const listener = (frame: TapFrame): void => { into.push(frame) }
  entry.listeners.add(listener)
  return () => { entry.listeners.delete(listener) }
}

/** tap 帧的宽松文本化（data 帧解码 utf8）。 */
function textOf(frame: TapFrame): string {
  if (frame.kind !== 'data') return ''
  return Buffer.from(frame.bytes).toString('utf8')
}

/** ring 快照的 utf8 文本。 */
function decodeRing(entry: NonNullable<ReturnType<TerminalTapRegistry['entryOf']>> | undefined): string {
  const snapshotValue = entry?.ring.snapshot()
  return snapshotValue === undefined ? '' : Buffer.from(snapshotValue).toString('utf8')
}
