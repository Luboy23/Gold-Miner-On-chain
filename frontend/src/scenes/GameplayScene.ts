import Phaser from 'phaser';

import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import {
  DEFAULT_STRENGTH_MULTIPLIER,
  MAX_DYNAMITE_COUNT,
  RANKED_LOGIC_FRAME_SEC,
} from '../game/constants';
import { BackgroundTimingTracker } from '../game/backgroundTiming';
import { DEFAULT_TEMPORARY_BUFFS } from '../game/constants';
import { configureLogicalCamera } from '../game/display';
import { gameState } from '../game/gameState';
import { restoreRunFromRestartSnapshot } from '../game/runRestart';
import { SCENE_KEYS } from '../game/sceneKeys';
import {
  applyStrengthBoostMultiplier,
  getInitialStrengthMultiplier,
} from '../game/strengthBuffs';
import type {
  CatchResult,
  GameplayScenePayload,
  LevelDefinition,
  RunRestartSnapshot,
  RunState,
} from '../game/types/index';
import type { LevelEntity } from '../objects/LevelEntity';
import { levelSystem } from '../systems/LevelSystem';
import { HookSystem } from '../systems/HookSystem';
import { ScoreTimerSystem } from '../systems/ScoreTimerSystem';
import { GameplayEntityFactory } from './gameplay/GameplayEntityFactory';
import { GameplayHudController, type GameplayLayoutSnapshot } from './gameplay/GameplayHudController';
import { GameplayInputController } from './gameplay/GameplayInputController';
import { GameplayLoopCoordinator } from './gameplay/GameplayLoopCoordinator';
import { GameplayOutcomeController } from './gameplay/GameplayOutcomeController';
import { GameplayPresentationController } from './gameplay/GameplayPresentationController';
import { RankedDiamondRushController } from './gameplay/RankedDiamondRushController';
import { VerifiedStepDrain } from './gameplay/VerifiedStepDrain';
import { composeGameplaySceneControllers } from './gameplay/GameplaySceneComposition';
import { PauseMenuModal, type PauseMenuAction } from './common/PauseMenuModal';
import { prepareRankedRunForChallenge } from '../game/rankedStart';

/**
 * GameplayScene 是局内运行时的总装配点。
 *
 * 这里持有“场景级生命周期”和“局内共享状态”的最终控制权：
 * - Scene create/update/shutdown
 * - 本地 run 与 gameState.currentRun 的同步
 * - 关卡系统、输入、表现、结算控制器的装配
 * - 前台逐帧推进与失焦后的背景补账
 *
 * 这里刻意不直接承载所有玩法细节：
 * - 排位 authoritative/shadow 细节交给 RankedDiamondRushController
 * - 结算流转交给 GameplayOutcomeController
 * - 固定步长/背景补账调度交给 GameplayLoopCoordinator
 *
 * 阅读这个文件时，优先按“时序”理解：
 * 1. create 时装配控制器和系统
 * 2. update 中先消费背景 elapsed，再处理输入，再推进一小步玩法
 * 3. 一旦进入 ending，当前关不允许再继续推进或录入结果
 */
const MINER_DYNAMITE_ANIMATION_DURATION_SEC = 0.39;

function isVerifiedRun(run: RunState | null): boolean {
  return run?.mode === 'ranked' || run?.mode === 'campaign';
}

export class GameplayScene extends Phaser.Scene {
  private run: RunState | null = null;
  private restartSnapshot: RunRestartSnapshot | null = null;
  private level: LevelDefinition | null = null;
  private entities: LevelEntity[] = [];
  private hookSystem: HookSystem | null = null;
  private scoreTimerSystem: ScoreTimerSystem | null = null;
  private hudController: GameplayHudController | null = null;
  private rankedDiamondRushController: RankedDiamondRushController | null = null;
  private outcomeController: GameplayOutcomeController | null = null;
  private presentationController: GameplayPresentationController | null = null;
  private inputController: GameplayInputController | null = null;
  private entityFactory: GameplayEntityFactory | null = null;
  private loopCoordinator: GameplayLoopCoordinator | null = null;
  private backgroundTiming: BackgroundTimingTracker | null = null;
  private applyingBackgroundElapsed = false;
  private ending = false;
  private gameplaySessionId = 0;
  private verifiedStepDrain: VerifiedStepDrain | null = null;
  private levelStrengthMultiplier = DEFAULT_STRENGTH_MULTIPLIER;
  private forcedGoalResolved = false;
  private forcedGoalDelaySec = 0.12;
  private previousRankedCaughtCount = 0;
  private pauseMenuModal: PauseMenuModal | null = null;
  private pauseMenuVisible = false;
  private brandFooter: BrandFooterHandle | null = null;
  private backgroundTimingPaused = false;
  private suppressEscapeUntilRelease = false;
  private readonly handlePauseMenuUpKey = (): void => {
    if (this.pauseMenuVisible) {
      this.pauseMenuModal?.handleDirectionalInput('up');
    }
  };
  private readonly handlePauseMenuDownKey = (): void => {
    if (this.pauseMenuVisible) {
      this.pauseMenuModal?.handleDirectionalInput('down');
    }
  };
  private readonly handlePauseMenuEnterKey = (): void => {
    if (this.pauseMenuVisible) {
      this.pauseMenuModal?.handleConfirm();
    }
  };
  private readonly handlePauseMenuEscKey = (): void => {
    if (this.pauseMenuVisible) {
      this.pauseMenuModal?.handleCancel();
    }
  };

