import { describe, expect, it } from 'vitest';

import { ResultRequestTracker } from './ResultRequestTracker';

describe('ResultRequestTracker', () => {
  it('invalidates older requests when a newer request of the same kind starts', () => {
    const tracker = new ResultRequestTracker();

    tracker.beginSession();
    const firstOverview = tracker.beginRequest('overview');
    const secondOverview = tracker.beginRequest('overview');

    expect(tracker.isCurrent(firstOverview)).toBe(false);
    expect(tracker.isCurrent(secondOverview)).toBe(true);
  });

  it('resets per-kind request counters on a new result session', () => {
    const tracker = new ResultRequestTracker();

    tracker.beginSession();
    const oldSync = tracker.beginRequest('sync');
    tracker.beginRequest('history');
    tracker.beginSession();
    const newSync = tracker.beginRequest('sync');

    expect(tracker.isCurrent(oldSync)).toBe(false);
    expect(tracker.isCurrent(newSync)).toBe(true);
    expect(newSync.requestId).toBe(1);
  });
});
