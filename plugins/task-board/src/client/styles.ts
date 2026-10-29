/**
 * 「任务看板」页面的 DOM/CSS 样式。
 * token 全部取 dsh design-platform alias（深浅主题各自生效）；浅色 bg-layer 全白，
 * 列与卡片的层次靠 `--dsw-specific-tip`（抬升面，浅色浅灰/深色深灰）加 0.5px 边框表达。
 * 字段（就地编辑的 input/textarea）遵循官方插件字段契约：0.5px border-l4、8px 圆角、
 * bg-layer-3、focus 只换 brand 边框色；按钮保留 UA 焦点轮廓。
 */

/** 看板规则的 class 前缀。 */
const CLASS = 'dsh-task-board'

/** 生成看板页面的全部 stylesheet 规则。 */
export function boardStyles(): string {
  return [
    // ── 页面框架 ──
    `.${CLASS}-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}`,
    `.${CLASS}-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;padding:28px 16px 0;margin:0 auto;width:100%;box-sizing:border-box;max-width:none}`,
    `[data-platform='darwin'] .${CLASS}-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}`,
    `.${CLASS}-title{flex:0 1 auto;min-width:0;margin:0;font-size:20px;line-height:28px;font-weight:500}`,
    `.${CLASS}-hint{flex:1 1 320px;min-width:0;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    `.${CLASS}-status{display:flex;align-items:center;gap:8px;min-height:20px;padding:2px 16px 0;margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);width:100%;box-sizing:border-box}`,
    `.${CLASS}-statusError{color:var(--dsw-alias-state-error-primary)}`,
    // ── 横向看板滚动区（拖到边缘时 dnd-kit autoScroll 驱动它滚动）──
    `.${CLASS}-board{flex:1;min-height:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}`,
    `.${CLASS}-columns{display:flex;align-items:stretch;gap:12px;width:max-content;height:100%;min-height:0;padding:12px 16px 16px;box-sizing:border-box}`,
    // ── 列 ──
    `.${CLASS}-list{display:flex;flex-direction:column;width:284px;flex:none;min-height:0;max-height:100%;box-sizing:border-box;background:var(--dsw-specific-tip);border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px}`,
    `.${CLASS}-listDragging{box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,0.16));opacity:0.92}`,
    `.${CLASS}-listHeader{display:flex;align-items:center;gap:6px;padding:8px 8px 4px 12px;flex:none;touch-action:none}`,
    `.${CLASS}-listTitle{flex:1 1 auto;min-width:0;margin:0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text;border-radius:4px;padding:2px 4px}`,
    `.${CLASS}-listTitle:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    `.${CLASS}-listCount{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
    `.${CLASS}-listDelete{flex:none;opacity:0}`,
    `.${CLASS}-list:hover .${CLASS}-listDelete,.${CLASS}-listDelete:focus-visible{opacity:1}`,
    `.${CLASS}-listTitleInput{flex:1 1 auto;min-width:0;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:3px 8px;outline:none;box-sizing:border-box}`,
    `.${CLASS}-listTitleInput:focus{border-color:var(--dsw-alias-brand-primary)}`,
    // ── 列内卡片滚动 ──
    `.${CLASS}-cards{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}`,
    // ── 卡片 ──
    `.${CLASS}-card{display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;cursor:grab;touch-action:none;box-sizing:border-box}`,
    `.${CLASS}-card:hover{border-color:var(--dsw-alias-border-l2)}`,
    `.${CLASS}-cardSource{opacity:0}`,
    `.${CLASS}-cardText{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;min-width:0;margin:0}`,
    `.${CLASS}-cardMeta{display:flex;align-items:center;gap:6px;min-width:0}`,
    `.${CLASS}-cardActions{display:flex;align-items:center;gap:2px;flex:none;margin-left:auto;opacity:0}`,
    `.${CLASS}-card:hover .${CLASS}-cardActions,.${CLASS}-cardActions:focus-within{opacity:1}`,
    `.${CLASS}-cardFooter{display:flex;align-items:center;min-height:22px;gap:6px}`,
    `.${CLASS}-sendWrap{margin-left:auto;opacity:0}`,
    `.${CLASS}-card:hover .${CLASS}-sendWrap,.${CLASS}-sendWrap:focus-within{opacity:1}`,
    // 拖拽悬浮影卡：抬升阴影 + 轻微倾角，指明「已拿起」。
    `.${CLASS}-overlayCard{display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;width:264px;box-sizing:border-box;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,0.16));transform:rotate(1.2deg);cursor:grabbing}`,
    // ── 工作区 chip ──
    `.${CLASS}-wsChip{display:inline-flex;align-items:center;gap:4px;max-width:70%;min-width:0;padding:1px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;box-sizing:border-box}`,
    `.${CLASS}-wsChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-wsChipLabel{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    `.${CLASS}-wsChip svg{flex:none;display:block}`,
    // ── 通用小图标按钮（复制/删除/发送）──
    `.${CLASS}-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;box-sizing:border-box}`,
    `.${CLASS}-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-iconBtnDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}`,
    `.${CLASS}-iconBtn svg{display:block}`,
    // ── 就地编辑与新增 composer ──
    `.${CLASS}-editor{width:100%;font:inherit;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:8px 10px;outline:none;resize:none;box-sizing:border-box;min-height:56px}`,
    `.${CLASS}-editor:focus{border-color:var(--dsw-alias-brand-primary)}`,
    `.${CLASS}-composerActions{display:flex;align-items:center;gap:8px;flex:none}`,
    `.${CLASS}-textBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;padding:4px 8px;cursor:pointer}`,
    `.${CLASS}-textBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-textBtn svg{display:block}`,
    // ── 添加卡片 / 添加列表 ──
    `.${CLASS}-addCard{flex:none;margin:0 10px 10px}`,
    `.${CLASS}-addColumn{display:flex;flex-direction:column;gap:8px;width:284px;flex:none;box-sizing:border-box;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:10px;background:transparent}`,
    `.${CLASS}-addColumn:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    `.${CLASS}-addColumnOpen{border-style:solid;border-color:var(--dsw-alias-border-l1);background:var(--dsw-specific-tip)}`,
    `.${CLASS}-addColumnInput{width:100%;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:6px 8px;outline:none;box-sizing:border-box}`,
    `.${CLASS}-addColumnInput:focus{border-color:var(--dsw-alias-brand-primary)}`,
    // ── 空板空态 ──
    `.${CLASS}-empty{margin:0;padding:32px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}`,
  ].join('')
}

/**
 * 安装看板 stylesheet；每个 panel 实例只安装一份。
 * @returns 卸载回调。
 */
export function installBoardStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const element = document.createElement('style')
  element.dataset['dshTaskBoard'] = ''
  element.textContent = boardStyles()
  document.head.append(element)
  return () => {
    element.remove()
  }
}

/** 按钮内的 tooltip 纯文本（原生 title 属性由组件内直接设置）。 */
export const ICON_BUTTON_CLASS = `${CLASS}-iconBtn`
