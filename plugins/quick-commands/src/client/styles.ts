/**
 * 插件命名空间样式表：触发按钮的几何复刻 composer 工具排原生 `.add` 圆形钮
 * （`ui-conversation/src/client/skeleton/InputBar.module.css` 的 `.add`，28×28、
 * 14px Medium 字形），但开关两态区分（关闭透明底次级色、打开 `--dsw-specific-selector`
 * 灰底主色，见 `.button` 段注释）；面板几何照 favorite-models 的 MenuSurface 几何类
 * （表面材质由 MenuSurface 提供，不自绘 background）。
 * 静态 `<style>` 经 marker 属性安装，卸载时移除。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client/styles
 */

/** 样式表挂载标记；同时是「本插件的样式已安装」的判别属性。 */
export const STYLE_MARKER = 'data-dsh-plugin-quick-commands-styles'

export const classes = {
  root: 'dsh-qc-root',
  button: 'dsh-qc-button',
  menu: 'dsh-qc-menu',
  status: 'dsh-qc-status',
  empty: 'dsh-qc-empty',
  error: 'dsh-qc-error',
  retry: 'dsh-qc-retry',
  list: 'dsh-qc-list',
  row: 'dsh-qc-row',
  rowText: 'dsh-qc-row-text',
  rowLabel: 'dsh-qc-row-label',
  rowActions: 'dsh-qc-row-actions',
  rowAction: 'dsh-qc-row-action',
  delete: 'dsh-qc-delete',
  editor: 'dsh-qc-editor',
  addRow: 'dsh-qc-add-row',
} as const

const c = classes

/** 按钮与面板的全部 CSS；值逐条对照原生契约（见各段注释）。 */
export const stylesheet = `
.${c.root} {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

/* 工具排圆形纯图标钮（几何复刻 InputBar.module.css 的 .add），但开关两态区分：
   关闭态透明底 + 次级图标色（与 permission/plan chip 同节奏），打开态换 .add 的
   灰底 + 主色图标——用户由此看出「点一次开、再点一次关」。 */
.${c.button} {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.${c.button}:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${c.button}[aria-expanded='true'] {
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
}

.${c.button}[aria-expanded='true']:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.${c.button}:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 仅几何与层级；表面材质（半透明填充 + backdrop-filter 磨砂）由 MenuSurface 提供。 */
.${c.menu} {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  width: 380px;
  min-width: min(320px, calc(100vw - 32px));
  max-width: min(420px, calc(100vw - 32px));
  max-height: min(360px, calc(100vh - 96px));
  overflow: hidden;
  padding: 4px;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.${c.status},
.${c.empty} {
  padding: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.${c.error} {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin: 0 4px 4px;
  padding: 7px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}

.${c.retry} {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.${c.list} {
  min-height: 0;
  overflow-y: auto;
}

/* 指令行：正文按钮占满剩余宽度（点击插入），行尾动作簇 flex:none 不被压缩
   （docs/dsh/plugins.md 的 dock 行约定）。 */
.${c.row} {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 100%;
  min-height: 34px;
  border-radius: 8px;
}

.${c.rowText} {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

.${c.rowText}:hover:not(:disabled),
.${c.rowText}:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${c.rowText}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

/* 省略号写在内层 span（flex 容器自己做不了 text-overflow，flex-centering skill）。 */
.${c.rowLabel} {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行尾动作簇：hover 或键盘聚焦行内任一元素时显现。 */
.${c.rowActions} {
  display: inline-flex;
  flex: none;
  gap: 2px;
  opacity: 0;
}

.${c.row}:hover .${c.rowActions},
.${c.row}:focus-within .${c.rowActions} {
  opacity: 1;
}

.${c.rowAction} {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.${c.rowAction}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${c.rowAction}:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}

.${c.rowAction}.${c.delete} {
  color: var(--dsw-alias-state-error-primary);
}

/* 行内编辑/新增输入框：复刻官方表单字段基准（34px 内容高、0.5px border-l4、
   8px 圆角、bg-layer-3；focus 换 brand-primary 边框，不叠加外圈）。 */
.${c.editor} {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.${c.editor}::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.${c.editor}:focus {
  border-color: var(--dsw-alias-brand-primary);
}

.${c.editor}:disabled {
  border-color: var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

/* 底部新增行：编辑框 + 提交按钮。 */
.${c.addRow} {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  margin-top: 4px;
  padding: 4px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
`.trim()

/** 安装样式表的宿主面（jsdom 测试注入最小面）。 */
export interface StyleHost {
  readonly head: Element
  createElement(tagName: string): HTMLElement
}

/**
 * 安装插件样式表（幂等：已有 marker 节点时跳过）。
 * @param host - document；测试可注入替身。
 * @returns 清理函数：移除本插件安装的 `<style>` 节点。
 */
export function installStyles(host: StyleHost | undefined): () => void {
  if (host === undefined) return () => {}
  const existing = host.head.querySelector(`style[${STYLE_MARKER}]`)
  if (existing !== null) return () => {}
  const node = host.createElement('style')
  node.setAttribute(STYLE_MARKER, '')
  node.textContent = stylesheet
  host.head.appendChild(node)
  return () => { node.remove() }
}
