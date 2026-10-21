import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutlineMedium, IconCheckOutlineMedium, IconCopyOutlineMedium,
  Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatNodeOwnerProps, UserContentAttachment, UserContentData, UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserTextFacts } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { UserMessageForkNodeProps, UserMessageForkRequest } from './index.js'
import {
  previousCompletedTurnEnd, userMessageContentFacts, userMessageForkAvailability,
  type UserMessageForkAvailability,
} from '../shared.js'
import { type UserMessageForkKey } from './locales.js'
import {
  USER_ROW_CLASS, USER_STACK_CLASS,
  ACTIONS_CLASS, ACTION_CLASS, VISUALLY_HIDDEN_CLASS,
} from './styles.js'

type PropsRuntimeLoadImage = ChatNodeOwnerProps['loadImage']

interface UserData extends UserMessageNode {
  readonly referenceLabels?: readonly string[]
  readonly skillNames?: readonly string[]
}

/** 官方 MessageItem 同款切分：文本拼接、附件按显示序、其余块原样保留。 */
function contentParts(content: readonly unknown[]): UserContentData {
  const texts: string[] = []
  const attachments: UserContentAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const candidate = block as {
      type?: unknown; text?: unknown
      attachment?: ImageAttachmentRef | FileAttachmentRef
    }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      texts.push(candidate.text)
    } else if (candidate.type === 'image' && isImageRef(candidate.attachment)) {
      attachments.push({ type: 'image', image: { attachment: candidate.attachment } })
    } else if (candidate.type === 'file' && isFileRef(candidate.attachment)) {
      attachments.push({ type: 'file', file: candidate.attachment })
    } else {
      rest.push(block)
    }
  }
  return { text: texts.join(''), attachments, extraBlocks: rest }
}

function isImageRef(value: unknown): value is ImageAttachmentRef {
  return typeof value === 'object' && value !== null
    && typeof (value as ImageAttachmentRef).attachmentId === 'string'
    && typeof (value as ImageAttachmentRef).mediaType === 'string'
}

function isFileRef(value: unknown): value is FileAttachmentRef {
  return typeof value === 'object' && value !== null
    && typeof (value as FileAttachmentRef).attachmentId === 'string'
    && typeof (value as FileAttachmentRef).name === 'string'
    && typeof (value as FileAttachmentRef).bytes === 'number'
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatMessageClock(
  time: number,
  t: (key: UserMessageForkKey, params?: Record<string, unknown>) => string,
  now = Date.now(),
): string {
  const date = new Date(time)
  const current = new Date(now)
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (
    date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate()
  ) return clock
  const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
  const key = date.getFullYear() === current.getFullYear() ? 'clockMd' : 'clockYmd'
  return `${t(key, params)} ${clock}`
}

function branchLabel(
  availability: UserMessageForkAvailability,
  t: (key: UserMessageForkKey, params?: Record<string, unknown>) => string,
): string {
  switch (availability.kind) {
    case 'ready':
    case 'needs-history':
      return t('branch')
    case 'fresh':
      return t('branchFresh')
    case 'unavailable':
      return availability.reason === 'empty-text'
        ? t('branchUnavailableEmpty')
        : t('branchUnavailableContent')
  }
}

function UserMessageActions({
  text, time, currentTurn, turnStartSeq, availability, forkMessage, t,
}: {
  text: string
  time: number
  currentTurn: number
  turnStartSeq: number | undefined
  availability: UserMessageForkAvailability
  forkMessage: UserMessageForkNodeProps['forkMessage']
  t: UserMessageForkNodeProps['t']
}) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const reasonId = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const copy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then(ok => {
      if (ok) {
        setCopied(true)
        timer.current = setTimeout(() => {
          timer.current = null
          setCopied(false)
        }, 1_000)
      }
      return ok
    })
  }, [copied, text])

  const branch = useCallback(() => {
    if (availability.kind === 'unavailable' || busy) return
    setBusy(true)
    const request: UserMessageForkRequest = availability.kind === 'fresh'
      ? { mode: 'fresh', text }
      : {
        mode: 'fork',
        ...(availability.kind === 'ready' ? { atSeq: availability.atSeq } : {}),
        currentTurn,
        ...(turnStartSeq === undefined ? {} : { turnStartSeq }),
        text,
      }
    void forkMessage(request)
      .finally(() => { setBusy(false) })
      .catch(() => {
        // 设置写入契约：此处说明命名空间、校验、回读确认和草稿保留。
      })
  }, [availability, busy, currentTurn, forkMessage, text, turnStartSeq])

  const unavailable = availability.kind === 'unavailable'
  const disabled = unavailable || busy
  const label = busy ? t('branchBusy') : branchLabel(availability, t)
  return (
    <div className={ACTIONS_CLASS}>
      <span className={`${ACTIONS_CLASS}__time`}>{formatMessageClock(time, t)}</span>
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={ACTION_CLASS} aria-label={copied ? t('copied') : t('copy')} onClick={copy}>
          {copied ? <IconCheckOutlineMedium /> : <IconCopyOutlineMedium />}
        </button>
      </Tooltip>
      <Tooltip label={label} side="bottom">
        <button
          type="button"
          className={ACTION_CLASS}
          aria-label={label}
          aria-disabled={disabled || undefined}
          aria-describedby={disabled ? reasonId : undefined}
          data-unavailable={unavailable || undefined}
          onClick={disabled ? undefined : branch}
        >
          <IconBranchOutlineMedium />
        </button>
      </Tooltip>
      {disabled && <span id={reasonId} className={VISUALLY_HIDDEN_CLASS}>{label}</span>}
    </div>
  )
}

