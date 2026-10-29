import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-session-park',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.ts' },
    // 纯行为组件：不渲染 React 内容、不借用页面共享模块，模块表留空。
    clientModuleTable: [],
  }),
)
