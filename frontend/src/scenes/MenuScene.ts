import Phaser from 'phaser';

import {
  LOGIC_CENTER_X,
  LOGIC_CENTER_Y,
} from '../game/constants';
import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import { web3State, type Web3StateShape } from '../game/web3State';
import { SCENE_KEYS } from '../game/sceneKeys';
import {
  type MenuModeCardViewModel,
  MENU_SELECTIONS,
} from '../game/types/index';
import { ExperienceConfirmModal } from './menu/ExperienceConfirmModal';
import { MenuActionController } from './menu/MenuActionController';
import { MenuInputRouter } from './menu/MenuInputRouter';
import { MenuSelectionController } from './menu/MenuSelectionController';
import { MenuWalletActionController } from './menu/MenuWalletActionController';
import { WalletBadgeController } from './menu/WalletBadgeController';

/**
 * 首页菜单场景。
 *
 * 这里只负责把首页拆成三个层次：
 * 1. 菜单条目与当前选择高亮；
 * 2. 钱包状态与连接/断开操作；
 * 3. 体验模式确认弹窗。
 *
 * 具体进入哪个场景、如何准备挑战、如何处理钱包错误，都继续下放给
 * action / wallet controller。这样菜单场景本身只做组合，不额外持有业务真值。
 */
export class MenuScene extends Phaser.Scene {
  private static readonly MENU_GROUP_START_Y = 136;
  private static readonly MENU_GROUP_STEP_Y = 19;

  private selectionController?: MenuSelectionController;
  private walletBadgeController?: WalletBadgeController;
  private walletActionController?: MenuWalletActionController;
  private experienceConfirmModal?: ExperienceConfirmModal;
  private actionController?: MenuActionController;
  private inputRouter?: MenuInputRouter;
  private unsubscribeWeb3?: () => void;
  private brandFooter?: BrandFooterHandle;
  public rankedQuickStartStage: string | null = null;
  public rankedQuickStartError: string | null = null;
  private experienceConfirmVisible = false;

  constructor() {
    super(SCENE_KEYS.Menu);
  }

