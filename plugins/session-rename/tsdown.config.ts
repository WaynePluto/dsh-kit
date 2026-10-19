import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-session-rename',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    // dsh-client-store（请求 store）经页面冻结模块表 external 复用，同 files。
    clientModuleTable: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  }),
)
