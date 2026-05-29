/**
 * WalletBadgeController 负责首页右上角钱包模块的紧凑展示。
 *
 * 这里的约束与中心页/结果页不同：菜单页需要把钱包状态压缩在一行里，同时预留
 * 错误扩展位。因此正常态优先紧凑，错误态才允许卡片向下增加一行。
 */
import type Phaser from 'phaser';
import type { Address } from 'viem';

import { LOGIC_WIDTH } from '../../game/constants';
import { createUiText } from '../../game/uiText';
import type { Web3StateShape } from '../../game/web3State';

type WalletBadgeCallbacks = {
  onAction: () => void;
};

export class WalletBadgeController {
  private readonly panelBackground: Phaser.GameObjects.Rectangle;
  private readonly badgeText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly errorText: Phaser.GameObjects.Text;
  private readonly actionButton: Phaser.GameObjects.Container;
  private readonly actionBackground: Phaser.GameObjects.Rectangle;
  private readonly actionLabel: Phaser.GameObjects.Text;
  private readonly panelWidth: number;
  private readonly baseHeight: number;
  private readonly buttonWidth: number;

  constructor(scene: Phaser.Scene, callbacks: WalletBadgeCallbacks) {
    const panelWidth = 96;
    const baseHeight = 18;
    const panelTop = 4;
    const panelLeft = LOGIC_WIDTH - 4 - panelWidth;
    const buttonWidth = 20;
    const buttonHeight = 9;
    this.panelWidth = panelWidth;
    this.baseHeight = baseHeight;
    this.buttonWidth = buttonWidth;

    const panel = scene.add.container(panelLeft, panelTop).setDepth(40);

    this.panelBackground = scene.add
      .rectangle(0, 0, panelWidth, baseHeight, 0x1f140a, 0.72)
      .setStrokeStyle(1, 0xa37a3f, 0.88)
      .setOrigin(0, 0)
      .setName('menu.wallet.panel');

    this.badgeText = createUiText(scene, 5, 3, '链上', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#d8b561',
      },
    })
      .setOrigin(0, 0)
      .setName('menu.wallet.badge');

    this.statusText = createUiText(scene, 22, 2, '未连接', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#f0e2b6',
        align: 'left',
        wordWrap: { width: 46, useAdvancedWrap: true },
      },
    })
      .setOrigin(0, 0)
      .setName('menu.wallet.status');

    this.errorText = createUiText(scene, 5, 20, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '5px',
        color: '#ff8585',
        align: 'left',
        wordWrap: { width: 86, useAdvancedWrap: true },
      },
    })
      .setOrigin(0, 0)
      .setVisible(false)
      .setName('menu.wallet.error');

    this.actionButton = scene.add.container(panelWidth - 4 - buttonWidth, 4);
    this.actionBackground = scene.add
      .rectangle(0, 0, buttonWidth, buttonHeight, 0x123c42, 0.94)
      .setStrokeStyle(1, 0x5ca5b6, 0.92)
      .setOrigin(0, 0)
      .setName('menu.wallet.action')
      .setInteractive({ useHandCursor: true });
    this.actionLabel = createUiText(scene, buttonWidth / 2, buttonHeight / 2, '连接', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#e7fbff',
      },
    }).setOrigin(0.5, 0.5);

    this.actionBackground.on('pointerover', () => {
      this.actionBackground.setFillStyle(0x185862, 0.97);
    });

    this.actionBackground.on('pointerout', () => {
      this.actionBackground.setFillStyle(0x123c42, 0.94);
    });

    this.actionBackground.on('pointerdown', () => {
      void callbacks.onAction();
    });

    this.actionButton.add([this.actionBackground, this.actionLabel]);

    panel.add([
      this.panelBackground,
      this.badgeText,
      this.statusText,
      this.errorText,
      this.actionButton,
    ]);
  }

  applyWeb3State(state: Readonly<Web3StateShape>): void {
    const connectedAddress = state.address;
    const hasWallet = state.walletAvailable;
    const hasError = Boolean(state.lastError);

    const statusLabel = connectedAddress
      ? this.formatAddress(connectedAddress)
      : hasWallet
        ? '未连接'
        : '无钱包';
    this.statusText.setText(statusLabel);

    this.errorText.setText(state.lastError ?? '');
    this.errorText.setVisible(hasError);

    const actionLabel = !hasWallet ? '安装' : !connectedAddress ? '连接' : '断开';
    this.actionLabel.setText(actionLabel);
    this.actionBackground.setFillStyle(connectedAddress ? 0x45321a : 0x123c42, 0.94);
    this.actionBackground.setStrokeStyle(1, connectedAddress ? 0xc7a46c : 0x5ca5b6, 0.92);
    this.actionLabel.setColor(connectedAddress ? '#fff2cf' : '#e7fbff');

    // 钱包卡片正常态保持单行紧凑高度；只有错误态才允许扩成两行。
    this.panelBackground.setSize(this.panelWidth, hasError ? 34 : this.baseHeight);
    this.statusText.setPosition(22, 3);
    this.statusText.setWordWrapWidth(46, true);
    this.actionButton.setPosition(this.panelWidth - 4 - this.buttonWidth, 4);
    this.errorText.setPosition(5, 20);
  }

  showError(message: string): void {
    this.errorText.setText(message);
    this.errorText.setVisible(Boolean(message));
    this.panelBackground.setSize(this.panelWidth, message ? 34 : this.baseHeight);
  }

  clearError(): void {
    this.showError('');
  }

  private formatAddress(address: Address): string {
    // 首页空间有限，这里固定采用短地址格式，避免地址宽度反向推动卡片继续变宽。
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
