import type { CampaignHistoryEntry } from '../web3/types';

export interface AdventureHistorySummary {
  highestScore: number | null;
  bestReachedLevel: number | null;
  completedL10: boolean;
}

export function summarizeAdventureHistory(
  entries: CampaignHistoryEntry[],
): AdventureHistorySummary {
  if (entries.length === 0) {
    return {
      highestScore: null,
      bestReachedLevel: null,
      completedL10: false,
    };
  }

  const highestScore = entries.reduce(
    (current, entry) => Math.max(current, entry.result.finalScore),
    0,
  );
  const bestEntry = [...entries].sort((left, right) => {
    if (right.result.reachedLevel !== left.result.reachedLevel) {
      return right.result.reachedLevel - left.result.reachedLevel;
    }

    return right.result.finalScore - left.result.finalScore;
  })[0];

  return {
    highestScore,
    bestReachedLevel: bestEntry.result.reachedLevel,
    completedL10: entries.some((entry) => entry.result.completed),
  };
}
