/**
 * Transitional shadow-parity runtime.
 *
 * This controller is only allowed to run when ranked gameplay is explicitly in
 * `shadow` mode or when DEV / automated parity validation needs to compare the
 * legacy TypeScript path against the authoritative Rust/WASM runtime.
 *
 * It must not drive production-ranked gameplay state in `authoritative` mode.
 */
import type { RankedChallengeManifestEntry } from './rankedChallengeManifest';
import {
  createRankedWasmRuntimeFacade,
  type RankedRuntimeFacade,
  type RankedWasmRuntimeFinalized,
  type RankedWasmRuntimeSnapshot,
} from './rankedWasmRuntime';

type HookSnapshotLike = {
  state: string | null;
  angleDeg: number;
  length: number;
};

export type RankedParityLocalSnapshot = {
  logicTick: number;
  hook: HookSnapshotLike;
  caughtCount: number;
  lastDiamondTick: number;
  entities: Array<{
    active: boolean;
    isCaught: boolean;
    collisionX: number;
    collisionY: number;
    collisionRadius: number;
  }>;
};

export interface RankedShadowParityStepSample {
  runtime: RankedWasmRuntimeSnapshot;
  local: RankedParityLocalSnapshot;
  mismatch: boolean;
}

export interface RankedShadowParityDebugState {
  ready: boolean;
  initializationAttempted: boolean;
  mismatchReported: boolean;
  recentSteps: RankedShadowParityStepSample[];
}

type ParityLogDetails = {
  stage: 'init' | 'fire' | 'step' | 'finalize';
  message: string;
  runtime?: RankedWasmRuntimeSnapshot | RankedWasmRuntimeFinalized | null;
  local?: RankedParityLocalSnapshot | null;
};

/**
 * ranked shadow parity 控制器。
 *
 * 这是一个开发期对照工具：它让旧的本地 TypeScript 路径与 authoritative
 * Rust/WASM runtime 同步推进，然后记录两者是否出现偏差。
 *
 * 约束非常明确：
 * - 它只服务 shadow 模式或 DEV 诊断；
 * - 它不会修正 production gameplay；
 * - mismatch 只用于暴露偏差，不参与结果判定。
 */
function normalizeHookState(state: string | null): RankedWasmRuntimeSnapshot['hookState'] {
  switch (state) {
    case 'swinging':
      return 'swinging';
    case 'extending':
      return 'extending';
    case 'returning-empty':
      return 'returningEmpty';
    case 'returning-loaded':
      return 'returningLoaded';
    default:
      return 'swinging';
  }
}

function approxEqual(left: number, right: number, epsilon = 0.001): boolean {
  return Math.abs(left - right) <= epsilon;
}

export class RankedShadowParityController {
  private runtime: RankedRuntimeFacade | null = null;
  private enabled = false;
  private initializationAttempted = false;
  private mismatchReported = false;
  private recentSteps: RankedShadowParityStepSample[] = [];
  private static readonly MAX_RECENT_STEPS = 12;

  async initialize(spec: RankedChallengeManifestEntry): Promise<void> {
    this.initializationAttempted = true;
    this.runtime = await createRankedWasmRuntimeFacade(spec);
    this.enabled = this.runtime !== null;
  }

  reset(): void {
    this.runtime = null;
    this.enabled = false;
    this.initializationAttempted = false;
    this.mismatchReported = false;
    this.recentSteps = [];
  }

  get isReady(): boolean {
    return this.enabled;
  }

  get hasAttemptedInitialization(): boolean {
    return this.initializationAttempted;
  }

  get debugState(): RankedShadowParityDebugState {
    return {
      ready: this.enabled,
      initializationAttempted: this.initializationAttempted,
      mismatchReported: this.mismatchReported,
      recentSteps: this.recentSteps.map((sample) => ({
        mismatch: sample.mismatch,
        runtime: {
          ...sample.runtime,
          entities: sample.runtime.entities.map((entity) => ({ ...entity })),
        },
        local: {
          ...sample.local,
          hook: {
            ...sample.local.hook,
          },
          entities: sample.local.entities.map((entity) => ({ ...entity })),
        },
      })),
    };
  }

