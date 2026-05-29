/**
 * ChallengeHubLayout 负责冒险/中心页这类双栏 hub 场景的纯布局渲染。
 *
 * 这里的核心约束是：布局层只消费上层已经整理好的 section/action 文案，
 * 不直接理解链上历史、最佳进度或挑战准备逻辑。这样可以把“数据真相源”
 * 固定留在 scene/controller 层，避免布局文件再次演化成业务协调器。
 *
 * 左侧“冒险记录”是这份布局里唯一允许内部滚动的模块。我们刻意让它在
 * 卡片内部滚动，而不是让整页增长或整页滚动，这样能保持右侧模块、状态栏
 * 和底部双按钮的几何关系稳定。
 */
import Phaser from 'phaser';

import type { RankedBoardSectionViewModel, RankedUiTone } from './types/index';
import {
  createRankedButton,
  createRankedEmptyState,
  createRankedListRow,
  createRankedPanel,
  fitRankedText,
} from './ranked-ui/hub';
import type { RankedRect } from './ranked-ui/shared';
import { createUiText } from './uiText';

export type ChallengeHubLayoutConfig = {
  prefix: string;
  headerTitle: string;
  headerBestText: string;
  leftTitle: string;
  rightTitle: string;
  statusText: string;
  statusTone: RankedUiTone;
};

export type ChallengeHubActionConfig = {
  primary: {
    name: string;
    label: string;
    hotkey?: string;
    tone: RankedUiTone;
    disabled: boolean;
    onPress: () => void;
  };
  secondary: {
    name: string;
    label: string;
    hotkey?: string;
    tone: RankedUiTone;
    disabled: boolean;
    onPress: () => void;
  };
};

type HubSectionKey = 'left' | 'right';

type SectionView = {
  panel: Phaser.GameObjects.Container;
  title: Phaser.GameObjects.Text;
  content: Phaser.GameObjects.Container;
  prefix: string;
  viewportRect: RankedRect;
  scrollContent?: Phaser.GameObjects.Container;
  maskShape?: Phaser.GameObjects.Graphics;
  fadeTop?: Phaser.GameObjects.Rectangle;
  fadeBottom?: Phaser.GameObjects.Rectangle;
  scrollbarTrack?: Phaser.GameObjects.Rectangle;
  scrollbarThumb?: Phaser.GameObjects.Rectangle;
  rows: Phaser.GameObjects.Container[];
  currentScrollY: number;
  maxScrollY: number;
  draggingPointerId?: number;
  dragStartPointerY?: number;
  dragStartScrollY?: number;
};

type ScrollStateSnapshot = {
  currentScrollY: number;
  maxScrollY: number;
  rowCount: number;
  scrollbarVisible: boolean;
};

const SECTION_CONTENT_RECT: RankedRect = {
  x: 0,
  y: 0,
  width: 122,
  height: 96,
};
// 冒险记录卡片始终只暴露 3 条可视记录；更多历史必须留在卡片内部滚动。
const HISTORY_VISIBLE_ROW_COUNT = 3;
const ROW_HEIGHT = 24;
const ROW_GAP = 4;
const ROW_STEP = ROW_HEIGHT + ROW_GAP;
const HISTORY_SCROLL_RECT: RankedRect = {
  x: 0,
  y: 0,
  width: 118,
  height: HISTORY_VISIBLE_ROW_COUNT * ROW_HEIGHT + (HISTORY_VISIBLE_ROW_COUNT - 1) * ROW_GAP,
};
const HISTORY_SCROLLBAR_X = HISTORY_SCROLL_RECT.width + 1;
const HISTORY_SCROLLBAR_WIDTH = 2;
const HISTORY_SCROLLBAR_HEIGHT = HISTORY_SCROLL_RECT.height;
const HISTORY_WHEEL_STEP = 18;
const HISTORY_FADE_HEIGHT = 8;

export class ChallengeHubLayout {
  readonly root: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly headerPanel: Phaser.GameObjects.Container;
  private readonly statusPanel: Phaser.GameObjects.Container;
  private prefix = 'challenge.hub';

