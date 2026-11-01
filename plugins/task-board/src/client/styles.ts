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
    // 提示文字只收缩不撑满：页头「添加列表」入口紧随其后（不再远推到行尾）。
    `.${CLASS}-hint{flex:0 1 auto;min-width:0;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    // 页头「添加列表」入口：标题行是 baseline 对齐，控件自居中免得图标随 baseline 抬走。
    `.${CLASS}-headingAdd{flex:none;align-self:center}`,
    `.${CLASS}-headingAddOpen{display:flex;align-items:center;gap:8px}`,
    `.${CLASS}-headingAddOpen .${CLASS}-addColumnInput{flex:0 1 240px}`,
    `.${CLASS}-status{display:flex;align-items:center;gap:8px;min-height:20px;height:20px;padding:2px 16px 0;margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);width:100%;box-sizing:border-box;overflow:hidden}`,
    `.${CLASS}-statusError{color:var(--dsw-alias-state-error-primary)}`,
    // ── 横向看板滚动区（拖到边缘时 dnd-kit autoScroll 驱动它滚动）──
    `.${CLASS}-board{flex:1;min-height:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}`,
    `.${CLASS}-columns{display:flex;align-items:stretch;gap:12px;width:max-content;height:100%;min-height:0;padding:12px 16px 16px;box-sizing:border-box}`,
    // ── 列 ──
    // 列宽契约：358px + 12px 间距 = 370px 槽，4 槽（1480px）铺满此前 5 槽（296×5）的整行；
    // Board.tsx 的 COLUMN_SLOT_PX 与此同步（列拖拽的槽位换算依赖固定槽距）。
    `.${CLASS}-list{display:flex;flex-direction:column;width:358px;flex:none;min-height:0;max-height:100%;box-sizing:border-box;background:var(--dsw-specific-tip);border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px}`,
    `.${CLASS}-listDragging{box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,0.16));opacity:0.92}`,
    // 列自身被拖拽时：源列留在原地变暗，作为落点占位（跟随指针的是悬浮影列）。
    `.${CLASS}-listSource{opacity:0.35;border-style:dashed}`,
    // 表头是整列拖拽手柄：上间距加大既是留白也是更大的热区，grab/grabbing 小手指示可拖。
    `.${CLASS}-listHeader{display:flex;align-items:center;gap:6px;padding:14px 8px 8px 12px;flex:none;touch-action:none;cursor:grab}`,
    `.${CLASS}-listHeader:active{cursor:grabbing}`,
    `.${CLASS}-listTitle{flex:1 1 auto;min-width:0;margin:0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text;border-radius:4px;padding:2px 4px}`,
    `.${CLASS}-listTitle:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    `.${CLASS}-listCount{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
    `.${CLASS}-listDelete{flex:none;opacity:0}`,
    `.${CLASS}-list:hover .${CLASS}-listDelete,.${CLASS}-listDelete:focus-visible{opacity:1}`,
    `.${CLASS}-listTitleInput{flex:1 1 auto;min-width:0;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:3px 8px;outline:none;box-sizing:border-box;cursor:text}`,
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
    // 拖拽悬浮影卡：抬升阴影 + 轻微倾角，指明「已拿起」（宽 = 列宽 − 列内左右 padding）。
    `.${CLASS}-overlayCard{display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;width:338px;box-sizing:border-box;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,0.16));transform:rotate(1.2deg);cursor:grabbing}`,
    // 拖拽悬浮影列：列形快照随指针 1:1 移动（不旋转，大面积倾斜显得散）；卡无交互光标。
    `.${CLASS}-overlayList{display:flex;flex-direction:column;width:358px;min-height:96px;max-height:70vh;background:var(--dsw-specific-tip);border:0.5px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,0.16));cursor:grabbing;overflow:hidden;box-sizing:border-box}`,
    `.${CLASS}-overlayListHead{display:flex;align-items:center;gap:6px;padding:14px 8px 8px 12px;cursor:grabbing}`,
    `.${CLASS}-overlayList .${CLASS}-cards{flex:1 1 auto;overflow:hidden}`,
    `.${CLASS}-overlayList .${CLASS}-card{cursor:grabbing}`,
    // ── 工作区 chip ──
    // 宽度契约：百分比上限只能挂在 Menu 的 anchor 包装 span（wsChipHost）上——包装 span
    // 是内容宽（chip 自身 max-content），chip 里任何 max-width:N% 都对它解析，等于永远
    // 裁掉自身 30%+固定开销（实机：6 字标题 scrollWidth 72 只分到 41.7px）。包装 span
    // 经 className 拿到 flex:0 1 auto + min-width:0 后对定宽的 cardMeta 收缩，chip 随行
    // 收缩，短标题完整显示、长标题占满 actions 之外的整行再省略。
    `.${CLASS}-wsChipHost{flex:0 1 auto;min-width:0}`,
    `.${CLASS}-wsChip{display:inline-flex;align-items:center;gap:4px;min-width:0;padding:1px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;box-sizing:border-box}`,
    `.${CLASS}-wsChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-wsChipLabel{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    `.${CLASS}-wsChip svg{flex:none;display:block}`,
    // ── 通用小图标按钮（复制/删除/发送）──
    `.${CLASS}-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;box-sizing:border-box}`,
    `.${CLASS}-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-iconBtnDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}`,
    `.${CLASS}-iconBtn svg{display:block}`,
    // 确认弹窗的危险确认键（官方 deepseek-official-switch `.deleteConfirm` 同款最低覆写）。
    `.${CLASS}-confirmDanger:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}`,
    `.${CLASS}-confirmDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}`,
    // ── 就地编辑与新增 composer ──
    `.${CLASS}-editor{width:100%;font:inherit;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:8px 10px;outline:none;resize:none;box-sizing:border-box;min-height:56px}`,
    `.${CLASS}-editor:focus{border-color:var(--dsw-alias-brand-primary)}`,
    `.${CLASS}-composerActions{display:flex;align-items:center;gap:8px;flex:none}`,
    `.${CLASS}-textBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;padding:4px 8px;cursor:pointer}`,
    `.${CLASS}-textBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    `.${CLASS}-textBtn svg{display:block}`,
    // ── 添加卡片 / 添加列表（页头输入行）──
    `.${CLASS}-addCard{flex:none;margin:0 10px 10px}`,
    `.${CLASS}-addColumnInput{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:3px 8px;outline:none;box-sizing:border-box}`,
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
