import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackgroundTimingTracker } from './backgroundTiming';

describe('BackgroundTimingTracker', () => {
  let nowMs = 1_000;
  let hidden = false;
  const documentListeners = new Map<string, EventListener>();
  const windowListeners = new Map<string, EventListener>();
  const fakeDocument = {
    get hidden() {
      return hidden;
    },
    hasFocus: () => !hidden,
    addEventListener: (event: string, listener: EventListener) => {
      documentListeners.set(event, listener);
    },
    removeEventListener: (event: string) => {
      documentListeners.delete(event);
    },
  };
  const fakeWindow = {
    addEventListener: (event: string, listener: EventListener) => {
      windowListeners.set(event, listener);
    },
    removeEventListener: (event: string) => {
      windowListeners.delete(event);
    },
  };

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    hidden = false;
    documentListeners.clear();
    windowListeners.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accumulates elapsed time across blur and focus once', () => {
    const tracker = new BackgroundTimingTracker({
      document: fakeDocument as unknown as Document,
      window: fakeWindow as unknown as Window,
      now: () => nowMs,
    });
    tracker.start();

    windowListeners.get('blur')?.(new Event('blur'));
    nowMs += 2_500;
    windowListeners.get('focus')?.(new Event('focus'));

    expect(tracker.consumeElapsedMs()).toBe(2_500);
    expect(tracker.consumeElapsedMs()).toBe(0);

    tracker.stop();
  });

  it('stops tracking cleanly without leaking elapsed time', () => {
    const tracker = new BackgroundTimingTracker({
      document: fakeDocument as unknown as Document,
      window: fakeWindow as unknown as Window,
      now: () => nowMs,
    });
    tracker.start();

    windowListeners.get('blur')?.(new Event('blur'));
    nowMs += 800;
    tracker.stop();

    expect(tracker.consumeElapsedMs()).toBe(0);
  });
});
