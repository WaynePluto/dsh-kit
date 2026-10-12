import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-copilot-auth',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@earendil-works\//] },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
    clientModuleTable: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
      'react-dom',
    ],
  }),
)
