import { defineConfig } from 'tsdown'
import { createPluginBuildConfig } from '../../plugin-build/index.mjs'

export default defineConfig(
  createPluginBuildConfig({
    id: '@dsh-station/dsh-plugin-remote-runtime',
    entry: ['src/index.ts', 'src/bootstrap.ts'],
    hostDeps: { neverBundle: [/^@deepseek-ai\//] },
    client: false,
  }),
)
