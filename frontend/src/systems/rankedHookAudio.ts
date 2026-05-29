import type { RankedWasmRuntimeSnapshot } from '../game/rankedWasmRuntime';
import type { BonusTier, CatchRewardKind, EntityType } from '../game/types/index';

export const BONUS_SOUND_BY_TIER = {
  low: 'lowValue',
  normal: 'normalValue',
  high: 'highValue',
} as const;

export type RankedHookSoundKey =
  | 'explosive'
  | 'grabStart'
  | 'highValue'
  | 'hookReset'
  | 'lowValue'
  | 'money'
  | 'normalValue';

export interface RankedHookAudioEntity {
  type: EntityType;
  bonusTier: BonusTier;
  rewardKind: CatchRewardKind;
}

export function deriveRankedHookAudioEvents(options: {
  previous: RankedWasmRuntimeSnapshot | null;
  next: RankedWasmRuntimeSnapshot;
  enteringCaughtEntity: RankedHookAudioEntity | null;
  resolvingCaughtEntity: RankedHookAudioEntity | null;
}): RankedHookSoundKey[] {
  const { previous, next, enteringCaughtEntity, resolvingCaughtEntity } = options;

  if (!previous) {
    return [];
  }

  const sounds: RankedHookSoundKey[] = [];

  if (previous.hookState === 'swinging' && next.hookState === 'extending') {
    sounds.push('grabStart');
  }

  if (
    previous.hookState !== 'returningLoaded' &&
    next.hookState === 'returningLoaded' &&
    enteringCaughtEntity
  ) {
    if (enteringCaughtEntity.type === 'TNT') {
      sounds.push('explosive');
    }
    sounds.push(BONUS_SOUND_BY_TIER[enteringCaughtEntity.bonusTier]);
  }

  if (
    previous.hookState === 'returningLoaded' &&
    next.hookState === 'swinging'
  ) {
    if (resolvingCaughtEntity) {
      sounds.push(getCatchResolutionSoundKey(resolvingCaughtEntity.rewardKind));
    }
    sounds.push('hookReset');
    return sounds;
  }

  if (
    previous.hookState !== 'swinging' &&
    next.hookState === 'swinging'
  ) {
    sounds.push('hookReset');
  }

  return sounds;
}

export function getCatchResolutionSoundKey(
  rewardKind: CatchRewardKind,
): 'money' | 'highValue' {
  return rewardKind === 'money' ? 'money' : 'highValue';
}
