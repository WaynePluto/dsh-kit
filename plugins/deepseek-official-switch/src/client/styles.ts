/** 模型页注入的局部样式；删除按钮逐项复刻原生 rowActions 紧凑档危险按钮。 */

const STYLE_ID = 'dsh-plugin-deepseek-official-switch-styles'
const CSS = `
.dsh-deepseek-official-switch-remove{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-deepseek-official-switch-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-deepseek-official-switch-remove:disabled{opacity:0.4;cursor:default}
.dsh-deepseek-official-switch-remove:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dsh-deepseek-official-switch-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-deepseek-official-switch-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dsh-deepseek-official-switch-confirm:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-deepseek-official-switch-confirm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-deepseek-official-switch-footer{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-deepseek-official-switch-footer-text{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);min-width:0}
.dsh-deepseek-official-switch-restore{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-deepseek-official-switch-restore:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-deepseek-official-switch-restore:disabled{opacity:0.4;cursor:default}
.dsh-deepseek-official-switch-restore:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
`

export function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}
