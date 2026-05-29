import { describe, expect, it, vi } from 'vitest';

import { VerifiedStepDrain } from './VerifiedStepDrain';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

describe('VerifiedStepDrain', () => {
  it('drains queued ticks sequentially without parallel step execution', async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const executeStep = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const drain = new VerifiedStepDrain(executeStep);

    drain.queueTick();
    drain.queueTick();
    drain.queueTick();

    expect(executeStep).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.resolve();
    expect(executeStep).toHaveBeenCalledTimes(2);

    second.resolve();
    await Promise.resolve();
    expect(executeStep).toHaveBeenCalledTimes(3);

    third.resolve();
    await drain.awaitIdle();

    expect(executeStep).toHaveBeenCalledTimes(3);
  });

  it('keeps awaitIdle pending until the queued drain fully settles', async () => {
    const first = deferred();
    const second = deferred();
    const executeStep = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const drain = new VerifiedStepDrain(executeStep);

    drain.queueTick();
    drain.queueTick();

    let idleResolved = false;
    const idlePromise = drain.awaitIdle().then(() => {
      idleResolved = true;
    });

    await Promise.resolve();
    expect(idleResolved).toBe(false);

    first.resolve();
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    second.resolve();
    await idlePromise;
    expect(idleResolved).toBe(true);
  });
});
