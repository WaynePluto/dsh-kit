/**
 * kit 组件私有 RPC 通道的共享实现。
 *
 * dsh 官方 `connection.rpc.handle` 把通道挂在 connection 行 fiber 上，注册路径要求该行
 * 注入 `webServer`；套件因此曾覆写官方 connection 行，而官方行覆写会在套件启停的
 * HMR 重组合中重启 connection/llm 级联，命中 dsh 0.2.0 session-controller 的
 * file-upload Agent resolver 二次注册竞态（详见 docs/01-decisions.md D16）。
 * 这里改走官方 `connection.fetch.register` 的 `/api` 精确 Fetch 路由：由官方共享
 * /api 桥统一应用 Host/Origin 围栏与浏览器认证，不要求 connection 行注入任何服务，
 * 套件层因此可以只含 insert 行、永不改写官方行。
 *
 * 信封：`POST /api<channel>`，请求体 `{ endpoint: string, payload?: unknown }`，
 * 响应为 {@link KitChannelResult} JSON。宿主半与浏览器半共用本文件。
 */


/** 通道失败信息；字段与 dsh `ConnectionRpcFailure` 结构一致。 */
export interface KitChannelFailure {
  readonly code: string
  readonly message: string
  readonly details: Record<string, unknown>
}

/** 一元通道结果；字段与 dsh `ConnectionRpcResult` 结构一致。 */
export type KitChannelResult<T> = { ok: true; value: T } | { ok: false; error: KitChannelFailure }

/**
 * 宿主半端点处理函数；与 dsh `ConnectionRpcHandler` 同形。
 * 返回值只要求结果信封的最小结构（ok/value | error.{code,message,details}）：
 * 插件自己的 dispatch 常以 dsh `ConnectionRpcResult` 标注，details 的具体形状
 * 各不相同，最小面让两种标注都可直接传入，包装层负责规整成 KitChannelResult。
 */
export interface KitChannelHandler {
  (endpoint: string, payload: unknown, signal: AbortSignal): Promise<{
    ok: true
    value: unknown
  } | {
    ok: false
    error: { readonly code: string, readonly message: string, readonly details: unknown }
  }>
}

/** 非 JSON 信封或 endpoint 缺失时的失败码。 */
export const BAD_REQUEST_CODE = 'kit-rpc/bad-request'

/** 端点处理函数自身抛错时的失败码（正常业务失败应返回 ok:false 而不是抛错）。 */
export const INTERNAL_CODE = 'kit-rpc/internal'

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把处理函数返回的结果信封规整成 KitChannelResult（容忍不同 details 标注）。 */
function normalizeResult(value: { ok: true, value: unknown } | { ok: false, error: { readonly code: string, readonly message: string, readonly details: unknown } }): KitChannelResult<unknown> {
  if (value.ok === true) return { ok: true, value: value.value }
  return {
    ok: false,
    error: {
      code: value.error.code,
      message: value.error.message,
      details: isRecord(value.error.details) ? value.error.details : {},
    },
  }
}

function parseResult(value: unknown): KitChannelResult<unknown> {
  if (!isRecord(value)) throw new TypeError('kit-rpc: invalid channel result envelope')
  if (value.ok === true) return { ok: true, value: value.value }
  if (value.ok === false && isRecord(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string'
    && isRecord(value.error.details)) {
    return {
      ok: false,
      error: { code: value.error.code, message: value.error.message, details: value.error.details },
    }
  }
  throw new TypeError('kit-rpc: invalid channel result envelope')
}

/**
 * 宿主半注册所需的最小上下文形状。不引用完整 cordis `Context`：d.ts 会把该类型
 * 内联进本包产物，与插件解析到的 cordis 实例形成两份类型声明，在
 * exactOptionalPropertyTypes 下互相不可赋值（CI 实测）；结构化最小面让任何
 * 形态的宿主 ctx 都能传入。
 */
export interface KitHostContext {
  readonly connection: {
    readonly fetch: {
      readonly register: (route: {
        readonly path: string
        readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
        readonly requestBody: 'buffered' | 'streaming'
        readonly fetch: (request: Request) => Promise<Response>
      }) => () => Promise<void>
    }
  }
}

/**
 * 把一个 kit 通道端点处理函数挂到 `/api` 精确 Fetch 路由。
 * @param ctx - 已注入 `connection` 的宿主插件上下文。
 * @param channel - 通道名（以 `/` 开头的单段路径，如 `/models-catalog`）；实际路由为 `/api<channel>`。
 * @param handler - 端点分发函数；抛错会被兜底成 INTERNAL 失败结果。
 * @returns 官方路由注销器。
 */
export function registerKitChannel(ctx: KitHostContext, channel: string, handler: KitChannelHandler): () => Promise<void> {
  return ctx.connection.fetch.register({
    path: `/api${channel}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let endpoint: unknown
      let payload: unknown
      try {
        const body: unknown = await request.json()
        if (isRecord(body)) {
          endpoint = body.endpoint
          payload = body.payload
        }
      } catch {
        // 落到下面的统一校验，按 bad-request 拒绝。
      }
      if (typeof endpoint !== 'string' || endpoint.length === 0) {
        return Response.json({
          ok: false,
          error: {
            code: BAD_REQUEST_CODE,
            message: 'body must be JSON { endpoint: string, payload?: unknown }',
            details: {},
          },
        } satisfies KitChannelResult<never>)
      }
      try {
        return Response.json(normalizeResult(await handler(endpoint, payload ?? {}, request.signal)))
      } catch (error) {
        return Response.json({
          ok: false,
          error: {
            code: INTERNAL_CODE,
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        } satisfies KitChannelResult<never>)
      }
    },
  })
}

/**
 * 浏览器半调用一个 kit 通道端点。
 * @param channel - 通道名（与宿主半注册一致，如 `/models-catalog`）。
 * @param endpoint - 端点名（路径段）。
 * @param payload - 请求负载；缺省为空对象。
 * @param signal - 可选取消信号。
 * @returns 通道结果；传输失败（非 2xx / 非法信封）抛 Error。
 */
export async function callKitChannel<T>(
  channel: string,
  endpoint: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<KitChannelResult<T>> {
  const response = await fetch(`/api${channel}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload: payload ?? {} }),
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) {
    throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${String(response.status)}`)
  }
  return parseResult(await response.json()) as KitChannelResult<T>
}
