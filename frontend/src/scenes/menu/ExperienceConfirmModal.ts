/**
 * ExperienceConfirmModal 是体验模式入口前的轻量确认弹窗。
 *
 * 它只解决一件事：让用户在进入本地试玩前明确知道“不会保存进度”。
 * 这里不引入额外业务状态，也不负责真正开始 run；scene 只通过回调拿到最终确认结果。
 */
import type Phaser from 'phaser';

import { LOGIC_CENTER_X, LOGIC_HEIGHT, LOGIC_WIDTH } from '../../game/constants';
import { createUiText } from '../../game/uiText';

type ExperienceConfirmSelection = 'no' | 'yes';

type ExperienceConfirmCallbacks = {
  onConfirm: () => void;
};

export class ExperienceConfirmModal {
  private static readonly BODY =
    '试玩模式不保存进度。';

  private readonly root: Phaser.GameObjects.Container;
  private readonly noBackground: Phaser.GameObjects.Rectangle;
  private readonly yesBackground: Phaser.GameObjects.Rectangle;
  private readonly noLabel: Phaser.GameObjects.Text;
  private readonly yesLabel: Phaser.GameObjects.Text;
  private selection: ExperienceConfirmSelection = 'no';

  constructor(scene: Phaser.Scene, callbacks: ExperienceConfirmCallbacks) {
    this.root = scene.add.container(0, 0).setDepth(60).setVisible(false);

    const backdrop = scene.add
      .rectangle(LOGIC_CENTER_X, LOGIC_HEIGHT / 2, LOGIC_WIDTH, 240, 0x000000, 0.42)
      .setOrigin(0.5);

    const panel = scene.add
      .container(LOGIC_CENTER_X, 136)
      .setName('menu.experience.confirm.panel');
    const backdropPanel = scene.add
      .rectangle(0, 0, 236, 146, 0x1f140a, 0.96)
      .setStrokeStyle(2, 0xf7d54a);

    const title = createUiText(scene, 0, -50, '试玩说明', {
      variant: 'heading',
      script: 'mixed',
      style: {
        fontSize: '16px',
        color: '#f7d54a',
      },
    })
      .setOrigin(0.5)
      .setName('menu.experience.confirm.title');

    const body = createUiText(scene, 0, -24, ExperienceConfirmModal.BODY, {
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
      .setName('menu.experience.confirm.body');

    this.noBackground = scene.add
      .rectangle(-56, 52, 86, 18, 0x3b2410, 0.96)
      .setStrokeStyle(2, 0x9f7f53, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.noLabel = createUiText(scene, -56, 52, '返回', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#fff4d0',
      },
    }).setOrigin(0.5);
    const noButton = scene.add
      .container(0, 0, [this.noBackground, this.noLabel])
      .setName('menu.experience.confirm.no');

    this.yesBackground = scene.add
      .rectangle(56, 52, 86, 18, 0x224413, 0.96)
      .setStrokeStyle(2, 0x79f05a, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.yesLabel = createUiText(scene, 56, 52, '开始试玩', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#efffe6',
      },
    }).setOrigin(0.5);
    const yesButton = scene.add
      .container(0, 0, [this.yesBackground, this.yesLabel])
      .setName('menu.experience.confirm.yes');

    this.noBackground.on('pointerover', () => {
      this.setSelection('no');
    });
    this.yesBackground.on('pointerover', () => {
      this.setSelection('yes');
    });
    this.noBackground.on('pointerdown', () => {
      this.hide();
    });
    this.yesBackground.on('pointerdown', () => {
      callbacks.onConfirm();
    });

    panel.add([backdropPanel, title, body, noButton, yesButton]);
    this.root.add([backdrop, panel]);
    this.refreshSelection();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  show(): void {
    // 每次打开都强制回到“否”默认选项，避免沿用上次选择造成误触进入试玩。
    this.selection = 'no';
    this.root.setVisible(true);
    this.refreshSelection();
  }

  hide(): void {
    this.root.setVisible(false);
    this.selection = 'no';
    this.refreshSelection();
  }

  isVisible(): boolean {
    return this.root.visible;
  }

  handleDirectionalInput(direction: 'no' | 'yes' | 'toggle'): void {
    // 弹窗只维护一个二选一状态机；方向输入只允许在 yes/no 之间切换，不引入额外焦点层级。
    if (direction === 'toggle') {
      this.setSelection(this.selection === 'no' ? 'yes' : 'no');
      return;
    }

    this.setSelection(direction);
  }

  handleConfirm(onConfirm: () => void): void {
    if (this.selection === 'yes') {
      onConfirm();
      return;
    }

    this.hide();
  }

  handleCancel(): void {
    this.hide();
  }

  private setSelection(selection: ExperienceConfirmSelection): void {
    this.selection = selection;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    // 视觉高亮只反映当前逻辑选择，不直接触发任何回调；真正提交仍由 confirm/cancel 路径负责。
    const noActive = this.selection === 'no';
    this.noBackground.setFillStyle(noActive ? 0x5f3517 : 0x3b2410, 0.98);
    this.noBackground.setStrokeStyle(2, noActive ? 0xf7d54a : 0x9f7f53, 0.98);
    this.noLabel.setAlpha(noActive ? 1 : 0.86);

    const yesActive = this.selection === 'yes';
    this.yesBackground.setFillStyle(yesActive ? 0x2e5f16 : 0x224413, 0.98);
    this.yesBackground.setStrokeStyle(2, yesActive ? 0xd4ff8f : 0x79f05a, 0.98);
    this.yesLabel.setAlpha(yesActive ? 1 : 0.86);
  }
}
