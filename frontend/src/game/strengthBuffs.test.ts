import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STRENGTH_MULTIPLIER,
  STRENGTH_DRINK_MULTIPLIER,
} from './constants';
import {
  applyStrengthBoostMultiplier,
  getInitialStrengthMultiplier,
} from './strengthBuffs';

describe('strengthBuffs', () => {
  it('uses the default multiplier without a strength drink', () => {
    expect(
      getInitialStrengthMultiplier({
        temporaryBuffs: {
          strengthDrink: 0,
          luckyClover: 0,
          rockCollectorsBook: 0,
          gemPolish: 0,
        },
      }),
    ).toBe(DEFAULT_STRENGTH_MULTIPLIER);
  });

  it('starts the next level with an elevated hook strength multiplier after buying strength drink', () => {
    expect(
      getInitialStrengthMultiplier({
        temporaryBuffs: {
          strengthDrink: 1,
          luckyClover: 0,
          rockCollectorsBook: 0,
          gemPolish: 0,
        },
      }),
    ).toBe(STRENGTH_DRINK_MULTIPLIER);
  });

  it('applies question-bag strength on top of the same multiplier system', () => {
    expect(
      applyStrengthBoostMultiplier(STRENGTH_DRINK_MULTIPLIER),
    ).toBeGreaterThan(STRENGTH_DRINK_MULTIPLIER);
  });
});
