import { describe, expect, it } from 'vitest';

import fixtureJson from '../test-fixtures/ranked-golden-question-bag.json';
import {
  materializeRankedEntities,
  simulateRankedRun,
  type RankedSimulationFixture,
} from './rankedSimulation';

const fixture = fixtureJson as RankedSimulationFixture;

describe('ranked golden simulation', () => {
  it('replays the shared question-bag catch fixture', () => {
    const outcome = simulateRankedRun(fixture.evidence, fixture.spec);

    expect(outcome).toEqual({
      score: fixture.expected.score,
      dynamiteUsed: fixture.expected.dynamiteUsed,
      caughtCount: fixture.expected.caughtCount,
      cleared: fixture.expected.cleared,
      finishedTick: fixture.expected.finishedTick,
      durationMs: fixture.expected.durationMs,
    });
  });

  it('materializes question bags from the canonical challenge seed', () => {
    const questionBags = materializeRankedEntities(fixture.spec)
      .filter((entity) => entity.rewardKind !== undefined)
      .map((entity, index) => ({
        index,
        mass: entity.mass,
        bonus: entity.bonus,
        rewardKind: entity.rewardKind,
        dynamiteDelta: entity.dynamiteDelta,
        grantsStrengthBoost: entity.grantsStrengthBoost,
      }));

    expect(questionBags).toEqual(fixture.expected.questionBags);
  });
});
