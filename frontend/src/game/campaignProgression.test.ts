import { describe, expect, it } from 'vitest';

import {
  advanceCampaignRunState,
  finalizeCampaignLevel,
  recordCampaignLevelResult,
  recordCampaignPurchaseResult,
} from './campaignProgression';
import type { RunState } from './types/index';

const SESSION_ID = `0x${'11'.repeat(32)}` as const;
const LEVEL_ONE_HASH = `0x${'22'.repeat(32)}` as const;
const LEVEL_ONE_SEED = `0x${'33'.repeat(32)}` as const;
const BUILD_HASH = `0x${'44'.repeat(32)}` as const;
const CAMPAIGN_ID = `0x${'55'.repeat(32)}` as const;
const CAMPAIGN_SEED = `0x${'66'.repeat(32)}` as const;
const LEVEL_TWO_HASH = `0x${'77'.repeat(32)}` as const;
const LEVEL_TWO_SEED = `0x${'88'.repeat(32)}` as const;

function buildCampaignRun(overrides?: Partial<RunState>): RunState {
  return {
    mode: 'campaign',
    seed: 'campaign-seed',
    levelGroup: 1,
    levelId: 'L1',
    goal: 600,
    score: 600,
    scoreView: 600,
    timeRemainingSec: 0,
    dynamiteCount: 0,
    caughtCount: 1,
    purchasedItems: [],
    temporaryBuffs: {
      strengthDrink: 0,
      luckyClover: 0,
      rockCollectorsBook: 0,
      gemPolish: 0,
    },
    currentShopOffers: null,
    status: 'result',
    rankedContext: {
      sessionId: SESSION_ID,
      challengeId: 'L1',
      challengeVersion: 1,
      challengeContentHash: LEVEL_ONE_HASH,
      challengeSeed: LEVEL_ONE_SEED,
      clientBuildHash: BUILD_HASH,
      simulationVersion: 1,
      logicFps: 60,
      timeLimitTicks: 3600,
      logicTick: 3600,
      actions: [{ kind: 'fireHook', tick: 59 }],
        challenge: {
          challengeId: 'L1',
          version: 1,
          contentHash: LEVEL_ONE_HASH,
          challengeSeed: LEVEL_ONE_SEED,
          simulationVersion: 1,
          logicFps: 60,
          timeLimitTicks: 3600,
          isCurrent: true,
        },
      lastDiamondTick: 60,
    },
    campaignContext: {
      campaignId: CAMPAIGN_ID,
      sessionId: SESSION_ID,
      campaignSeed: CAMPAIGN_SEED,
      clientBuildHash: BUILD_HASH,
      simulationVersion: 1,
      logicFps: 60,
      challengeByLevel: {
        L1: {
          levelId: 'L1',
          version: 1,
          order: 1,
          contentHash: LEVEL_ONE_HASH,
          challengeSeed: LEVEL_ONE_SEED,
          simulationVersion: 1,
          logicFps: 60,
          timeLimitTicks: 3600,
        },
        L2: {
          levelId: 'L2',
          version: 1,
          order: 2,
          contentHash: LEVEL_TWO_HASH,
          challengeSeed: LEVEL_TWO_SEED,
          simulationVersion: 1,
          logicFps: 60,
          timeLimitTicks: 3600,
        },
      },
      completedLevels: [],
      purchases: [],
      levelStartScore: 0,
      levelStartCaughtCount: 0,
      levelStartDynamiteUsed: 0,
    },
    ...overrides,
  };
}

