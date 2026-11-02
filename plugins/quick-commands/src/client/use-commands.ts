/**
 * 面板的指令文档状态与持久化。面板只在打开期间挂载：挂载时 `get`，
 * 每次增删改先落本地（乐观更新，交互不被 RPC 往返打断）再立即整份 `put`；
 * 写失败保留本地状态并亮出错误文案，下一次改动自动重试。不做防抖：
 * 增删改都以「提交」为粒度（Enter/点击），频率天然有界。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client/use-commands
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_COMMANDS, cleanCommandText, emptyDocument,
} from '../shared.js'
import type { QuickCommand, QuickCommandDocument } from '../shared.js'

/** 文档装载进度。 */
export type CommandsStatus = 'loading' | 'ready' | 'error'

/** 最近一次失败的类别：装载失败（文档仍是空文档）或保存失败（本地改动已生效）。 */
export type CommandsErrorKind = 'load' | 'save'

/** 新 id：优先 UUID，无 crypto 的环境回退到时间戳 + 随机段。 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `qc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @param load - 读取整份文档的 RPC 调用（宿主 `get`）。
 * @param save - 整份写回的 RPC 调用（宿主 `put`）。
 * @returns 文档、进度与增删改入口。
 */
export function useCommands(
  load: () => Promise<QuickCommandDocument>,
  save: (document: QuickCommandDocument) => Promise<void>,
): {
  document: QuickCommandDocument
  status: CommandsStatus
  errorKind: CommandsErrorKind | undefined
  errorMessage: string | undefined
  limitReached: boolean
  reload: () => void
  add: (text: string) => boolean
  update: (id: string, text: string) => boolean
  remove: (id: string) => boolean
} {
  const [document, setDocument] = useState<QuickCommandDocument>(emptyDocument)
  const [status, setStatus] = useState<CommandsStatus>('loading')
  const [errorKind, setErrorKind] = useState<CommandsErrorKind | undefined>(undefined)
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
  const [limitReached, setLimitReached] = useState(false)
  const documentRef = useRef(document)
  documentRef.current = document
  const seqRef = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const saveRef = useRef(save)
  saveRef.current = save

  const fetchDocument = useCallback(() => {
    const seq = seqRef.current + 1
    seqRef.current = seq
    setStatus('loading')
    setErrorKind(undefined)
    setErrorMessage(undefined)
    void (async () => {
      try {
        const loaded = await loadRef.current()
        if (seqRef.current !== seq) return
        setDocument(loaded)
        setStatus('ready')
      } catch (error: unknown) {
        if (seqRef.current !== seq) return
        setStatus('error')
        setErrorKind('load')
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [])

  useEffect(() => { fetchDocument() }, [fetchDocument])

  /** 乐观落本地后立即写回；失败亮错误，本地改动保留。 */
  const mutate = useCallback((next: QuickCommandDocument) => {
    const seq = seqRef.current + 1
    seqRef.current = seq
    setDocument(next)
    setStatus('ready')
    setErrorKind(undefined)
    setErrorMessage(undefined)
    void (async () => {
      try {
        await saveRef.current(next)
        if (seqRef.current === seq) {
          setErrorKind(undefined)
          setErrorMessage(undefined)
        }
      } catch (error: unknown) {
        if (seqRef.current === seq) {
          setErrorKind('save')
          setErrorMessage(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }, [])

  const add = useCallback((text: string) => {
    const cleaned = cleanCommandText(text)
    if (cleaned === '') return false
    const current = documentRef.current
    if (current.commands.length >= MAX_COMMANDS) {
      setLimitReached(true)
      return false
    }
    const now = new Date().toISOString()
    const command: QuickCommand = { id: newId(), text: cleaned, createdAt: now, updatedAt: now }
    setLimitReached(false)
    mutate({ version: 1, commands: [...current.commands, command] })
    return true
  }, [mutate])

  const update = useCallback((id: string, text: string) => {
    const cleaned = cleanCommandText(text)
    if (cleaned === '') return false
    const current = documentRef.current
    let changed = false
    const commands = current.commands.map(command => {
      if (command.id !== id || command.text === cleaned) return command
      changed = true
      return { ...command, text: cleaned, updatedAt: new Date().toISOString() }
    })
    if (!changed) return false
    mutate({ version: 1, commands })
    return true
  }, [mutate])

  const remove = useCallback((id: string) => {
    const current = documentRef.current
    const commands = current.commands.filter(command => command.id !== id)
    if (commands.length === current.commands.length) return false
    if (commands.length < MAX_COMMANDS) setLimitReached(false)
    mutate({ version: 1, commands })
    return true
  }, [mutate])

  return {
    document,
    status,
    errorKind,
    errorMessage,
    limitReached,
    reload: fetchDocument,
    add,
    update,
    remove,
  }
}
