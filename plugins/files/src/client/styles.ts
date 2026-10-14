/**
 * 视图样式：单一样式标签 + dsw token，不引用上游构建后的哈希类名。
 * Git review 面板按原生 ui-deliverables 的 FileDiff.module.css 与 ReviewTab.module.css
 * （dsh 0.2.0-rc.2）逐规则复刻，类名加 dsh-files-gr 前缀。
 */
const STYLE_ID = 'dsh-plugin-files-styles'
const CSS = `
.dsh-files-native-note{flex:none;width:100%;box-sizing:border-box;padding:5px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4;border-bottom:.5px solid var(--dsw-alias-border-l1)}
[data-files-state] [data-files-entry]>button[data-files-git-marker]{position:relative}
[data-files-state] [data-files-entry]>button[data-files-git-marker]::after{content:attr(data-files-git-marker);display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:16px;margin-left:auto;font-family:var(--dsw-font-markdown-code-block-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;font-weight:650;line-height:1}
[data-files-state] [data-files-entry]>button[data-files-git-status=modified]::after{color:var(--dsw-alias-state-warn-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=added]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=untracked]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=copied]::after{color:var(--dsw-alias-state-success-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=renamed]::after{color:var(--dsw-alias-state-business-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=deleted]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=conflict]::after{color:var(--dsw-alias-state-error-primary)}
.dsh-files-preview-tab-title{display:inline-flex;flex:1 1 auto;align-items:center;gap:5px;min-width:0;max-width:100%;overflow:hidden;line-height:1.4;white-space:nowrap}
.dsh-files-preview-tab-title svg{display:block;flex:none}
.dsh-files-preview-tab-title-temporary{font-style:italic}
.dsh-files-tab-menu-item{display:block;width:100%;padding:5px 8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.4;text-align:left;background:transparent;border:0;border-radius:4px;cursor:pointer}
.dsh-files-tab-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-tab-menu-item:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
[data-document-zoom-scrollport][data-files-image-pan=ready]{cursor:grab}
[data-document-zoom-scrollport][data-files-image-pan=dragging],[data-document-zoom-scrollport][data-files-image-pan=dragging] *{cursor:grabbing;user-select:none}
.dsh-files-image-toolbar{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:4px;min-height:32px;padding:4px 8px;color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:10000;pointer-events:auto}
.dsh-files-image-tool{display:flex;align-items:center;justify-content:center;min-width:28px;height:24px;padding:0 6px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;border:0;border-radius:4px;background:transparent;cursor:pointer}
.dsh-files-image-tool:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-image-tool:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dsh-files-image-percent{min-width:42px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:24px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-files-gr{--dsh-files-gr-empty-fill:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 50%,transparent);display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}
.dsh-files-gr-header{display:flex;flex:0 0 auto;gap:6px;align-items:center;box-sizing:border-box;height:38px;padding:0 6px 0 8px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.dsh-files-gr-selector{flex:0 1 auto;min-width:0}
.dsh-files-gr-selector-label{flex:1 1 auto;min-width:0;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.dsh-files-gr-selector-button{display:inline-flex;gap:4px;align-items:center;box-sizing:border-box;max-width:100%;height:28px;padding:0 6px 0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:20px}
.dsh-files-gr-selector-button:hover,.dsh-files-gr-selector-button[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-gr-selector-button svg{display:block;flex:none}
.dsh-files-gr-item{display:flex;gap:12px;align-items:center;justify-content:space-between;min-width:0}
.dsh-files-gr-item-path{min-width:0;overflow:hidden;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-files-gr-item-counts,.dsh-files-gr-counts{display:inline-flex;flex:none;gap:6px;align-items:center;font-family:var(--ds-font-family-code);font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-files-gr-counts{min-width:0;margin-right:auto}
.dsh-files-gr-added{color:var(--dsw-alias-state-success-primary)}
.dsh-files-gr-deleted{color:var(--dsw-alias-state-error-primary)}
.dsh-files-gr-label{color:var(--dsw-alias-label-tertiary)}
.dsh-files-gr-tools{display:inline-flex;flex:none;gap:2px;align-items:center;margin-left:auto}
.dsh-files-gr-tool{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-files-gr-tool svg{width:15px;height:15px}
.dsh-files-gr-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-gr-tool[aria-pressed='true'] .dsh-files-gr-compare-icon{transform:rotate(90deg)}
.dsh-files-gr-status{display:flex;gap:12px;align-items:center;margin:0;padding:16px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-files-gr-status .dsh-files-gr-retry{flex:none}
.dsh-files-gr-note{margin:0;padding:4px 16px 8px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-files-gr-body{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:auto;padding:8px 0 16px;font:var(--dsw-font-markdown-code-block)}
.dsh-files-gr-columns{display:grid;flex:1 1 auto;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0}
.dsh-files-gr-column,.dsh-files-gr-body[data-dsh-files-gr-view=unified]:not([data-dsh-files-gr-wrap]){display:grid;grid-template-columns:minmax(max-content,100%);align-content:start}
.dsh-files-gr-column{min-width:0;overflow-x:scroll;overscroll-behavior:none}
.dsh-files-gr-column+.dsh-files-gr-column{border-left:.5px solid var(--dsw-alias-border-l3)}
.dsh-files-gr-side-line{display:grid;grid-template-columns:3.5em max-content;box-sizing:border-box;min-width:100%;width:max-content;min-height:22px;line-height:22px;white-space:pre}
.dsh-files-gr-hunk{margin-bottom:8px}
.dsh-files-gr-hunk-header{padding:4px 16px;color:var(--dsw-alias-label-tertiary);white-space:pre}
.dsh-files-gr-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);box-sizing:border-box;min-height:22px;line-height:22px;white-space:pre}
.dsh-files-gr-split-line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre}
.dsh-files-gr-cell{display:grid;grid-template-columns:3.5em minmax(0,1fr);box-sizing:border-box;min-width:0}
.dsh-files-gr-cell+.dsh-files-gr-cell{border-left:.5px solid var(--dsw-alias-border-l3)}
.dsh-files-gr-number{padding-right:8px;color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none}
.dsh-files-gr-sign{text-align:center;user-select:none}
.dsh-files-gr-text{padding-right:16px}
.dsh-files-gr-body[data-dsh-files-gr-wrap] .dsh-files-gr-line,.dsh-files-gr-body[data-dsh-files-gr-wrap] .dsh-files-gr-split-line{white-space:pre-wrap}
.dsh-files-gr-body[data-dsh-files-gr-wrap] .dsh-files-gr-text{overflow-wrap:anywhere}
.dsh-files-gr-add{--dsh-files-gr-gutter-fill:var(--dsw-alias-file-diff-added-gutter);--dsh-files-gr-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}
.dsh-files-gr-del{--dsh-files-gr-gutter-fill:var(--dsw-alias-file-diff-deleted-gutter);--dsh-files-gr-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}
.dsh-files-gr-add .dsh-files-gr-number,.dsh-files-gr-del .dsh-files-gr-number{background:var(--dsh-files-gr-gutter-fill);color:var(--dsh-files-gr-marker)}
.dsh-files-gr-add .dsh-files-gr-number:first-child,.dsh-files-gr-del .dsh-files-gr-number:first-child{box-shadow:inset 3px 0 0 var(--dsh-files-gr-marker)}
.dsh-files-gr-add .dsh-files-gr-sign,.dsh-files-gr-del .dsh-files-gr-sign{color:var(--dsh-files-gr-marker)}
.dsh-files-gr-context .dsh-files-gr-text{color:var(--dsw-alias-label-secondary)}
.dsh-files-gr-empty{background:var(--dsh-files-gr-empty-fill)}
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