describe('campaign progression evidence', () => {
  it('re-bases the next level score baseline after a shop purchase', () => {
    const levelOneRun = buildCampaignRun();
    const recordedLevelOne = recordCampaignLevelResult(
      levelOneRun,
      finalizeCampaignLevel(levelOneRun, true),
    );
    const advancedRun = advanceCampaignRunState(recordedLevelOne);

    const purchasedRun = recordCampaignPurchaseResult(
      {
        ...advancedRun,
        score: 480,
        scoreView: 480,
      },
      {
        shopLevelGroup: 2,
        itemId: 'dynamite',
        price: 120,
      },
    );

    expect(purchasedRun.campaignContext?.levelStartScore).toBe(480);
    expect(purchasedRun.campaignContext?.levelStartCaughtCount).toBe(1);
    expect(purchasedRun.campaignContext?.levelStartDynamiteUsed).toBe(0);

    const levelTwoResult = recordCampaignLevelResult(
      {
        ...purchasedRun,
        levelGroup: 2,
        levelId: 'L2',
        goal: 950,
        score: 1080,
        scoreView: 1080,
        caughtCount: 2,
        rankedContext: purchasedRun.rankedContext
          ? {
              ...purchasedRun.rankedContext,
              challengeId: 'L2',
              logicTick: 3600,
              actions: [{ kind: 'fireHook', tick: 120 }],
            }
          : null,
      },
      finalizeCampaignLevel(
        {
          ...purchasedRun,
          levelGroup: 2,
          levelId: 'L2',
          goal: 950,
          score: 1080,
          scoreView: 1080,
          caughtCount: 2,
          rankedContext: purchasedRun.rankedContext
            ? {
                ...purchasedRun.rankedContext,
                challengeId: 'L2',
                logicTick: 3600,
                actions: [{ kind: 'fireHook', tick: 120 }],
              }
            : null,
        },
        true,
      ),
    );

    const secondLevel = levelTwoResult.campaignContext?.completedLevels.at(-1);
    expect(secondLevel?.levelGroup).toBe(2);
    expect(secondLevel?.scoreDelta).toBe(600);
    expect(secondLevel?.caughtCountDelta).toBe(1);
  });

  it('only marks campaign cleared when the time limit is exhausted and the goal is reached', () => {
    const prematureRun = buildCampaignRun({
      rankedContext: {
        ...buildCampaignRun().rankedContext!,
        logicTick: 2400,
      },
    });
    const prematureSnapshot = finalizeCampaignLevel(prematureRun, true);
    expect(prematureSnapshot?.cleared).toBe(false);

    const completedRun = buildCampaignRun({
      rankedContext: {
        ...buildCampaignRun().rankedContext!,
        logicTick: 3600,
      },
    });
    const completedSnapshot = finalizeCampaignLevel(completedRun, true);
    expect(completedSnapshot?.cleared).toBe(true);
  });

  it('freezes a finalized snapshot even if the run keeps changing later', () => {
    const initialRun = buildCampaignRun({
      score: 800,
      caughtCount: 2,
      rankedContext: {
        ...buildCampaignRun().rankedContext!,
        logicTick: 3600,
        actions: [
          { kind: 'fireHook', tick: 59 },
          { kind: 'useDynamite', tick: 120 },
        ],
      },
    });
    const snapshot = finalizeCampaignLevel(initialRun, true);
    expect(snapshot).not.toBeNull();

    const mutatedRun = {
      ...initialRun,
      score: 1200,
      caughtCount: 4,
      rankedContext: initialRun.rankedContext
        ? {
            ...initialRun.rankedContext,
            logicTick: 3600,
            actions: [
              ...initialRun.rankedContext.actions,
              { kind: 'fireHook' as const, tick: 240 },
            ],
          }
        : null,
    };
    const recorded = recordCampaignLevelResult(mutatedRun, snapshot);
    const recordedLevel = recorded.campaignContext?.completedLevels[0];
    expect(recordedLevel?.scoreDelta).toBe(800);
    expect(recordedLevel?.caughtCountDelta).toBe(2);
    expect(recordedLevel?.dynamiteUsed).toBe(1);
    expect(recordedLevel?.actions).toEqual([
      { kind: 'fireHook', tick: 59 },
      { kind: 'useDynamite', tick: 120 },
    ]);
  });

  it('does not finalize an unstarted next level when leaving from the shop', () => {
    const advancedRun = advanceCampaignRunState(
      recordCampaignLevelResult(
        buildCampaignRun(),
        finalizeCampaignLevel(buildCampaignRun(), true),
      ),
    );

    const snapshot = finalizeCampaignLevel(advancedRun, false);
    expect(snapshot).toBeNull();
  });
});
