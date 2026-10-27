/**
 * 工作区路径的展示名：末级目录名，作为 pill 标签。
 *
 * @module @dsh-kit/dsh-plugin-session-workspace/client/label
 */

/**
 * 取路径的末级目录名作为 pill 标签；Windows 与 POSIX 分隔符都识别，
 * 连续分隔符与首尾分隔符被吸收。取不到非空段（异常输入）时回退原路径。
 * @param cwd - 会话工作区的完整路径。
 * @returns 末级目录名；根路径（如 `D:`）也照末段显示，完整路径始终在悬停 title 里。
 */
export function workspaceLabel(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter(segment => segment.length > 0)
  const last = segments[segments.length - 1]
  return last === undefined || last === '' ? cwd : last
}
