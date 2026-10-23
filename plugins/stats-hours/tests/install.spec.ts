// @vitest-environment jsdom
/** 安装行为测试：与统计弹窗无关的 DOM 变更被过滤，弹窗子树变更触发改写。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionStatsHours } from '../src/client/index.js'

/** 等 MutationObserver 的微任务回调跑完。 */
function flush(): Promise<void> {
  return new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/** 造一个统计弹窗（portal 形态：dl 直挂 body）。 */
function statsDialog(): HTMLDListElement {
  const dl = document.createElement('dl')
  dl.setAttribute('data-session-stats-details', '')
  document.body.appendChild(dl)
  return dl
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('installSessionStatsHours', () => {
  it('弹窗挂载后把超一小时时长改写为三档', async () => {
    const dispose = installSessionStatsHours(document)
    const dl = statsDialog()
    const dd = document.createElement('dd')
    dd.textContent = '62分5秒'
    dl.appendChild(dd)
    await flush()
    expect(dd.textContent).toBe('1小时2分5秒')
    dispose()
  })

  it('弹窗内文本被覆写后再次改写（统计投影更新）', async () => {
    const dispose = installSessionStatsHours(document)
    const dl = statsDialog()
    const dd = document.createElement('dd')
    dd.textContent = '62分5秒'
    dl.appendChild(dd)
    await flush()
    dd.textContent = '125分3秒'
    await flush()
    expect(dd.textContent).toBe('2小时5分3秒')
    dispose()
  })

  it('聊天流式输出形态的变更批次不做全 body 扫描', async () => {
    const dispose = installSessionStatsHours(document)
    const querySpy = vi.spyOn(document.body, 'querySelectorAll')
    const chat = document.createElement('div')
    chat.innerHTML = '<p>streaming <span>token</span></p>'
    document.body.appendChild(chat)
    // 逐 token 文本更新（characterData）与普通子树变更都应被过滤。
    const text = chat.querySelector('p')?.firstChild
    if (text !== null && text !== undefined) text.textContent = 'streaming more '
    chat.querySelector('span')?.append('s')
    await flush()
    expect(querySpy).not.toHaveBeenCalled()
    querySpy.mockRestore()
    dispose()
  })

  it('卸载后弹窗变更不再被改写', async () => {
    const dispose = installSessionStatsHours(document)
    dispose()
    const dl = statsDialog()
    const dd = document.createElement('dd')
    dd.textContent = '62分5秒'
    dl.appendChild(dd)
    await flush()
    expect(dd.textContent).toBe('62分5秒')
  })
})
