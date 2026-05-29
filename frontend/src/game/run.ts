import {
  DEFAULT_TIME_LIMIT_SEC,
  FINAL_LEVEL_GROUP,
  RANKED_LOGIC_FPS,
  RANKED_PROTOCOL_VERSION,
} from './constants';
import { buildCampaignLevelEvidence } from './campaignProgression';
import type { RankedWasmRuntimeFinalized } from './rankedWasmRuntime';
import type {
  CampaignEvidenceV2,
  RankedRunEvidenceV3,
  RunResult,
  RunState,
} from './types/index';

/**
 * run.ts 负责把运行期 RunState 收口成“可展示 / 可上传”的结果对象。
 *
 * 关键边界：
 * - rankedEvidence 允许从当前 rankedContext 或 authoritative finalize 结果派生
 * - campaignEvidence 不允许再从 mutable rankedContext 重算 replay 字段
 * - buildCampaignEvidence 只序列化已封存的 finalized snapshots
 */
function buildRankedEvidence(
  run: RunState,
  authoritativeFinalized?: RankedWasmRuntimeFinalized | null,
): RankedRunEvidenceV3 | null {
  if (run.mode !== 'ranked' || !run.rankedContext) {
    return null;
  }

  const finishedTick = authoritativeFinalized
    ? Math.max(
        0,
        Math.min(
          authoritativeFinalized.finishedTick,
          run.rankedContext.timeLimitTicks,
        ),
      )
    : Math.max(
        0,
        Math.min(run.rankedContext.logicTick, run.rankedContext.timeLimitTicks),
      );
  const actions = run.rankedContext.actions
    .filter((action) => action.tick >= 0 && action.tick < finishedTick)
    .filter((action) => action.kind === 'fireHook')
    .map((action) => ({ ...action }));

  return {
    protocolVersion: RANKED_PROTOCOL_VERSION,
    simulationVersion: run.rankedContext.simulationVersion,
    sessionId: run.rankedContext.sessionId,
    challengeId: run.rankedContext.challengeId,
    challengeVersion: run.rankedContext.challengeVersion,
    challengeContentHash: run.rankedContext.challengeContentHash,
    challengeSeed: run.rankedContext.challengeSeed,
    clientBuildHash: run.rankedContext.clientBuildHash,
    logicFps: run.rankedContext.logicFps || RANKED_LOGIC_FPS,
    finishedTick,
    actions,
    summary: {
      diamondsCaught: authoritativeFinalized?.diamondsCaught ?? run.caughtCount,
      lastDiamondTick:
        authoritativeFinalized?.lastDiamondTick
        ?? Math.max(0, run.rankedContext.lastDiamondTick),
    },
  };
}

function buildCampaignEvidence(run: RunState): CampaignEvidenceV2 | null {
  if (run.mode !== 'campaign' || !run.campaignContext) {
    return null;
  }

  if (run.campaignContext.completedLevels.length === 0) {
    return null;
  }

  return {
    protocolVersion: RANKED_PROTOCOL_VERSION,
    simulationVersion: run.campaignContext.simulationVersion,
    campaignId: run.campaignContext.campaignId,
    sessionId: run.campaignContext.sessionId,
    campaignSeed: run.campaignContext.campaignSeed,
    clientBuildHash: run.campaignContext.clientBuildHash,
    // 约束：campaign levels 必须完全来自 finalized snapshots。
    // 如果这里重新读取当前 rankedContext/actions 现算，商店退出和结果页时序会再次污染 evidence。
    levels: run.campaignContext.completedLevels.map((level) =>
      buildCampaignLevelEvidence(level),
    ),
    purchases: run.campaignContext.purchases.map((purchase) => ({ ...purchase })),
    finalScore: run.score,
  };
}

export function buildRunResult(
  run: RunState,
  reachedGoal: boolean,
  options?: {
    authoritativeRankedFinalized?: RankedWasmRuntimeFinalized | null;
  },
): RunResult {
  // 这里做的是“结果组装”，不是“结果修正”。
  // 一旦运行到这一层，campaign 的 replay 真值已经在 finalized snapshot 中封存完毕。
  const authoritativeRankedFinalized =
    options?.authoritativeRankedFinalized ?? null;
  const rankedEvidence = buildRankedEvidence(run, authoritativeRankedFinalized);
  const rankedRuntimeSummary =
    run.mode === 'ranked' && authoritativeRankedFinalized
      ? {
          logicTick: authoritativeRankedFinalized.logicTick,
          diamondsCaught: authoritativeRankedFinalized.diamondsCaught,
          lastDiamondTick: authoritativeRankedFinalized.lastDiamondTick,
          finishedTick: authoritativeRankedFinalized.finishedTick,
          durationMs: authoritativeRankedFinalized.durationMs,
        }
      : null;

  return {
    mode: run.mode,
    levelGroup: run.levelGroup,
    levelId: run.levelId,
    goal: run.goal,
    score: run.mode === 'ranked' ? run.caughtCount : run.score,
    reachedGoal,
    endedAtFinalLevel:
      run.mode === 'campaign'
        ? reachedGoal && run.levelGroup >= FINAL_LEVEL_GROUP
        : run.mode === 'casual'
          ? reachedGoal && run.levelGroup >= FINAL_LEVEL_GROUP
          : false,
    elapsedSec:
      run.mode === 'ranked' && authoritativeRankedFinalized
        ? Math.max(0, authoritativeRankedFinalized.durationMs / 1000)
        : run.mode === 'ranked' && run.rankedContext
        ? Math.max(
            0,
            run.rankedContext.timeLimitTicks / Math.max(1, run.rankedContext.logicFps) -
              run.timeRemainingSec,
          )
        : Math.max(0, DEFAULT_TIME_LIMIT_SEC - run.timeRemainingSec),
    purchasedItems: [...run.purchasedItems],
    seed: run.seed,
    caughtCount: run.caughtCount,
    rankedEvidence,
    rankedRuntimeSummary,
    campaignEvidence: buildCampaignEvidence(run),
  };
}
