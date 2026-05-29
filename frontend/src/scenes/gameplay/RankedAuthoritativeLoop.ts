import { gameState } from '../../game/gameState';
import type { RunState } from '../../game/types/index';
import type { LevelEntity } from '../../objects/LevelEntity';
import type { ScoreTimerSystem } from '../../systems/ScoreTimerSystem';
import type { HookSystem } from '../../systems/HookSystem';
import type { RankedDiamondRushController } from './RankedDiamondRushController';

type AuthoritativeLoopOptions = {
  run: RunState;
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
};

export type AuthoritativeLoopResult = {
  run: RunState;
  previousRankedCaughtCount: number;
  timeLimitReached: boolean;
};

export class RankedAuthoritativeLoop {
  async step(
    controller: RankedDiamondRushController,
    options: AuthoritativeLoopOptions,
    deltaSec: number,
  ): Promise<AuthoritativeLoopResult | null> {
    const snapshot = await controller.stepAuthoritative(options.run);

    if (!snapshot) {
      return null;
    }

    const run = controller.syncAuthoritativeRun(options.run, snapshot);
    options.scoreTimerSystem.update(deltaSec, {
      infiniteTime: gameState.snapshot.debug.infiniteTime,
    });

    let previousRankedCaughtCount = options.previousRankedCaughtCount;
    if (snapshot.diamondsCaught > previousRankedCaughtCount) {
      const delta = snapshot.diamondsCaught - previousRankedCaughtCount;
      options.onCatchFeedback(delta);
      previousRankedCaughtCount = snapshot.diamondsCaught;
    }

    options.syncEntities(snapshot);
    options.hookSystem.applyRankedSnapshot(snapshot, options.entities);

    return {
      run,
      previousRankedCaughtCount,
      timeLimitReached: controller.isTimeLimitReached(run),
    };
  }

  async applyBackgroundElapsed(
    controller: RankedDiamondRushController,
    options: AuthoritativeLoopOptions,
    elapsedSec: number,
  ): Promise<AuthoritativeLoopResult | null> {
    const snapshot = await controller.advanceAuthoritativeElapsed(
      options.run,
      elapsedSec,
    );

    if (!snapshot) {
      return null;
    }

    const run = controller.syncAuthoritativeRun(options.run, snapshot);
    options.scoreTimerSystem.consumeElapsedTime(elapsedSec, {
      infiniteTime: gameState.snapshot.debug.infiniteTime,
    });
    options.syncEntities(snapshot);
    options.hookSystem.applyRankedSnapshot(snapshot, options.entities);

    return {
      run,
      previousRankedCaughtCount: options.previousRankedCaughtCount,
      timeLimitReached: controller.isTimeLimitReached(run),
    };
  }
}
