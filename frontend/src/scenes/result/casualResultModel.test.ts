import { describe, expect, it } from 'vitest';

import type { RunResult } from '../../game/types/index';
import { buildCasualResultViewModel } from './casualResultModel';

function buildCasualResult(
  partial: Partial<RunResult>,
): RunResult {
  return {
    mode: 'casual',
    levelGroup: 2,
    levelId: 'L2',
    goal: 950,
    score: 860,
    reachedGoal: false,
    endedAtFinalLevel: false,
    elapsedSec: 61,
    purchasedItems: [],
    seed: 'casual-seed',
    caughtCount: 4,
    rankedEvidence: null,
    rankedRuntimeSummary: null,
    campaignEvidence: null,
    ...partial,
  };
}

describe('buildCasualResultViewModel', () => {
  it('describes a failed casual run as stopping at the current level', () => {
    const viewModel = buildCasualResultViewModel(
      buildCasualResult({
        levelGroup: 2,
        reachedGoal: false,
        endedAtFinalLevel: false,
      }),
    );

    expect(viewModel.headline).toBe('试玩结束');
    expect(viewModel.scoreLabel).toBe('得分 $860');
    expect(viewModel.subline).toBe('本次试玩止步第 2 关');
    expect(viewModel.hint).toBe('试玩模式不保存进度，也不会同步到链上。');
    expect(viewModel.primaryLabel).toBe('再来一局');
    expect(viewModel.secondaryLabel).toBe('返回主菜单');
  });

  it('describes a goal-cleared casual run as reaching the current level', () => {
    const viewModel = buildCasualResultViewModel(
      buildCasualResult({
        levelGroup: 4,
        score: 2100,
        reachedGoal: true,
      }),
    );

    expect(viewModel.scoreLabel).toBe('得分 $2100');
    expect(viewModel.subline).toBe('已试玩到第 4 关');
  });

  it('describes a final-level casual clear as finishing all 10 levels', () => {
    const viewModel = buildCasualResultViewModel(
      buildCasualResult({
        levelGroup: 10,
        score: 8000,
        reachedGoal: true,
        endedAtFinalLevel: true,
      }),
    );

    expect(viewModel.scoreLabel).toBe('得分 $8000');
    expect(viewModel.subline).toBe('已试玩全部 10 关');
    expect(viewModel.keyboardHint).toBe('Enter 再来一局  Esc 返回主菜单');
  });
});
