import type { CatchResult, LevelDefinition, LevelEntitySpawn, RunState } from '../../game/types/index';
import { gameState } from '../../game/gameState';
import { RANKED_LOGIC_FRAME_SEC } from '../../game/constants';
import type { LevelEntity } from '../../objects/LevelEntity';
import {
  assertRankedChallengeMatchesSpec,
  loadRankedChallengeSpec,
} from '../../game/rankedChallengeManifest';
import {
  getRankedRuntimeMode,
  type RankedWasmRuntimeFinalized,
  type RankedWasmRuntimeSnapshot,
} from '../../game/rankedWasmRuntime';
import type { HookSnapshot } from '../../systems/HookSystem';
import { RankedAuthoritativeRuntimeCoordinator } from './RankedAuthoritativeRuntimeCoordinator';
import { RankedShadowParityCoordinator } from './RankedShadowParityCoordinator';
import { RankedLegacySpawnController } from './RankedLegacySpawnController';

/**
 * RankedDiamondRushController 是 GameplayScene 与 ranked/runtime 子系统之间的门面。
 *
 * 它的职责不是完整拥有玩法，而是统一管理这些容易混淆的边界：
 * - ranked authoritative runtime 的准备、step、finalize
 * - shadow parity 的诊断路径
 * - ranked/campaign 共用的 fixed-step action 录制接口
 * - legacy 钻石生成逻辑与 runtime snapshot 同步
 *
 * 关键约束：
 * - authoritative 只服务 ranked，不服务 campaign
 * - campaign 虽然复用 rankedContext 记 tick/actions，但最终 evidence 真值不从这里直接序列化
 */
export class RankedDiamondRushController {
  private accumulatorSec = 0;
  private pendingFire = false;
  private pendingDynamite = false;
  private runtimePreparation: Promise<void> | null = null;
  // Authoritative is the production-ranked path. Shadow remains a migration
  // and parity-validation path until the legacy TypeScript runtime is retired.
  private readonly authoritativeRuntime = new RankedAuthoritativeRuntimeCoordinator();
  private readonly shadowParity = new RankedShadowParityCoordinator();
  private readonly legacySpawn = new RankedLegacySpawnController();
  private runtimeMode = getRankedRuntimeMode();

  reset(): void {
    this.accumulatorSec = 0;
    this.pendingFire = false;
    this.pendingDynamite = false;
    this.shadowParity.reset();
    this.legacySpawn.reset();
    this.authoritativeRuntime.reset();
    this.runtimeMode = getRankedRuntimeMode();
    this.runtimePreparation = null;
  }

  async prepareRankedRuntime(run: RunState | null): Promise<void> {
    if (run?.mode !== 'ranked' || !run.rankedContext) {
      return;
    }

    const rankedContext = run.rankedContext;
    this.runtimePreparation = (async () => {
      const spec = await loadRankedChallengeSpec(
        rankedContext.challengeId,
        rankedContext.challengeVersion,
      );
      assertRankedChallengeMatchesSpec(rankedContext.challenge, spec);
      if (this.runtimeMode === 'authoritative') {
        // 生产排位路径只允许 authoritative runtime 作为真值源。
        await this.authoritativeRuntime.initialize(spec);
        return;
      }

      await this.shadowParity.initialize(spec);
    })();

    await this.runtimePreparation;
  }

  queueInputs(run: RunState | null, input: { firePressed: boolean; dynamitePressed: boolean }): void {
    if (input.firePressed) {
      this.pendingFire = true;
    }

    if (run?.mode === 'campaign' && input.dynamitePressed) {
      this.pendingDynamite = true;
    }
  }

  tickAccumulator(deltaSec: number): number {
    this.accumulatorSec = Math.min(this.accumulatorSec + deltaSec, 0.25);
    let steps = 0;
    while (this.accumulatorSec >= RANKED_LOGIC_FRAME_SEC) {
      this.accumulatorSec -= RANKED_LOGIC_FRAME_SEC;
      steps += 1;
    }
    return steps;
  }

