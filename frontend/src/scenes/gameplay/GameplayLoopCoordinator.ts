import { gameState } from '../../game/gameState';
import type { RunState } from '../../game/types/index';
import type { LevelEntity } from '../../objects/LevelEntity';
import type { ScoreTimerSystem } from '../../systems/ScoreTimerSystem';
import type { HookSystem } from '../../systems/HookSystem';
import type { RankedDiamondRushController } from './RankedDiamondRushController';
import { RankedAuthoritativeLoop } from './RankedAuthoritativeLoop';

/**
 * GameplayLoopCoordinator 只负责“怎么推进一段时间”，不负责决定场景流转。
 *
 * 它把两类时序统一到一个门面里：
 * - 正常前台 fixed-step 推进
 * - 浏览器失焦后的背景 elapsed 补账
 *
 * 这里最容易误解的点是 verified run 的双路径：
 * - ranked authoritative：交给 WASM/runtime 真值源推进
 * - campaign / 非 authoritative ranked：仍走前端本地逻辑，但保持相同的 tick 预算语义
 */
export type GameplayVerifiedLoopResult =
  | { kind: 'authoritative-stepped'; run: RunState; previousRankedCaughtCount: number; timeLimitReached: boolean }
  | { kind: 'continue' };

export class GameplayLoopCoordinator {
  private readonly authoritativeLoop = new RankedAuthoritativeLoop();

  async stepVerifiedRun(options: {
    run: RunState;
    deltaSec: number;
    rankedDiamondRushController: RankedDiamondRushController;
    hookSystem: HookSystem;
    scoreTimerSystem: ScoreTimerSystem;
    entities: LevelEntity[];
    previousRankedCaughtCount: number;
    syncEntities: (snapshot: {
      entities: Array<{
        active: boolean;
        caught: boolean;
        collisionX: number;
        collisionY: number;
      }>;
    }) => void;
    onCatchFeedback: (countDelta: number) => void;
  }): Promise<GameplayVerifiedLoopResult> {
    if (options.run.mode === 'ranked' && options.rankedDiamondRushController.isAuthoritative) {
      const result = await this.authoritativeLoop.step(
        options.rankedDiamondRushController,
        {
          run: options.run,
          hookSystem: options.hookSystem,
          scoreTimerSystem: options.scoreTimerSystem,
          entities: options.entities,
          previousRankedCaughtCount: options.previousRankedCaughtCount,
          syncEntities: options.syncEntities,
          onCatchFeedback: options.onCatchFeedback,
        },
        options.deltaSec,
      );

      if (!result) {
        return { kind: 'continue' };
      }

      return {
        kind: 'authoritative-stepped',
        run: result.run,
        previousRankedCaughtCount: result.previousRankedCaughtCount,
        timeLimitReached: result.timeLimitReached,
      };
    }

    return { kind: 'continue' };
  }

  async applyVerifiedBackgroundElapsed(options: {
    run: RunState;
    elapsedSec: number;
    rankedDiamondRushController: RankedDiamondRushController;
    hookSystem: HookSystem;
    scoreTimerSystem: ScoreTimerSystem;
    entities: LevelEntity[];
    previousRankedCaughtCount: number;
    syncEntities: (snapshot: {
      entities: Array<{
        active: boolean;
        caught: boolean;
        collisionX: number;
        collisionY: number;
      }>;
    }) => void;
  }): Promise<GameplayVerifiedLoopResult> {
    if (options.run.mode === 'ranked' && options.rankedDiamondRushController.isAuthoritative) {
      const result = await this.authoritativeLoop.applyBackgroundElapsed(
        options.rankedDiamondRushController,
        {
          run: options.run,
          hookSystem: options.hookSystem,
          scoreTimerSystem: options.scoreTimerSystem,
          entities: options.entities,
          previousRankedCaughtCount: options.previousRankedCaughtCount,
          syncEntities: options.syncEntities,
          onCatchFeedback: () => {
            // Background elapsed does not synthesize catch feedback.
          },
        },
        options.elapsedSec,
      );

      if (!result) {
        return { kind: 'continue' };
      }

      return {
        kind: 'authoritative-stepped',
        run: result.run,
        previousRankedCaughtCount: result.previousRankedCaughtCount,
        timeLimitReached: result.timeLimitReached,
      };
    }

    if (!options.run.rankedContext) {
      return { kind: 'continue' };
    }

    // 非 authoritative verified run 没有独立 runtime 真值源，
    // 这里只推进“共享账本上的时间窗口”，真正的玩法快进由 GameplayScene 复用 stepGameplay 完成。
    const remainingTicks = Math.max(
      0,
      options.run.rankedContext.timeLimitTicks - options.run.rankedContext.logicTick,
    );
    const elapsedTicks =
      options.elapsedSec >= options.run.timeRemainingSec
        ? remainingTicks
        : Math.min(
            remainingTicks,
            Math.floor(
              options.elapsedSec * Math.max(1, options.run.rankedContext.logicFps),
            ),
          );

    options.scoreTimerSystem.consumeElapsedTime(options.elapsedSec, {
      infiniteTime: gameState.snapshot.debug.infiniteTime,
    });

    if (elapsedTicks <= 0) {
      const nextRun: RunState = {
        ...options.run,
        timeRemainingSec: options.scoreTimerSystem.snapshot.timeRemainingSec,
      };
      gameState.setCurrentRun(nextRun);
      return {
        kind: 'authoritative-stepped',
        run: nextRun,
        previousRankedCaughtCount: options.previousRankedCaughtCount,
        timeLimitReached: false,
      };
    }

    const nextRun: RunState = {
      ...options.run,
      timeRemainingSec: options.scoreTimerSystem.snapshot.timeRemainingSec,
      rankedContext: {
        ...options.run.rankedContext,
        // 约束：背景补账只能把 logicTick 向前推进到当前关预算上限，
        // 不能越过 timeLimitTicks，也不能在这里追加新的 actions。
        logicTick: Math.min(
          options.run.rankedContext.timeLimitTicks,
          options.run.rankedContext.logicTick + elapsedTicks,
        ),
      },
    };

    gameState.setCurrentRun(nextRun);

    return {
      kind: 'authoritative-stepped',
      run: nextRun,
      previousRankedCaughtCount: options.previousRankedCaughtCount,
      timeLimitReached: elapsedTicks > 0 && options.rankedDiamondRushController.isTimeLimitReached(nextRun),
    };
  }

  applyCasualBackgroundElapsed(options: {
    run: RunState;
    elapsedSec: number;
    scoreTimerSystem: ScoreTimerSystem;
  }): RunState {
    // casual 没有 replay 账本，只需要保证“真实流逝的时间”被记到账面上，
    // 具体局内状态快进由场景层复用正常玩法更新完成。
    options.scoreTimerSystem.consumeElapsedTime(options.elapsedSec, {
      infiniteTime: gameState.snapshot.debug.infiniteTime,
    });

    return {
      ...options.run,
      timeRemainingSec: options.scoreTimerSystem.snapshot.timeRemainingSec,
    };
  }
}
