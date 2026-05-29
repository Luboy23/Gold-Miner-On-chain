import {
  DEFAULT_TEMPORARY_BUFFS,
  DEFAULT_TIME_LIMIT_SEC,
  FINAL_LEVEL_GROUP,
  GOAL_BY_LEVEL,
} from './constants';
import { levelSystem } from '../systems/LevelSystem';
import type { AdventureLevelRef } from '../web3/types';
import type {
  CampaignLevelFinalizedSnapshot,
  CampaignLevelEvidenceV2,
  CampaignShopPurchaseEvidence,
  LevelGroup,
  RunState,
  TemporaryBuffs,
} from './types/index';

/**
 * campaignProgression 只负责冒险模式的“关卡账本”演进。
 *
 * 这里最重要的设计不是 UI 流程，而是 replay 真值的封存规则：
 * - 每一关结束时生成一份 immutable CampaignLevelFinalizedSnapshot
 * - 后续 shop / 退出挑战 / 结果页 / 自动同步全部只消费 snapshot
 * - buildCampaignLevelEvidence 只做序列化，不再从 mutable run 回头重算
 *
 * 这套约束是 campaign 与后端 replay 保持一致的根基。
 */
function cloneTemporaryBuffs(buffs: TemporaryBuffs): TemporaryBuffs {
  return { ...buffs };
}

function parseLevelGroup(levelId: string): LevelGroup {
  const match = /^L(10|[1-9])$/.exec(levelId);
  const group = Number(match?.[1] ?? 1);
  return Math.min(Math.max(group, 1), FINAL_LEVEL_GROUP) as LevelGroup;
}

function buildChallengeByLevel(
  challenges: AdventureLevelRef[],
): Record<string, AdventureLevelRef> {
  return Object.fromEntries(
    challenges.map((challenge) => [challenge.levelId, { ...challenge }]),
  );
}

export function createCampaignRun(
  challenges: AdventureLevelRef[],
  context: {
    campaignId: `0x${string}`;
    sessionId: `0x${string}`;
    campaignSeed: `0x${string}`;
    clientBuildHash: `0x${string}`;
  },
): RunState {
  const challenge = challenges.find((entry) => entry.levelId === 'L1') ?? null;

  if (!challenge) {
    throw new Error('冒险模式缺少 L1 关卡配置。');
  }

  const levelDefinition = levelSystem.getLevelDefinition(challenge.levelId);
  const levelGroup = levelDefinition?.group ?? parseLevelGroup(challenge.levelId);

  return {
    mode: 'campaign',
    seed: context.campaignSeed,
    levelGroup,
    levelId: challenge.levelId,
    goal: GOAL_BY_LEVEL[levelGroup],
    score: 0,
    scoreView: 0,
    timeRemainingSec:
      challenge.timeLimitTicks > 0 && challenge.logicFps > 0
        ? challenge.timeLimitTicks / challenge.logicFps
        : (levelDefinition?.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC),
    dynamiteCount: 0,
    caughtCount: 0,
    purchasedItems: [],
    temporaryBuffs: cloneTemporaryBuffs(DEFAULT_TEMPORARY_BUFFS),
    currentShopOffers: null,
    status: 'goal',
    rankedContext: {
      sessionId: context.sessionId,
      challengeId: challenge.levelId,
      challengeVersion: challenge.version,
      challengeContentHash: challenge.contentHash,
      challengeSeed: challenge.challengeSeed,
      clientBuildHash: context.clientBuildHash,
      simulationVersion: challenge.simulationVersion,
      logicFps: challenge.logicFps,
      timeLimitTicks: challenge.timeLimitTicks,
      logicTick: 0,
      actions: [],
      challenge: {
        challengeId: challenge.levelId,
        version: challenge.version,
        contentHash: challenge.contentHash,
        challengeSeed: challenge.challengeSeed,
        simulationVersion: challenge.simulationVersion,
        logicFps: challenge.logicFps,
        timeLimitTicks: challenge.timeLimitTicks,
        isCurrent: true,
      },
      lastDiamondTick: 0,
    },
    campaignContext: {
      campaignId: context.campaignId,
      sessionId: context.sessionId,
      campaignSeed: context.campaignSeed,
      clientBuildHash: context.clientBuildHash,
      simulationVersion: challenge.simulationVersion,
      logicFps: challenge.logicFps,
      challengeByLevel: buildChallengeByLevel(challenges),
      completedLevels: [],
      purchases: [],
      levelStartScore: 0,
      levelStartCaughtCount: 0,
      levelStartDynamiteUsed: 0,
    },
  };
}

