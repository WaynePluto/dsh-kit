import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  // 面板经 createPortal 渲染进 body：portal 与页面 reconciler 必须共用同一次
  // React 实例，react-dom 显式进浏览器构建模块表（portal 插件约定）。
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-quick-commands',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    clientModuleTable: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  }),
)