  async applyFireHook(tick: number): Promise<void> {
    if (!this.runtime) {
      return;
    }

    try {
      await this.runtime.applyFireHook(tick);
    } catch (error) {
      this.report({
        stage: 'fire',
        message: error instanceof Error ? error.message : 'ranked wasm fireHook failed',
      });
    }
  }

  async compareStep(local: RankedParityLocalSnapshot): Promise<void> {
    if (!this.runtime) {
      return;
    }

    try {
      // shadow parity 必须与本地路径按相同 tick 节奏前进；如果 step 数量不同，
      // 即使最终 summary 相同，也无法用来判断中途状态机是否漂移。
      await this.runtime.step();
      const snapshot = await this.runtime.snapshot();
      const entityMismatch =
        snapshot.entities.length !== local.entities.length ||
        snapshot.entities.some((entity, index) => {
          const candidate = local.entities[index];
          if (!candidate) {
            return true;
          }

          return (
            entity.active !== candidate.active ||
            entity.caught !== candidate.isCaught ||
            !approxEqual(entity.collisionX, candidate.collisionX) ||
            !approxEqual(entity.collisionY, candidate.collisionY) ||
            !approxEqual(entity.collisionRadius, candidate.collisionRadius)
          );
        });

      const mismatch =
        snapshot.logicTick !== local.logicTick ||
        snapshot.diamondsCaught !== local.caughtCount ||
        snapshot.lastDiamondTick !== local.lastDiamondTick ||
        snapshot.hookState !== normalizeHookState(local.hook.state) ||
        !approxEqual(snapshot.hookAngleDeg, local.hook.angleDeg) ||
        !approxEqual(snapshot.hookLength, local.hook.length) ||
        entityMismatch;

      this.recentSteps.push({
        runtime: {
          ...snapshot,
          entities: snapshot.entities.map((entity) => ({ ...entity })),
        },
        local: {
          ...local,
          hook: {
            ...local.hook,
          },
          entities: local.entities.map((entity) => ({ ...entity })),
        },
        mismatch,
      });
      if (this.recentSteps.length > RankedShadowParityController.MAX_RECENT_STEPS) {
        this.recentSteps.splice(
          0,
          this.recentSteps.length - RankedShadowParityController.MAX_RECENT_STEPS,
        );
      }

      if (mismatch) {
        this.report({
          stage: 'step',
          message: 'ranked shadow parity mismatch',
          runtime: snapshot,
          local,
        });
      }
    } catch (error) {
      this.report({
        stage: 'step',
        message: error instanceof Error ? error.message : 'ranked wasm step failed',
        local,
      });
    }
  }

  async finalize(local: {
    finishedTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
  }): Promise<void> {
    if (!this.runtime) {
      return;
    }

    try {
      const finalized = await this.runtime.finalize();
      // finalize 阶段只比对终局关键字段；它的意义是判断“本地路径最终摘要是否仍和
      // authoritative 真值一致”，而不是补回中途 step 的所有细节。
      if (
        finalized.finishedTick !== local.finishedTick ||
        finalized.diamondsCaught !== local.diamondsCaught ||
        finalized.lastDiamondTick !== local.lastDiamondTick
      ) {
        this.report({
          stage: 'finalize',
          message: 'ranked shadow parity finalize mismatch',
          runtime: finalized,
          local: {
            logicTick: local.finishedTick,
            hook: {
              state: null,
              angleDeg: 0,
              length: 0,
            },
            caughtCount: local.diamondsCaught,
            lastDiamondTick: local.lastDiamondTick,
            entities: [],
          },
        });
      }
    } catch (error) {
      this.report({
        stage: 'finalize',
        message: error instanceof Error ? error.message : 'ranked wasm finalize failed',
      });
    }
  }

  private report(details: ParityLogDetails): void {
    if (!import.meta.env.DEV || this.mismatchReported) {
      return;
    }

    this.mismatchReported = true;
    console.warn('[ranked-shadow-parity]', details);
  }
}
