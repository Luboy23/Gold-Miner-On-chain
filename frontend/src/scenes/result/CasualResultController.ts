import type Phaser from 'phaser';

import { LOGIC_CENTER_X, LOGIC_HEIGHT, LOGIC_WIDTH } from '../../game/constants';
import { createUiText } from '../../game/uiText';
import type { RunResult } from '../../game/types/index';
import { buildCasualResultViewModel } from './casualResultModel';

type CasualResultCallbacks = {
  onReplay: () => void;
  onReturnToMenu: () => void;
};

export class CasualResultController {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: CasualResultCallbacks;
  private root?: Phaser.GameObjects.Container;
  private headlineText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  private sublineText?: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private keyboardHintText?: Phaser.GameObjects.Text;
  private primaryLabel?: Phaser.GameObjects.Text;
  private secondaryLabel?: Phaser.GameObjects.Text;
  private primaryBackground?: Phaser.GameObjects.Rectangle;
  private secondaryBackground?: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, callbacks: CasualResultCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  show(result: RunResult): void {
    if (!this.root) {
      this.createRoot();
    }

    const viewModel = buildCasualResultViewModel(result);

    this.headlineText?.setText(viewModel.headline);
    this.scoreText?.setText(viewModel.scoreLabel);
    this.sublineText?.setText(viewModel.subline);
    this.hintText?.setText(viewModel.hint);
    this.keyboardHintText?.setText(viewModel.keyboardHint);
    this.primaryLabel?.setText(viewModel.primaryLabel);
    this.secondaryLabel?.setText(viewModel.secondaryLabel);
  }

  destroy(): void {
    this.root?.destroy(true);
    this.root = undefined;
    this.headlineText = undefined;
    this.scoreText = undefined;
    this.sublineText = undefined;
    this.hintText = undefined;
    this.keyboardHintText = undefined;
    this.primaryLabel = undefined;
    this.secondaryLabel = undefined;
    this.primaryBackground = undefined;
    this.secondaryBackground = undefined;
  }

  private createRoot(): void {
    this.root = this.scene.add.container(0, 0);

    const backdrop = this.scene.add
      .rectangle(LOGIC_CENTER_X, LOGIC_HEIGHT / 2, LOGIC_WIDTH, LOGIC_HEIGHT, 0x2a1607, 0.18)
      .setOrigin(0.5)
      .setName('result.casual.backdrop')
      .setInteractive({ useHandCursor: false });

    const panel = this.scene.add
      .container(LOGIC_CENTER_X, 126)
      .setName('result.casual.panel');

    const panelBackground = this.scene.add
      .rectangle(0, 0, 236, 156, 0x7e4200, 0.96)
      .setStrokeStyle(2, 0xf7b22a, 0.98);

    this.headlineText = createUiText(this.scene, 0, -50, '', {
      variant: 'heading',
      script: 'mixed',
      style: {
        fontSize: '16px',
        color: '#f7d54a',
        align: 'center',
      },
    }).setOrigin(0.5);

    this.scoreText = createUiText(this.scene, 0, -6, '', {
      variant: 'value',
      script: 'mixed',
      style: {
        fontSize: '28px',
        color: '#ffffff',
      },
    }).setOrigin(0.5);

    this.sublineText = createUiText(this.scene, 0, 34, '', {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '12px',
        color: '#ffe08c',
        align: 'center',
      },
    }).setOrigin(0.5);

    this.hintText = createUiText(this.scene, 0, 54, '', {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#fff2c8',
        align: 'center',
        wordWrap: { width: 176, useAdvancedWrap: true },
        lineSpacing: 2,
      },
    }).setOrigin(0.5);

    this.primaryBackground = this.scene.add
      .rectangle(-52, 74, 92, 18, 0x224413, 0.96)
      .setStrokeStyle(2, 0x79f05a, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.primaryBackground.on('pointerdown', () => {
      this.callbacks.onReplay();
    });
    this.primaryBackground.on('pointerover', () => {
      this.primaryBackground?.setFillStyle(0x2e5f16, 0.98);
      this.primaryBackground?.setStrokeStyle(2, 0xd4ff8f, 0.98);
      this.primaryLabel?.setAlpha(1);
    });
    this.primaryBackground.on('pointerout', () => {
      this.primaryBackground?.setFillStyle(0x224413, 0.96);
      this.primaryBackground?.setStrokeStyle(2, 0x79f05a, 0.95);
      this.primaryLabel?.setAlpha(0.94);
    });

    this.primaryLabel = createUiText(this.scene, -52, 74, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#efffe6',
      },
    }).setOrigin(0.5).setAlpha(0.94);

    this.secondaryBackground = this.scene.add
      .rectangle(52, 74, 92, 18, 0x3b2410, 0.96)
      .setStrokeStyle(2, 0x9f7f53, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.secondaryBackground.on('pointerdown', () => {
      this.callbacks.onReturnToMenu();
    });
    this.secondaryBackground.on('pointerover', () => {
      this.secondaryBackground?.setFillStyle(0x5f3517, 0.98);
      this.secondaryBackground?.setStrokeStyle(2, 0xf7d54a, 0.98);
      this.secondaryLabel?.setAlpha(1);
    });
    this.secondaryBackground.on('pointerout', () => {
      this.secondaryBackground?.setFillStyle(0x3b2410, 0.96);
      this.secondaryBackground?.setStrokeStyle(2, 0x9f7f53, 0.95);
      this.secondaryLabel?.setAlpha(0.9);
    });

    this.secondaryLabel = createUiText(this.scene, 52, 74, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#fff4d0',
      },
    }).setOrigin(0.5).setAlpha(0.9);

    this.keyboardHintText = createUiText(this.scene, 0, 94, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#ffffff',
        align: 'center',
      },
    }).setOrigin(0.5);

    panel.add([
      panelBackground,
      this.headlineText,
      this.scoreText,
      this.sublineText,
      this.hintText,
      this.primaryBackground,
      this.primaryLabel,
      this.secondaryBackground,
      this.secondaryLabel,
      this.keyboardHintText,
    ]);

    this.root.add([backdrop, panel]);
  }
}
