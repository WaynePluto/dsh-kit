/** Bundle 详情页配置区的局部样式；直接输出字段行，不另套卡片外壳。 */

const STYLE_ID = 'dsh-plugin-web-search-switch-styles'
const CSS = `
.dsh-web-search-switch{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-web-search-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-web-search-switch-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-web-search-switch-title{font:inherit;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-search-switch-status{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.dsh-web-search-switch-toggle{flex:none}
.dsh-web-search-switch-hint{margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dsh-web-search-switch-error{margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-state-error-primary)}
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
