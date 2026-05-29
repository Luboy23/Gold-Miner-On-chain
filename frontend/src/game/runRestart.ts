import { DEFAULT_TEMPORARY_BUFFS, DEFAULT_TIME_LIMIT_SEC } from './constants';
import type {
  CampaignRunContext,
  RankedRunContext,
  RunRestartSnapshot,
  RunState,
  TemporaryBuffs,
} from './types/index';

function cloneTemporaryBuffs(buffs: TemporaryBuffs): TemporaryBuffs {
  return { ...buffs };
}

function cloneRankedContext(
  rankedContext: RankedRunContext | null,
): RankedRunContext | null {
  if (!rankedContext) {
    return null;
  }

  return {
    ...rankedContext,
    actions: rankedContext.actions.map((action) => ({ ...action })),
    challenge: { ...rankedContext.challenge },
  };
}

function cloneCampaignContext(
  campaignContext: CampaignRunContext | null,
): CampaignRunContext | null {
  if (!campaignContext) {
    return null;
  }

  return {
    ...campaignContext,
    challengeByLevel: Object.fromEntries(
      Object.entries(campaignContext.challengeByLevel).map(
        ([levelId, challenge]) => [levelId, { ...challenge }],
      ),
    ),
    completedLevels: campaignContext.completedLevels.map((level) => ({
      ...level,
      actions: level.actions.map((action) => ({ ...action })),
    })),
    purchases: campaignContext.purchases.map((purchase) => ({ ...purchase })),
  };
}

export function buildRestartSnapshot(run: RunState): RunRestartSnapshot {
  return {
    mode: run.mode,
    seed: run.seed,
    levelGroup: run.levelGroup,
    levelId: run.levelId,
    goal: run.goal,
    score: run.score,
    scoreView: run.scoreView,
    timeRemainingSec: run.timeRemainingSec,
    dynamiteCount: run.dynamiteCount,
    caughtCount: run.caughtCount,
    purchasedItems: [...run.purchasedItems],
    temporaryBuffs: cloneTemporaryBuffs(run.temporaryBuffs),
    rankedContext: cloneRankedContext(run.rankedContext),
    campaignContext: cloneCampaignContext(run.campaignContext),
  };
}

export function restoreRunFromRestartSnapshot(
  snapshot: RunRestartSnapshot,
): RunState {
  return {
    mode: snapshot.mode,
    seed: snapshot.seed,
    levelGroup: snapshot.levelGroup,
    levelId: snapshot.levelId,
    goal: snapshot.goal,
    score: snapshot.score,
    scoreView: snapshot.scoreView,
    timeRemainingSec:
      snapshot.timeRemainingSec > 0
        ? snapshot.timeRemainingSec
        : DEFAULT_TIME_LIMIT_SEC,
    dynamiteCount: snapshot.dynamiteCount,
    caughtCount: snapshot.caughtCount,
    purchasedItems: [...snapshot.purchasedItems],
    temporaryBuffs: cloneTemporaryBuffs(
      snapshot.mode === 'ranked'
        ? snapshot.temporaryBuffs
        : snapshot.temporaryBuffs ?? DEFAULT_TEMPORARY_BUFFS,
    ),
    currentShopOffers: null,
    status: 'goal',
    rankedContext: cloneRankedContext(snapshot.rankedContext),
    campaignContext: cloneCampaignContext(snapshot.campaignContext),
  };
}
