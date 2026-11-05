/**
 * 交互终端 sidebar tab 的 body：xterm.js 实时渲染 + 键盘直写。
 *
 * 数据面：`POST /api/terminal/stream` 的流式响应（ring 重放 → 实时帧 → exit），
 * 键盘经 16ms 微批写回 PTY，尺寸经 FitAddon → resize 端点跟随面板。进程与画面
 * 生命周期在宿主；tab 隐藏即断流（ring 保底重放），可见即重连；body keepMounted，
 * 状态随 occurrence 存续。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { STREAM_PATH, decodeStreamFrame } from '../shared.js'
import { fill } from './locales.js'
import type { TerminalKey } from './locales.js'
import { getBinding, setBinding } from './terminal-bindings.js'
import { disarmClose } from './terminal-tab.js'
import { resolveTerminalTheme, terminalOptions } from './terminal-theme.js'
import {
  MONO, containerStyle, confirmDangerClass, overlayErrorStyle, overlayStyle,
  overlayTitleStyle, rootStyle, statusStyle, statusTextStyle,
} from './terminal-tab.styles.js'
import type { TerminalTabInjected } from './terminal-tab.types.js'

/** 本 kind 的导航参数：body 与 monitor 经 params 识别 tab 对应的终端。 */
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** 这个 tab 绑定的 Host 终端。 */
    'dsh-kit-terminal': { terminalId: string }
  }
}

/** 键盘写回的微批窗口：粘贴 bursts 合并成一次 POST。 */
const WRITE_FLUSH_MS = 16

/** 断流后的重连间隔（tab 可见期间）。 */
const RECONNECT_DELAY_MS = 1500

/** sidebar tab 槽收到的完整 props。 */
export type TerminalTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'dsh-plugin-terminal'>
  & InjectFace<TerminalTabInjected>

/** body 的渲染阶段。 */
type Phase = 'resolving' | 'connecting' | 'live' | 'exited' | 'missing' | 'error'

/** body 内部持有的终端实例组。 */
interface TermHandle {
  terminalId: string
  term: Terminal
  fit: FitAddon
  dataDisposable: { dispose(): void }
}

/** base64 → 字节（流帧载荷）。 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 不依赖 slot plumbing 的 tab body，便于测试直接渲染。
 * @param props - sidebar occurrence、Host verbs、locale seat 与共享 hooks。
 * @returns xterm 终端画面；解析/退出/错误态有对应覆盖层。
 */
