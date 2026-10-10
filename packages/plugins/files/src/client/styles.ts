const STYLE_ID = 'dsh-plugin-files-styles'
const CSS = `
.dsh-files-native-note{flex:none;width:100%;box-sizing:border-box;padding:5px 12px;color:var(--dsh-alias-label-tertiary);font-size:12px;line-height:1.4;border-bottom:.5px solid var(--dsw-alias-border-l1)}
[data-files-state] [data-files-entry]>button[data-files-git-marker]{position:relative}
[data-files-state] [data-files-entry]>button[data-files-git-marker]::after{content:attr(data-files-git-marker);display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:16px;margin-left:auto;font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;font-weight:650;line-height:1}
[data-files-state] [data-files-entry]>button[data-files-git-status=modified]::after{color:var(--dsh-alias-state-warn-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=added]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=untracked]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=copied]::after{color:var(--dsh-alias-state-success-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=renamed]::after{color:var(--dsh-alias-state-business-primary)}
[data-files-state] [data-files-entry]>button[data-files-git-status=deleted]::after,[data-files-state] [data-files-entry]>button[data-files-git-status=conflict]::after{color:var(--dsh-alias-state-error-primary)}
.dsh-files-preview-tab-title{display:inline-flex;flex:1 1 auto;align-items:center;gap:5px;min-width:0;max-width:100%;overflow:hidden;line-height:1.4;white-space:nowrap}
.dsh-files-preview-tab-title svg{display:block;flex:none}
.dsh-files-preview-tab-title-temporary{font-style:italic}
.dsh-files-tab-menu-item{display:block;width:100%;padding:5px 8px;color:var(--dsh-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.4;text-align:left;background:transparent;border:0;border-radius:4px;cursor:pointer}
.dsh-files-tab-menu-item:hover:not(:disabled){background:var(--dsh-alias-interactive-bg-hover)}
.dsh-files-tab-menu-item:disabled{color:var(--dsh-alias-label-tertiary);cursor:default}
[data-document-zoom-scrollport][data-files-image-pan=ready]{cursor:grab}
[data-document-zoom-scrollport][data-files-image-pan=dragging],[data-document-zoom-scrollport][data-files-image-pan=dragging] *{cursor:grabbing;user-select:none}
.dsh-files-image-toolbar{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:4px;min-height:32px;padding:4px 8px;color:var(--dsh-alias-label-primary);border:.5px solid var(--dsh-alias-border-l1);border-radius:8px;background:var(--dsh-alias-bg-layer-1);box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:10000;pointer-events:auto}
.dsh-files-image-tool{display:flex;align-items:center;justify-content:center;min-width:28px;height:24px;padding:0 6px;color:var(--dsh-alias-label-secondary);font:inherit;font-size:12px;line-height:1;border:0;border-radius:4px;background:transparent;cursor:pointer}
.dsh-files-image-tool:hover{color:var(--dsh-alias-label-primary);background:var(--dsh-alias-interactive-bg-hover)}
.dsh-files-image-tool:focus-visible{outline:2px solid var(--dsh-alias-brand-primary);outline-offset:-1px}
.dsh-files-image-percent{min-width:42px;color:var(--dsh-alias-label-secondary);font-size:12px;line-height:24px;text-align:center;font-variant-numeric:tabular-nums}
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
