type BackgroundTimingState = {
  isTracking: boolean;
  isBackgrounded: boolean;
  backgroundStartedAtMs: number | null;
  accumulatedElapsedMs: number;
};

type BackgroundTimingEnvironment = {
  document: Pick<Document, 'hidden' | 'hasFocus' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now: () => number;
};

/**
 * 失焦计时跟踪器。
 *
 * 这个对象只记录“窗口离开前台了多久”，不负责任何 gameplay 决策。真正如何把
 * 这段 elapsed 应用到游戏逻辑，由 GameplayScene / coordinator 决定。
 *
 * 这样做的约束是：tracking 层不能知道当前模式、hook 状态或结算规则，否则会把
 * 时间来源和业务语义重新耦合在一起。
 */
function nowMs(): number {
  return performance.now();
}

export class BackgroundTimingTracker {
  private readonly environment: BackgroundTimingEnvironment;
  private state: BackgroundTimingState = {
    isTracking: false,
    isBackgrounded: false,
    backgroundStartedAtMs: null,
    accumulatedElapsedMs: 0,
  };

  constructor(environment?: Partial<BackgroundTimingEnvironment>) {
    this.environment = {
      document: environment?.document ?? document,
      window: environment?.window ?? window,
      now: environment?.now ?? nowMs,
    };
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.environment.document.hidden) {
      this.beginBackgroundWindow();
      return;
    }

    this.endBackgroundWindow();
  };

  private readonly handleWindowBlur = (): void => {
    this.beginBackgroundWindow();
  };

  private readonly handleWindowFocus = (): void => {
    this.endBackgroundWindow();
  };

  start(): void {
    if (this.state.isTracking) {
      return;
    }

    this.state = {
      isTracking: true,
      isBackgrounded: false,
      backgroundStartedAtMs: null,
      accumulatedElapsedMs: 0,
    };

    this.environment.document.addEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.environment.window.addEventListener('blur', this.handleWindowBlur);
    this.environment.window.addEventListener('focus', this.handleWindowFocus);

    // 如果 tracker 启动时页面本来就处于后台，必须立即开启背景窗口，否则第一段
    // elapsed 会被漏记。
    if (this.environment.document.hidden || !this.environment.document.hasFocus()) {
      this.beginBackgroundWindow();
    }
  }

  stop(): void {
    if (!this.state.isTracking) {
      return;
    }

    this.endBackgroundWindow();
    this.environment.document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.environment.window.removeEventListener('blur', this.handleWindowBlur);
    this.environment.window.removeEventListener('focus', this.handleWindowFocus);

    this.state = {
      isTracking: false,
      isBackgrounded: false,
      backgroundStartedAtMs: null,
      accumulatedElapsedMs: 0,
    };
  }

  consumeElapsedMs(): number {
    if (!this.state.isTracking) {
      return 0;
    }

    this.endBackgroundWindow();
    const elapsedMs = this.state.accumulatedElapsedMs;
    this.state.accumulatedElapsedMs = 0;

    // consume 会先把当前后台窗口结算，再在仍然失焦时立刻重新开一个窗口。
    // 这样上层无论多久消费一次，都不会把同一段 elapsed 重复记账。
    if (this.environment.document.hidden || !this.environment.document.hasFocus()) {
      this.beginBackgroundWindow();
    }

    return elapsedMs;
  }

  get isBackgrounded(): boolean {
    return this.state.isBackgrounded;
  }

  private beginBackgroundWindow(): void {
    if (!this.state.isTracking || this.state.isBackgrounded) {
      return;
    }

    this.state.isBackgrounded = true;
    this.state.backgroundStartedAtMs = this.environment.now();
  }

  private endBackgroundWindow(): void {
    if (
      !this.state.isTracking ||
      !this.state.isBackgrounded ||
      this.state.backgroundStartedAtMs === null
    ) {
      this.state.isBackgrounded = false;
      this.state.backgroundStartedAtMs = null;
      return;
    }

    this.state.accumulatedElapsedMs += Math.max(
      0,
      this.environment.now() - this.state.backgroundStartedAtMs,
    );
    this.state.isBackgrounded = false;
    this.state.backgroundStartedAtMs = null;
  }
}