export function finalizeCampaignLevel(
  run: RunState,
  reachedGoal: boolean,
): CampaignLevelFinalizedSnapshot | null {
  if (run.mode !== 'campaign' || !run.campaignContext || !run.rankedContext) {
    return null;
  }

  const isUnstartedLevel =
    run.rankedContext.logicTick <= 0
    && run.rankedContext.actions.length === 0
    && run.score === run.campaignContext.levelStartScore
    && run.caughtCount === run.campaignContext.levelStartCaughtCount;

  if (isUnstartedLevel) {
    // 约束：shop 中的“下一关占位 run”绝不能被录成一条空关卡 evidence。
    // 否则 “L1 通关 -> 商店退出” 会把未开打的 L2 混入上传 payload。
    return null;
  }

  const finishedTick = Math.max(
    0,
    Math.min(run.rankedContext.logicTick, run.rankedContext.timeLimitTicks),
  );
  const actions = run.rankedContext.actions
    .filter((action) => action.tick >= 0 && action.tick < finishedTick)
    .map((action) => ({ ...action }));
  const scoreDelta = Math.max(0, run.score - run.campaignContext.levelStartScore);
  const caughtCountDelta = Math.max(
    0,
    run.caughtCount - run.campaignContext.levelStartCaughtCount,
  );
  const totalDynamiteUsed = actions.filter((action) => action.kind === 'useDynamite').length;
  const dynamiteUsed = Math.max(
    0,
    totalDynamiteUsed - run.campaignContext.levelStartDynamiteUsed,
  );

  return {
    levelGroup: run.levelGroup,
    levelId: run.levelId,
    levelVersion: run.rankedContext.challengeVersion,
    levelContentHash: run.rankedContext.challengeContentHash,
    challengeSeed: run.rankedContext.challengeSeed,
    goal: run.goal,
    logicFps: run.rankedContext.logicFps,
    finishedTick,
    actions,
    scoreDelta,
    caughtCountDelta,
    dynamiteUsed,
    // cleared 的语义必须与后端 replay 保持一致：
    // 只有在完整跑到 timeLimitTicks 且达标时，才算“已通关该关”。
    cleared:
      finishedTick === run.rankedContext.timeLimitTicks
      && reachedGoal,
  };
}

export function recordCampaignLevelResult(
  run: RunState,
  snapshot: CampaignLevelFinalizedSnapshot | null,
): RunState {
  if (run.mode !== 'campaign' || !run.campaignContext || !snapshot) {
    return run;
  }

  const alreadyRecorded = run.campaignContext.completedLevels.some(
    (level) => level.levelGroup === snapshot.levelGroup,
  );

  return {
    ...run,
    campaignContext: {
      ...run.campaignContext,
      completedLevels: alreadyRecorded
        ? run.campaignContext.completedLevels
        // 约束：同一 levelGroup 只允许录证一次。
        // finalize 之后如果再次写入，会把“终局封存”退化回“可重复覆盖”的可变状态。
        : [...run.campaignContext.completedLevels, snapshot],
    },
  };
}

