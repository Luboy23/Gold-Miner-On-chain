import { describe, expect, it, vi } from 'vitest';

import { gameState } from '../../game/gameState';
import type { RunState } from '../../game/types/index';
import { RankedDiamondRushController } from './RankedDiamondRushController';

const SESSION_ID = `0x${'11'.repeat(32)}` as const;
const CONTENT_HASH = `0x${'22'.repeat(32)}` as const;
const CHALLENGE_SEED = `0x${'33'.repeat(32)}` as const;
const BUILD_HASH = `0x${'44'.repeat(32)}` as const;

function buildRun(mode: 'ranked' | 'campaign'): RunState {
  return {
    mode,
    seed: `${mode}-seed`,
    levelGroup: 1,
    levelId: 'L1',
    goal: 600,
    score: 0,
    scoreView: 0,
    timeRemainingSec: 60,
    dynamiteCount: 0,
    caughtCount: 0,
    purchasedItems: [],
    temporaryBuffs: {
      strengthDrink: 0,
      luckyClover: 0,
      rockCollectorsBook: 0,
      gemPolish: 0,
    },
    currentShopOffers: null,
    status: 'playing',
    rankedContext: {
      sessionId: SESSION_ID,
      challengeId: 'diamond_rush_60',
      challengeVersion: 1,
      challengeContentHash: CONTENT_HASH,
      challengeSeed: CHALLENGE_SEED,
      clientBuildHash: BUILD_HASH,
      simulationVersion: 1,
      logicFps: 60,
      timeLimitTicks: 3600,
      logicTick: 120,
      actions: [],
      challenge: {
        challengeId: 'diamond_rush_60',
        version: 1,
        contentHash: CONTENT_HASH,
        challengeSeed: CHALLENGE_SEED,
        simulationVersion: 1,
        logicFps: 60,
        timeLimitTicks: 3600,
        isCurrent: true,
      },
      lastDiamondTick: 0,
    },
    campaignContext:
      mode === 'campaign'
        ? {
            campaignId: `0x${'55'.repeat(32)}` as const,
            sessionId: SESSION_ID,
            campaignSeed: `0x${'66'.repeat(32)}` as const,
            clientBuildHash: BUILD_HASH,
            simulationVersion: 1,
            logicFps: 60,
            challengeByLevel: {},
            completedLevels: [],
            purchases: [],
            levelStartScore: 0,
            levelStartCaughtCount: 0,
            levelStartDynamiteUsed: 0,
          }
        : null,
  };
}

describe('RankedDiamondRushController.consumeInputs', () => {
  it('keeps campaign fireHook on the local hook path even when runtime mode is authoritative', () => {
    const controller = new RankedDiamondRushController();
    const fire = vi.fn();
    const useDynamite = vi.fn(() => false);
    const applyFireHook = vi.fn().mockResolvedValue(undefined);
    const applyShadowFireHook = vi.fn().mockResolvedValue(undefined);

    (
      controller as unknown as {
        authoritativeRuntime: { applyFireHook: (tick: number) => Promise<void> };
        shadowParity: { applyFireHook: (tick: number) => Promise<void> };
      }
    ).authoritativeRuntime.applyFireHook = applyFireHook;
    (
      controller as unknown as {
        authoritativeRuntime: { applyFireHook: (tick: number) => Promise<void> };
        shadowParity: { applyFireHook: (tick: number) => Promise<void> };
      }
    ).shadowParity.applyFireHook = applyShadowFireHook;

    controller.queueInputs(buildRun('campaign'), {
      firePressed: true,
      dynamitePressed: false,
    });

    controller.consumeInputs(buildRun('campaign'), {
      hookState: 'swinging',
      fire,
      useDynamite,
    });

    expect(fire).toHaveBeenCalledTimes(1);
    expect(useDynamite).not.toHaveBeenCalled();
    expect(applyFireHook).not.toHaveBeenCalled();
    expect(applyShadowFireHook).not.toHaveBeenCalled();
  });

  it('keeps ranked fireHook on the authoritative path when runtime mode is authoritative', () => {
    const controller = new RankedDiamondRushController();
    const fire = vi.fn();
    const useDynamite = vi.fn(() => false);
    const applyFireHook = vi.fn().mockResolvedValue(undefined);

    (
      controller as unknown as {
        authoritativeRuntime: { applyFireHook: (tick: number) => Promise<void> };
      }
    ).authoritativeRuntime.applyFireHook = applyFireHook;

    controller.queueInputs(buildRun('ranked'), {
      firePressed: true,
      dynamitePressed: false,
    });

    controller.consumeInputs(buildRun('ranked'), {
      hookState: 'swinging',
      fire,
      useDynamite,
    });

    expect(fire).not.toHaveBeenCalled();
    expect(applyFireHook).toHaveBeenCalledWith(120);
  });

  it('does not restore spent campaign dynamite when recording useDynamite', () => {
    const controller = new RankedDiamondRushController();
    const fire = vi.fn();
    const useDynamite = vi.fn(() => {
      gameState.setCurrentRun({
        ...campaignRun,
        dynamiteCount: 0,
      });
      return true;
    });
    const campaignRun = {
      ...buildRun('campaign'),
      dynamiteCount: 1,
    };

    controller.queueInputs(campaignRun, {
      firePressed: false,
      dynamitePressed: true,
    });

    controller.consumeInputs(campaignRun, {
      hookState: 'returning-loaded',
      fire,
      useDynamite,
    });

    expect(useDynamite).toHaveBeenCalledWith(120);
    expect(gameState.currentRun?.dynamiteCount).toBe(0);
    expect(gameState.currentRun?.rankedContext?.actions).toEqual([
      { kind: 'useDynamite', tick: 120 },
    ]);
  });
});
