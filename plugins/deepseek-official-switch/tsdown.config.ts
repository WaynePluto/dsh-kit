import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-deepseek-official-switch',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    // portal 与确认弹窗共享页面运行时的 react-dom（单 React 实例，模型页同表）。
    clientModuleTable: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
  }),
)