export function buildCampaignLevelEvidence(
  snapshot: CampaignLevelFinalizedSnapshot,
): CampaignLevelEvidenceV2 {
  return {
    levelGroup: snapshot.levelGroup,
    levelId: snapshot.levelId,
    levelVersion: snapshot.levelVersion,
    levelContentHash: snapshot.levelContentHash,
    challengeSeed: snapshot.challengeSeed,
    goal: snapshot.goal,
    logicFps: snapshot.logicFps,
    finishedTick: snapshot.finishedTick,
    actions: snapshot.actions.map((action) => ({ ...action })),
    summary: {
      score: snapshot.scoreDelta,
      dynamiteUsed: snapshot.dynamiteUsed,
      caughtCount: snapshot.caughtCountDelta,
      cleared: snapshot.cleared,
    },
  };
}

export function recordCampaignPurchaseResult(
  run: RunState,
  purchase: CampaignShopPurchaseEvidence,
): RunState {
  if (run.mode !== 'campaign' || !run.campaignContext) {
    return run;
  }

  return {
    ...run,
    campaignContext: {
      ...run.campaignContext,
      purchases: [...run.campaignContext.purchases, { ...purchase }],
      // 购买发生在关卡之间，下一关的分数窗口必须从“购买后的总分”重新起算，
      // 否则 evidence 会把上一关的 carry score 错算进下一关 summary.score。
      levelStartScore: run.score,
      levelStartDynamiteUsed: run.rankedContext?.actions.filter(
        (action) => action.kind === 'useDynamite',
      ).length ?? run.campaignContext.levelStartDynamiteUsed,
    },
  };
}

export function advanceCampaignRunState(run: RunState): RunState {
  if (run.levelGroup >= FINAL_LEVEL_GROUP) {
    return run;
  }

  const nextLevelGroup = (run.levelGroup + 1) as LevelGroup;
  const nextLevelId =
    levelSystem.resolveLevelId(
      run.seed,
      nextLevelGroup,
      null,
    ) ?? `L${nextLevelGroup}`;
  const campaignChallenge =
    run.mode === 'campaign' && run.campaignContext
      ? run.campaignContext.challengeByLevel[nextLevelId] ?? null
      : null;

  return {
    ...run,
    levelGroup: nextLevelGroup,
    levelId: nextLevelId,
    goal: GOAL_BY_LEVEL[nextLevelGroup],
    timeRemainingSec: DEFAULT_TIME_LIMIT_SEC,
    purchasedItems: [...run.purchasedItems],
    temporaryBuffs: cloneTemporaryBuffs(run.temporaryBuffs),
    currentShopOffers: null,
    status: 'goal',
    rankedContext:
      run.mode === 'campaign' && campaignChallenge && run.campaignContext
        ? {
            sessionId: run.campaignContext.sessionId,
            challengeId: campaignChallenge.levelId,
            challengeVersion: campaignChallenge.version,
            challengeContentHash: campaignChallenge.contentHash,
            challengeSeed: campaignChallenge.challengeSeed,
            clientBuildHash: run.campaignContext.clientBuildHash,
            simulationVersion: campaignChallenge.simulationVersion,
            logicFps: campaignChallenge.logicFps,
            timeLimitTicks: campaignChallenge.timeLimitTicks,
            logicTick: 0,
            actions: [],
            challenge: {
              challengeId: campaignChallenge.levelId,
              version: campaignChallenge.version,
              contentHash: campaignChallenge.contentHash,
              challengeSeed: campaignChallenge.challengeSeed,
              simulationVersion: campaignChallenge.simulationVersion,
              logicFps: campaignChallenge.logicFps,
              timeLimitTicks: campaignChallenge.timeLimitTicks,
              isCurrent: true,
            },
            lastDiamondTick: 0,
          }
        : null,
    campaignContext:
      run.mode === 'campaign' && run.campaignContext
        ? {
            ...run.campaignContext,
            // 进入下一关时，三组 baseline 必须和新的 tick/action 窗口一起刷新。
            // 否则下一关的 score/caught/dynamite 增量会混入上一关收尾数据。
            levelStartScore: run.score,
            levelStartCaughtCount: run.caughtCount,
            levelStartDynamiteUsed:
              run.rankedContext?.actions.filter((action) => action.kind === 'useDynamite')
                .length ?? run.campaignContext.levelStartDynamiteUsed,
          }
        : null,
  };
}
