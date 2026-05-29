import type { RunResult } from '../../game/types/index';
import {
  getRankedChallengeDisplayName,
  getRankedChallengeShortName,
} from '../../game/rankedChallengeDisplay';

export type RankedDerivedResultState = {
  challengeLabel: string;
  levelLabel: string;
  diamondsCaught: number;
  isEligible: boolean;
  finishedTick: number | null;
  lastDiamondTick: number | null;
  logicFps: number | null;
};

export type RankedRetryTarget = {
  challengeId: string;
  version: number;
} | null;

export type RankedSyncEnvelope = {
  sessionId: `0x${string}`;
  challengeId: string;
  challengeVersion: number;
} | null;

export function deriveRankedResultState(result: RunResult): RankedDerivedResultState {
  const challengeId = result.rankedEvidence?.challengeId ?? result.levelId;
  const challengeDisplayName = getRankedChallengeDisplayName({
    challengeId,
  });
  const challengeShortName = getRankedChallengeShortName({
    challengeId,
  });

  return {
    challengeLabel: result.rankedEvidence
      ? `${challengeDisplayName} · 第${result.rankedEvidence.challengeVersion}版`
      : challengeDisplayName,
    levelLabel: challengeShortName,
    diamondsCaught:
      result.rankedRuntimeSummary?.diamondsCaught
      ?? result.rankedEvidence?.summary.diamondsCaught
      ?? result.caughtCount,
    isEligible: result.rankedEvidence !== null,
    finishedTick:
      result.rankedRuntimeSummary?.finishedTick
      ?? result.rankedEvidence?.finishedTick
      ?? null,
    lastDiamondTick:
      result.rankedRuntimeSummary?.lastDiamondTick
      ?? result.rankedEvidence?.summary.lastDiamondTick
      ?? null,
    logicFps: result.rankedEvidence?.logicFps ?? null,
  };
}

export function formatCampaignResultLevelLabel(result: Pick<RunResult, 'levelGroup'>): string {
  return `第${result.levelGroup}关`;
}

export function getRankedRetryTarget(result: RunResult): RankedRetryTarget {
  if (!result.rankedEvidence) {
    return null;
  }

  return {
    challengeId: result.rankedEvidence.challengeId,
    version: result.rankedEvidence.challengeVersion,
  };
}

export function getRankedSyncEnvelope(result: RunResult): RankedSyncEnvelope {
  if (!result.rankedEvidence) {
    return null;
  }

  return {
    sessionId: result.rankedEvidence.sessionId,
    challengeId: result.rankedEvidence.challengeId,
    challengeVersion: result.rankedEvidence.challengeVersion,
  };
}
