import { describe, expect, it } from 'vitest';

import { getBrandFooterLayout } from './brandFooterLayout';

describe('getBrandFooterLayout', () => {
  it('maps spacious scenes to the wide footer layout', () => {
    expect(getBrandFooterLayout('menu')).toEqual({
      variant: 'wide',
      x: 302,
      y: 234,
    });
    expect(getBrandFooterLayout('goal')).toEqual({
      variant: 'wide',
      x: 302,
      y: 234,
    });
    expect(getBrandFooterLayout('gameplay')).toEqual({
      variant: 'wide',
      x: 302,
      y: 234,
    });
    expect(getBrandFooterLayout('result-casual')).toEqual({
      variant: 'wide',
      x: 302,
      y: 234,
    });
  });

  it('maps dense scenes to the micro footer layout', () => {
    expect(getBrandFooterLayout('adventure-center')).toEqual({
      variant: 'micro',
      x: 298,
      y: 212,
    });
    expect(getBrandFooterLayout('ranked-center')).toEqual({
      variant: 'micro',
      x: 298,
      y: 212,
    });
    expect(getBrandFooterLayout('shop')).toEqual({
      variant: 'micro',
      x: 302,
      y: 214,
    });
    expect(getBrandFooterLayout('result-verified')).toEqual({
      variant: 'micro',
      x: 298,
      y: 216,
    });
  });
});