  consumeInputs(
    run: RunState | null,
    options: {
      hookState: string | null;
      fire: () => void;
      useDynamite: (tick: number) => boolean;
    },
  ): void {
    if (!run?.rankedContext) {
      this.pendingFire = false;
      this.pendingDynamite = false;
      return;
    }

    const currentTick = run.rankedContext.logicTick;
    const usesAuthoritativeRankedInput =
      run.mode === 'ranked' && this.runtimeMode === 'authoritative';

    if (this.pendingFire) {
      if (options.hookState === 'swinging') {
        if (usesAuthoritativeRankedInput) {
          // 约束：authoritative fireHook 只能由 ranked runtime 消费。
          // campaign 如果误走这里，会让前端本地 hook 状态与上传 action 脱节，
          // 后端 replay 会直接拒绝 evidence。
          void this.authoritativeRuntime.applyFireHook(currentTick);
        } else {
          options.fire();
          if (run.mode === 'ranked') {
            void this.shadowParity.applyFireHook(currentTick);
          }
        }
        this.recordAction(run, 'fireHook', currentTick);
      }
      this.pendingFire = false;
    }

    if (run.mode === 'campaign' && this.pendingDynamite) {
      const used = options.useDynamite(currentTick);
      if (used) {
        this.recordAction(run, 'useDynamite', currentTick);
      }
      this.pendingDynamite = false;
    }
  }

  advanceLogicTick(run: RunState | null): RunState | null {
    if (!run?.rankedContext) {
      return run;
    }

    const nextRun: RunState = {
      ...run,
      rankedContext: {
        ...run.rankedContext,
        logicTick: run.rankedContext.logicTick + 1,
      },
    };

    gameState.setCurrentRun(nextRun);
    return nextRun;
  }

  isTimeLimitReached(run: RunState | null): boolean {
    if (!run?.rankedContext) {
      return false;
    }

    return run.rankedContext.logicTick >= run.rankedContext.timeLimitTicks;
  }

  get isAuthoritative(): boolean {
    return this.runtimeMode === 'authoritative';
  }

  get currentSnapshot(): RankedWasmRuntimeSnapshot | null {
    return this.authoritativeRuntime.currentSnapshot;
  }

  async stepAuthoritative(run: RunState | null): Promise<RankedWasmRuntimeSnapshot | null> {
    if (this.runtimeMode !== 'authoritative') {
      return null;
    }

    await this.runtimePreparation;
    return this.authoritativeRuntime.step(run);
  }

  async advanceAuthoritativeElapsed(
    run: RunState | null,
    elapsedSec: number,
  ): Promise<RankedWasmRuntimeSnapshot | null> {
    if (
      this.runtimeMode !== 'authoritative' ||
      !run?.rankedContext ||
      elapsedSec <= 0
    ) {
      return null;
    }

    await this.runtimePreparation;
    const remainingTicks = Math.max(
      0,
      run.rankedContext.timeLimitTicks - run.rankedContext.logicTick,
    );
    const ticks =
      elapsedSec >= run.timeRemainingSec
        ? remainingTicks
        : Math.min(
            remainingTicks,
            Math.floor(elapsedSec / RANKED_LOGIC_FRAME_SEC),
          );

    if (ticks <= 0) {
      return this.authoritativeRuntime.currentSnapshot;
    }

    // 背景 elapsed 在 authoritative 模式下不是“补 deltaSec”，
    // 而是把秒数换算成确定的逻辑 tick，再交给 runtime 逐 tick 推进。
    return this.authoritativeRuntime.advanceElapsedTicks(run, ticks);
  }

  async finalizeAuthoritative(): Promise<RankedWasmRuntimeFinalized | null> {
    if (this.runtimeMode !== 'authoritative') {
      return null;
    }

    await this.runtimePreparation;
    return this.authoritativeRuntime.finalize();
  }

  buildRankedLevelDefinition(run: RunState): LevelDefinition {
    return {
      id: run.levelId,
      group: 1,
      theme: 'LevelD',
      timeLimitSec:
        run.rankedContext && run.rankedContext.logicFps > 0
          ? run.rankedContext.timeLimitTicks / run.rankedContext.logicFps
          : 60,
      entities: [],
    };
  }

