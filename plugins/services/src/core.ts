/**
 * `core.ts` 的稳定兼容入口。
 * 实现按 registry、日志、pid 身份、进程生命周期和 readiness 拆分；这里显式 re-export 原入口的全部 public API，避免调用方改变 import 路径。
 *
 * @module @dsh-kit/dsh-plugin-services/core
 */

export {
  REGISTRY_VERSION,
  claimLegacyRegistry,
  readRegistry,
  registryPath,
  unionRoots,
  withRegistryLock,
  writeRegistry,
} from './registry.js'
export type { Registry, ServiceRecord } from './registry.js'

export {
  findExistingLog,
  homeLogsDir,
  legacyLogPath,
  legacyLogsDir,
  listLegacyLogNames,
  listLogNames,
  logPath,
  readText,
  tailFile,
} from './logs.js'

export {
  findExecutable,
  identify,
  identifyBatch,
  isPidAlive,
  processStartedAt,
  processStartTimes,
  reconcile,
  reconcileIdentified,
  reportedIdentity,
  START_TIME_TOLERANCE_MS,
} from './process-identity.js'
export type { Identity, IdentityEntry } from './process-identity.js'

export {
  ENV_OVERRIDES,
  killTree,
  shellDialectWarning,
  shellInvocation,
  startProcess,
} from './process-lifecycle.js'
export type { ShellInvocation, StartOptions } from './process-lifecycle.js'

export {
  matchesReadyLog,
  waitForReady,
} from './readiness.js'
export type { ReadyOptions, ReadyOutcome } from './readiness.js'
