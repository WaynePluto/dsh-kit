// 假 DeepSeek LLM 服务（Anthropic Messages 协议）：供 dsh dev 实例生成带真实
// 助手消息的会话，用于浏览器端 UI 效果验证（滚动定位、面板、消息流等）。
//
// 启动：node assets/fake-deepseek-server.mjs（可用 FAKE_LLM_PORT 覆盖端口，默认 3939）
// dsh 侧以环境变量接入：DEEPSEEK_API_KEY=sk-fake-local DEEPSEEK_BASE_URL=http://127.0.0.1:<port>
//
// 协议要点（与上游 packages/llm/llm-deepseek 对齐）：
// - 端点 POST {base}/v1/messages（上游 messagesApiRoot 会自动补 /v1）
// - SSE data JSON 必须带 type 字段，且与 event: 名一致（eventsource-parser 校验）
// - 认证头 x-api-key，本服务不校验
import http from 'node:http'

const PORT = Number(process.env.FAKE_LLM_PORT) || 3939
const PARAGRAPHS = [
  '## 段落引言',
  '这是一段用于复现聊天滚动行为的较长回复文本。它包含多个段落、一些代码块与列表，',
  '目的是让单条助手消息超过视口高度，从而让滚动定位类功能有真实的滚动距离。',
  '',
  '### 细节列表',
  '1. 第一项：滚动容器的几何测量依赖 getBoundingClientRect。',
  '2. 第二项：动画逐帧推进 scrollTop，并在到达阅读线（24px）后停止。',
  '3. 第三项：落点确认后才闪烁分界线，避免虚假到达效果。',
  '',
  '```ts',
  'function scrollTopForMessage(current: number, rowTop: number, portTop: number, inset = 24) {',
  '  return Math.max(0, current + rowTop - portTop - inset)',
  '}',
  '```',
  '',
  '### 继续展开',
  '长回复还需要更多正文，才能保证在常见窗口高度下内容显著溢出。以下重复填充若干行，',
  '每行都是有效的 markdown 段落，渲染后占据真实高度。',
  '',
]

function longText(seed) {
  const parts = []
  for (let block = 0; block < 6; block += 1) {
    parts.push(`**第 ${seed}-${block + 1} 块**`)
    for (const line of PARAGRAPHS) parts.push(line)
    parts.push(`补充行 ${seed}-${block}-a：阅读线 inset 取 24px，与 dsh Turn 导航一致。`)
    parts.push(`补充行 ${seed}-${block}-b：短回复需要临时底部衬垫才能对齐阅读线。`)
    parts.push(`补充行 ${seed}-${block}-c：滚轮、触摸或键盘输入会取消进行中的定位。`)
    parts.push('')
  }
  return parts.join('\n')
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/messages')) {
    console.log(`[fake-llm] miss ${req.method} ${req.url} -> 404`)
    res.writeHead(404).end()
    return
  }
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* ignore */ }
    const seed = (body.messages ?? []).length
    const firstUser = (body.messages ?? []).find(m => m.role === 'user')
    const preview = typeof firstUser?.content === 'string'
      ? firstUser.content.slice(0, 40)
      : JSON.stringify(firstUser?.content ?? '').slice(0, 40)
    console.log(`[fake-llm] POST ${req.url} model=${body.model ?? '?'} turns=${seed} stream=${body.stream === true} prompt="${preview}"`)
    const text = longText(seed)
    const usage = { input_tokens: 10, output_tokens: 100 }
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg_fake', role: 'assistant', model: body.model ?? 'deepseek-flash',
        content: [{ type: 'text', text }], stop_reason: 'end_turn', usage,
      }))
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
    send('message_start', { message: { id: 'msg_fake', role: 'assistant', content: [], usage } })
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    let i = 0
    const timer = setInterval(() => {
      // 每 tick 发 ~80 字符，模拟流式输出；整条约 3200 字符，数秒内流完
      const piece = text.slice(i, i + 80)
      i += 80
      if (piece.length > 0) {
        send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } })
      }
      if (i >= text.length) {
        clearInterval(timer)
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } })
        send('message_stop')
        res.end()
        console.log(`[fake-llm] done turns=${seed} chars=${text.length}`)
      }
    }, 12)
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-llm] Anthropic Messages 假服务 http://127.0.0.1:${PORT}（POST /v1/messages）`))
