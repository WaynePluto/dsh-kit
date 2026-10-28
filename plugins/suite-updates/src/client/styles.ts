/** 套件详情页配置区的局部样式；直接输出字段行，不另套卡片外壳。 */

const STYLE_ID = 'dsh-plugin-suite-updates-styles'
const CSS = `
.dsh-suite-updates{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-suite-updates-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-suite-updates-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-suite-updates-title{font:inherit;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-suite-updates-status{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.dsh-suite-updates-action{flex:none}
.dsh-suite-updates-hint{margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dsh-suite-updates-error{margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-state-error-primary)}
.dsh-suite-updates-url{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);word-break:break-all}
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
