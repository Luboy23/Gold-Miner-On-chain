import Phaser from 'phaser';

import { LOGIC_CENTER_X } from '../../game/constants';
import { setLogicalTextureSize } from '../../game/display';
import { createUiText } from '../../game/uiText';
import type { GoalSceneMode, RunState } from '../../game/types/index';

const CASUAL_GOAL_STACK_TOP_OFFSET = 1;
const CASUAL_GOAL_STACK_GAPS = [2, 2, 1] as const;
const CASUAL_AUTO_ADVANCE_START_SEC = 3 as const;
const CASUAL_AUTO_ADVANCE_DISPLAY_WINDOW_MS = 1100;
const CASUAL_HINT_FONT_SIZES = ['10px', '9px'] as const;
const CASUAL_HINT_HORIZONTAL_PADDING = 14;

type CasualAutoAdvanceRemainingSec = 1 | 2 | 3;

type GoalCasualBriefingCallbacks = {
  onAdvance: () => void;
  onCountdownChange?: (state: {
    remainingSec: number | null;
    hintText: string | null;
  }) => void;
};

export class GoalCasualBriefingController {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: GoalCasualBriefingCallbacks;
  private root: Phaser.GameObjects.Container | null = null;
  private autoAdvanceHintText: Phaser.GameObjects.Text | null = null;
  private autoAdvanceAnimationFrameId: number | null = null;
  private autoAdvanceGeneration = 0;
  private autoAdvanceStartedAtMs = 0;
  private autoAdvanceRemainingSec: CasualAutoAdvanceRemainingSec =
    CASUAL_AUTO_ADVANCE_START_SEC;
  private autoAdvanceConsumed = false;
  private autoAdvanceMode: GoalSceneMode = 'next-goal';
  private readonly handleEnterKey = (): void => {
    this.advance();
  };

