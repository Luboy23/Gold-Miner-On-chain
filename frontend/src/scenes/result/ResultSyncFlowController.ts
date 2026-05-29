import type Phaser from 'phaser';

import type { RankedSyncStage, RunResult } from '../../game/types/index';
import {
  createResultSyncTransport,
  type ResultSyncTransport,
} from './resultSyncTransport';

export interface ResultSyncSnapshot {
  syncing: boolean;
  stage: RankedSyncStage;
  message: string;
}

type ResultSyncFlowCallbacks = {
  onSnapshotChange: (snapshot: Readonly<ResultSyncSnapshot>) => void;
};

type ResultSyncOptions = {
  acceptUpdate?: () => boolean;
};

export class ResultSyncFlowController {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: ResultSyncFlowCallbacks;
  private readonly transport: ResultSyncTransport;
  private snapshot: ResultSyncSnapshot = {
    syncing: false,
    stage: 'idle',
    message: '',
  };

  constructor(
    scene: Phaser.Scene,
    callbacks: ResultSyncFlowCallbacks,
  ) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.transport = createResultSyncTransport();
  }

  initialize(result: RunResult): void {
    this.snapshot = this.transport.initialize(result);
    this.emit();
  }

  getSnapshot(): Readonly<ResultSyncSnapshot> {
    return this.snapshot;
  }

  async sync(result: RunResult, options?: ResultSyncOptions): Promise<void> {
    if (this.snapshot.syncing) {
      return;
    }

    await this.transport.sync(
      result,
      (update) => {
        this.setSnapshot(update, options?.acceptUpdate);
      },
      async (delayMs) => this.wait(delayMs),
    );
  }

  private wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.scene.time.delayedCall(delayMs, () => resolve());
    });
  }

  private setSnapshot(
    partial: Partial<ResultSyncSnapshot>,
    acceptUpdate?: () => boolean,
  ): void {
    if (acceptUpdate && !acceptUpdate()) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    this.emit();
  }

  private emit(): void {
    this.callbacks.onSnapshotChange(this.snapshot);
  }
}
