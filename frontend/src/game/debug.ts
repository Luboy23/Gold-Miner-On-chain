import type { DebugFlags } from './types/index';

function readSearchParams(): URLSearchParams | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  try {
    if (!globalThis.location?.search) {
      return null;
    }

    return new URLSearchParams(globalThis.location.search);
  } catch {
    return null;
  }
}

function isEnabledParam(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function parseForcedLevelId(params: URLSearchParams | null): string | null {
  const levelId = params?.get('level')?.trim() ?? null;

  if (!levelId) {
    return null;
  }

  return /^L(?:[1-9]|10)$/.test(levelId) ? levelId : null;
}

const queryParams = readSearchParams();

export const DEFAULT_DEBUG_FLAGS: DebugFlags = {
  showHitCircles: isEnabledParam(queryParams?.get('showHitCircles') ?? null),
  forceGoalReached: isEnabledParam(queryParams?.get('forceGoalReached') ?? null),
  infiniteTime: isEnabledParam(queryParams?.get('infiniteTime') ?? null),
  forcedLevelId: parseForcedLevelId(queryParams),
  muteAudio: isEnabledParam(queryParams?.get('muteAudio') ?? null),
};
