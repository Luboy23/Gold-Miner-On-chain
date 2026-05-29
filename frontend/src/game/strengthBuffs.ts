import {
  DEFAULT_STRENGTH_MULTIPLIER,
  MAX_STRENGTH_MULTIPLIER,
  STRENGTH_DRINK_MULTIPLIER,
} from './constants';
import type { RunState } from './types/index';

export function getInitialStrengthMultiplier(
  run: Pick<RunState, 'temporaryBuffs'>,
): number {
  return run.temporaryBuffs.strengthDrink === 1
    ? STRENGTH_DRINK_MULTIPLIER
    : DEFAULT_STRENGTH_MULTIPLIER;
}

export function applyStrengthBoostMultiplier(currentMultiplier: number): number {
  return Math.min(MAX_STRENGTH_MULTIPLIER, currentMultiplier * 1.5 + 1);
}
