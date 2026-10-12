// 官方 preset 包只有 default 导出（带 inject/Config 属性）；export * 不转发 default，必须两条都写。
export * from '@deepseek-ai/dsh-agent-preset'
export { default } from '@deepseek-ai/dsh-agent-preset'