  private readonly headerTitle: Phaser.GameObjects.Text;
  private readonly headerBest: Phaser.GameObjects.Text;
  private readonly leftSection: SectionView;
  private readonly rightSection: SectionView;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly actionButtons: {
    primary: ReturnType<typeof createRankedButton>;
    secondary: ReturnType<typeof createRankedButton>;
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = this.scene.add.container(0, 0);

    this.headerPanel = createRankedPanel(this.scene, {
      x: 16,
      y: 10,
      width: 288,
      height: 24,
    }).setName('challenge.hub.header.panel');
    this.root.add(this.headerPanel);

    this.headerTitle = createUiText(this.scene, 24, 22, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '11px',
        color: '#fff4d0',
      },
    }).setOrigin(0, 0.5);
    this.headerBest = createUiText(this.scene, 294, 22, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#c7faff',
      },
    }).setOrigin(1, 0.5);
    this.root.add([this.headerTitle, this.headerBest]);

    this.leftSection = this.createSection({
      panel: { x: 16, y: 42, width: 138, height: 126 },
      titleX: 24,
      titleY: 52,
    });
    this.rightSection = this.createSection({
      panel: { x: 166, y: 42, width: 138, height: 126 },
      titleX: 174,
      titleY: 52,
    });

    this.statusPanel = createRankedPanel(this.scene, {
      x: 16,
      y: 178,
      width: 288,
      height: 12,
    }).setName('challenge.hub.status.panel');
    this.root.add(this.statusPanel);
    this.statusText = createUiText(this.scene, 22, 184, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#f7e0ab',
      },
    }).setOrigin(0, 0.5);
    this.root.add(this.statusText);

    const primary = createRankedButton(this.scene, {
      x: 16,
      y: 220,
      width: 134,
      height: 20,
    }, {
      label: '',
      tone: 'muted',
      disabled: true,
      hotkey: undefined,
    });
    const secondary = createRankedButton(this.scene, {
      x: 156,
      y: 220,
      width: 148,
      height: 20,
    }, {
      label: '',
      tone: 'default',
      disabled: false,
      hotkey: undefined,
    });
    this.actionButtons = { primary, secondary };
    this.root.add([primary.root, secondary.root]);
  }

  destroy(): void {
    this.detachHistoryScrollInteractions();
    this.root.destroy(true);
  }

  setHeader(config: ChallengeHubLayoutConfig): void {
    this.prefix = config.prefix;
    this.headerPanel.setName(`${config.prefix}.header.panel`);
    this.headerTitle.setText(config.headerTitle);
    this.headerTitle.setName(`${config.prefix}.header.title`);
    this.headerBest.setText(config.headerBestText);
    this.headerBest.setName(`${config.prefix}.header.best`);
    fitRankedText(this.headerBest, config.headerBestText, 102);
  }

  setSection(
    key: HubSectionKey,
    prefix: string,
    section: RankedBoardSectionViewModel,
  ): void {
    const target = key === 'left' ? this.leftSection : this.rightSection;
    target.prefix = prefix;
    target.panel.setName(`${prefix}.panel`);
    target.title.setText(section.title);
    target.content.removeAll(true);
    target.rows.forEach((row) => row.destroy(true));
    target.rows = [];
    target.currentScrollY = 0;
    target.maxScrollY = 0;
    target.draggingPointerId = undefined;
    target.dragStartPointerY = undefined;
    target.dragStartScrollY = undefined;

    this.resetSectionScrollVisuals(target);

    if (section.rows.length > 0) {
      // 左侧历史卡片采用“固定 viewport + 内部滚动”的专门路径。
      // 这里最多承载 8 条链上记录，但可视窗口永远保持 3 条，避免历史项
      // 挤压状态栏和底部按钮，也避免为这一块引入整页滚动语义。
      const rowLimit = key === 'left' && prefix === 'adventure.board.history' ? 8 : 5;
      const rows = section.rows.slice(0, rowLimit);

      rows.forEach((row, index) => {
        const rendered = createRankedListRow(this.scene, {
          x: SECTION_CONTENT_RECT.x,
          y:
            key === 'left' && prefix === 'adventure.board.history'
              ? SECTION_CONTENT_RECT.y + index * ROW_STEP
              : SECTION_CONTENT_RECT.y + index * 26,
          width:
            key === 'left' && prefix === 'adventure.board.history'
              ? HISTORY_SCROLL_RECT.width
              : SECTION_CONTENT_RECT.width,
          height: ROW_HEIGHT,
        }, row);
        rendered.setName(`${prefix}.row.${index}`);
        target.rows.push(rendered);
      });

      if (key === 'left' && prefix === 'adventure.board.history') {
        target.rows.forEach((row) => target.scrollContent?.add(row));
        target.maxScrollY = Math.max(
          0,
          target.rows.length * ROW_STEP - ROW_GAP - HISTORY_SCROLL_RECT.height,
        );
        this.attachHistoryScrollInteractions(target);
        this.applySectionScroll(target, 0);
        return;
      }

      target.rows.forEach((row) => target.content.add(row));
      return;
    }

    if (section.emptyState) {
      const empty = createRankedEmptyState(this.scene, {
        x: SECTION_CONTENT_RECT.x,
        y: SECTION_CONTENT_RECT.y + 6,
        width: SECTION_CONTENT_RECT.width,
        height: SECTION_CONTENT_RECT.height - 12,
      }, section.emptyState);
      empty.setName(`${prefix}.empty`);
      target.content.add(empty);
    }
  }

  setStatus(text: string, tone: RankedUiTone): void {
    this.statusPanel.setName(`${this.prefix}.status.panel`);
    this.statusText.setText(text);
    this.statusText.setName(`${this.prefix}.status.banner`);
    this.statusText.setColor(
      tone === 'danger'
        ? '#ffcdc0'
        : tone === 'success'
          ? '#b9f7a4'
          : tone === 'info'
            ? '#c7faff'
            : '#f7e0ab',
    );
    fitRankedText(this.statusText, text, 276);
  }

  configureActions(config: ChallengeHubActionConfig): void {
    this.actionButtons.primary.root.setName(config.primary.name);
    this.actionButtons.primary.setLabel(config.primary.label, config.primary.hotkey);
    this.actionButtons.primary.setTone(config.primary.tone);
    this.actionButtons.primary.setDisabled(config.primary.disabled);
    this.actionButtons.primary.onPress(config.primary.onPress);

    this.actionButtons.secondary.root.setName(config.secondary.name);
    this.actionButtons.secondary.setLabel(config.secondary.label, config.secondary.hotkey);
    this.actionButtons.secondary.setTone(config.secondary.tone);
    this.actionButtons.secondary.setDisabled(config.secondary.disabled);
    this.actionButtons.secondary.onPress(config.secondary.onPress);
  }

  getHistoryScrollState(): ScrollStateSnapshot | null {
    const target = this.leftSection;
    if (target.prefix !== 'adventure.board.history') {
      return null;
    }

    return {
      currentScrollY: target.currentScrollY,
      maxScrollY: target.maxScrollY,
      rowCount: target.rows.length,
      scrollbarVisible: Boolean(target.scrollbarThumb?.visible),
    };
  }

  scrollHistoryBy(deltaY: number): void {
    const target = this.leftSection;
    if (target.prefix !== 'adventure.board.history' || target.maxScrollY <= 0) {
      return;
    }

    this.applySectionScroll(target, target.currentScrollY + deltaY);
  }

  private createSection(config: {
    panel: RankedRect;
    titleX: number;
    titleY: number;
  }): SectionView {
    const panel = createRankedPanel(this.scene, config.panel);
    const title = createUiText(this.scene, config.titleX, config.titleY, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#fff4d0',
      },
    }).setOrigin(0, 0.5);
    const content = this.scene.add.container(config.titleX, config.titleY + 8);
    const scrollContent = this.scene.add.container(config.titleX, config.titleY + 8);
    const maskShape = this.scene.add.graphics().setVisible(false);
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRect(
      config.titleX + HISTORY_SCROLL_RECT.x,
      config.titleY + 8 + HISTORY_SCROLL_RECT.y,
      HISTORY_SCROLL_RECT.width,
      HISTORY_SCROLL_RECT.height,
    );
    const fadeTop = this.scene.add
      .rectangle(
        config.titleX + HISTORY_SCROLL_RECT.width / 2,
        config.titleY + 8 + HISTORY_FADE_HEIGHT / 2,
        HISTORY_SCROLL_RECT.width,
        HISTORY_FADE_HEIGHT,
        0x1f140a,
        0.78,
      )
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    const fadeBottom = this.scene.add
      .rectangle(
        config.titleX + HISTORY_SCROLL_RECT.width / 2,
        config.titleY + 8 + HISTORY_SCROLL_RECT.height - HISTORY_FADE_HEIGHT / 2,
        HISTORY_SCROLL_RECT.width,
        HISTORY_FADE_HEIGHT,
        0x1f140a,
        0.78,
      )
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    const scrollbarTrack = this.scene.add
      .rectangle(
        config.titleX + HISTORY_SCROLLBAR_X,
        config.titleY + 8 + HISTORY_SCROLLBAR_HEIGHT / 2,
        HISTORY_SCROLLBAR_WIDTH,
        HISTORY_SCROLLBAR_HEIGHT,
        0x8d6a30,
        0.18,
      )
      .setOrigin(0, 0.5)
      .setVisible(false);
    const scrollbarThumb = this.scene.add
      .rectangle(
        config.titleX + HISTORY_SCROLLBAR_X,
        config.titleY + 8,
        HISTORY_SCROLLBAR_WIDTH,
        16,
        0xf0d57a,
        0.92,
      )
      .setOrigin(0, 0)
      .setVisible(false)
      .setName('adventure.board.history.scrollbar.thumb');

    this.root.add([
      panel,
      title,
      content,
      scrollContent,
      maskShape,
      fadeTop,
      fadeBottom,
      scrollbarTrack,
      scrollbarThumb,
    ]);

    return {
      panel,
      title,
      content,
      prefix: '',
      viewportRect: { ...SECTION_CONTENT_RECT },
      scrollContent,
      maskShape,
      fadeTop,
      fadeBottom,
      scrollbarTrack,
      scrollbarThumb,
      rows: [],
      currentScrollY: 0,
      maxScrollY: 0,
    };
  }

  private resetSectionScrollVisuals(section: SectionView): void {
    section.scrollContent?.removeAll(true);
    section.scrollContent?.clearMask(true);
    section.scrollContent?.setVisible(false);
    section.fadeTop?.setVisible(false);
    section.fadeBottom?.setVisible(false);
    section.scrollbarTrack?.setVisible(false);
    section.scrollbarThumb?.setVisible(false);
    this.detachHistoryScrollInteractions();
  }

  private attachHistoryScrollInteractions(section: SectionView): void {
    if (section.maxScrollY <= 0) {
      if (section.scrollContent && section.maskShape) {
        section.scrollContent.setMask(section.maskShape.createGeometryMask());
      }
      section.scrollContent?.setVisible(true);
      return;
    }

    if (section.scrollContent && section.maskShape) {
      section.scrollContent.setMask(section.maskShape.createGeometryMask());
    }
    section.scrollContent?.setVisible(true);
    section.scrollbarTrack?.setVisible(true);
    section.scrollbarThumb?.setVisible(true);

    this.scene.input.on('wheel', this.handleHistoryWheel, this);
    this.scene.input.on('pointerdown', this.handleHistoryPointerDown, this);
    this.scene.input.on('pointermove', this.handleHistoryPointerMove, this);
    this.scene.input.on('pointerup', this.handleHistoryPointerUp, this);
    this.scene.input.on('pointerupoutside', this.handleHistoryPointerUp, this);
  }

  private detachHistoryScrollInteractions(): void {
    this.scene.input.off('wheel', this.handleHistoryWheel, this);
    this.scene.input.off('pointerdown', this.handleHistoryPointerDown, this);
    this.scene.input.off('pointermove', this.handleHistoryPointerMove, this);
    this.scene.input.off('pointerup', this.handleHistoryPointerUp, this);
    this.scene.input.off('pointerupoutside', this.handleHistoryPointerUp, this);
  }

  private handleHistoryWheel(
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    const section = this.leftSection;
    if (
      section.prefix !== 'adventure.board.history' ||
      section.maxScrollY <= 0 ||
      !this.isPointerWithinHistoryViewport(this.scene.input.activePointer)
    ) {
      return;
    }

    this.applySectionScroll(section, section.currentScrollY + Math.sign(deltaY) * HISTORY_WHEEL_STEP);
  }

  private handleHistoryPointerDown(pointer: Phaser.Input.Pointer): void {
    const section = this.leftSection;
    if (
      section.prefix !== 'adventure.board.history' ||
      section.maxScrollY <= 0 ||
      !this.isPointerWithinHistoryViewport(pointer)
    ) {
      return;
    }

    section.draggingPointerId = pointer.id;
    section.dragStartPointerY = pointer.y;
    section.dragStartScrollY = section.currentScrollY;
  }

  private handleHistoryPointerMove(pointer: Phaser.Input.Pointer): void {
    const section = this.leftSection;
    if (
      section.prefix !== 'adventure.board.history' ||
      section.maxScrollY <= 0 ||
      section.draggingPointerId !== pointer.id ||
      section.dragStartPointerY === undefined ||
      section.dragStartScrollY === undefined ||
      !pointer.isDown
    ) {
      return;
    }

    const deltaY = pointer.y - section.dragStartPointerY;
    this.applySectionScroll(section, section.dragStartScrollY - deltaY);
  }

  private handleHistoryPointerUp(pointer: Phaser.Input.Pointer): void {
    const section = this.leftSection;
    if (section.draggingPointerId !== pointer.id) {
      return;
    }

    section.draggingPointerId = undefined;
    section.dragStartPointerY = undefined;
    section.dragStartScrollY = undefined;
  }

  private isPointerWithinHistoryViewport(pointer: Phaser.Input.Pointer): boolean {
    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const viewportLeft = 24 + HISTORY_SCROLL_RECT.x;
    const viewportTop = 60;

    return (
      worldPoint.x >= viewportLeft &&
      worldPoint.x <= viewportLeft + HISTORY_SCROLL_RECT.width &&
      worldPoint.y >= viewportTop &&
      worldPoint.y <= viewportTop + HISTORY_SCROLL_RECT.height
    );
  }

  private applySectionScroll(section: SectionView, nextScrollY: number): void {
    const clamped = Phaser.Math.Clamp(nextScrollY, 0, section.maxScrollY);
    section.currentScrollY = clamped;

    if (section.scrollContent) {
      section.scrollContent.y = 60 - clamped;
    }

    const canScroll = section.maxScrollY > 0;
    section.fadeTop?.setVisible(canScroll && clamped > 0.5);
    section.fadeBottom?.setVisible(canScroll && clamped < section.maxScrollY - 0.5);

    if (section.scrollbarThumb && section.scrollbarTrack) {
      if (!canScroll) {
        section.scrollbarThumb.setVisible(false);
        section.scrollbarTrack.setVisible(false);
      } else {
        section.scrollbarThumb.setVisible(true);
        section.scrollbarTrack.setVisible(true);
        const contentHeight = Math.max(
          HISTORY_SCROLL_RECT.height,
          section.rows.length * ROW_STEP - ROW_GAP,
        );
        const ratio = HISTORY_SCROLL_RECT.height / contentHeight;
        const thumbHeight = Phaser.Math.Clamp(
          Math.round(HISTORY_SCROLLBAR_HEIGHT * ratio),
          12,
          HISTORY_SCROLLBAR_HEIGHT,
        );
        const trackTravel = HISTORY_SCROLLBAR_HEIGHT - thumbHeight;
        const thumbY =
          60 + (trackTravel * (section.maxScrollY === 0 ? 0 : clamped / section.maxScrollY));
        section.scrollbarThumb.setSize(HISTORY_SCROLLBAR_WIDTH, thumbHeight);
        section.scrollbarThumb.setPosition(24 + HISTORY_SCROLLBAR_X, thumbY);
      }
    }
  }
}
