import type Phaser from 'phaser';

import { setLogicalTextureSize } from '../../game/display';
import { createUiText } from '../../game/uiText';
import type { MenuModeCardViewModel, MenuSelection } from '../../game/types/index';

type MenuSelectionControllerConfig = {
  startY: number;
  stepY: number;
};

type MenuCardSelectionEntry = {
  viewModel: MenuModeCardViewModel;
  primarySelection: MenuSelection;
};

type EntryView = {
  root: Phaser.GameObjects.Container;
  primaryBackground: Phaser.GameObjects.Rectangle;
  primaryShadow: Phaser.GameObjects.Rectangle;
  primaryLabel: Phaser.GameObjects.Text;
  arrowTargets: {
    primaryY: number;
  };
  hitAreas: {
    primary: Phaser.GameObjects.Zone;
  };
};

const MENU_GROUP_CENTER_X = 72;
const BUTTON_WIDTH = 94;
const BUTTON_HEIGHT = 15;
const BUTTON_SHADOW_WIDTH = BUTTON_WIDTH + 4;
const BUTTON_SHADOW_HEIGHT = BUTTON_HEIGHT + 2;
const SELECTOR_OFFSET_X = BUTTON_WIDTH / 2 + 7;

/**
 * 首页菜单选择控制器。
 *
 * 当前首页已经收口成 5 个同级按钮，因此这个控制器只维护单层 vertical
 * selection，不再支持旧的 primary/secondary 双层结构。视觉高亮和指示箭头
 * 都从同一份 selection 真值派生。
 */
export class MenuSelectionController {
  private readonly scene: Phaser.Scene;
  private readonly config: MenuSelectionControllerConfig;
  private readonly entries: MenuCardSelectionEntry[] = [];
  private readonly views: EntryView[] = [];
  private selectionArrow?: Phaser.GameObjects.Image;
  private selection: MenuSelection | null = null;
  private modalVisible = false;
  private activateSelectionHandler?: () => void;

  constructor(scene: Phaser.Scene, config: MenuSelectionControllerConfig) {
    this.scene = scene;
    this.config = config;
  }

  setModalVisible(visible: boolean): void {
    this.modalVisible = visible;
  }

  setActivateSelectionHandler(handler: () => void): void {
    this.activateSelectionHandler = handler;
  }

  createEntries(entries: readonly MenuCardSelectionEntry[]): void {
    this.destroy();
    this.entries.push(...entries);

    this.selectionArrow = setLogicalTextureSize(
      this.scene.add
        .image(MENU_GROUP_CENTER_X - SELECTOR_OFFSET_X, this.config.startY, 'menuArrow')
        .setOrigin(0.5)
        .setDepth(25),
      'menuArrow',
      0.5,
    );

    entries.forEach((entry, index) => {
      const rootY = this.config.startY + this.config.stepY * index;
      const root = this.scene.add
        .container(MENU_GROUP_CENTER_X, rootY)
        .setName(`menu.group.${entry.viewModel.id}`);

      const primaryShadow = this.scene.add
        .rectangle(0, 1, BUTTON_SHADOW_WIDTH, BUTTON_SHADOW_HEIGHT, 0x080401, 0.3)
        .setOrigin(0.5);
      const primaryBackground = this.scene.add
        .rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 0x231108, 0.84)
        .setOrigin(0.5)
        .setStrokeStyle(1, 0x7e5729, 0.95)
        .setName(`menu.entry.${entry.viewModel.id}.primary`);
      const primaryLabel = createUiText(
        this.scene,
        0,
        0,
        entry.viewModel.primaryAction.label,
        {
          variant: 'body',
          script: 'mixed',
          style: {
            fontSize: '9px',
            color: '#ecd8a8',
          },
        },
      ).setOrigin(0.5);
      const primaryHitArea = this.scene.add
        .zone(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      root.add([primaryShadow, primaryBackground, primaryLabel, primaryHitArea]);

      primaryHitArea.on('pointerover', () => {
        if (this.modalVisible) {
          return;
        }
        this.setSelection(entry.primarySelection);
      });

      primaryHitArea.on('pointerdown', () => {
        if (this.modalVisible) {
          return;
        }
        // 鼠标点击与键盘 Enter 共用同一套激活回调，保证菜单选择语义只有一份。
        this.setSelection(entry.primarySelection);
        this.activateSelectionHandler?.();
      });

      this.views.push({
        root,
        primaryBackground,
        primaryShadow,
        primaryLabel,
        arrowTargets: {
          primaryY: rootY,
        },
        hitAreas: {
          primary: primaryHitArea,
        },
      });
    });

    if (entries.length > 0) {
      this.selection = entries[0].primarySelection;
      this.refreshSelection();
    }
  }

  getSelection(): MenuSelection | null {
    return this.selection;
  }

  setSelection(selection: MenuSelection): void {
    this.selection = selection;
    this.refreshSelection();
  }

  moveVertical(direction: -1 | 1): void {
    if (!this.selection || this.entries.length === 0) {
      return;
    }

    const currentIndex = this.entries.findIndex(
      (entry) => entry.primarySelection === this.selection,
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + direction + this.entries.length) % this.entries.length;
    const targetEntry = this.entries[nextIndex];
    this.selection = targetEntry.primarySelection;
    this.refreshSelection();
  }

  moveHorizontal(direction: -1 | 1): void {
    // 首页不再有 secondary action，横向输入保留为空操作，只是为了和旧调用方
    // 以及统一接口兼容。
    void direction;
  }

  destroy(): void {
    this.views.forEach((view) => view.root.destroy(true));
    this.views.length = 0;
    this.entries.length = 0;
    this.selectionArrow?.destroy();
    this.selectionArrow = undefined;
    this.selection = null;
  }

  private refreshSelection(): void {
    this.views.forEach((view, index) => {
      const entry = this.entries[index];
      const primaryActive = this.selection === entry.primarySelection;
      const groupActive = primaryActive;

      view.root.setAlpha(groupActive ? 1 : 0.92);
      view.primaryShadow.setFillStyle(0x080401, primaryActive ? 0.36 : 0.22);
      view.primaryBackground.setFillStyle(
        primaryActive ? 0x4f2d10 : 0x231108,
        primaryActive ? 0.96 : 0.84,
      );
      view.primaryBackground.setStrokeStyle(
        primaryActive ? 2 : 1,
        primaryActive ? 0xf5d160 : 0x7e5729,
        0.98,
      );
      view.primaryLabel.setColor(primaryActive ? '#fff7dc' : '#ecd8a8');

      if (groupActive && this.selectionArrow) {
        // 箭头永远跟随当前唯一选中项，不存在“组内次级入口”偏移。
        this.selectionArrow.setPosition(
          MENU_GROUP_CENTER_X - SELECTOR_OFFSET_X,
          view.arrowTargets.primaryY,
        );
      }
    });

    this.selectionArrow?.setVisible(Boolean(this.selection));
  }
}
