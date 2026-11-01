/**
 * 「置顶到列首」图标：顶部一条横线，下面一支向上箭头。官方 ui-primitives 图标库
 * 没有这个字形（IconPinOutline 是斜图钉），按其 Medium 字形族规范自绘：16 网格、
 * `fill="none"`、`currentColor`、1.3px 描边、默认线帽（对照 icons/index.tsx 的
 * ChevronUp/Copy 等 14px dock 字形）。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/PinToTopIcon
 */

/** 置顶图标（Medium 字形族描边，缺省 14px，与卡片操作按钮同尺寸使用）。 */
export function PinToTopIcon({ size = 14, className }: {
  size?: number
  className?: string | undefined
}) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth={1.3}
    >
      <path d="M3 3H13" stroke="currentColor" />
      <path d="M8 13V5" stroke="currentColor" />
      <path d="M5 8L8 5L11 8" stroke="currentColor" />
    </svg>
  )
}
