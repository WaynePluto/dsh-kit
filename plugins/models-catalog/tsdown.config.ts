import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-models-catalog',
    entry: ['src/index.ts'],
    hostDeps: {
      neverBundle: [/^@earendil-works\//, /^@deepseek-ai\//],
    },
    client: true,
    clientEntry: { client: 'src/client/index.tsx' },
  }),
)