  constructor() {
    super(SCENE_KEYS.Gameplay);
  }

  init(data?: Partial<GameplayScenePayload>): void {
    this.gameplaySessionId += 1;
    this.ending = false;
    this.forcedGoalResolved = false;
    this.forcedGoalDelaySec = 0.12;
    this.previousRankedCaughtCount = 0;
    this.applyingBackgroundElapsed = false;
    this.pauseMenuVisible = false;
    this.backgroundTimingPaused = false;
    this.suppressEscapeUntilRelease = false;
    const sessionId = this.gameplaySessionId;
    this.verifiedStepDrain = new VerifiedStepDrain(() => (
      this.stepVerifiedLoop(sessionId, RANKED_LOGIC_FRAME_SEC)
    ));
    this.restartSnapshot = data?.restartSnapshot ?? null;
    this.run = data?.run ?? gameState.currentRun;
    this.rankedDiamondRushController ??= new RankedDiamondRushController();
    this.level = this.run
      ? this.run.mode === 'ranked'
        ? this.rankedDiamondRushController.buildRankedLevelDefinition(this.run)
        : levelSystem.getLevelDefinition(this.run.levelId)
      : null;
  }

  create(): void {
    if (!this.run || !this.level) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const activeRun: RunState = {
      ...this.run,
      status: 'playing',
      currentShopOffers: null,
      timeRemainingSec:
        this.run.timeRemainingSec > 0
          ? this.run.timeRemainingSec
          : this.level.timeLimitSec,
    };

    this.run = activeRun;
    gameState.setCurrentRun(activeRun);
    this.previousRankedCaughtCount = activeRun.caughtCount;

    configureLogicalCamera(this);
    const controllers = composeGameplaySceneControllers(
      this,
      this.rankedDiamondRushController,
    );
    this.hudController = controllers.hudController;
    this.rankedDiamondRushController = controllers.rankedDiamondRushController;
    this.rankedDiamondRushController.reset();
    if (activeRun.mode === 'ranked') {
      void this.rankedDiamondRushController
        .prepareRankedRuntime(activeRun)
        .then(() => {
          if (!this.sys.isActive()) {
            return;
          }

          const snapshot = this.rankedDiamondRushController?.currentSnapshot;

          if (snapshot && this.hookSystem) {
            this.hookSystem.applyRankedSnapshot(snapshot, this.entities);
          }
        });
    }
    this.outcomeController = controllers.outcomeController;
    this.presentationController = controllers.presentationController;
    this.inputController = controllers.inputController;
    this.entityFactory = controllers.entityFactory;
    this.loopCoordinator = controllers.loopCoordinator;
    this.presentationController.create(
      this.level,
      import.meta.env.DEV && gameState.snapshot.debug.showHitCircles,
    );
    this.brandFooter = createBrandFooter(
      this,
      getBrandFooterLayout('gameplay'),
    );
    this.createHud(activeRun);
    this.createSystems(activeRun, this.level);
    this.inputController.create();
    this.backgroundTiming = new BackgroundTimingTracker();
    this.backgroundTiming.start();
    this.pauseMenuModal = new PauseMenuModal(this, {
      onSelect: (action) => {
        this.handlePauseMenuAction(action);
      },
      onCancel: () => {
        this.hidePauseMenu();
      },
    });
    this.bindPauseMenuKeyboard();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupScene();
    });
  }

  override update(_time: number, delta: number): void {
    if (
      this.ending ||
      this.applyingBackgroundElapsed ||
      !this.run ||
      !this.level ||
      !this.hookSystem ||
      !this.scoreTimerSystem ||
      !this.hudController ||
      !this.inputController
    ) {
      return;
    }

    if (this.pauseMenuVisible) {
      return;
    }

    this.applyBackgroundElapsed();

    if (this.ending || this.applyingBackgroundElapsed) {
      return;
    }

    const deltaSec = Math.min(delta / 1000, 0.25);
    if (
      this.suppressEscapeUntilRelease &&
      !this.inputController.isEscapeDown()
    ) {
      this.suppressEscapeUntilRelease = false;
    }
    const frameInput = this.inputController.pollFrameInput();

    if (!this.suppressEscapeUntilRelease && frameInput.escapePressed) {
      this.showPauseMenu();
      return;
    }

    if (frameInput.toggleCollisionDebug) {
      const debugVisible = this.presentationController?.toggleCollisionDebug();
      this.presentationController?.showDevToast(
        debugVisible ? '碰撞调试 开' : '碰撞调试 关',
      );
    }

    if (frameInput.toggleForceGoalReached) {
      const nextForceGoalReached = !gameState.debug.forceGoalReached;
      gameState.updateDebugFlags({ forceGoalReached: nextForceGoalReached });
      this.forcedGoalDelaySec = 0.12;
      this.presentationController?.showDevToast(
        nextForceGoalReached ? '强制达标 开' : '强制达标 关',
      );
    }

    if (isVerifiedRun(this.run)) {
      this.rankedDiamondRushController?.queueInputs(this.run, {
        firePressed: frameInput.firePressed,
        dynamitePressed: frameInput.dynamitePressed,
      });

      const steps = this.rankedDiamondRushController?.tickAccumulator(deltaSec) ?? 0;
      for (let index = 0; index < steps && !this.ending; index += 1) {
        this.stepGameplay(RANKED_LOGIC_FRAME_SEC, true);
      }
    } else {
      if (frameInput.firePressed) {
        this.hookSystem.fire();
      }

      if (frameInput.dynamitePressed) {
        this.tryUseDynamite();
      }

      this.stepGameplay(deltaSec, false);
    }

    if (this.ending) {
      return;
    }

    this.presentationController?.updatePresentationState(deltaSec);
    this.presentationController?.syncMinerAnimation(
      this.hookSystem?.snapshot.state ?? null,
    );
    this.syncHud();
    this.presentationController?.syncDebugGraphics(
      this.entities,
      this.hookSystem?.snapshot
        ? {
            collisionX: this.hookSystem.snapshot.collisionX,
            collisionY: this.hookSystem.snapshot.collisionY,
          }
        : null,
    );
  }

  private createHud(run: RunState): void {
    this.hudController?.createHud(run);
  }

  private createSystems(run: RunState, level: LevelDefinition): void {
    this.levelStrengthMultiplier = getInitialStrengthMultiplier(run);
    this.entities = this.entityFactory?.createInitialEntities(
      run,
      level,
      this.rankedDiamondRushController,
    ) ?? [];

    this.hookSystem = new HookSystem(this);
    this.hookSystem.setStrengthMultiplier(this.levelStrengthMultiplier);
    this.scoreTimerSystem = new ScoreTimerSystem(run);
  }

  private handleCatchResult(result: CatchResult): void {
    if (!this.run || !this.scoreTimerSystem) {
      return;
    }

    this.scoreTimerSystem.applyCatch(result);

    let nextRun = this.run;

    if (result.dynamiteDelta > 0) {
      nextRun = {
        ...nextRun,
        dynamiteCount: Math.min(
          MAX_DYNAMITE_COUNT,
          nextRun.dynamiteCount + result.dynamiteDelta,
        ),
      };
    }

    if (result.grantsStrengthBoost) {
      this.levelStrengthMultiplier = applyStrengthBoostMultiplier(
        this.levelStrengthMultiplier,
      );
      this.hookSystem?.setStrengthMultiplier(this.levelStrengthMultiplier);
    }

    nextRun = {
      ...nextRun,
      caughtCount: nextRun.caughtCount + 1,
    };

    nextRun = this.rankedDiamondRushController?.handleCatchResult(nextRun, result) ?? nextRun;

    this.run = nextRun;
    gameState.setCurrentRun(nextRun);

    if (
      nextRun.mode === 'ranked' &&
      nextRun.rankedContext &&
      nextRun.rankedContext.logicTick + 1 < nextRun.rankedContext.timeLimitTicks &&
      this.level
    ) {
      this.entities = this.entityFactory?.spawnNextRankedDiamond(
        nextRun,
        this.level,
        this.entities,
        this.rankedDiamondRushController,
      ) ?? this.entities;
    }
  }

  private applyBackgroundElapsed(): void {
    if (
      this.ending ||
      this.pauseMenuVisible ||
      !this.run ||
      !this.scoreTimerSystem ||
      !this.loopCoordinator ||
      !this.backgroundTiming
    ) {
      return;
    }

    const elapsedMs = this.backgroundTiming.consumeElapsedMs();

    if (elapsedMs <= 0) {
      return;
    }

    const elapsedSec = elapsedMs / 1000;

    // 约束：失焦补账必须先于任何新的输入消费发生。
    // 否则玩家回焦后的第一帧输入可能被错误记入“离焦前本应已经结束”的局面。
    if (
      isVerifiedRun(this.run) &&
      this.hookSystem &&
      this.rankedDiamondRushController
    ) {
      if (
        this.run.mode === 'ranked' &&
        this.rankedDiamondRushController.isAuthoritative
      ) {
        const sessionId = this.gameplaySessionId;
        this.applyingBackgroundElapsed = true;
        void this.applyVerifiedBackgroundElapsed(sessionId, elapsedSec).finally(() => {
          if (this.gameplaySessionId === sessionId) {
            this.applyingBackgroundElapsed = false;
          }
        });
        return;
      }

      this.advanceClassicBackgroundElapsed(elapsedSec, true);
      return;
    }

    this.advanceClassicBackgroundElapsed(elapsedSec, false);
  }

  async advanceBackgroundElapsedForTests(elapsedSec: number): Promise<void> {
    if (
      this.ending ||
      this.pauseMenuVisible ||
      elapsedSec <= 0 ||
      !this.run ||
      !this.scoreTimerSystem ||
      !this.loopCoordinator
    ) {
      return;
    }

    if (
      isVerifiedRun(this.run) &&
      this.hookSystem &&
      this.rankedDiamondRushController
    ) {
      if (
        this.run.mode === 'ranked' &&
        this.rankedDiamondRushController.isAuthoritative
      ) {
        const sessionId = this.gameplaySessionId;
        this.applyingBackgroundElapsed = true;
        try {
          await this.applyVerifiedBackgroundElapsed(sessionId, elapsedSec);
        } finally {
          if (this.gameplaySessionId === sessionId) {
            this.applyingBackgroundElapsed = false;
          }
        }
        return;
      }

      this.advanceClassicBackgroundElapsed(elapsedSec, true);
      return;
    }

    this.advanceClassicBackgroundElapsed(elapsedSec, false);
  }

  private advanceClassicBackgroundElapsed(
    elapsedSec: number,
    rankedFixedStep: boolean,
  ): void {
    if (!this.run || !this.hookSystem || !this.scoreTimerSystem) {
      return;
    }

    let remainingSec = elapsedSec;
    this.setSilentBackgroundSimulation(true);

    try {
      // 这里故意复用 stepGameplay，而不是只扣 timer。
      // 背景补账的目标是把抓钩、实体、命中和计时一起快进到“现在应该在的位置”，
      // 只是关闭音效和即时反馈，避免回焦时补播一串过时表现。
      while (!this.ending && remainingSec > 0) {
        const stepSec = Math.min(RANKED_LOGIC_FRAME_SEC, remainingSec);
        this.stepGameplay(stepSec, rankedFixedStep);
        remainingSec -= stepSec;
      }
    } finally {
      this.setSilentBackgroundSimulation(false);
    }

    this.syncRunStateFromScoreTimer();
  }

  private setSilentBackgroundSimulation(silent: boolean): void {
    this.hookSystem?.setSilent(silent);
    for (const entity of this.entities) {
      entity.setSilent?.(silent);
    }
  }

  private async applyVerifiedBackgroundElapsed(
    sessionId: number,
    elapsedSec: number,
  ): Promise<void> {
    if (
      !this.isCurrentGameplaySession(sessionId) ||
      this.ending ||
      !this.run ||
      !this.hookSystem ||
      !this.scoreTimerSystem ||
      !this.rankedDiamondRushController ||
      !this.loopCoordinator
    ) {
      return;
    }

    await this.verifiedStepDrain?.awaitIdle();
    if (!this.isCurrentGameplaySession(sessionId) || this.ending) {
      return;
    }

    this.setSilentBackgroundSimulation(true);
    let result;

    try {
      result = await this.loopCoordinator.applyVerifiedBackgroundElapsed({
        run: this.run,
        elapsedSec,
        rankedDiamondRushController: this.rankedDiamondRushController,
        hookSystem: this.hookSystem,
        scoreTimerSystem: this.scoreTimerSystem,
        entities: this.entities,
        previousRankedCaughtCount: this.previousRankedCaughtCount,
        syncEntities: (snapshot) => {
          this.syncAuthoritativeEntities(snapshot);
        },
      });
    } finally {
      this.setSilentBackgroundSimulation(false);
    }

    if (!this.isCurrentGameplaySession(sessionId)) {
      return;
    }

    if (result.kind !== 'authoritative-stepped') {
      return;
    }

    this.run = result.run;
    this.previousRankedCaughtCount = result.previousRankedCaughtCount;
    this.syncRunStateFromScoreTimer();

    if (result.timeLimitReached || this.scoreTimerSystem.snapshot.timeRemainingSec <= 0) {
      if (this.scoreTimerSystem.snapshot.reachedGoal) {
        this.completeLevel();
      } else {
        this.failRun();
      }
    }
  }

  private tryUseDynamite(_rankTick?: number): boolean {
    if (
      !this.run ||
      !this.hookSystem ||
      this.run.mode === 'ranked' ||
      this.run.dynamiteCount <= 0
    ) {
      return false;
    }

    if (!this.hookSystem.useDynamite()) {
      return false;
    }

    const nextRun: RunState = {
      ...this.run,
      dynamiteCount: Math.max(0, this.run.dynamiteCount - 1),
    };

    this.presentationController?.triggerDynamiteUse(
      MINER_DYNAMITE_ANIMATION_DURATION_SEC,
    );
    this.run = nextRun;
    gameState.setCurrentRun(nextRun);
    this.presentationController?.syncMinerAnimation(
      this.hookSystem.snapshot.state,
    );

    return true;
  }

  private stepGameplay(deltaSec: number, rankedFixedStep: boolean): void {
    if (!this.run || !this.hookSystem || !this.scoreTimerSystem) {
      return;
    }

    if (
      rankedFixedStep &&
      this.rankedDiamondRushController?.isTimeLimitReached(this.run)
    ) {
      this.scoreTimerSystem.expireTime();
      if (this.scoreTimerSystem.snapshot.reachedGoal) {
        this.completeLevel();
      } else {
        this.failRun();
      }
      return;
    }

    if (rankedFixedStep) {
      // 约束：固定步长输入消费前，gameState 必须先对齐到 scene-local run。
      // campaign/ranked 的 action 录证逻辑会回写 currentRun，如果这里仍是旧值，
      // 后续 evidence/tick 可能被过时状态覆盖。
      // Keep the shared store aligned with the scene-local run before we consume
      // fixed-step input. This prevents stale currentRun state from clobbering
      // the latest ranked tick/evidence state during exact-budget finishes.
      gameState.setCurrentRun(this.run);
      this.rankedDiamondRushController?.consumeInputs(this.run, {
        hookState: this.hookSystem.snapshot.state,
        fire: () => {
          this.hookSystem?.fire();
        },
        useDynamite: (tick) => {
          return this.tryUseDynamite(tick);
        },
      });
      this.run = gameState.currentRun ?? this.run;
    }

    if (
      rankedFixedStep &&
      this.run &&
      this.rankedDiamondRushController &&
      this.hookSystem &&
      this.scoreTimerSystem &&
      this.loopCoordinator
    ) {
      if (
        this.run.mode === 'ranked' &&
        this.rankedDiamondRushController.isAuthoritative
      ) {
        this.verifiedStepDrain?.queueTick();
        return;
      }

      void this.stepVerifiedLoop(this.gameplaySessionId, deltaSec);
    }

    const catchResult = this.hookSystem.update(deltaSec, this.entities);

    for (const entity of this.entities) {
      entity.update(deltaSec);
    }

    if (catchResult) {
      this.handleCatchResult(catchResult);
    }

    this.scoreTimerSystem.update(deltaSec, {
      infiniteTime: gameState.snapshot.debug.infiniteTime,
    });
    this.syncRunStateFromScoreTimer();

    if (rankedFixedStep) {
      this.run = this.rankedDiamondRushController?.advanceLogicTick(this.run) ?? this.run;
      this.rankedDiamondRushController?.reportShadowParity(
        this.run,
        this.hookSystem.snapshot,
        this.entities,
      );
      if (this.rankedDiamondRushController?.isTimeLimitReached(this.run)) {
        this.scoreTimerSystem.expireTime();
        if (this.scoreTimerSystem.snapshot.reachedGoal) {
          this.completeLevel();
        } else {
          this.failRun();
        }
        return;
      }
    }

    if (
      import.meta.env.DEV &&
      gameState.snapshot.debug.forceGoalReached &&
      !this.forcedGoalResolved
    ) {
      this.forcedGoalDelaySec = Math.max(0, this.forcedGoalDelaySec - deltaSec);

      if (this.forcedGoalDelaySec === 0) {
        this.forcedGoalResolved = true;
        this.forceCurrentLevelGoalReached();
        return;
      }
    }

    if (this.scoreTimerSystem.snapshot.timeRemainingSec <= 0) {
      if (this.scoreTimerSystem.snapshot.reachedGoal) {
        this.completeLevel();
      } else {
        this.failRun();
      }
    }
  }

  private async stepVerifiedLoop(
    sessionId: number,
    deltaSec: number,
  ): Promise<void> {
    if (
      !this.isCurrentGameplaySession(sessionId) ||
      !this.run ||
      !this.hookSystem ||
      !this.scoreTimerSystem ||
      !this.rankedDiamondRushController ||
      !this.loopCoordinator
    ) {
      return;
    }

    const result = await this.loopCoordinator.stepVerifiedRun({
      run: this.run,
      deltaSec,
      rankedDiamondRushController: this.rankedDiamondRushController,
      hookSystem: this.hookSystem,
      scoreTimerSystem: this.scoreTimerSystem,
      entities: this.entities,
      previousRankedCaughtCount: this.previousRankedCaughtCount,
      syncEntities: (snapshot) => {
        this.syncAuthoritativeEntities(snapshot);
      },
      onCatchFeedback: (delta) => {
        // authoritative ranked 的分数真值来自 runtime snapshot。
        // 这里补的是“前端表现上的加分反馈”，不是在本地重新决定胜负。
        for (let index = 0; index < delta; index += 1) {
          this.scoreTimerSystem?.applyCatch({
            entityType: 'Diamond',
            bonus: 600,
            bonusTier: 'high',
            rewardKind: 'money',
            feedbackText: '+$600',
            dynamiteDelta: 0,
            grantsStrengthBoost: false,
          });
        }
      },
    });

    if (!this.isCurrentGameplaySession(sessionId)) {
      return;
    }

    if (result.kind !== 'authoritative-stepped') {
      return;
    }

    this.run = result.run;
    this.previousRankedCaughtCount = result.previousRankedCaughtCount;

    if (
      import.meta.env.DEV &&
      gameState.snapshot.debug.forceGoalReached &&
      !this.forcedGoalResolved
    ) {
      this.forcedGoalDelaySec = Math.max(0, this.forcedGoalDelaySec - deltaSec);

      if (this.forcedGoalDelaySec === 0) {
        this.forcedGoalResolved = true;
        this.forceCurrentLevelGoalReached();
        return;
      }
    }

    if (result.timeLimitReached) {
      this.scoreTimerSystem.expireTime();
      if (this.scoreTimerSystem.snapshot.reachedGoal) {
        this.completeLevel();
      } else {
        this.failRun();
      }
    }
  }

  private syncAuthoritativeEntities(snapshot: {
    entities: Array<{
      active: boolean;
      caught: boolean;
      collisionX: number;
      collisionY: number;
    }>;
  }): void {
    if (!this.entities.length) {
      return;
    }

    for (let index = 0; index < this.entities.length; index += 1) {
      const entity = this.entities[index];
      const nextSnapshot = snapshot.entities[index];
      if (!entity || !nextSnapshot) {
        continue;
      }
      entity.syncSnapshot?.(nextSnapshot);
    }
  }

  private forceCurrentLevelGoalReached(): void {
    if (!this.run || !this.scoreTimerSystem) {
      return;
    }

    const forcedScore = Math.max(
      this.run.goal + this.run.levelGroup * 1000,
      this.scoreTimerSystem.snapshot.score,
    );

    this.scoreTimerSystem.forceScore(forcedScore);
    this.completeLevel();
  }

  private syncHud(): void {
    this.hudController?.syncHud(this.run, this.scoreTimerSystem);
  }

  private syncRunStateFromScoreTimer(): void {
    if (!this.run || !this.scoreTimerSystem) {
      return;
    }

    const snapshot = this.scoreTimerSystem.snapshot;
    const nextRun: RunState = {
      ...this.run,
      score: snapshot.score,
      scoreView: snapshot.scoreView,
      timeRemainingSec: snapshot.timeRemainingSec,
    };

    this.run = nextRun;
    gameState.setCurrentRun(nextRun);
  }

  getGameplayLayoutSnapshot(): GameplayLayoutSnapshot | null {
    return this.hudController?.getLayoutSnapshot(
      this.presentationController?.getMinerSprite() ?? null,
      this.hookSystem?.snapshot
        ? {
            originX: this.hookSystem.snapshot.originX,
            originY: this.hookSystem.snapshot.originY,
            tipX: this.hookSystem.snapshot.tipX,
            tipY: this.hookSystem.snapshot.tipY,
          }
        : null,
    ) ?? null;
  }

  private completeLevel(): void {
    if (!this.run || !this.scoreTimerSystem) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    this.ending = true;
    this.hidePauseMenu();
    // 约束：一旦进入 ending，本关必须停止进一步输入、补账和结果重算。
    // campaign 的 finalized snapshot 就依赖这道门槛，保证同一关只封存一次终局真值。
    if (this.run.mode === 'ranked' && this.rankedDiamondRushController?.isAuthoritative) {
      void this.completeAuthoritativeRankedLevel();
      return;
    }
    this.rankedDiamondRushController?.finalizeShadowParity(this.run);
    void this.outcomeController?.completeLevel(this.run, this.scoreTimerSystem);
  }

  public failRun(): void {
    this.failRunInternal();
  }

  private failRunInternal(): void {
    if (!this.run || !this.scoreTimerSystem) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    this.ending = true;
    this.hidePauseMenu();
    if (this.run.mode === 'ranked' && this.rankedDiamondRushController?.isAuthoritative) {
      void this.failAuthoritativeRankedLevel();
      return;
    }
    this.rankedDiamondRushController?.finalizeShadowParity(this.run);
    void this.outcomeController?.failRun(this.run, this.scoreTimerSystem);
  }

  private async completeAuthoritativeRankedLevel(): Promise<void> {
    if (!this.run || !this.scoreTimerSystem || !this.rankedDiamondRushController) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const finalized = await this.rankedDiamondRushController.finalizeAuthoritative();
    this.rankedDiamondRushController.setFinalizedSnapshot(finalized);
    await this.outcomeController?.completeLevel(
      this.run,
      this.scoreTimerSystem,
      finalized,
    );
  }

  private async failAuthoritativeRankedLevel(): Promise<void> {
    if (!this.run || !this.scoreTimerSystem || !this.rankedDiamondRushController) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const finalized = await this.rankedDiamondRushController.finalizeAuthoritative();
    this.rankedDiamondRushController.setFinalizedSnapshot(finalized);
    await this.outcomeController?.failRun(
      this.run,
      this.scoreTimerSystem,
      finalized,
    );
  }

  public isPauseMenuVisible(): boolean {
    return this.pauseMenuVisible;
  }

  private showPauseMenu(): void {
    if (!this.run || this.ending || this.pauseMenuVisible) {
      return;
    }

    this.pauseMenuVisible = true;
    this.pauseBackgroundTiming();
    this.pauseMenuModal?.show(
      this.getPauseMenuBodyText(this.run),
      this.getPauseMenuEntries(this.run),
    );
  }

  private hidePauseMenu(): void {
    if (!this.pauseMenuVisible) {
      return;
    }

    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
    this.resumeBackgroundTiming();
  }

  private handlePauseMenuAction(action: PauseMenuAction): void {
    if (action === 'resume') {
      this.hidePauseMenu();
      return;
    }

    if (action === 'restart') {
      void this.restartCurrentRun();
      return;
    }

    this.returnFromPauseMenu();
  }

  private returnFromPauseMenu(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const activeRun = this.run;
    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
    this.backgroundTiming?.stop();
    this.backgroundTimingPaused = false;

    if (activeRun.mode === 'casual') {
      gameState.clearCurrentRun();
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    gameState.clearCurrentRun();

    if (activeRun.mode === 'campaign') {
      this.scene.start(SCENE_KEYS.AdventureCenter, {
        statusMessage: '已退出本次冒险',
        statusTone: 'info',
      });
      return;
    }

    this.scene.start(SCENE_KEYS.Ranked, {
      statusMessage: '已退出本次挑战',
      statusTone: 'info',
    });
  }

  private async restartCurrentRun(): Promise<void> {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const activeRun = this.run;
    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
    this.backgroundTiming?.stop();
    this.backgroundTimingPaused = false;
    this.ending = true;

    if (activeRun.mode === 'ranked') {
      const retryTarget =
        activeRun.rankedContext
          ? {
              challengeId: activeRun.rankedContext.challengeId,
              version: activeRun.rankedContext.challengeVersion,
            }
          : null;
      if (!retryTarget) {
        this.scene.start(SCENE_KEYS.Ranked, {
          statusMessage: '当前挑战不可重开',
          statusTone: 'danger',
        });
        return;
      }
      try {
        const nextRun = await prepareRankedRunForChallenge(retryTarget);
        this.scene.start(SCENE_KEYS.Gameplay, {
          run: nextRun,
          restartSnapshot: this.restartSnapshot ?? {
            mode: nextRun.mode,
            seed: nextRun.seed,
            levelGroup: nextRun.levelGroup,
            levelId: nextRun.levelId,
            goal: nextRun.goal,
            score: nextRun.score,
            scoreView: nextRun.scoreView,
            timeRemainingSec: nextRun.timeRemainingSec,
            dynamiteCount: nextRun.dynamiteCount,
            caughtCount: nextRun.caughtCount,
            purchasedItems: [...nextRun.purchasedItems],
            temporaryBuffs: { ...nextRun.temporaryBuffs },
            rankedContext: nextRun.rankedContext
              ? {
                  ...nextRun.rankedContext,
                  actions: nextRun.rankedContext.actions.map((action) => ({
                    ...action,
                  })),
                  challenge: { ...nextRun.rankedContext.challenge },
                }
              : null,
            campaignContext: null,
          },
        });
      } catch (error) {
        this.scene.start(SCENE_KEYS.Ranked, {
          statusMessage:
            error instanceof Error ? error.message : '重开当前挑战失败',
          statusTone: 'danger',
        });
      }
      return;
    }

    const snapshot =
      this.restartSnapshot
      ?? this.buildCurrentRunRestartSnapshot(activeRun);
    const nextRun = restoreRunFromRestartSnapshot(snapshot);
    gameState.setCurrentRun(nextRun);
    this.scene.start(SCENE_KEYS.Gameplay, {
      run: nextRun,
      restartSnapshot: snapshot,
    });
  }

  private buildCurrentRunRestartSnapshot(run: RunState): RunRestartSnapshot {
    return {
      mode: run.mode,
      seed: run.seed,
      levelGroup: run.levelGroup,
      levelId: run.levelId,
      goal: run.goal,
      score: 0,
      scoreView: 0,
      timeRemainingSec:
        this.level?.timeLimitSec
        ?? run.timeRemainingSec,
      dynamiteCount: 0,
      caughtCount: 0,
      purchasedItems: run.mode === 'casual' ? [] : [...run.purchasedItems],
      temporaryBuffs:
        run.mode === 'casual'
          ? { ...DEFAULT_TEMPORARY_BUFFS }
          : { ...run.temporaryBuffs },
      rankedContext: run.rankedContext
        ? {
            ...run.rankedContext,
            logicTick: 0,
            actions: [],
            lastDiamondTick: 0,
          }
        : null,
      campaignContext: run.campaignContext
        ? {
            ...run.campaignContext,
            challengeByLevel: Object.fromEntries(
              Object.entries(run.campaignContext.challengeByLevel).map(
                ([levelId, challenge]) => [levelId, { ...challenge }],
              ),
            ),
            completedLevels: run.campaignContext.completedLevels.map((level) => ({
              ...level,
              actions: level.actions.map((action) => ({ ...action })),
            })),
            purchases: run.campaignContext.purchases.map((purchase) => ({
              ...purchase,
            })),
          }
        : null,
    };
  }

  private getPauseMenuBodyText(run: RunState): string {
    if (run.mode === 'casual') {
      return '已暂停当前试玩。';
    }

    if (run.mode === 'campaign') {
      return '已暂停当前冒险。';
    }

    return '已暂停当前挑战。';
  }

  private getPauseMenuEntries(run: RunState): Array<{
    action: PauseMenuAction;
    label: string;
  }> {
    return [
      {
        action: 'resume',
        label: '继续本局',
      },
      {
        action: 'restart',
        label: '重开本局',
      },
      {
        action: 'return',
        label:
          run.mode === 'casual'
            ? '返回主菜单'
            : run.mode === 'campaign'
              ? '返回冒险中心'
              : '返回排位中心',
      },
    ];
  }

  private pauseBackgroundTiming(): void {
    if (!this.backgroundTiming || this.backgroundTimingPaused) {
      return;
    }

    this.backgroundTiming.stop();
    this.backgroundTimingPaused = true;
  }

  private resumeBackgroundTiming(): void {
    if (!this.backgroundTiming || !this.backgroundTimingPaused || this.ending) {
      return;
    }

    this.backgroundTiming.start();
    this.backgroundTimingPaused = false;
  }

  private bindPauseMenuKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    keyboard.on('keydown-UP', this.handlePauseMenuUpKey);
    keyboard.on('keydown-DOWN', this.handlePauseMenuDownKey);
    keyboard.on('keydown-ENTER', this.handlePauseMenuEnterKey);
    keyboard.on('keydown-ESC', this.handlePauseMenuEscKey);
  }

  private cleanupScene(): void {
    this.pauseMenuModal?.destroy();
    this.pauseMenuModal = null;
    this.pauseMenuVisible = false;
    this.brandFooter?.destroy();
    this.brandFooter = null;
    this.suppressEscapeUntilRelease = false;
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.off('keydown-UP', this.handlePauseMenuUpKey);
      keyboard.off('keydown-DOWN', this.handlePauseMenuDownKey);
      keyboard.off('keydown-ENTER', this.handlePauseMenuEnterKey);
      keyboard.off('keydown-ESC', this.handlePauseMenuEscKey);
    }
    this.hookSystem?.destroy();
    this.hookSystem = null;

    for (const entity of this.entities) {
      entity.destroy();
    }
    this.entities = [];

    this.inputController?.destroy();
    this.inputController = null;
    this.hudController?.destroy();
    this.hudController = null;
    this.presentationController?.destroy();
    this.presentationController = null;
    this.entityFactory = null;
    this.loopCoordinator = null;
    this.rankedDiamondRushController = null;
    this.verifiedStepDrain?.reset();
    this.verifiedStepDrain = null;
    this.outcomeController = null;
    this.scoreTimerSystem = null;
    this.backgroundTiming?.stop();
    this.backgroundTiming = null;
    this.applyingBackgroundElapsed = false;
  }

  private isCurrentGameplaySession(sessionId: number): boolean {
    return sessionId === this.gameplaySessionId && this.sys.isActive();
  }
}
