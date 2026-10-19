/**
 * 从会话模型目录快照解析当前选择的提供商显示名。
 * 契约出处（相对 dsh 仓库根）：packages/client/ui-model-selection/src/client/
 * {directory.ts,ModelSelect.tsx}——目录组 id 即 `state.current.provider`，
 * 菜单组头显示 `group.name`，唯 `deepseek-account` 特判为账号显示名；
 * 触发器本身只显示模型名，提供商名由本组件补在座位左侧。
 */
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'

/**
 * 解析当前提供商的显示名。
 * @param state - 会话目录快照（只读 current 与 groups）。
 * @param accountName - `deepseek-account` 的本地化账号显示名（对齐原生菜单标题）。
 * @returns 显示名；当前无选择时为 null。目录尚未装载（组缺失）时回退原始
 * provider id（保留信息量，与原生触发器回退 `provider/model` 同思路）。
 */
export function providerDisplayName(
  state: Pick<ModelDirectoryState, 'current' | 'groups'>,
  accountName: string,
): string | null {
  const { current, groups } = state
  if (current === null || current.provider === '') return null
  const group = groups.find(candidate => candidate.id === current.provider)
  if (group === undefined) return current.provider
  if (group.id === 'deepseek-account') return accountName
  return group.name === '' ? group.id : group.name
}
