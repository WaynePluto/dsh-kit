/**
 * 模型提供商标签：`conversation.input.right` 槽的一个 list 占用者，
 * 渲染在模型选择座位左侧，显示当前选择所属提供商的显示名。
 * 数据来自与原生选择器/`/model` 弹窗共享的 per-session ModelDirectory
 * （`ctx.modelDirectories`），在任一入口切换模型都实时跟随；只读展示，
 * 不重复装载目录（服务构造时已自发 load，store 订阅即得全部更新）。
 */
import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { providerDisplayName } from './label.js'
import type { ModelProviderKey } from './locales.js'
import { labelHostStyle, labelTextStyle } from './styles.js'

/** 槽位注入面：由 src/client/index.tsx 的登记项提供。 */
export interface ModelProviderLabelInjected {
  /** 寻址 subagent 会话没有模型选择面（与原生座位同判），标签一并隐藏。 */
  available: boolean
  /** 会话共享目录 store（与模型座位、/model 弹窗同一实例）。 */
  directory: SnapshotStore<ModelDirectoryState>
}

function translate(t: ((key: ModelProviderKey) => string) | undefined, key: ModelProviderKey): string {
  return t?.(key) ?? key
}

/**
 * 渲染提供商标签。
 * @param props - 注入面 + 标准 locale 座位的 `t`。
 * @returns 标签 span；无可显示名称（无选择/不可用/加载中）时为 null。
 */
export function ModelProviderLabel({
  available, directory, t,
}: ModelProviderLabelInjected & { t?: (key: ModelProviderKey) => string }) {
  const state = useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => directory.getSnapshot(),
    () => directory.getSnapshot(),
  )
  const label = available ? providerDisplayName(state, translate(t, 'provider.account')) : null
  if (label === null) return null
  return (
    <span
      className="dsh-kit-model-provider-label"
      style={labelHostStyle}
      data-model-provider-label=""
      title={label}
    >
      <span style={labelTextStyle}>{label}</span>
    </span>
  )
}
