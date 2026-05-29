export class VerifiedStepDrain {
  private readonly executeStep: () => Promise<void>;
  private stepInFlight: Promise<void> | null = null;
  private pendingTicks = 0;

  constructor(executeStep: () => Promise<void>) {
    this.executeStep = executeStep;
  }

  reset(): void {
    this.pendingTicks = 0;
    this.stepInFlight = null;
  }

  queueTick(): void {
    this.pendingTicks += 1;
    if (this.stepInFlight) {
      return;
    }

    this.stepInFlight = this.drain();
    void this.stepInFlight.catch(() => {
      // Scene-level callers guard end-user state updates and can observe failures via awaitIdle.
    });
  }

  async awaitIdle(): Promise<void> {
    await this.stepInFlight;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingTicks > 0) {
        this.pendingTicks -= 1;
        await this.executeStep();
      }
    } finally {
      this.stepInFlight = null;

      if (this.pendingTicks > 0) {
        this.stepInFlight = this.drain();
        void this.stepInFlight.catch(() => {
          // Keep fire-and-forget queueing from surfacing unhandled rejections.
        });
      }
    }
  }
}
