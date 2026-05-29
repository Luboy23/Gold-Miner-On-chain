import type Phaser from 'phaser';

import { gameState } from '../../game/gameState';

export class GoalSceneAudioController {
  private readonly scene: Phaser.Scene;
  private currentMusicKey: 'goal' | 'madeGoal' | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  play(mode: 'next-goal' | 'level-clear' | 'ranked-briefing'): void {
    const snapshot = gameState.snapshot;

    if (snapshot.settings.muted || snapshot.debug.muteAudio) {
      return;
    }

    this.stop();
    this.currentMusicKey = mode === 'level-clear' ? 'madeGoal' : 'goal';
    this.scene.sound.play(this.currentMusicKey, { loop: true, volume: 0.6 });
  }

  stop(): void {
    if (!this.currentMusicKey) {
      return;
    }

    this.scene.sound.stopByKey(this.currentMusicKey);
    this.currentMusicKey = null;
  }
}