  constructor(scene: Phaser.Scene, callbacks: GoalCasualBriefingCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  show(mode: GoalSceneMode, run: RunState): void {
    this.destroy();
    this.autoAdvanceMode = mode;

    const isLevelClear = mode === 'level-clear';
    this.root = this.scene.add.container(0, 0);

    const title = setLogicalTextureSize(
      this.scene.add.image(LOGIC_CENTER_X, 40, 'title').setOrigin(0.5),
      'title',
    );
    const panel = setLogicalTextureSize(
      this.scene.add.image(LOGIC_CENTER_X, 128, 'panel').setOrigin(0.5),
      'panel',
    )
      .setName('goal.casual.panel')
      .setInteractive({ useHandCursor: true });
    panel.on('pointerdown', () => {
      this.advance();
    });

    const headline =
      isLevelClear
        ? '进入下一关'
        : run.levelGroup === 1
          ? '第一关目标'
          : '下一关目标';
    const primaryValue = isLevelClear ? `第 ${run.levelGroup} 关` : `$${run.goal}`;

    const headlineText = createUiText(this.scene, LOGIC_CENTER_X, 0, headline, {
      variant: 'heading',
      script: 'mixed',
      style: {
        fontSize: isLevelClear ? '14px' : '15px',
        color: '#f7d54a',
        align: 'center',
      },
    })
      .setOrigin(0.5)
      .setName('goal.casual.headline');

    const primaryText = createUiText(
      this.scene,
      LOGIC_CENTER_X,
      0,
      primaryValue,
      {
        variant: 'value',
        script: /^\$[\d\s.,]+$/.test(primaryValue) ? 'latin' : 'mixed',
        style: {
          fontSize: isLevelClear ? '21px' : '28px',
          color: '#ffffff',
        },
      },
    )
      .setOrigin(0.5)
      .setName('goal.casual.primary');

    const levelText = createUiText(
      this.scene,
      LOGIC_CENTER_X,
      0,
      `当前第 ${run.levelGroup} 关`,
      {
        variant: 'body',
        script: 'mixed',
        style: {
          fontSize: '12px',
          color: '#f7d54a',
          align: 'center',
        },
      },
    )
      .setOrigin(0.5)
      .setName('goal.casual.level');

    const hintText = createUiText(
      this.scene,
      LOGIC_CENTER_X,
      0,
      this.buildAutoAdvanceHint(mode, CASUAL_AUTO_ADVANCE_START_SEC),
      {
        variant: 'body',
        script: 'mixed',
        style: {
          fontSize: CASUAL_HINT_FONT_SIZES[0],
          color: '#ffffff',
          align: 'center',
        },
      },
    )
      .setOrigin(0.5)
      .setName('goal.casual.hint');

    this.autoAdvanceHintText = hintText;
    this.fitHintToSingleLine(
      hintText,
      Math.max(0, panel.displayWidth - CASUAL_HINT_HORIZONTAL_PADDING * 2),
    );
    this.layoutTextStack(panel, [
      headlineText,
      primaryText,
      levelText,
      hintText,
    ]);

    this.root.add([
      title,
      panel,
      headlineText,
      primaryText,
      levelText,
      hintText,
    ]);

    this.scene.input.keyboard?.on('keydown-ENTER', this.handleEnterKey);
    this.startAutoAdvance(mode);
    this.emitCountdownState();
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown-ENTER', this.handleEnterKey);
    this.root?.destroy(true);
    this.root = null;
    this.autoAdvanceGeneration += 1;
    this.clearAutoAdvanceAnimationFrame();
    this.autoAdvanceHintText = null;
    this.autoAdvanceRemainingSec = CASUAL_AUTO_ADVANCE_START_SEC;
    this.autoAdvanceConsumed = false;
  }

  getCountdownState(): {
    remainingSec: number | null;
    hintText: string | null;
  } {
    return {
      remainingSec: this.autoAdvanceConsumed ? null : this.autoAdvanceRemainingSec,
      hintText: this.autoAdvanceHintText?.text ?? null,
    };
  }

  private layoutTextStack(
    panel: Phaser.GameObjects.Image,
    texts: [
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
    ],
  ): void {
    const totalTextHeight =
      texts.reduce((sum, text) => sum + text.height, 0) +
      CASUAL_GOAL_STACK_GAPS.reduce((sum, gap) => sum + gap, 0);
    let nextTop =
      panel.y - totalTextHeight / 2 + CASUAL_GOAL_STACK_TOP_OFFSET;

    texts.forEach((text, index) => {
      text.setY(nextTop + text.height / 2);
      nextTop += text.height;
      if (index < CASUAL_GOAL_STACK_GAPS.length) {
        nextTop += CASUAL_GOAL_STACK_GAPS[index];
      }
    });
  }

  private startAutoAdvance(mode: GoalSceneMode): void {
    this.autoAdvanceGeneration += 1;
    const generation = this.autoAdvanceGeneration;
    this.clearAutoAdvanceAnimationFrame();
    this.autoAdvanceConsumed = false;
    this.autoAdvanceStartedAtMs = performance.now();
    this.autoAdvanceRemainingSec = CASUAL_AUTO_ADVANCE_START_SEC;
    this.updateAutoAdvanceHint(mode);
    this.emitCountdownState();

    const tick = (): void => {
      if (!this.isCurrentAutoAdvanceGeneration(generation)) {
        return;
      }

      const elapsedMs = performance.now() - this.autoAdvanceStartedAtMs;
      let nextRemainingSec = 0;

      if (elapsedMs < CASUAL_AUTO_ADVANCE_DISPLAY_WINDOW_MS) {
        nextRemainingSec = 3;
      } else if (elapsedMs < CASUAL_AUTO_ADVANCE_DISPLAY_WINDOW_MS * 2) {
        nextRemainingSec = 2;
      } else if (elapsedMs < CASUAL_AUTO_ADVANCE_DISPLAY_WINDOW_MS * 3) {
        nextRemainingSec = 1;
      }

      if (nextRemainingSec === 0) {
        this.advance();
        return;
      }

      if (nextRemainingSec !== this.autoAdvanceRemainingSec) {
        this.autoAdvanceRemainingSec =
          nextRemainingSec as CasualAutoAdvanceRemainingSec;
        this.updateAutoAdvanceHint(this.autoAdvanceMode);
        this.emitCountdownState();
      }

      this.autoAdvanceAnimationFrameId = window.requestAnimationFrame(tick);
    };

    this.autoAdvanceAnimationFrameId = window.requestAnimationFrame(tick);
  }

  private updateAutoAdvanceHint(mode: GoalSceneMode): void {
    if (!this.autoAdvanceHintText) {
      return;
    }

    this.autoAdvanceHintText.setText(
      this.buildAutoAdvanceHint(mode, this.autoAdvanceRemainingSec),
    );
  }

  private buildAutoAdvanceHint(
    mode: GoalSceneMode,
    remainingSec: CasualAutoAdvanceRemainingSec,
  ): string {
    const destination = mode === 'level-clear' ? '商店' : '下一关';
    return `${remainingSec}秒后自动进入${destination}，点击面板或按回车可立即进入`;
  }

  private fitHintToSingleLine(
    hintText: Phaser.GameObjects.Text,
    maxWidth: number,
  ): void {
    for (const fontSize of CASUAL_HINT_FONT_SIZES) {
      hintText.setFontSize(fontSize);
      if (hintText.width <= maxWidth) {
        return;
      }
    }
  }

  private advance(): void {
    if (this.autoAdvanceConsumed) {
      return;
    }

    this.autoAdvanceConsumed = true;
    this.clearAutoAdvanceAnimationFrame();
    this.emitCountdownState();
    this.callbacks.onAdvance();
  }

  private clearAutoAdvanceAnimationFrame(): void {
    if (this.autoAdvanceAnimationFrameId === null) {
      return;
    }

    window.cancelAnimationFrame(this.autoAdvanceAnimationFrameId);
    this.autoAdvanceAnimationFrameId = null;
  }

  private isCurrentAutoAdvanceGeneration(generation: number): boolean {
    return generation === this.autoAdvanceGeneration && !this.autoAdvanceConsumed;
  }

  private emitCountdownState(): void {
    this.callbacks.onCountdownChange?.({
      remainingSec: this.autoAdvanceConsumed
        ? null
        : this.autoAdvanceRemainingSec,
      hintText: this.autoAdvanceHintText?.text ?? null,
    });
  }
}
