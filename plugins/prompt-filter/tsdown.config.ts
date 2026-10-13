import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../packages/plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-kit/dsh-plugin-prompt-filter',
    entry: ['src/index.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: false,
    hostName: '@dsh-kit/dsh-plugin-prompt-filter',
  }),
)
