import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  clean: true,
  // 无运行时依赖；dsh 类型只在构建期使用。宿主半在插件构建期被内联。
  outExtensions: () => ({ js: '.js' }),
})
