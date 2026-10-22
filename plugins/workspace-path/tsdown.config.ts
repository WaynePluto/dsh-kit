import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-workspace-path',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    // react-dom/client 用于在原生菜单 DOM 里挂独立 React 根，必须向页面借同一实例。
    clientModuleTable: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
  }),
)
