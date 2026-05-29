import type { RunResult } from '../../game/types/index';

export type CasualResultViewModel = {
  headline: string;
  scoreLabel: string;
  subline: string;
  hint: string;
  primaryLabel: string;
  secondaryLabel: string;
  keyboardHint: string;
};

export function buildCasualResultViewModel(
  result: RunResult,
): CasualResultViewModel {
  const subline = result.endedAtFinalLevel
    ? '已试玩全部 10 关'
    : result.reachedGoal
      ? `已试玩到第 ${result.levelGroup} 关`
      : `本次试玩止步第 ${result.levelGroup} 关`;

  return {
    headline: '试玩结束',
    scoreLabel: `得分 $${result.score}`,
    subline,
    hint: '试玩模式不保存进度，也不会同步到链上。',
    primaryLabel: '再来一局',
    secondaryLabel: '返回主菜单',
    keyboardHint: 'Enter 再来一局  Esc 返回主菜单',
  };
}
