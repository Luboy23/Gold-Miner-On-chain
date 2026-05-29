import type Phaser from 'phaser';

import { LOGIC_CENTER_X, LOGIC_HEIGHT, LOGIC_WIDTH } from '../../game/constants';
import { createUiText } from '../../game/uiText';

export type PauseMenuAction = 'resume' | 'restart' | 'return';

type PauseMenuEntry = {
  action: PauseMenuAction;
  label: string;
};

type PauseMenuCallbacks = {
  onSelect: (action: PauseMenuAction) => void;
  onCancel: () => void;
};

type PauseMenuButton = {
  action: PauseMenuAction;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

export class PauseMenuModal {
  private readonly root: Phaser.GameObjects.Container;
  private readonly bodyText: Phaser.GameObjects.Text;
  private readonly callbacks: PauseMenuCallbacks;
  private readonly buttons: PauseMenuButton[] = [];
  private entries: PauseMenuEntry[] = [];
  private selectionIndex = 0;

  constructor(scene: Phaser.Scene, callbacks: PauseMenuCallbacks) {
    this.callbacks = callbacks;
    this.root = scene.add.container(0, 0).setDepth(80).setVisible(false);

    const backdrop = scene.add
      .rectangle(LOGIC_CENTER_X, LOGIC_HEIGHT / 2, LOGIC_WIDTH, 240, 0x000000, 0.46)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backdrop.on('pointerdown', () => {
      this.cancel();
    });

    const panel = scene.add
      .container(LOGIC_CENTER_X, 126)
      .setName('pause.menu.panel');
    const panelBackground = scene.add
      .rectangle(0, 0, 236, 164, 0x1f140a, 0.96)
      .setStrokeStyle(2, 0xf7d54a);

    const titleText = createUiText(scene, 0, -60, '暂停中', {
      variant: 'heading',
      script: 'mixed',
      style: {
        fontSize: '16px',
        color: '#f7d54a',
      },
    })
      .setOrigin(0.5)
      .setName('pause.menu.title');

    this.bodyText = createUiText(scene, 0, -38, '', {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#fff6ba',
        align: 'center',
        wordWrap: { width: 188, useAdvancedWrap: true },
        lineSpacing: 2,
      },
    })
      .setOrigin(0.5, 0)
      .setName('pause.menu.body');

    const buttonY = [-2, 26, 54] as const;

    buttonY.forEach((y, index) => {
      const background = scene.add
        .rectangle(0, y, 148, 18, 0x224413, 0.96)
        .setStrokeStyle(2, 0x79f05a, 0.95)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      const label = createUiText(scene, 0, y, '', {
        variant: 'caption',
        script: 'mixed',
        style: {
          fontSize: '8px',
          color: '#efffe6',
        },
      }).setOrigin(0.5);

      background.on('pointerover', () => {
        this.setSelection(index);
      });
      background.on('pointerdown', () => {
        const entry = this.entries[index];
        if (!entry) {
          return;
        }
        this.selectionIndex = index;
        this.refreshSelection();
        this.select(entry.action);
      });

      this.buttons.push({
        action: 'resume',
        background,
        label,
      });
    });

    panel.add([
      panelBackground,
      titleText,
      this.bodyText,
      ...this.buttons.flatMap((button) => [button.background, button.label]),
    ]);
    this.root.add([backdrop, panel]);
  }

  destroy(): void {
    this.root.destroy(true);
  }

  show(body: string, entries: PauseMenuEntry[]): void {
    this.entries = entries;
    this.selectionIndex = 0;
    this.bodyText.setText(body);
    this.buttons.forEach((button, index) => {
      const entry = entries[index];
      button.action = entry.action;
      button.label.setText(entry.label);
      button.background.setVisible(true);
      button.label.setVisible(true);
    });
    this.root.setVisible(true);
    this.refreshSelection();
  }

  hide(): void {
    this.root.setVisible(false);
    this.selectionIndex = 0;
    this.entries = [];
    this.refreshSelection();
  }

  isVisible(): boolean {
    return this.root.visible;
  }

  getSelectedAction(): PauseMenuAction | null {
    return this.entries[this.selectionIndex]?.action ?? null;
  }

  handleDirectionalInput(direction: 'up' | 'down'): void {
    if (this.entries.length === 0) {
      return;
    }

    const delta = direction === 'up' ? -1 : 1;
    this.selectionIndex =
      (this.selectionIndex + delta + this.entries.length) % this.entries.length;
    this.refreshSelection();
  }

  handleConfirm(): void {
    const action = this.entries[this.selectionIndex]?.action;
    if (!action) {
      this.cancel();
      return;
    }

    this.select(action);
  }

  handleCancel(): void {
    this.cancel();
  }

  private select(action: PauseMenuAction): void {
    this.hide();
    this.callbacks.onSelect(action);
  }

  private cancel(): void {
    this.hide();
    this.callbacks.onCancel();
  }

  private setSelection(index: number): void {
    if (index < 0 || index >= this.entries.length) {
      return;
    }

    this.selectionIndex = index;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    this.buttons.forEach((button, index) => {
      const active = index === this.selectionIndex && index < this.entries.length;
      const isReturn = this.entries[index]?.action === 'return';

      if (active) {
        button.background.setFillStyle(isReturn ? 0x5f3517 : 0x2e5f16, 0.98);
        button.background.setStrokeStyle(
          2,
          isReturn ? 0xf7d54a : 0xd4ff8f,
          0.98,
        );
        button.label.setAlpha(1);
        return;
      }

      button.background.setFillStyle(isReturn ? 0x3b2410 : 0x224413, 0.96);
      button.background.setStrokeStyle(
        2,
        isReturn ? 0x9f7f53 : 0x79f05a,
        0.95,
      );
      button.label.setAlpha(0.86);
    });
  }
}
