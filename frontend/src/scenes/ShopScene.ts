import Phaser from 'phaser';

import { SHOP_ITEM_CONFIGS } from '../data/shopItems';
import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import {
  ANIMATION_KEYS,
  LOGIC_CENTER_X,
  LOGIC_CENTER_Y,
} from '../game/constants';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import { restoreRunFromRestartSnapshot } from '../game/runRestart';
import { SCENE_KEYS } from '../game/sceneKeys';
import { createUiText } from '../game/uiText';
import { shopSystem } from '../systems/ShopSystem';
import type {
  RunRestartSnapshot,
  RunState,
  ShopOffer,
  ShopScenePayload,
} from '../game/types/index';
import { PauseMenuModal, type PauseMenuAction } from './common/PauseMenuModal';

/**
 * ShopScene 只处理“关卡之间的购买与分流”。
 *
 * 这里最重要的不是 UI，而是 campaign 的时序约束：
 * - 购买会改变下一关的基线
 * - 跳过商店只推进到下一关
 * - 主动退出时，结果页只能消费已经 finalize 的关卡
 */
export class ShopScene extends Phaser.Scene {
  private run: RunState | null = null;
  private restartSnapshot: RunRestartSnapshot | null = null;
  private offers: ShopOffer[] = [];
  private selectionIndex = 0;
  private selector: Phaser.GameObjects.Image | null = null;
  private offerSlots: Array<{
    x: number;
    frame: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Image;
    price: Phaser.GameObjects.Text;
    hitArea: Phaser.GameObjects.Zone;
  }> = [];
  private moneyText: Phaser.GameObjects.Text | null = null;
  private levelText: Phaser.GameObjects.Text | null = null;
  private dialogueTitleText: Phaser.GameObjects.Text | null = null;
  private dialogueBodyText: Phaser.GameObjects.Text | null = null;
  private shopkeeper: Phaser.GameObjects.Sprite | null = null;
  private leftKey: Phaser.Input.Keyboard.Key | null = null;
  private rightKey: Phaser.Input.Keyboard.Key | null = null;
  private upKey: Phaser.Input.Keyboard.Key | null = null;
  private downKey: Phaser.Input.Keyboard.Key | null = null;
  private enterKey: Phaser.Input.Keyboard.Key | null = null;
  private spaceKey: Phaser.Input.Keyboard.Key | null = null;
  private escapeKey: Phaser.Input.Keyboard.Key | null = null;
  private feedbackTimer: Phaser.Time.TimerEvent | null = null;
  private activeFeedbackMessage: string | null = null;
  private pauseMenuModal: PauseMenuModal | null = null;
  private brandFooter: BrandFooterHandle | null = null;
  private pauseMenuVisible = false;
  private suppressEscapeUntilRelease = false;

  constructor() {
    super(SCENE_KEYS.Shop);
  }

  init(data?: Partial<ShopScenePayload>): void {
    this.run = data?.run ?? gameState.currentRun;
    this.restartSnapshot = data?.restartSnapshot ?? null;
    this.pauseMenuVisible = false;
    this.suppressEscapeUntilRelease = false;
  }

