import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  // @dnd-kit/core 运行时 import `react-dom`（createPortal/unstable_batchedUpdates），
  // 必须与页面共享同一次 React 实例：react-dom 显式进浏览器构建模块表（同 portal 插件约定）。
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-task-board',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    clientModuleTable: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', 'react-dom'],
  }),
)
