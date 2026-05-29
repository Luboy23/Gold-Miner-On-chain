import { describe, expect, it } from 'vitest';

import { buildRunResult } from './run';
import type { RunState } from './types/index';

const SESSION_ID = `0x${'11'.repeat(32)}` as const;
const CONTENT_HASH = `0x${'22'.repeat(32)}` as const;
const CHALLENGE_SEED = `0x${'33'.repeat(32)}` as const;
const BUILD_HASH = `0x${'44'.repeat(32)}` as const;
const CAMPAIGN_ID = `0x${'55'.repeat(32)}` as const;
const CAMPAIGN_SEED = `0x${'66'.repeat(32)}` as const;

function buildCampaignRun(): RunState {
  return {
    mode: 'campaign',
    seed: 'campaign-seed',
    levelGroup: 1,
    levelId: 'L1',
    goal: 600,
    score: 800,
    scoreView: 800,
    timeRemainingSec: 0,
    dynamiteCount: 0,
    caughtCount: 2,
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
      challengeContentHash: CONTENT_HASH,
      challengeSeed: CHALLENGE_SEED,
      clientBuildHash: BUILD_HASH,
      simulationVersion: 1,
      logicFps: 60,
      timeLimitTicks: 3600,
      logicTick: 3600,
      actions: [{ kind: 'fireHook', tick: 59 }],
      challenge: {
        challengeId: 'L1',
        version: 1,
        contentHash: CONTENT_HASH,
        challengeSeed: CHALLENGE_SEED,
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
      challengeByLevel: {},
      completedLevels: [
        {
          levelGroup: 1,
          levelId: 'L1',
          levelVersion: 1,
          levelContentHash: CONTENT_HASH,
          challengeSeed: CHALLENGE_SEED,
          goal: 600,
          logicFps: 60,
          finishedTick: 3600,
          actions: [{ kind: 'fireHook', tick: 59 }],
          scoreDelta: 800,
          caughtCountDelta: 2,
          dynamiteUsed: 0,
          cleared: true,
        },
      ],
      purchases: [],
      levelStartScore: 0,
      levelStartCaughtCount: 0,
      levelStartDynamiteUsed: 0,
    },
  };
}

describe('buildRunResult campaign evidence', () => {
  it('serializes finalized campaign snapshots without recomputing replay fields from rankedContext', () => {
    const run = buildCampaignRun();
    const mutatedRun: RunState = {
      ...run,
      score: 1300,
      caughtCount: 5,
      rankedContext: run.rankedContext
        ? {
            ...run.rankedContext,
            logicTick: 3599,
            actions: [
              ...run.rankedContext.actions,
              { kind: 'useDynamite', tick: 120 },
            ],
          }
        : null,
    };

    const result = buildRunResult(mutatedRun, true);
    expect(result.campaignEvidence).not.toBeNull();
    expect(result.campaignEvidence?.levels[0]).toMatchObject({
      finishedTick: 3600,
      actions: [{ kind: 'fireHook', tick: 59 }],
      summary: {
        score: 800,
        caughtCount: 2,
        dynamiteUsed: 0,
        cleared: true,
      },
    });
    expect(result.campaignEvidence?.finalScore).toBe(1300);
  });
});
