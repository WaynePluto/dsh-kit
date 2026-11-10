/** 切模型时显式提交的偏好推理档位（dsh 没有 per-model 默认档位）。 */

/** pi-ai 的规范档位阶梯（从弱到强），与 dsh `THINKING_LEVELS` 同序。 */
const LADDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const OFF_RANK = LADDER.indexOf('off')
const HIGH_RANK = LADDER.indexOf('high')

/** 读一个档位的阶梯序；未知 id 返回 -1，表示不参与偏好选择。 */
function rankOf(id: string): number {
  return LADDER.indexOf(id as typeof LADDER[number])
}

/**
 * 为一个模型挑选切过去时要显式提交的推理档位。
 *
 * dsh 只有路由级默认档位（`providers.<route>.reasoning`）：模型不支持该档位时
 * 选择器退回 `Default`（不指定 effort）。这里按已确认的偏好补 per-model 默认——优先
 * high，其次 high 以下最高档，模型只提供更强档位时取最低可用档；不选 off。
 * @param efforts - 模型声明的档位（pi-ai 规范 id）。
 * @returns 要显式提交的档位 id；undefined 表示模型没有可选思考档位。
 */
export function preferredEffort(efforts: readonly { readonly id: string }[] | undefined): string | undefined {
  if (efforts === undefined) return undefined
  const thinking = efforts
    .map(level => ({ id: level.id, rank: rankOf(level.id) }))
    .filter(level => level.rank > OFF_RANK)
  if (thinking.length === 0) return undefined
  const atOrBelowHigh = thinking.filter(level => level.rank <= HIGH_RANK)
  if (atOrBelowHigh.length > 0) {
    return atOrBelowHigh.reduce((best, level) => level.rank > best.rank ? level : best).id
  }
  return thinking.reduce((lowest, level) => level.rank < lowest.rank ? level : lowest).id
}
