/** 设置写入契约：此处说明命名空间、校验、回读确认和草稿保留。 */

export const SELECTOR_STYLE_MARKER = 'data-dsh-plugin-favorite-models-selector'

export const selectorClasses = {
  root: 'dshx-favorite-models-selector',
  trigger: 'dshx-favorite-models-selector__trigger',
  triggerIcon: 'dshx-favorite-models-selector__trigger-icon',
  triggerLabel: 'dshx-favorite-models-selector__trigger-label',
  triggerEffort: 'dshx-favorite-models-selector__trigger-effort',
  chevron: 'dshx-favorite-models-selector__chevron',
  menu: 'dshx-favorite-models-selector__menu',
  cell: 'dshx-favorite-models-selector__cell',
  cellLabel: 'dshx-favorite-models-selector__cell-label',
  cellValue: 'dshx-favorite-models-selector__cell-value',
  cellChevron: 'dshx-favorite-models-selector__cell-chevron',
  searchRow: 'dshx-favorite-models-selector__search-row',
  search: 'dshx-favorite-models-selector__search',
  searchWithQuery: 'dshx-favorite-models-selector__search-with-query',
  searchClear: 'dshx-favorite-models-selector__search-clear',
  status: 'dshx-favorite-models-selector__status',
  error: 'dshx-favorite-models-selector__error',
  warning: 'dshx-favorite-models-selector__warning',
  retry: 'dshx-favorite-models-selector__retry',
  groups: 'dshx-favorite-models-selector__groups',
  option: 'dshx-favorite-models-selector__option',
  optionActive: 'dshx-favorite-models-selector__option-active',
  optionCopy: 'dshx-favorite-models-selector__option-copy',
  modelName: 'dshx-favorite-models-selector__model-name',
  check: 'dshx-favorite-models-selector__check',
  empty: 'dshx-favorite-models-selector__empty',
} as const

const c = selectorClasses

/** 原生 selector CSS 值（ui-model-selection/ModelSelect.module.css，dsh 0.2.2-rc.1），限定在本插件类名前缀下。 */
export const selectorStyles = `
.${c.root} {
  position: relative;
  min-width: 0;
}

.${c.trigger} {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  /* 原生注记：上限不能随行收缩——composer 以本 seat 的展开需求量宽，
     行相对上限（cqw/%）会让需求随可用宽下降，展开文字就永远「放得下」。 */
  max-width: 360px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  cursor: pointer;
}

@media (hover: hover) {
  .${c.trigger}:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.${c.trigger}:focus-visible:not([data-selection-focus]) {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}

.${c.trigger}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.${c.triggerIcon} {
  display: var(--dsh-composer-model-icon-display, none);
  flex: 0 0 auto;
}

.${c.triggerLabel},
.${c.triggerEffort} {
  display: var(--dsh-composer-model-text-display, block);
}

.${c.triggerLabel} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${c.triggerEffort} {
  /* 推理等级说明会在模型名或 chevron 之前让出宽度。 */
  flex-shrink: 1000;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-caption);
}

.${c.chevron} {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.${c.root}[data-open] .${c.chevron} {
  transform: rotate(180deg);
}

.${c.menu} {
  /** 仅几何与层级；表面材质（半透明填充 + backdrop-filter 磨砂）由 MenuSurface 提供。
   * 自绘 background 会退回无模糊的纯透明（0.2.0 起官方菜单面是半透明磨砂设计）。 */
  box-sizing: border-box;
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: min(240px, calc(100vw - 32px));
  max-width: min(420px, calc(100vw - 32px));
  max-height: min(360px, calc(100vh - 96px));
  overflow: hidden;
  padding: 4px;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.${c.status},
.${c.empty} {
  padding: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.${c.error},
.${c.warning} {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 3px;
  padding: 6px 7px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 16px;
}

.${c.warning} {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-state-warn-label);
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

.${c.searchRow} {
  position: relative;
  flex-shrink: 0;
  margin: 2px 0 3px;
}

.${c.searchRow} .${c.search} {
  display: flex;
  height: auto;
  padding: 5px 7px;
  border: 0 solid transparent;
  border-radius: var(--dsw-radius-md);
  background: transparent;
}

.${c.searchRow} .${c.searchWithQuery} {
  padding-right: 34px;
}

.${c.searchClear} {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  corner-shape: round;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.${c.searchClear}:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}

@media (hover: hover) {
  .${c.searchClear}:hover {
    outline: none;
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.${c.searchRow} .${c.search}:focus-within {
  border-color: transparent;
}

.${c.searchRow} .${c.search} input {
  padding: 0;
  font-size: 12px;
  line-height: normal;
}

@media (pointer: coarse) {
  .${c.searchRow} .${c.search} input {
    font-size: 16px;
  }
}

.${c.searchRow} .${c.search} input::placeholder {
  color: var(--dsw-alias-label-caption);
}

.${c.groups}:not([hidden]) {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.${c.option} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: auto;
  min-width: 100%;
  max-width: 100%;
  min-height: 34px;
  padding: 5px 7px;
  border: none;
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.${c.option}:focus-visible,
.${c.optionActive}:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

@media (hover: hover) {
  .${c.option}:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.${c.option}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.${c.optionCopy} {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.${c.modelName} {
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  line-height: 18px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${c.check} {
  display: grid;
  place-items: center;
  flex: 0 0 14px;
  color: var(--dsw-alias-label-primary);
}

.${c.check} svg {
  width: 14px;
  height: 14px;
}

.${c.cell} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: auto;
  min-width: 100%;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  text-align: left;
  outline: none;
}

.${c.cell}:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}

@media (hover: hover) {
  .${c.cell}:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.${c.cellLabel} {
  flex: 0 0 auto;
  white-space: nowrap;
}

.${c.cellValue} {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
}

.${c.cellChevron} {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-menu-icon);
}
`.trim()
