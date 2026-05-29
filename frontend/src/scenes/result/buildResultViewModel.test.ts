import { describe, expect, it } from 'vitest';

import type { RunResult } from '../../game/types/index';
import type { ResultSyncSnapshot } from './ResultSyncFlowController';
import { buildResultViewModel } from './buildResultViewModel';

const RANKED_RESULT = {
  mode: 'ranked',
  levelGroup: 1,
  levelId: 'diamond_rush_60',
  goal: 0,
  score: 0,
  reachedGoal: true,
  endedAtFinalLevel: false,
  elapsedSec: 60,
  purchasedItems: [],
  seed: 'ranked-seed',
  caughtCount: 7,
  rankedEvidence: {
    sessionId: `0x${'11'.repeat(32)}`,
    challengeId: 'diamond_rush_60',
    challengeVersion: 1,
    logicFps: 60,
    finishedTick: 3600,
    summary: {
      diamondsCaught: 7,
      lastDiamondTick: 3200,
    },
  },
  rankedRuntimeSummary: {
    logicTick: 3600,
    diamondsCaught: 7,
    lastDiamondTick: 3200,
    finishedTick: 3600,
    durationMs: 60000,
  },
  campaignEvidence: null,
} as unknown as RunResult;

const CAMPAIGN_RESULT = {
  mode: 'campaign',
  levelGroup: 3,
  levelId: 'L3',
  goal: 1800,
  score: 2400,
  reachedGoal: true,
  endedAtFinalLevel: false,
  elapsedSec: 90,
  purchasedItems: [],
  seed: 'campaign-seed',
  caughtCount: 12,
  rankedEvidence: null,
  rankedRuntimeSummary: null,
  campaignEvidence: {
    campaignId: `0x${'22'.repeat(32)}`,
  },
} as unknown as RunResult;

function buildSyncSnapshot(
  partial: Partial<ResultSyncSnapshot>,
): ResultSyncSnapshot {
  return {
    syncing: false,
    stage: 'idle',
    message: '',
    ...partial,
  };
}

describe('buildResultViewModel retry actions', () => {
  it('maps failed ranked sync to retry-sync primary and retry-run secondary', () => {
    const viewModel = buildResultViewModel(
      RANKED_RESULT,
      null,
      [],
      true,
      buildSyncSnapshot({
        stage: 'failed',
        message: '成绩提交失败，可重试提交。',
      }),
    );

    expect(viewModel.actions.primaryKind).toBe('retry-sync');
    expect(viewModel.actions.primaryLabel).toBe('重试提交');
    expect(viewModel.actions.secondaryKind).toBe('retry-run');
    expect(viewModel.actions.secondaryLabel).toBe('再来一局');
  });

  it('maps timed-out finalizing ranked sync to the same retry-sync action model', () => {
    const viewModel = buildResultViewModel(
      RANKED_RESULT,
      null,
      [],
      true,
      buildSyncSnapshot({
        syncing: false,
        stage: 'finalizing',
        message: '成绩已提交，仍在处理，可重试提交。',
      }),
    );

    expect(viewModel.actions.primaryKind).toBe('retry-sync');
    expect(viewModel.actions.secondaryKind).toBe('retry-run');
  });

  it('keeps active finalizing on the normal ranked primary path while syncing is still live', () => {
    const viewModel = buildResultViewModel(
      RANKED_RESULT,
      null,
      [],
      true,
      buildSyncSnapshot({
        syncing: true,
        stage: 'finalizing',
        message: '提交成功，正在处理成绩...',
      }),
    );

    expect(viewModel.actions.primaryKind).toBe('retry-run');
    expect(viewModel.actions.secondaryKind).toBe('go-menu');
  });

  it('maps failed campaign sync to retry-sync primary and go-adventure secondary', () => {
    const viewModel = buildResultViewModel(
      CAMPAIGN_RESULT,
      null,
      [],
      true,
      buildSyncSnapshot({
        stage: 'failed',
        message: '冒险成绩提交失败，可重试提交。',
      }),
    );

    expect(viewModel.actions.primaryKind).toBe('retry-sync');
    expect(viewModel.actions.primaryLabel).toBe('重试提交');
    expect(viewModel.actions.secondaryKind).toBe('go-adventure');
    expect(viewModel.actions.secondaryLabel).toBe('返回冒险中心');
  });
});