  spawnInitialDiamond(
    run: RunState | null,
    level: LevelDefinition | null,
    entities: LevelEntity[],
    createEntity: (
      spawn: LevelEntitySpawn,
      run: RunState,
      level: LevelDefinition,
      bagIndex: number | null,
    ) => LevelEntity,
  ): LevelEntity[] {
    return this.legacySpawn.spawnInitialDiamond(run, level, entities, createEntity);
  }

  spawnNextDiamond(
    run: RunState | null,
    level: LevelDefinition | null,
    entities: LevelEntity[],
    createEntity: (
      spawn: LevelEntitySpawn,
      run: RunState,
      level: LevelDefinition,
      bagIndex: number | null,
    ) => LevelEntity,
  ): LevelEntity[] {
    return this.legacySpawn.spawnNextDiamond(run, level, entities, createEntity);
  }

  handleCatchResult(run: RunState | null, _result: CatchResult): RunState | null {
    if (!run) {
      return run;
    }

    let nextRun = run;

    if (nextRun.mode === 'ranked' && nextRun.rankedContext) {
      const creditedTick = Math.min(
        nextRun.rankedContext.timeLimitTicks,
        nextRun.rankedContext.logicTick + 1,
      );
      nextRun = {
        ...nextRun,
        rankedContext: {
          ...nextRun.rankedContext,
          lastDiamondTick: creditedTick,
        },
      };
    }

    gameState.setCurrentRun(nextRun);
    return nextRun;
  }

  reportShadowParity(
    run: RunState | null,
    hookSnapshot: HookSnapshot | null,
    entities: LevelEntity[],
  ): void {
    if (this.runtimeMode === 'authoritative') {
      return;
    }

    this.shadowParity.reportStep(run, hookSnapshot, entities);
  }

  finalizeShadowParity(run: RunState | null): void {
    if (this.runtimeMode === 'authoritative') {
      return;
    }

    this.shadowParity.finalize(run);
  }

  getShadowParityDebugState() {
    return this.shadowParity.debugState;
  }

  getAuthoritativeDebugState() {
    return this.authoritativeRuntime.getDebugState();
  }

  getFinalizedSnapshot(): RankedWasmRuntimeFinalized | null {
    return this.authoritativeRuntime.getFinalizedSnapshot();
  }

  syncAuthoritativeRun(run: RunState, snapshot: RankedWasmRuntimeSnapshot): RunState {
    const nextRun: RunState = {
      ...run,
      caughtCount: snapshot.diamondsCaught,
      timeRemainingSec: Math.max(
        0,
        ((run.rankedContext?.timeLimitTicks ?? 0) - snapshot.logicTick) /
          Math.max(1, run.rankedContext?.logicFps ?? 60),
      ),
      rankedContext: run.rankedContext
        ? {
            ...run.rankedContext,
            // 约束：authoritative snapshot 回写时，前端只能镜像 runtime 当前真值，
            // 不能保留旧 tick 或本地推导出的 lastDiamondTick。
            logicTick: snapshot.logicTick,
            lastDiamondTick: snapshot.lastDiamondTick,
          }
        : null,
    };
    gameState.setCurrentRun(nextRun);
    return nextRun;
  }

  setFinalizedSnapshot(snapshot: RankedWasmRuntimeFinalized | null): void {
    this.authoritativeRuntime.setFinalizedSnapshot(snapshot);
    gameState.setLatestRankedRuntimeFinalized(snapshot);
  }

  private recordAction(
    run: RunState,
    kind: 'fireHook' | 'useDynamite',
    tick: number,
  ): void {
    const baseRun = gameState.currentRun ?? run;

    if (!baseRun?.rankedContext) {
      return;
    }

    const actions = [...baseRun.rankedContext.actions, { kind, tick }];
    const nextRun: RunState = {
      ...baseRun,
      rankedContext: {
        ...baseRun.rankedContext,
        actions,
      },
    };

    gameState.setCurrentRun(nextRun);
  }
}
