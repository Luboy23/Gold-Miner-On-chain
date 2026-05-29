import Phaser from 'phaser';

import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import { LOGIC_CENTER_X, LOGIC_CENTER_Y } from '../game/constants';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import { SCENE_KEYS } from '../game/sceneKeys';
import type {
  GoalSceneMode,
  GoalScenePayload,
  RunRestartSnapshot,
  RunState,
} from '../game/types/index';
import { GoalSceneAudioController } from './goal/GoalSceneAudioController';
import { GoalCasualBriefingController } from './goal/GoalCasualBriefingController';
import { GoalSceneNavigationController } from './goal/GoalSceneNavigationController';
import { GoalRankedBriefingController } from './goal/GoalRankedBriefingController';

export class GoalScene extends Phaser.Scene {
  private mode: GoalSceneMode = 'next-goal';
  private run: RunState | null = null;
  private casualBriefingController: GoalCasualBriefingController | null = null;
  private rankedBriefingController: GoalRankedBriefingController | null = null;
  private audioController: GoalSceneAudioController | null = null;
  private navigationController: GoalSceneNavigationController | null = null;
  private restartSnapshot: RunRestartSnapshot | null = null;
  private brandFooter: BrandFooterHandle | null = null;
  public autoAdvanceRemainingSec: number | null = null;
  public autoAdvanceHintText: { text: string | null } | null = null;

  constructor() {
    super(SCENE_KEYS.Goal);
  }

  init(data?: Partial<GoalScenePayload>): void {
    this.mode = data?.mode ?? 'next-goal';
    this.run = data?.run ?? gameState.currentRun;
    this.restartSnapshot = data?.restartSnapshot ?? null;
    this.autoAdvanceRemainingSec = null;
    this.autoAdvanceHintText = null;
  }

  create(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    gameState.setCurrentRun(this.run);
    configureLogicalCamera(this);
    this.audioController ??= new GoalSceneAudioController(this);
    this.navigationController ??= new GoalSceneNavigationController(this);
    this.audioController.play(this.mode);

    setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'goal').setOrigin(0.5),
      'goal',
    );
    this.brandFooter = createBrandFooter(this, getBrandFooterLayout('goal'));

    if (this.run.mode === 'ranked') {
      this.createRankedBriefing();
    } else {
      this.createCasualGoal();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audioController?.stop();
      this.autoAdvanceRemainingSec = null;
      this.autoAdvanceHintText = null;
      this.casualBriefingController?.destroy();
      this.casualBriefingController = null;
      this.rankedBriefingController?.destroy();
      this.rankedBriefingController = null;
      this.brandFooter?.destroy();
      this.brandFooter = null;
    });
  }

  private createCasualGoal(): void {
    if (!this.run) {
      return;
    }
    this.casualBriefingController ??= new GoalCasualBriefingController(this, {
      onAdvance: () => {
        this.navigationController?.goToNextCasualScene(
          this.mode,
          this.run,
          this.restartSnapshot,
        );
      },
      onCountdownChange: (countdownState) => {
        this.autoAdvanceRemainingSec = countdownState.remainingSec;
        this.autoAdvanceHintText = countdownState.hintText
          ? { text: countdownState.hintText }
          : null;
      },
    });
    this.casualBriefingController.show(this.mode, this.run);
  }

  private createRankedBriefing(): void {
    if (!this.run) {
      return;
    }
    this.rankedBriefingController ??= new GoalRankedBriefingController(this, {
      onStart: () => {
        this.navigationController?.goToGameplay(this.run);
      },
      onBack: () => {
        this.navigationController?.goBackToRanked();
      },
    });
    this.rankedBriefingController.show(this.run);
  }
}
