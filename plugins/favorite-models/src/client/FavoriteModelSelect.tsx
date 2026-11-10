import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconCloseFillRegular, IconDataOutlineRegular, IconWarningOutlineRegular, Input, isMobileDevice,
  MenuGroup, MenuSurface, observeStickyMenuGroups, rankByName, StateDot, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { preferredEffort } from '../effort.js'
import { filterFavoriteGroups } from '../filter.js'
import { DEFAULT_SETTINGS } from '../shared.js'
import type { FavoriteModelsSettings } from '../shared.js'
import { fill } from './locales.js'
import type { FavoriteModelsKey } from './locales.js'
import { SELECTOR_STYLE_MARKER, selectorClasses, selectorStyles } from './selector-styles.js'

export interface FavoriteModelSelectInjected {
  available: boolean
  directory: SnapshotStore<ModelDirectoryState>
  load: () => void
  select: (selection: ModelSelection) => Promise<boolean>
  favorites: ConfigForm<FavoriteModelsSettings>
}

type Pane = 'root' | 'model' | 'effort'
interface EffortChoice { key: string; effort: string | undefined; label: string }

/** 收藏 selector 的渲染 props。 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

function translate(t: ((key: FavoriteModelsKey) => string) | undefined, key: FavoriteModelsKey): string {
  return t?.(key) ?? key
}

export function FavoriteModelSelect({
  locked, available, directory, load, select, favorites, t,
}: FavoriteModelSelectInjected & { locked: boolean; t?: (key: FavoriteModelsKey) => string }) {
  const state = useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => directory.getSnapshot(),
    () => directory.getSnapshot(),
  )
  const favoriteSnapshot = useSyncExternalStore(
    listener => favorites.subscribe(listener),
    () => favorites.getSnapshot(),
    () => favorites.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  // 选中返回触发器后不画焦点圈，直到触发器失焦或菜单重开（与原生一致）。
  const [selectionFocus, setSelectionFocus] = useState(false)
  const [, refreshFavorites] = useState(0)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const lastAction = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const favoritesValue = favorites.getSnapshot().value ?? favoriteSnapshot.value ?? DEFAULT_SETTINGS

  const groups = useMemo(
    () => filterFavoriteGroups(state.groups, favoritesValue.favorites),
    [state.groups, favoritesValue.favorites],
  )
  const allChoices = useMemo(() => state.groups.flatMap(group => group.models.map(model => ({ group, model }))), [state.groups])
  const choices = useMemo(() => groups.flatMap(group => group.models.map(model => ({ group, model }))), [groups])
  // 目录条目超过 4 个时提供搜索（原生同阈值）；搜索作用于收藏过滤后的列表。
  const showSearch = choices.length > 4
  const filteredGroups = useMemo(() => groups.map(group => ({
    ...group, models: rankByName(group.models, showSearch ? query.trim() : ''),
  })).filter(group => group.models.length > 0), [groups, query, showSearch])
  const visibleModels = useMemo(() => filteredGroups.flatMap(group => group.models.map(model => ({
    provider: group.id, model: model.id,
  }))), [filteredGroups])
  const currentVisibleIndex = visibleModels.findIndex(model =>
    model.provider === state.current?.provider && model.model === state.current.model)
  const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1)
  const currentChoice = state.current === null
    ? undefined
    : allChoices.find(choice => choice.group.id === state.current?.provider && choice.model.id === state.current.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? translate(t, 'providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: translate(t, 'providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, t])
  const { pending } = state
  const busy = pending !== null

  const reload = (): void => {
    lastAction.current = 'load'
    load()
  }

  useEffect(() => {
    if (!available || !open) return
    const closeOutside = (event: MouseEvent): void => {
      // 只在点击菜单外部时关闭菜单，点击列表项本身交给其 handler。
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [available, open])

  // 计算菜单位置：优先放在 trigger 上方，并用 clamp 处理矮视口和窄屏。
  useLayoutEffect(() => {
    if (!available || !open) { setMenuPos(null); return }
    const place = (): void => {
      /* v8 ignore next 2 -- 菜单打开时 trigger ref 一定已挂载。 */
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const MARGIN = 12
      const lw = menuRef.current?.offsetWidth ?? 0
      const lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - lw
      let y = rect.top - 8 - lh
      if (lw > 0) {
        const maxX = Math.max(MARGIN, window.innerWidth - lw - MARGIN)
        x = Math.min(Math.max(x, MARGIN), maxX)
      }
      if (lh > 0) {
        const maxY = Math.max(MARGIN, window.innerHeight - lh - MARGIN)
        y = Math.min(Math.max(y, MARGIN), maxY)
      }
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [available, open, pane, state])

  // 非搜索模式重置搜索状态（列表变短后搜索框退场）。
  useLayoutEffect(() => {
    if (!showSearch) {
      setQuery('')
      setHighlightedIndex(null)
    }
  }, [showSearch])

  // 深入子 pane / 返回 root / 搜索模式切换后，把焦点放回有意义的行：
  // drill 优先搜索框（desktop），其次当前选中行；back 回到打开它的 cell。
  const paneFocus = useRef<'drill' | 'model' | 'effort' | null>(null)
  const previousShowSearch = useRef(showSearch)
  useEffect(() => {
    const changedSearchMode = previousShowSearch.current !== showSearch
    previousShowSearch.current = showSearch
    const intent = paneFocus.current ?? (changedSearchMode && pane === 'model' ? 'drill' : null)
    paneFocus.current = null
    if (!open || intent === null) return
    if (intent === 'drill') {
      if (pane === 'model' && showSearch && !isMobileDevice()) {
        searchRef.current?.focus()
        return
      }
      // 当前选中行是「在用的值」；没有选中项的 pane 打开在第一行。
      const checked = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
      const target = checked ?? itemRefs.current.find(item => item !== null && !item.disabled)
      ;(target ?? triggerRef.current)?.focus()
      return
    }
    const cell = itemRefs.current[intent === 'effort' ? 1 : 0]
    ;(cell !== null && cell !== undefined && !cell.disabled ? cell : triggerRef.current)?.focus()
  }, [open, pane, showSearch])

  // 打开时把当前选中项滚进视野。
  useLayoutEffect(() => {
    if (open && pane === 'model' && activeModelIndex >= 0) {
      itemRefs.current[activeModelIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, pane, activeModelIndex, visibleModels])

  // 组头滚动到顶时由官方观察器加 data-stuck（背景从不透明填充切换）；与官方
  // ModelSelect 相同的接法，组集合或面板切换时重建观察。
  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return undefined
    return observeStickyMenuGroups(viewport)
  }, [open, pane, filteredGroups])
  if (!available) return null

  const show = (): void => {
    setSelectionFocus(false)
    // 收藏快照不在订阅里（getSnapshot 读取）；每次打开强制重渲染取最新收藏。
    refreshFavorites(value => value + 1)
    triggerRef.current?.focus()
    setQuery('')
    setHighlightedIndex(null)
    // 没有当前模型时直达模型列表 pane；否则展示「模型 / 推理等级」根 pane。
    if (currentChoice === undefined) paneFocus.current = 'drill'
    setPane(currentChoice === undefined ? 'model' : 'root')
    setOpen(true)
    reload()
  }
  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }
  const closeAfterSelection = (): void => {
    setSelectionFocus(true)
    close(true)
  }

  const changeQuery = (next: string): void => {
    setQuery(next)
    setHighlightedIndex(0)
  }

  /** 深入子 pane：清搜索状态，焦点交给子 pane 的「在用值」。 */
  const drill = (next: Pane): void => {
    setQuery('')
    setHighlightedIndex(null)
    paneFocus.current = 'drill'
    setPane(next)
  }

  /** 离开子 pane 回根 pane，把键盘交还给打开它的 cell。 */
  const back = (from: Exclude<Pane, 'root'>): void => {
    paneFocus.current = from
    setPane('root')
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = active < 0
      ? offset > 0 ? 0 : items.length - 1
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape 先退出子 pane（存在当前模型时），再关闭。
      if (pane !== 'root' && currentChoice !== undefined) back(pane)
      else close(true)
      return
    }
    if (!open) return
    if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (!busy && visibleModels.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlightedIndex((activeModelIndex + direction + visibleModels.length) % visibleModels.length)
        searchRef.current?.focus()
      }
      return
    }
    // 搜索模式下 Enter 接受高亮项。
    if (pane === 'model' && showSearch && event.target instanceof HTMLInputElement && event.key === 'Enter') {
      event.preventDefault()
      const highlighted = visibleModels[activeModelIndex]
      if (!busy && highlighted !== undefined) choose(highlighted)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && (
      rootRef.current?.contains(event.relatedTarget) === true
      || menuRef.current?.contains(event.relatedTarget) === true
    )) return
    close()
  }
  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) closeAfterSelection()
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: fill(translate(t, 'actionError'), { message }) })
    }
  }
  const submit = (selection: ModelSelection): void => {
    // 行在 pending 期间禁用；先把焦点收回触发器，避免禁用行的 blur 提前关菜单。
    setSelectionFocus(true)
    triggerRef.current?.focus()
    lastAction.current = 'select'
    void select(selection).then(settleSelection)
  }
  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      closeAfterSelection()
      return
    }
    // 换模型时显式写入档位：模型自带的默认优先（与原生一致），没有默认档位时
    // 用偏好档位补上，避免会话落进 `Default` 这个用户看不懂的未指定态。
    const targetReasoning = allChoices.find(choice =>
      choice.group.id === selection.provider && choice.model.id === selection.model)?.model.reasoning
    const effort = selection.reasoningEffort
      ?? targetReasoning?.defaultEffort
      ?? preferredEffort(targetReasoning?.efforts)
    submit({
      provider: selection.provider,
      model: selection.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }
  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      closeAfterSelection()
      return
    }
    submit({
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? translate(t, 'triggerLoading')
    : currentChoice?.model.name
      ?? (state.current === null ? translate(t, 'triggerFallback') : `${state.current.provider}/${state.current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? translate(t, 'triggerLoading')
    : state.current === null
      ? translate(t, 'triggerSelectAria')
      : effortLabel === undefined
        ? fill(translate(t, 'triggerAria'), { model: modelLabel })
        : fill(translate(t, 'triggerAriaEffort'), { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  let modelIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div
      ref={rootRef}
      className={selectorClasses.root}
      data-open={open ? '' : undefined}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
    >
      <style {...{ [SELECTOR_STYLE_MARKER]: '' }}>{selectorStyles}</style>
      <button
        ref={triggerRef}
        type="button"
        className={selectorClasses.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-busy={busy}
        title={triggerLabel}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => { if (open) close(); else show() }}
      >
        <IconDataOutlineRegular className={selectorClasses.triggerIcon} size={16} />
        <span className={selectorClasses.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined ? <span className={selectorClasses.triggerEffort}>{effortLabel}</span> : null}
        {busy ? <StateDot state="ongoing" /> : <IconChevronDownOutlineRegular className={selectorClasses.chevron} />}
      </button>

      {open && createPortal(
        // MenuSurface 提供 0.2.0 的官方菜单材质（半透明填充 + backdrop-filter 磨砂层）；
        // 自绘 background 会退化成无模糊的纯透明（见 selector-styles 的 .menu 注释）。
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={selectorClasses.menu}
          style={menuPos ?? MEASURE_STYLE}
          role={pane === 'model' ? 'group' : 'menu'}
          aria-label={translate(t, 'menuAria')}
          aria-busy={state.status === 'loading' || busy}
        >
            {pane === 'root'
              ? (
                <>
                  <button ref={itemRef()} type="button" role="menuitem" className={selectorClasses.cell} onClick={() => { drill('model') }}>
                    <span className={selectorClasses.cellLabel}>{translate(t, 'menuModel')}</span>
                    <span className={selectorClasses.cellValue}>{modelLabel}</span>
                    <IconChevronRightOutlineRegular className={selectorClasses.cellChevron} />
                  </button>
                  {reasoning !== undefined
                    ? (
                      <button ref={itemRef()} type="button" role="menuitem" className={selectorClasses.cell} onClick={() => { drill('effort') }}>
                        <span className={selectorClasses.cellLabel}>{translate(t, 'menuEffort')}</span>
                        <span className={selectorClasses.cellValue}>{effortLabel}</span>
                        <IconChevronRightOutlineRegular className={selectorClasses.cellChevron} />
                      </button>
                    )
                    : null}
                </>
              )
              : null}
            {pane === 'model'
              ? (
                <>
                  {showSearch
                    ? (
                      <div className={selectorClasses.searchRow}>
                        <Input
                          ref={searchRef}
                          className={query !== '' ? `${selectorClasses.search} ${selectorClasses.searchWithQuery}` : selectorClasses.search}
                          type="text"
                          role="searchbox"
                          aria-label={translate(t, 'searchPlaceholder')}
                          aria-controls={`${id}-models`}
                          aria-activedescendant={activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`}
                          placeholder={translate(t, 'searchPlaceholder')}
                          value={query}
                          readOnly={busy}
                          onChange={event => { changeQuery(event.target.value) }}
                        />
                        {query !== ''
                          ? (
                            <button
                              type="button"
                              className={selectorClasses.searchClear}
                              aria-label={translate(t, 'searchClear')}
                              disabled={busy}
                              onClick={() => { changeQuery(''); searchRef.current?.focus() }}
                            >
                              <IconCloseFillRegular />
                            </button>
                          )
                          : null}
                      </div>
                    )
                    : null}
                  {state.status === 'loading' ? <div className={selectorClasses.status}>{translate(t, 'statusLoading')}</div> : null}
                  {state.error !== null && lastAction.current === 'load'
                    ? (
                      <div className={selectorClasses.error}>
                        <span>{fill(translate(t, 'actionError'), { message: state.error })}</span>
                        <button type="button" className={selectorClasses.retry} onClick={reload}>{translate(t, 'retry')}</button>
                      </div>
                    )
                    : null}
                  {state.failures.map(failure => (
                    <div className={selectorClasses.warning} key={failure.id}>
                      <span>{fill(translate(t, 'groupLoadWarning'), { name: failure.name, message: failure.message })}</span>
                      <button type="button" className={selectorClasses.retry} onClick={reload}>{translate(t, 'retry')}</button>
                    </div>
                  ))}
                  <div
                    ref={groupsRef}
                    id={`${id}-models`}
                    className={selectorClasses.groups}
                    role="menu"
                    aria-label={translate(t, 'menuModel')}
                    hidden={filteredGroups.length === 0}
                  >
                    {filteredGroups.map(group => (
                      <MenuGroup label={group.name} key={group.id}>
                        {group.models.map(model => {
                          const index = modelIndex++
                          const selected = state.current?.provider === group.id && state.current.model === model.id
                          return (
                            <button
                              ref={itemRef()}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              id={`${id}-model-${index}`}
                              tabIndex={showSearch ? -1 : 0}
                              onFocus={() => { setHighlightedIndex(index) }}
                              data-highlighted={index === activeModelIndex ? '' : undefined}
                              className={index === activeModelIndex
                                ? `${selectorClasses.option} ${selectorClasses.optionActive}`
                                : selectorClasses.option}
                              key={model.id}
                              title={model.name}
                              disabled={busy}
                              onClick={() => { choose({ provider: group.id, model: model.id }) }}
                            >
                              <span className={selectorClasses.optionCopy}><span className={selectorClasses.modelName}>{model.name}</span></span>
                              <span className={selectorClasses.check}>
                                {pending?.provider === group.id && pending.model === model.id
                                  ? <StateDot state="ongoing" />
                                  : selected ? <IconCheckOutlineRegular /> : null}
                              </span>
                            </button>
                          )
                        })}
                      </MenuGroup>
                    ))}
                  </div>
                  {state.status === 'ready' && filteredGroups.length === 0
                    ? <div className={selectorClasses.empty} role="status">{translate(t, choices.length === 0 ? 'emptyModels' : 'noMatches')}</div>
                    : null}
                </>
              )
              : null}
            {pane === 'effort'
              ? (
                <>
                  {state.error !== null && lastAction.current === 'load'
                    ? (
                      <div className={selectorClasses.error}>
                        <span>{fill(translate(t, 'actionError'), { message: state.error })}</span>
                        <button type="button" className={selectorClasses.retry} onClick={reload}>{translate(t, 'retry')}</button>
                      </div>
                    )
                    : null}
                  {effortChoices.length === 0
                    ? <div className={selectorClasses.empty}>{translate(t, 'emptyEfforts')}</div>
                    : effortChoices.map(level => (
                      <button
                        ref={itemRef()}
                        type="button"
                        role="menuitemradio"
                        aria-checked={effectiveEffort === level.effort}
                        className={selectorClasses.option}
                        key={level.key}
                        disabled={busy}
                        onClick={() => { chooseEffort(level.effort) }}
                      >
                        <span className={selectorClasses.optionCopy}><span className={selectorClasses.modelName}>{level.label}</span></span>
                        <span className={selectorClasses.check}>
                          {pending !== null && pending.provider === state.current?.provider
                            && pending.model === state.current.model && pending.reasoningEffort === level.effort
                            ? <StateDot state="ongoing" />
                            : effectiveEffort === level.effort ? <IconCheckOutlineRegular /> : null}
                        </span>
                      </button>
                    ))}
                </>
              )
              : null}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null
        ? (
          <Toast
            key={toast.seq}
            text={toast.text}
            icon={<IconWarningOutlineRegular />}
            anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
            onDone={() => { setToast(null) }}
          />
        )
        : null}
    </div>
  )
}
