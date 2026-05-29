import type { RankedChallengeManifestEntry } from './rankedChallengeManifest';

const FALLBACK_DISPLAY_NAME = '60秒钻石挑战';
const FALLBACK_SHORT_NAME = '钻石挑战';

export function getRankedChallengeDisplayName(
  challenge:
    | Pick<RankedChallengeManifestEntry, 'displayName' | 'challengeId'>
    | { displayName?: string; challengeId?: string | null }
    | null
    | undefined,
): string {
  const explicitName = challenge?.displayName?.trim();

  if (explicitName) {
    return explicitName;
  }

  if (challenge?.challengeId === 'diamond_rush_60') {
    return FALLBACK_DISPLAY_NAME;
  }

  return challenge?.challengeId?.trim() || FALLBACK_DISPLAY_NAME;
}

export function getRankedChallengeShortName(
  challenge:
    | Pick<RankedChallengeManifestEntry, 'shortName' | 'challengeId'>
    | { shortName?: string; challengeId?: string | null }
    | null
    | undefined,
): string {
  const explicitName = challenge?.shortName?.trim();

  if (explicitName) {
    return explicitName;
  }

  if (challenge?.challengeId === 'diamond_rush_60') {
    return FALLBACK_SHORT_NAME;
  }

  return challenge?.challengeId?.trim() || FALLBACK_SHORT_NAME;
}