function UserStyleBubble({
  data, currentTurn, turnStartSeq, previousEndSeq, hasMore, loadImage, renderFactorySlot, forkMessage, t,
}: {
  data: UserData
  currentTurn: number | undefined
  turnStartSeq: number | undefined
  previousEndSeq: number | undefined
  hasMore: boolean
  loadImage: PropsRuntimeLoadImage
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  forkMessage: UserMessageForkNodeProps['forkMessage']
  t: UserMessageForkNodeProps['t']
}): ReactNode {
  const parts = useMemo(() => contentParts(data.content), [data.content])
  const facts = useMemo(() => userMessageContentFacts(data.content), [data.content])
  const availability = useMemo(() => {
    // 没有 turn 归属的 user message（会话级节点）解析不出更早边界：按“没有可继承前缀”走新会话。
    if (currentTurn === undefined) return userMessageForkAvailability(undefined, facts)
    return userMessageForkAvailability(
      previousEndSeq,
      facts,
      previousEndSeq === undefined
        && currentTurn > 1
        && hasMore
        && turnStartSeq !== undefined
        && turnStartSeq > 0,
    )
  }, [currentTurn, facts, hasMore, previousEndSeq, turnStartSeq])
  // 会话引用与技能名进 facts，交给官方 conversation.user.text 规则渲染；
  // 与官方 MessageItem.UserStyleBubble 的 facts 组装同构。
  const textFacts = useMemo<Partial<UserTextFacts>>(() => ({
    ...(data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels }),
    ...(data.skillNames === undefined ? {} : { skillNames: data.skillNames }),
  }), [data.referenceLabels, data.skillNames])
  return (
    <div className={USER_ROW_CLASS} data-dshx-user-message-fork-row>
      <div className={USER_STACK_CLASS}>
        {renderFactorySlot('conversation.chat.user.content', {
          content: parts, loadImage, facts: textFacts,
        })}
      </div>
      <UserMessageActions
        text={parts.text}
        time={data.time}
        currentTurn={currentTurn ?? 0}
        turnStartSeq={turnStartSeq}
        availability={availability}
        forkMessage={forkMessage}
        t={t}
      />
    </div>
  )
}

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
export function UserMessageForkNodeView({
  node, loadImage, renderFactorySlot, forkMessage, useChat, useSession, t,
}: UserMessageForkNodeProps) {
  const turnLocation = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const currentTurn = turnLocation?.turn
  const turnStartSeq = turnLocation?.start?.seq
  const previousEndSeq = useChat(snapshot => currentTurn === undefined
    ? undefined
    : previousCompletedTurnEnd(snapshot.timeline, currentTurn))
  const hasMore = useSession(snapshot => snapshot.hasMore)
  return (
    <UserStyleBubble
      data={node.data as UserData}
      currentTurn={currentTurn}
      turnStartSeq={turnStartSeq}
      previousEndSeq={previousEndSeq}
      hasMore={hasMore}
      loadImage={loadImage}
      renderFactorySlot={renderFactorySlot}
      forkMessage={forkMessage}
      t={t}
    />
  )
}