  create(): void {
    configureLogicalCamera(this);

    setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'menu').setOrigin(0.5),
      'menu',
    );
    setLogicalTextureSize(
      this.add
        .image(LOGIC_CENTER_X, 41, 'title')
        .setOrigin(0.5)
        .setName('menu.home.title'),
      'title',
      0.84,
    );
    this.brandFooter = createBrandFooter(this, getBrandFooterLayout('menu'));
    this.selectionController = new MenuSelectionController(this, {
      startY: MenuScene.MENU_GROUP_START_Y,
      stepY: MenuScene.MENU_GROUP_STEP_Y,
    });
    this.selectionController.createEntries(this.buildMenuCards());
    this.selectionController.setSelection(MENU_SELECTIONS.ExperienceStart);

    this.walletBadgeController = new WalletBadgeController(this, {
      onAction: async () => {
        await this.handleWalletAction();
      },
    });
    this.walletActionController = new MenuWalletActionController({
      showError: (message) => {
        this.walletBadgeController?.showError(message);
      },
    });
    this.actionController = new MenuActionController(this, {
      onAdventureError: (message) => {
        if (!message) {
          this.walletBadgeController?.clearError();
          return;
        }
        this.walletBadgeController?.showError(message);
      },
      onRankedStageChange: (stage) => {
        this.rankedQuickStartStage = stage;
      },
      onRankedError: (message) => {
        this.rankedQuickStartError = message;
      },
    });
    this.experienceConfirmModal = new ExperienceConfirmModal(this, {
      onConfirm: () => {
        this.confirmExperienceStart();
      },
    });
    this.inputRouter = new MenuInputRouter({
      scene: this,
      selectionController: this.selectionController,
      experienceConfirmModal: this.experienceConfirmModal,
      actionController: this.actionController,
      showExperienceConfirmModal: () => {
        this.showExperienceConfirmModal();
      },
      hideExperienceConfirmModal: () => {
        this.hideExperienceConfirmModal();
      },
      isExperienceConfirmVisible: () => this.experienceConfirmVisible,
    });
    this.selectionController.setActivateSelectionHandler(() => {
      this.inputRouter?.activateCurrentSelection();
    });
    this.bindKeyboard();

    // 首页的钱包角标始终订阅组合后的 web3State，而不是分别监听钱包、读模型、
    // 库存三份子状态。菜单层只需要消费一个已经折叠好的只读快照。
    this.unsubscribeWeb3 = web3State.subscribe((state) => {
      this.refreshWalletPanel(state);
    });
  }

  private buildMenuCards(): Array<{
    viewModel: MenuModeCardViewModel;
    primarySelection: (typeof MENU_SELECTIONS)[keyof typeof MENU_SELECTIONS];
  }> {
    const cards: MenuModeCardViewModel[] = [
      {
        id: 'experience',
        primaryAction: {
          id: 'experience.start',
          label: '试玩模式',
          hotkey: 'Enter',
        },
      },
      {
        id: 'adventure',
        primaryAction: {
          id: 'adventure.start',
          label: '开始冒险',
          hotkey: 'Enter',
        },
      },
      {
        id: 'adventure-center',
        primaryAction: {
          id: 'adventure.center',
          label: '冒险中心',
          hotkey: 'Enter',
        },
      },
      {
        id: 'ranked',
        primaryAction: {
          id: 'ranked.start',
          label: '开始排位',
          hotkey: 'Enter',
        },
      },
      {
        id: 'ranked-center',
        primaryAction: {
          id: 'ranked.center',
          label: '排位中心',
          hotkey: 'Enter',
        },
      },
    ];

    return [
      {
        viewModel: cards[0],
        primarySelection: MENU_SELECTIONS.ExperienceStart,
      },
      {
        viewModel: cards[1],
        primarySelection: MENU_SELECTIONS.AdventureStart,
      },
      {
        viewModel: cards[2],
        primarySelection: MENU_SELECTIONS.AdventureCenter,
      },
      {
        viewModel: cards[3],
        primarySelection: MENU_SELECTIONS.RankedStart,
      },
      {
        viewModel: cards[4],
        primarySelection: MENU_SELECTIONS.RankedCenter,
      },
    ];
  }

  private bindKeyboard(): void {
    this.inputRouter?.bind();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeWeb3?.();
      this.unsubscribeWeb3 = undefined;
      this.selectionController?.destroy();
      this.selectionController = undefined;
      this.walletActionController = undefined;
      this.inputRouter?.unbind();
      this.inputRouter = undefined;
      this.brandFooter?.destroy();
      this.brandFooter = undefined;
    });
  }

  private refreshWalletPanel(state: Readonly<Web3StateShape>): void {
    this.walletBadgeController?.applyWeb3State(state);
  }

  private async handleWalletAction(): Promise<void> {
    await this.walletActionController?.handleAction(this.experienceConfirmVisible);
  }

  private showExperienceConfirmModal(): void {
    // 一旦用户已经确认过体验模式，首页不再重复弹窗；菜单层只负责决定是否需要
    // 展示确认 UI，不在这里重复实现“开始本地局”的业务逻辑。
    if (gameState.save.acknowledgedExperienceMode) {
      this.actionController?.startExperience();
      return;
    }
    this.experienceConfirmVisible = true;
    this.selectionController?.setModalVisible(true);
    this.experienceConfirmModal?.show();
  }

  private hideExperienceConfirmModal(): void {
    this.experienceConfirmVisible = false;
    this.selectionController?.setModalVisible(false);
    this.experienceConfirmModal?.hide();
  }

  public startLocalAdventureGame(): void {
    this.actionController?.startExperience();
  }

  private confirmExperienceStart(): void {
    this.hideExperienceConfirmModal();
    this.actionController?.startExperience();
  }

}