  create(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const activeRun: RunState = {
      ...this.run,
      status: 'shopping',
      currentShopOffers:
        this.run.currentShopOffers ?? shopSystem.buildOffers(this.run),
    };

    this.run = activeRun;
    this.offers =
      activeRun.currentShopOffers?.map((offer) => ({ ...offer })) ?? [];
    gameState.setCurrentRun(activeRun);

    configureLogicalCamera(this);

    setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'shop').setOrigin(0.5),
      'shop',
    );

    this.add
      .rectangle(58, 38, 86, 32, 0x1f140a, 0.7)
      .setStrokeStyle(1, 0xf7d54a, 0.9);

    setLogicalTextureSize(
      this.add.image(198, 6, 'title').setOrigin(0.5, 0),
      'title',
      0.72,
    );
    setLogicalTextureSize(
      this.add.image(102, 90, 'dialogueBubble').setOrigin(0.5),
      'dialogueBubble',
      0.86,
    );
    this.shopkeeper = setLogicalTextureSize(
      this.add
        .sprite(254, 154, 'shopkeeper')
        .setOrigin(0.5, 1)
        .play(ANIMATION_KEYS.shopkeeperIdle),
      'shopkeeper',
    );

    this.moneyText = createUiText(this, 18, 28, `金币 $${activeRun.score}`, {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#f7d54a',
      },
    }).setOrigin(0, 0.5);

    this.levelText = createUiText(
      this,
      18,
      42,
      `下一关 第${activeRun.levelGroup}关`,
      {
        variant: 'body',
        script: 'mixed',
        style: {
          fontSize: '10px',
          color: '#f7d54a',
        },
      },
    ).setOrigin(0, 0.5);

    this.dialogueTitleText = createUiText(this, 92, 79, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#120b04',
        align: 'center',
        wordWrap: { width: 130 },
      },
    }).setOrigin(0.5);

    this.dialogueBodyText = createUiText(this, 92, 92, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '6px',
        color: '#120b04',
        align: 'center',
        lineSpacing: 1,
        wordWrap: { width: 132 },
      },
    }).setOrigin(0.5);

    this.createOfferRow();
    this.createControlsHint();
    this.brandFooter = createBrandFooter(this, getBrandFooterLayout('shop'));
    this.bindKeyboard();
    this.pauseMenuModal = new PauseMenuModal(this, {
      onSelect: (action) => {
        this.handlePauseMenuAction(action);
      },
      onCancel: () => {
        this.hidePauseMenu();
      },
    });
    this.refreshShopUi();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupScene();
    });
  }

  private createOfferRow(): void {
    this.selector = setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, 146, 'selector').setAlpha(0.92),
      'selector',
    ).setVisible(false);

    this.rebuildOfferRow();
  }

  private rebuildOfferRow(): void {
    this.offerSlots.forEach((slot) => {
      slot.frame.destroy();
      slot.icon.destroy();
      slot.price.destroy();
      slot.hitArea.destroy();
    });
    this.offerSlots = [];

    if (this.offers.length === 0) {
      this.selector?.setVisible(false);
      return;
    }

    const slotSpacing = 56;
    const startX = LOGIC_CENTER_X - ((this.offers.length - 1) * slotSpacing) / 2;
    const rowY = 176;

    this.offers.forEach((offer, index) => {
      const item = SHOP_ITEM_CONFIGS[offer.itemId];
      const x = startX + index * slotSpacing;
      const frame = this.add
        .rectangle(x, rowY, 48, 52, 0x201108, 0.72)
        .setStrokeStyle(1, 0x8f572a, 1);
      const icon = setLogicalTextureSize(
        this.add.image(x, rowY - 6, item.textureKey),
        item.textureKey,
        0.78,
      );
      const price = createUiText(this, x, rowY + 16, `$${offer.price}`, {
        variant: 'caption',
        script: 'latin',
        style: {
          fontSize: '11px',
          color: '#ffffff',
        },
      }).setOrigin(0.5);
      const hitArea = this.add
        .zone(x, rowY, 48, 52)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      hitArea.on('pointerover', () => {
        this.selectOffer(index);
      });

      hitArea.on('pointerdown', () => {
        this.selectOffer(index);
        this.purchaseSelectedItem();
      });

      this.offerSlots.push({ x, frame, icon, price, hitArea });
    });
  }

  private createControlsHint(): void {
    this.add.rectangle(LOGIC_CENTER_X, 228, 238, 14, 0x1f140a, 0.72);
    createUiText(
      this,
      LOGIC_CENTER_X,
      228,
      '左右切换  回车购买  Space继续闯关  Esc暂停',
      {
        variant: 'caption',
        script: 'mixed',
        style: {
          fontSize: '10px',
          color: '#ffffff',
        },
      },
    ).setOrigin(0.5);
  }

  private bindKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    this.leftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.upKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.enterKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.spaceKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.escapeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    const clearSuppressedEscapeIfNeeded = (): void => {
      if (this.suppressEscapeUntilRelease && !this.escapeKey?.isDown) {
        this.suppressEscapeUntilRelease = false;
      }
    };

    this.leftKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (this.pauseMenuVisible) {
        return;
      }
      this.moveSelection(-1);
    });

    this.rightKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (this.pauseMenuVisible) {
        return;
      }
      this.moveSelection(1);
    });

    this.upKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (!this.pauseMenuVisible) {
        return;
      }
      this.pauseMenuModal?.handleDirectionalInput('up');
    });

    this.downKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (!this.pauseMenuVisible) {
        return;
      }
      this.pauseMenuModal?.handleDirectionalInput('down');
    });

    this.enterKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (this.pauseMenuVisible) {
        this.pauseMenuModal?.handleConfirm();
        return;
      }
      this.handlePrimaryAction();
    });

    this.spaceKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (this.pauseMenuVisible) {
        return;
      }
      this.skipShopAndContinue();
    });

    this.escapeKey.on('down', () => {
      clearSuppressedEscapeIfNeeded();
      if (this.pauseMenuVisible) {
        this.pauseMenuModal?.handleCancel();
        return;
      }
      if (this.suppressEscapeUntilRelease) {
        return;
      }
      this.showPauseMenu();
    });
  }

  private moveSelection(delta: number): void {
    if (this.offers.length === 0) {
      return;
    }

    this.selectionIndex =
      (this.selectionIndex + delta + this.offers.length) % this.offers.length;
    this.refreshShopUi();
  }

  private selectOffer(index: number): void {
    if (index < 0 || index >= this.offers.length || this.selectionIndex === index) {
      return;
    }

    this.selectionIndex = index;
    this.refreshShopUi();
  }

  private purchaseSelectedItem(): void {
    if (!this.run || this.offers.length === 0) {
      return;
    }

    const selectedOffer = this.offers[this.selectionIndex];
    const purchase = shopSystem.purchase(this.run, selectedOffer.itemId);

    this.run = purchase.run;
    this.offers = purchase.run.currentShopOffers?.map((offer) => ({ ...offer })) ?? [];
    gameState.setCurrentRun(purchase.run);

    if (purchase.status === 'purchased') {
      if (purchase.run.mode === 'campaign') {
        this.run = gameState.recordCampaignPurchase(purchase.run, {
          shopLevelGroup: purchase.run.levelGroup,
          itemId: selectedOffer.itemId,
          price: selectedOffer.price,
        });
        this.offers =
          this.run.currentShopOffers?.map((offer) => ({ ...offer })) ?? [];
      }
      this.selectionIndex = 0;
      this.rebuildOfferRow();
      this.refreshShopUi();
      this.showFeedback(`已买下：${SHOP_ITEM_CONFIGS[selectedOffer.itemId].label}`);
      return;
    }

    this.refreshShopUi();

    if (purchase.status === 'insufficient-funds') {
      this.showFeedback('金币不够', true);
      return;
    }

    if (purchase.status === 'already-sold') {
      this.showFeedback('这件已经买过了');
      return;
    }

    this.showFeedback('这件现在买不了', true);
  }

  private handlePrimaryAction(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    if (this.offers.length === 0) {
      this.continueToNextGoal();
      return;
    }

    this.purchaseSelectedItem();
  }

  private continueToNextGoal(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    this.scene.start(SCENE_KEYS.Goal, {
      mode: 'next-goal',
      run: this.run,
    });
  }

  private skipShopAndContinue(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    this.continueToNextGoal();
  }

  public isPauseMenuVisible(): boolean {
    return this.pauseMenuVisible;
  }

  private showPauseMenu(): void {
    if (!this.run || this.pauseMenuVisible) {
      return;
    }

    this.pauseMenuVisible = true;
    this.pauseMenuModal?.show(
      this.run.mode === 'casual' ? '已暂停当前试玩。' : '已暂停当前冒险。',
      [
        {
          action: 'resume',
          label: '继续选购',
        },
        {
          action: 'restart',
          label: '重开本局',
        },
        {
          action: 'return',
          label: this.run.mode === 'casual' ? '返回主菜单' : '返回冒险中心',
        },
      ],
    );
  }

  private hidePauseMenu(): void {
    if (!this.pauseMenuVisible) {
      return;
    }

    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
  }

  private handlePauseMenuAction(action: PauseMenuAction): void {
    if (action === 'resume') {
      this.hidePauseMenu();
      return;
    }

    if (action === 'restart') {
      this.restartCurrentRun();
      return;
    }

    this.returnFromPauseMenu();
  }

  private returnFromPauseMenu(): void {
    if (!this.run) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    const activeRun = this.run;
    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
    gameState.clearCurrentRun();

    if (activeRun.mode === 'campaign') {
      this.scene.start(SCENE_KEYS.AdventureCenter, {
        statusMessage: '已退出本次冒险',
        statusTone: 'info',
      });
      return;
    }

    this.scene.start(SCENE_KEYS.Menu);
  }

  private restartCurrentRun(): void {
    if (!this.restartSnapshot) {
      this.returnFromPauseMenu();
      return;
    }

    this.pauseMenuVisible = false;
    this.pauseMenuModal?.hide();
    this.suppressEscapeUntilRelease = true;
    const nextRun = restoreRunFromRestartSnapshot(this.restartSnapshot);
    gameState.setCurrentRun(nextRun);
    this.scene.start(SCENE_KEYS.Gameplay, {
      run: nextRun,
      restartSnapshot: this.restartSnapshot,
    });
  }

  private refreshShopUi(): void {
    if (!this.run) {
      return;
    }

    if (this.offers.length > 0) {
      this.selectionIndex = Phaser.Math.Clamp(
        this.selectionIndex,
        0,
        this.offers.length - 1,
      );
    } else {
      this.selectionIndex = 0;
    }

    this.moneyText?.setText(`金币 $${this.run.score}`);
    this.levelText?.setText(`下一关 第${this.run.levelGroup}关`);

    if (this.offers.length === 0) {
      // 商品卖完后，主按钮语义切换为“进入下一关”。
      // 这里不再保留购买/继续双重语义，避免按钮文案和真实行为脱节。
      this.selector?.setVisible(false);
      this.updateDialogueText();
      return;
    }

    const selectedOffer = this.offers[this.selectionIndex];
    this.selector
      ?.setPosition(this.offerSlots[this.selectionIndex].x, 145)
      .setVisible(true);

    this.offerSlots.forEach((slot, index) => {
      const offer = this.offers[index];
      const isSelected = index === this.selectionIndex;

      slot.frame.setFillStyle(isSelected ? 0x3b2411 : 0x201108, isSelected ? 0.92 : 0.72);
      slot.frame.setStrokeStyle(isSelected ? 2 : 1, isSelected ? 0xf7d54a : 0x8f572a, 1);
      setLogicalTextureSize(
        slot.icon,
        SHOP_ITEM_CONFIGS[offer.itemId].textureKey,
        isSelected ? 0.88 : 0.78,
      );
      slot.icon.setAlpha(isSelected ? 1 : 0.86);
      slot.price.setText(`$${offer.price}`);
      slot.price.setColor(isSelected ? '#fff6ba' : '#ffffff');
    });

    if (!selectedOffer) {
      this.selector?.setVisible(false);
    }

    this.updateDialogueText();
  }

  private showFeedback(message: string, sadShopkeeper = false): void {
    this.activeFeedbackMessage = message;
    this.updateDialogueText();

    if (sadShopkeeper) {
      this.shopkeeper?.play(ANIMATION_KEYS.shopkeeperSad);
    } else {
      this.shopkeeper?.play(ANIMATION_KEYS.shopkeeperIdle);
    }

    this.feedbackTimer?.destroy();
    this.feedbackTimer = this.time.delayedCall(1000, () => {
      this.activeFeedbackMessage = null;
      this.updateDialogueText();
      this.shopkeeper?.play(ANIMATION_KEYS.shopkeeperIdle);
      this.feedbackTimer = null;
    });
  }

  private updateDialogueText(): void {
    if (!this.dialogueTitleText || !this.dialogueBodyText) {
      return;
    }

    if (this.activeFeedbackMessage) {
      this.dialogueTitleText.setStyle({
        fontSize: '10px',
        wordWrap: { width: 132 },
      });
      this.dialogueTitleText.setPosition(92, 88);
      this.dialogueTitleText.setText(this.activeFeedbackMessage);
      this.dialogueBodyText.setVisible(false).setText('');
      return;
    }

    if (this.offers.length === 0) {
      this.dialogueTitleText.setStyle({
        fontSize: '10px',
        wordWrap: { width: 132 },
      });
      this.dialogueTitleText.setPosition(92, 82);
      this.dialogueTitleText.setText('东西都买完了');
      this.dialogueBodyText
        .setVisible(true)
        .setPosition(92, 95)
        .setStyle({
          fontSize: '7px',
          lineSpacing: 1,
          wordWrap: { width: 132 },
        })
        .setText('按回车继续闯关');
      return;
    }

    const selectedOffer = this.offers[this.selectionIndex];

    if (!selectedOffer) {
      this.dialogueTitleText.setStyle({
        fontSize: '9px',
        wordWrap: { width: 130 },
      });
      this.dialogueTitleText.setPosition(92, 88);
      this.dialogueTitleText.setText('请选择商品');
      this.dialogueBodyText.setVisible(false).setText('');
      return;
    }

    const selectedConfig = SHOP_ITEM_CONFIGS[selectedOffer.itemId];
    this.dialogueTitleText.setStyle({
      fontSize: '8px',
      wordWrap: { width: 130 },
    });
    this.dialogueTitleText.setPosition(92, 79);
    this.dialogueTitleText.setText(selectedConfig.label);
    this.dialogueBodyText
      .setVisible(true)
      .setPosition(92, 92)
      .setStyle({
        fontSize: '6px',
        lineSpacing: 1,
        wordWrap: { width: 132 },
      })
      .setText(selectedConfig.description);
  }

  private cleanupScene(): void {
    this.pauseMenuModal?.destroy();
    this.pauseMenuModal = null;
    this.pauseMenuVisible = false;
    this.brandFooter?.destroy();
    this.brandFooter = null;
    this.suppressEscapeUntilRelease = false;
    this.feedbackTimer?.destroy();
    this.feedbackTimer = null;

    this.offerSlots.forEach((slot) => {
      slot.frame.destroy();
      slot.icon.destroy();
      slot.price.destroy();
      slot.hitArea.destroy();
    });
    this.offerSlots = [];

    this.selector?.destroy();
    this.selector = null;

    this.leftKey?.destroy();
    this.rightKey?.destroy();
    this.upKey?.destroy();
    this.downKey?.destroy();
    this.enterKey?.destroy();
    this.spaceKey?.destroy();
    this.escapeKey?.destroy();
    this.leftKey = null;
    this.rightKey = null;
    this.upKey = null;
    this.downKey = null;
    this.enterKey = null;
    this.spaceKey = null;
    this.escapeKey = null;
  }
}
