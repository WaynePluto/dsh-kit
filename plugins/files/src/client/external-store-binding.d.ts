/**
 * 测试专用：`use-sync-external-store/shim/with-selector` 的最小类型声明。
 * 该包经 react-dom 18.3.1 的传递依赖在工作区 hoisted 解析（运行时无需声明），
 * 1.2.0 不自带类型；此声明只覆盖回归测试 `gitReviewBinding.spec.tsx` 用到的形状，
 * 语义与 `packages/client/ui-renderer/src/client/bind.ts` 的绑定一致。
 */
declare module 'use-sync-external-store/shim/with-selector' {
  export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot: undefined,
    selector: (snapshot: Snapshot) => Selection,
    isEqual?: (left: Selection, right: Selection) => boolean,
  ): Selection
}
