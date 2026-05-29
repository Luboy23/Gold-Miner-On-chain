import type { HookSnapshot } from '../../systems/HookSystem';
import type { RunState } from '../../game/types/index';
import type { LevelEntity } from '../../objects/LevelEntity';
import { RankedShadowParityController } from '../../game/rankedShadowParity';
import type { RankedChallengeManifestEntry } from '../../game/rankedChallengeManifest';

/**
 * shadow parity 场景级协调器。
 *
 * GameplayScene 只通过这个极薄的门面与 parity controller 交互，避免把
 * 具体的本地 snapshot 组装和 DEV 诊断细节泄漏回 gameplay 主循环。
 */
export class RankedShadowParityCoordinator {
  private readonly shadowParity = new RankedShadowParityController();

  async initialize(spec: RankedChallengeManifestEntry): Promise<void> {
    await this.shadowParity.initialize(spec);
  }

  reset(): void {
    this.shadowParity.reset();
  }

  get isReady(): boolean {
    return this.shadowParity.isReady;
  }

  get debugState() {
    return this.shadowParity.debugState;
  }

  async applyFireHook(tick: number): Promise<void> {
    await this.shadowParity.applyFireHook(tick);
  }

  reportStep(
    run: RunState | null,
    hookSnapshot: HookSnapshot | null,
    entities: LevelEntity[],
  ): void {
    if (!run?.rankedContext || !hookSnapshot || !this.shadowParity.isReady) {
      return;
    }

    // parity 只在 runtime ready 时采样，并且只镜像当前 tick 的只读局部快照；
    // 它不能反向持有实体引用，否则诊断层会污染主场景状态。
    void this.shadowParity.compareStep({
      logicTick: run.rankedContext.logicTick,
      hook: {
        state: hookSnapshot.state,
        angleDeg: hookSnapshot.angleDeg,
        length: hookSnapshot.length,
      },
      caughtCount: run.caughtCount,
      lastDiamondTick: run.rankedContext.lastDiamondTick,
      entities: entities.map((entity) => ({
        active: entity.isActive,
        isCaught: entity.isCaught,
        collisionX: entity.collisionX,
        collisionY: entity.collisionY,
        collisionRadius: entity.collisionRadius,
      })),
    });
  }

  finalize(run: RunState | null): void {
    if (!run?.rankedContext || !this.shadowParity.isReady) {
      return;
    }

    void this.shadowParity.finalize({
      finishedTick: run.rankedContext.logicTick,
      diamondsCaught: run.caughtCount,
      lastDiamondTick: run.rankedContext.lastDiamondTick,
    });
  }
}
