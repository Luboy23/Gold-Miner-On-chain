import type { CatchResult, CatchRewardKind, RunState } from '../game/types/index';

export interface ScoreTimerSnapshot {
  goal: number;
  score: number;
  scoreView: number;
  timeRemainingSec: number;
  reachedGoal: boolean;
  lastCatchText: string | null;
  lastCatchKind: CatchRewardKind | null;
  lastCatchTier: CatchResult['bonusTier'] | null;
  lastCatchVisible: boolean;
}

export class ScoreTimerSystem {
  private readonly goal: number;
  private score: number;
  private scoreView: number;
  private timeRemainingSec: number;
  private bonusTimerSec = 0;
  private lastCatchText: string | null = null;
  private lastCatchKind: CatchRewardKind | null = null;
  private lastCatchTier: CatchResult['bonusTier'] | null = null;

  constructor(run: RunState) {
    this.goal = run.goal;
    this.score = run.score;
    this.scoreView = run.scoreView;
    this.timeRemainingSec = run.timeRemainingSec;
  }

  update(deltaSec: number, options?: { infiniteTime?: boolean }): void {
    if (!options?.infiniteTime && this.timeRemainingSec > 0) {
      this.timeRemainingSec = Math.max(0, this.timeRemainingSec - deltaSec);
    }

    if (this.bonusTimerSec > 0) {
      this.bonusTimerSec = Math.max(0, this.bonusTimerSec - deltaSec);
      if (this.bonusTimerSec === 0) {
        this.lastCatchText = null;
        this.lastCatchKind = null;
        this.lastCatchTier = null;
      }
    }
  }

  consumeElapsedTime(deltaSec: number, options?: { infiniteTime?: boolean }): void {
    if (deltaSec <= 0) {
      return;
    }

    if (!options?.infiniteTime && this.timeRemainingSec > 0) {
      this.timeRemainingSec = Math.max(0, this.timeRemainingSec - deltaSec);
    }
  }

  applyCatch(result: CatchResult): void {
    this.score += result.bonus;
    this.scoreView = this.score;
    this.lastCatchText = result.feedbackText;
    this.lastCatchKind = result.rewardKind;
    this.lastCatchTier = result.bonusTier;
    this.bonusTimerSec = 1;
  }

  forceScore(nextScore: number): void {
    const normalizedScore = Math.max(this.score, Math.floor(nextScore));
    this.score = normalizedScore;
    this.scoreView = normalizedScore;
  }

  expireTime(): void {
    this.timeRemainingSec = 0;
  }

  get snapshot(): ScoreTimerSnapshot {
    return {
      goal: this.goal,
      score: this.score,
      scoreView: this.scoreView,
      timeRemainingSec: this.timeRemainingSec,
      reachedGoal: this.score >= this.goal,
      lastCatchText: this.lastCatchText,
      lastCatchKind: this.lastCatchKind,
      lastCatchTier: this.lastCatchTier,
      lastCatchVisible: this.bonusTimerSec > 0 && this.lastCatchText !== null,
    };
  }

  buildRun(run: RunState, status: RunState['status']): RunState {
    return {
      ...run,
      score: this.score,
      scoreView: this.scoreView,
      timeRemainingSec: this.timeRemainingSec,
      status,
    };
  }
}