export function TerminalTab(props: TerminalTabBodyProps): ReactNode {
  const { sessionId, useTabInfo, t, verbs, useArmed, useTheme } = props
  const { tab } = useTabInfo()
  const armed = useArmed(source => source.has(tab.id))
  const theme = useTheme(value => value)
  const sid = String(sessionId)

  const [phase, setPhase] = useState<Phase>('resolving')
  const [terminalId, setTerminalId] = useState<string | undefined>(undefined)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined)
  const [retryKey, setRetryKey] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<TermHandle | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const writeBufRef = useRef<string[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSizeRef = useRef<{ cols: number; rows: number } | undefined>(undefined)
  // 重放门控：attach 期间按 PTY 原几何渲染 ring；重放结束（live 帧）后才 fit + resize PTY，
  // 避免 160 列字节被重放进窄面板产生错位残影。
  const replayGateRef = useRef(false)

  /** 按当前面板几何 fit 并把新尺寸发给 PTY；重放未结束（门控关闭）时不执行。 */
  const fitNow = (): void => {
    const handle = termRef.current
    const element = containerRef.current
    if (handle === undefined || element === null || !tab.visible) return
    if (element.clientWidth === 0 || element.clientHeight === 0) return
    handle.fit.fit()
    const next = { cols: handle.term.cols, rows: handle.term.rows }
    const previous = lastSizeRef.current
    if (previous !== undefined && previous.cols === next.cols && previous.rows === next.rows) return
    lastSizeRef.current = next
    void verbs.onResize(handle.terminalId, next.cols, next.rows).catch(() => undefined)
  }

  // 解析 terminalId：导航 params → bindings → spawn 全新终端。每个 occurrence 一次。
  useEffect(() => {
    let cancelled = false
    const params = tab.navigation.params as { terminalId?: string } | undefined
    const existing = typeof params?.terminalId === 'string'
      ? params.terminalId
      : getBinding(sid, tab.contentId)
    if (existing !== undefined) {
      setTerminalId(existing)
      setPhase('connecting')
      return
    }
    setPhase('connecting')
    verbs.onSpawn().then((result) => {
      if (cancelled) return
      setBinding(sid, tab.contentId, result.id)
      setTerminalId(result.id)
      return undefined
    }).catch((cause: unknown) => {
      if (cancelled) return
      setPhase('error')
      setErrorMsg(fill(t('spawnFailed'), { message: cause instanceof Error ? cause.message : String(cause) }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- occurrence 生命周期只解析一次。
  }, [])

  // 组装/复用 xterm 实例；terminalId 换绑或 occurrence 消亡时释放。
  useEffect(() => {
    if (terminalId === undefined) return
    const container = containerRef.current
    if (container === null) return
    if (termRef.current !== undefined && termRef.current.terminalId === terminalId) return
    termRef.current?.dataDisposable.dispose()
    const term = new Terminal(terminalOptions({ mono: MONO }))
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = { terminalId, term, fit, dataDisposable: term.onData(data => enqueueWrite(data)) }
    lastSizeRef.current = undefined
    replayGateRef.current = false
    // 面板尺寸 → FitAddon → resize 端点。rAF 合并，避免 ResizeObserver 回环告警。
    // 重放期间门控关闭：ring 按 PTY 原几何渲染，重放结束才允许 fit。
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!replayGateRef.current) return
        fitNow()
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      abortRef.current?.abort()
      abortRef.current = undefined
      termRef.current?.dataDisposable.dispose()
      termRef.current?.term.dispose()
      termRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terminalId 换绑与卸载时重建。
  }, [terminalId])

  // 主题切换 → 重读 token 应用到底座四色。
  useEffect(() => {
    const handle = termRef.current
    if (handle === undefined) return
    handle.term.options.theme = resolveTerminalTheme()
  }, [theme])
  // 连接流：tab 可见时建立，隐藏/换绑/退出/卸载即断。异常断开在可见期间自动重连。
  useEffect(() => {
    if (terminalId === undefined || !tab.visible) {
      abortRef.current?.abort()
      abortRef.current = undefined
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    let finished = false
    const finish = (): void => { finished = true }
    const decoder = new TextDecoder()
    let carry = ''
    const handle = termRef.current

    const connect = async (): Promise<void> => {
      if (handle === undefined || handle.terminalId !== terminalId) return
      try {
        const response = await fetch(`/api${STREAM_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, terminalId }),
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (response.status === 404) {
          setPhase('missing')
          return
        }
        if (!response.ok || response.body === null) {
          setPhase('error')
          setErrorMsg(fill(t('spawnFailed'), { message: `stream status ${String(response.status)}` }))
          return
        }
        // 连接成立：进入 live（标题是静态文案，不需要回填）。
        setPhase('live')
        const reader = response.body.getReader()
        // 字节流的顺序消费是协议契约，不能并行读取。
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- 顺序帧推进本身是验收契约。
          const next = await reader.read()
          if (next.done || finished) break
          carry += decoder.decode(next.value, { stream: true })
          const lines = carry.split('\n')
          carry = lines.pop() ?? ''
          for (const line of lines) {
            const frame = decodeStreamFrame(line)
            if (frame === undefined) continue
            if (frame.t === 'size') {
              // 按 PTY 原几何重建画面（重连时先清掉旧内容，ring 全量重放）。
              const live = termRef.current
              if (live !== undefined) {
                live.term.resize(frame.cols, frame.rows)
                live.term.reset()
              }
              continue
            }
            if (frame.t === 'live') {
              // 重放结束：开 fit 门控并立刻按面板几何 resize PTY（ConPTY 重绘当前屏幕）。
              replayGateRef.current = true
              fitNow()
              continue
            }
            if (frame.t === 'ring' || frame.t === 'data') {
              termRef.current?.term.write(base64ToBytes(frame.b64))
              continue
            }
            setExitCode(frame.code)
            setPhase('exited')
            finish()
            return
          }
        }
      } catch (cause: unknown) {
        if (controller.signal.aborted) return
        setPhase('error')
        setErrorMsg(cause instanceof Error ? cause.message : String(cause))
        return
      }
      // 流在未退出的情况下结束（宿主短暂不可用）：可见期间自动重连。
      if (!controller.signal.aborted && !finished && tab.visible) {
        setPhase('connecting')
        setTimeout(() => {
          if (!controller.signal.aborted) setRetryKey(value => value + 1)
        }, RECONNECT_DELAY_MS)
      }
    }
    replayGateRef.current = false
    void connect()
    return () => { finish(); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 连接随可见性/换绑/重试键推进。
  }, [terminalId, tab.visible, retryKey])

  /** 键盘微批：16ms 内的键入合并成一次写回。 */
  function enqueueWrite(data: string): void {
    writeBufRef.current.push(data)
    if (flushTimerRef.current !== undefined) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = undefined
      const batched = writeBufRef.current.join('')
      writeBufRef.current = []
      if (batched.length === 0 || terminalId === undefined) return
      void verbs.onWrite(terminalId, batched).catch(() => undefined)
    }, WRITE_FLUSH_MS)
  }

  /** 新建终端（guide 入口按钮、退出/missing 覆盖层）：spawn → 换绑 → 就地重建画面。 */
  const spawnNew = (): void => {
    setPhase('connecting')
    setErrorMsg(undefined)
    verbs.onSpawn().then((result) => {
      setBinding(sid, tab.contentId, result.id)
      setExitCode(null)
      setTerminalId(result.id)
      setRetryKey(value => value + 1)
      return undefined
    }).catch((cause: unknown) => {
      setPhase('error')
      setErrorMsg(fill(t('spawnFailed'), { message: cause instanceof Error ? cause.message : String(cause) }))
    })
  }

  /** 弹窗「关闭终端」：保持 armed，走 tab.actions.close → close handler 直接杀进程并放行。 */
  const killNow = (): void => {
    tab.actions.close()
  }

  const translate = (key: TerminalKey): string => t(key)
  const statusText = phase === 'connecting' || phase === 'resolving' ? translate('connecting') : undefined

  return (
    <section style={rootStyle} aria-label={translate('title')} data-dsh-terminal-tab="">
      <div ref={containerRef} style={containerStyle} data-dsh-terminal-screen="" />
      {statusText !== undefined && <div style={statusStyle}><span style={statusTextStyle}>{statusText}</span></div>}
      {armed && terminalId !== undefined && (
        <Modal
          open
          onClose={() => { disarmClose(tab.id) }}
          title={translate('closeTitle')}
          closeLabel={translate('cancel')}
          description={translate('closeText')}
          footer={(
            <>
              <Button variant="outline" onClick={() => { disarmClose(tab.id) }}>{translate('cancel')}</Button>
              <Button variant="outline" className={confirmDangerClass} onClick={killNow}>{translate('closeConfirm')}</Button>
            </>
          )}
        />
      )}
      {phase === 'exited' && (
        <div style={overlayStyle} data-dsh-terminal-exited="">
          <div style={overlayTitleStyle}>
            {exitCode === null ? translate('exitedNoCode') : fill(translate('exited'), { code: exitCode })}
          </div>
          <Button variant="outline" size="sm" onClick={spawnNew}>{translate('newTerminal')}</Button>
        </div>
      )}
      {phase === 'missing' && (
        <div style={overlayStyle} data-dsh-terminal-missing="">
          <div style={overlayTitleStyle}>{translate('missing')}</div>
          <div>{translate('missingHint')}</div>
          <Button variant="outline" size="sm" onClick={spawnNew}>{translate('newTerminal')}</Button>
        </div>
      )}
      {phase === 'error' && (
        <div style={overlayStyle} data-dsh-terminal-error="">
          <div style={overlayErrorStyle}>{errorMsg}</div>
          <Button variant="outline" size="sm" onClick={spawnNew}>{translate('retry')}</Button>
        </div>
      )}
    </section>
  )
}

export type TerminalTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsLocale<'dsh-plugin-terminal'>

/**
 * tab chip 的静态标题（「AI交互终端」）。
 * @param props - title slot 的框架 props。
 * @returns 标题文字。
 */
export function TerminalTabTitle(props: TerminalTitleProps): ReactNode {
  const { t } = props
  return <span data-dsh-terminal-title="">{t('title')}</span>
}
