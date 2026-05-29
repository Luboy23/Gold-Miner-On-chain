import type Phaser from 'phaser';

import { MENU_SELECTIONS } from '../../game/types/index';
import type { ExperienceConfirmModal } from './ExperienceConfirmModal';
import type { MenuActionController } from './MenuActionController';
import type { MenuSelectionController } from './MenuSelectionController';

/**
 * 首页菜单输入路由器。
 *
 * 它只把键盘事件分发给当前可见的交互层：
 * - 默认情况下驱动 5 个同级菜单按钮；
 * - 弹出体验模式确认框后，输入完全切到 modal。
 *
 * 这里不直接依赖具体按钮节点，只操作选择控制器和 action controller，
 * 这样菜单几何变更不会反向污染输入语义。
 */
type MenuInputRouterDependencies = {
  scene: Phaser.Scene;
  selectionController: MenuSelectionController;
  experienceConfirmModal: ExperienceConfirmModal;
  actionController: MenuActionController;
  showExperienceConfirmModal: () => void;
  hideExperienceConfirmModal: () => void;
  isExperienceConfirmVisible: () => boolean;
};

export class MenuInputRouter {
  private readonly scene: Phaser.Scene;
  private readonly selectionController: MenuSelectionController;
  private readonly experienceConfirmModal: ExperienceConfirmModal;
  private readonly actionController: MenuActionController;
  private readonly showExperienceConfirmModal: () => void;
  private readonly hideExperienceConfirmModal: () => void;
  private readonly isExperienceConfirmVisible: () => boolean;

  private readonly handleMenuUpKey = (): void => {
    if (this.isExperienceConfirmVisible()) {
      this.experienceConfirmModal.handleDirectionalInput('toggle');
      return;
    }
    this.selectionController.moveVertical(-1);
  };

  private readonly handleMenuDownKey = (): void => {
    if (this.isExperienceConfirmVisible()) {
      this.experienceConfirmModal.handleDirectionalInput('toggle');
      return;
    }
    this.selectionController.moveVertical(1);
  };

  private readonly handleMenuLeftKey = (): void => {
    if (this.isExperienceConfirmVisible()) {
      this.experienceConfirmModal.handleDirectionalInput('no');
      return;
    }
  };

  private readonly handleMenuRightKey = (): void => {
    if (this.isExperienceConfirmVisible()) {
      this.experienceConfirmModal.handleDirectionalInput('yes');
      return;
    }
  };

  private readonly handleMenuEnterKey = (): void => {
    this.activateCurrentSelection();
  };

  private readonly handleMenuEscKey = (): void => {
    if (!this.isExperienceConfirmVisible()) {
      return;
    }

    this.hideExperienceConfirmModal();
  };

  constructor(deps: MenuInputRouterDependencies) {
    this.scene = deps.scene;
    this.selectionController = deps.selectionController;
    this.experienceConfirmModal = deps.experienceConfirmModal;
    this.actionController = deps.actionController;
    this.showExperienceConfirmModal = deps.showExperienceConfirmModal;
    this.hideExperienceConfirmModal = deps.hideExperienceConfirmModal;
    this.isExperienceConfirmVisible = deps.isExperienceConfirmVisible;
  }

  activateCurrentSelection(): void {
    if (this.isExperienceConfirmVisible()) {
      // modal 打开后，Enter 的唯一合法语义就是确认当前 yes/no 选择，
      // 不能再穿透到底层菜单。
      this.experienceConfirmModal.handleConfirm(() => {
        this.hideExperienceConfirmModal();
        this.actionController.startExperience();
      });
      return;
    }

    const selection = this.selectionController.getSelection();

    if (!selection) {
      return;
    }

    if (selection === MENU_SELECTIONS.ExperienceStart) {
      this.showExperienceConfirmModal();
      return;
    }

    if (selection === MENU_SELECTIONS.AdventureStart) {
      this.actionController.startAdventureChallenge();
      return;
    }

    if (selection === MENU_SELECTIONS.AdventureCenter) {
      void this.actionController.openAdventureCenter();
      return;
    }

    if (selection === MENU_SELECTIONS.RankedStart) {
      this.actionController.startRankedChallenge();
      return;
    }

    if (selection === MENU_SELECTIONS.RankedCenter) {
      this.actionController.openRankedCenter();
      return;
    }
  }

  bind(): void {
    const keyboard = this.scene.input.keyboard;

    if (!keyboard) {
      return;
    }

    // 首页键盘面固定为 Up/Down/Left/Right/Enter/Esc；其中 Left/Right 只在
    // 体验确认框可见时生效，不再承担旧版 secondary 菜单切换语义。
    keyboard.on('keydown-UP', this.handleMenuUpKey);
    keyboard.on('keydown-DOWN', this.handleMenuDownKey);
    keyboard.on('keydown-LEFT', this.handleMenuLeftKey);
    keyboard.on('keydown-RIGHT', this.handleMenuRightKey);
    keyboard.on('keydown-ENTER', this.handleMenuEnterKey);
    keyboard.on('keydown-ESC', this.handleMenuEscKey);
  }

  unbind(): void {
    const keyboard = this.scene.input.keyboard;

    if (!keyboard) {
      return;
    }

    keyboard.off('keydown-UP', this.handleMenuUpKey);
    keyboard.off('keydown-DOWN', this.handleMenuDownKey);
    keyboard.off('keydown-LEFT', this.handleMenuLeftKey);
    keyboard.off('keydown-RIGHT', this.handleMenuRightKey);
    keyboard.off('keydown-ENTER', this.handleMenuEnterKey);
    keyboard.off('keydown-ESC', this.handleMenuEscKey);
  }
}
