/**
 * RankedAuthoritativeRuntimeCoordinator 管理单局排位 authoritative runtime 的生命周期。
 *
 * scene 不应该直接持有 wasm runtime 实例并散落调用 snapshot/finalize，因为那样很容易
 * 让初始化、终局封存和背景 elapsed 推进互相踩状态。这个 coordinator 负责把：
 * - 初始化 gate
 * - 最新 snapshot
 * - 已 finalize 的终局 snapshot
 * 收口成单一状态机。
 */
import type { RunState } from '../../game/types/index';
import {
  createRankedWasmRuntimeFacade,
  type RankedRuntimeFacade,
  type RankedWasmRuntimeFinalized,
  type RankedWasmRuntimeSnapshot,
} from '../../game/rankedWasmRuntime';
import type { RankedChallengeManifestEntry } from '../../game/rankedChallengeManifest';

export class RankedAuthoritativeRuntimeCoordinator {
  private runtime: RankedRuntimeFacade | null = null;
  private latestSnapshot: RankedWasmRuntimeSnapshot | null = null;
  private finalizedSnapshot: RankedWasmRuntimeFinalized | null = null;
  private initialization: Promise<void> | null = null;

  reset(): void {
    this.runtime = null;
    this.latestSnapshot = null;
    this.finalizedSnapshot = null;
    this.initialization = null;
  }

  async initialize(spec: RankedChallengeManifestEntry): Promise<void> {
    // initialize promise 是这局 authoritative runtime 的共享闸门。
    // fire/step/finalize/background elapsed 都必须等它完成，不能各自重复创建 runtime。
    this.initialization = (async () => {
      this.runtime = await createRankedWasmRuntimeFacade(spec);
      if (!this.runtime) {
        throw new Error('排位权威运行时初始化失败，请稍后重试。');
      }
      this.latestSnapshot = await this.runtime.snapshot();
    })();
    await this.initialization;
  }

  get currentSnapshot(): RankedWasmRuntimeSnapshot | null {
    // snapshot 以拷贝形式返回，避免 scene/controller 在外部意外篡改 coordinator 持有的真值。
    return this.latestSnapshot
      ? {
          ...this.latestSnapshot,
          entities: this.latestSnapshot.entities.map((entity) => ({ ...entity })),
        }
      : null;
  }

  getFinalizedSnapshot(): RankedWasmRuntimeFinalized | null {
    return this.finalizedSnapshot ? { ...this.finalizedSnapshot } : null;
  }

  getDebugState() {
    if (!this.latestSnapshot && !this.finalizedSnapshot) {
      return null;
    }

    return {
      logicTick: this.latestSnapshot?.logicTick ?? this.finalizedSnapshot?.finishedTick ?? 0,
      diamondsCaught:
        this.latestSnapshot?.diamondsCaught ?? this.finalizedSnapshot?.diamondsCaught ?? 0,
      lastDiamondTick:
        this.latestSnapshot?.lastDiamondTick ?? this.finalizedSnapshot?.lastDiamondTick ?? 0,
      finishedTick: this.finalizedSnapshot?.finishedTick ?? null,
      durationMs: this.finalizedSnapshot?.durationMs ?? null,
      entityCount: this.latestSnapshot?.entities.length ?? 0,
    };
  }

  async applyFireHook(tick: number): Promise<void> {
    await this.initialization;
    await this.runtime?.applyFireHook(tick);
  }

  async step(run: RunState | null): Promise<RankedWasmRuntimeSnapshot | null> {
    // step 只镜像 authoritative runtime 推进结果，本地 scene 不在这里补做任何额外判定。
    if (!run?.rankedContext || !this.runtime) {
      await this.initialization;
    }

    if (!run?.rankedContext || !this.runtime) {
      return null;
    }

    await this.runtime.step();
    const snapshot = await this.runtime.snapshot();
    this.latestSnapshot = snapshot;
    return snapshot;
  }

  async advanceElapsedTicks(
    run: RunState | null,
    ticks: number,
  ): Promise<RankedWasmRuntimeSnapshot | null> {
    // 背景 elapsed 也必须经由 authoritative runtime 推进；不能在前端直接扣秒并猜测 hook 状态。
    if (!run?.rankedContext || ticks <= 0) {
      return this.latestSnapshot;
    }

    if (!this.runtime) {
      await this.initialization;
    }

    if (!this.runtime) {
      return this.latestSnapshot;
    }

    await this.runtime.advanceElapsedTicks(ticks);
    const snapshot = await this.runtime.snapshot();
    this.latestSnapshot = snapshot;
    return snapshot;
  }

  async finalize(): Promise<RankedWasmRuntimeFinalized | null> {
    // finalized snapshot 一旦产生，就与 latestSnapshot 分离保存，防止后续调试读取
    // 或 scene shutdown 又把终局真值覆盖掉。
    await this.initialization;
    if (!this.runtime) {
      return null;
    }

    return this.runtime.finalize();
  }

  setFinalizedSnapshot(snapshot: RankedWasmRuntimeFinalized | null): void {
    this.finalizedSnapshot = snapshot;
  }
}
