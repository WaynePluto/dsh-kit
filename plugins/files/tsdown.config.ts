import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-files',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    clientModuleTable: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  }),
)
