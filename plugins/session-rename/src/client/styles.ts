/** 重命名弹窗的输入框与错误行样式。

 * 逐条翻译 dsh 原生侧栏重命名弹窗的 `ui-workspace` `WorkspaceBrowser.module.css`
 * （`.renameInput` / `.renameError`，0.2.0-rc.2 构建产物核对）：原生输入框就是
 * `outline:none` + 0.5px border-l4、无焦点描边（弹窗内单输入框、回车即提交，
 * dsh 自身如此）；`:disabled` 换 label-dimmed。状态规则与默认规则放同一局部
 * stylesheet，不用 inline style（dsh-theme：inline 会压住 class 状态）。
 */

/** 安装弹窗 stylesheet；随插件行生失效。 */
export function installSessionRenameStyles(doc: Document | null): () => void {
  if (doc === null) return () => {}
  const element = doc.createElement('style')
  element.dataset['dshSessionRename'] = ''
  element.textContent = [
    '.dsh-session-rename-input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}',
    '.dsh-session-rename-input:disabled{color:var(--dsw-alias-label-dimmed)}',
    '.dsh-session-rename-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}',
  ].join('\n')
  doc.head.append(element)
  return () => { element.remove() }
}
