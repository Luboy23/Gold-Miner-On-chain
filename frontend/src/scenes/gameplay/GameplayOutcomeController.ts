import type Phaser from 'phaser';

import { finalizeCampaignLevel } from '../../game/campaignProgression';
import { DEFAULT_TEMPORARY_BUFFS, FINAL_LEVEL_GROUP } from '../../game/constants';
import { gameState } from '../../game/gameState';
import { buildRestartSnapshot } from '../../game/runRestart';
import { buildRunResult } from '../../game/run';
import { SCENE_KEYS } from '../../game/sceneKeys';
import type { RunState } from '../../game/types/index';
import type { ScoreTimerSystem } from '../../systems/ScoreTimerSystem';
import type { RankedWasmRuntimeFinalized } from '../../game/rankedWasmRuntime';

/**
 * GameplayOutcomeController 负责把“这一关已经结束”转换成后续流转动作。
 *
 * 对 campaign 来说，这里最关键的不是切哪个场景，而是：
 * - 先 finalize 当前关
 * - 再写入 completedLevels
 * - 最后才进入 shop / result / next-level
 *
 * 这个顺序一旦被打乱，后续页面读取到的就不是终局真值，而是被流转过程污染过的运行时状态。
 */
export class GameplayOutcomeController {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  async completeLevel(
    run: RunState,
    scoreTimerSystem: ScoreTimerSystem,
    authoritativeRankedFinalized?: RankedWasmRuntimeFinalized | null,
  ): Promise<void> {
    const clearedRun = this.consumeTemporaryBuffs(
      scoreTimerSystem.buildRun(run, 'shopping'),
    );

    if (clearedRun.mode === 'ranked') {
      const result = buildRunResult(
        {
          ...clearedRun,
          status: 'result',
        },
        true,
        {
          authoritativeRankedFinalized,
        },
      );
      if (import.meta.env.DEV) {
        window.__goldMinerResultPayload = result as unknown;
      }
      this.scene.scene.start(SCENE_KEYS.Result, { result });
      return;
    }

    const finalizedSnapshot =
      clearedRun.mode === 'campaign'
        ? finalizeCampaignLevel(clearedRun, true)
        : null;
    // 约束：campaign 必须先封存 snapshot，再决定是否进商店或推进下一关。
    // 否则商店阶段的当前 run 会把“已结束关卡”的证据窗口继续向后拖动。
    const recordedRun =
      clearedRun.mode === 'campaign'
        ? gameState.recordCampaignLevel(clearedRun, finalizedSnapshot)
        : clearedRun;
    const restartSnapshot = buildRestartSnapshot(recordedRun);

    if (recordedRun.levelGroup >= FINAL_LEVEL_GROUP) {
      const result = buildRunResult(recordedRun, true);
      if (import.meta.env.DEV) {
        window.__goldMinerResultPayload = result as unknown;
      }
      this.scene.scene.start(SCENE_KEYS.Result, { result });
      return;
    }

    const nextRun = gameState.advanceCampaignRun(recordedRun);
    gameState.setCurrentRun(nextRun);

    this.scene.scene.start(SCENE_KEYS.Goal, {
      mode: 'level-clear',
      run: nextRun,
      restartSnapshot,
    });
  }

  async failRun(
    run: RunState,
    scoreTimerSystem: ScoreTimerSystem,
    authoritativeRankedFinalized?: RankedWasmRuntimeFinalized | null,
  ): Promise<void> {
    const failedRun = this.consumeTemporaryBuffs(
      scoreTimerSystem.buildRun(run, 'failed'),
    );
    // 失败关同样需要 finalize。
    // 对后端 replay 来说，失败关仍然是一条必须可重放的完整 evidence。
    const finalizedSnapshot =
      failedRun.mode === 'campaign'
        ? finalizeCampaignLevel(failedRun, false)
        : null;
    const recordedRun =
      failedRun.mode === 'campaign'
        ? gameState.recordCampaignLevel(failedRun, finalizedSnapshot)
        : failedRun;
    const result = buildRunResult(recordedRun, false, {
      authoritativeRankedFinalized,
    });
    if (import.meta.env.DEV) {
      window.__goldMinerResultPayload = result as unknown;
    }
    this.scene.scene.start(SCENE_KEYS.Result, { result });
  }

  private consumeTemporaryBuffs(run: RunState): RunState {
    return {
      ...run,
      temporaryBuffs:
        run.mode === 'ranked'
          ? { ...run.temporaryBuffs }
          : { ...DEFAULT_TEMPORARY_BUFFS },
      currentShopOffers: null,
    };
  }
}
