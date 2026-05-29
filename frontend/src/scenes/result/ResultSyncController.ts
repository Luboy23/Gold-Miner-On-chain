/**
 * ResultSyncController 只负责结算页同步状态卡片的几何与文本布局。
 *
 * 它不理解 replay，也不判断“同步失败/已确认”背后的业务语义；scene/view model
 * 只需要把当前阶段与文案交给它，它负责在有限卡片空间里稳定排版。
 */
import type Phaser from 'phaser';

import { createRankedPanel, createRankedProgressBar } from '../../game/ranked-ui/result';
import { createUiText } from '../../game/uiText';
import type { RankedResultViewModel } from '../../game/types/index';

export class ResultSyncController {
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly progress: ReturnType<typeof createRankedProgressBar>;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly detailText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container) {
    const panel = createRankedPanel(scene, {
      x: 16,
      y: 176,
      width: 288,
      height: 34,
    }).setName('result.sync.panel');
    root.add(panel);

    this.titleText = createUiText(scene, 26, 184, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
      },
    }).setOrigin(0, 0.5);

    this.progress = createRankedProgressBar(
      scene,
      {
        x: 172,
        y: 188,
        width: 120,
        height: 8,
      },
      {
        value: 0,
        max: 3,
        tone: 'accent',
      },
    );
    this.progress.root.setName('result.sync.progress');

    const stageLabels = [
      { x: 172, label: '已提交' },
      { x: 216, label: '处理中' },
      { x: 260, label: '已记录' },
    ].map(({ x, label }) =>
      createUiText(scene, x, 198, label, {
        variant: 'caption',
        script: 'mixed',
        style: {
          fontSize: '6px',
          color: '#d7c696',
        },
      }).setOrigin(0, 0.5),
    );

    this.statusText = createUiText(scene, 26, 200, '', {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#fff4d0',
        wordWrap: { width: 140 },
      },
    })
      .setOrigin(0, 0)
      .setName('result.sync.status');

    this.detailText = createUiText(scene, 26, 0, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '6px',
        color: '#d7c696',
        wordWrap: { width: 246, useAdvancedWrap: true },
        maxLines: 2,
      },
    })
      .setOrigin(0, 0)
      .setVisible(false)
      .setName('result.sync.detail');

    root.add([
      this.titleText,
      this.progress.root,
      ...stageLabels,
      this.statusText,
      this.detailText,
    ]);
  }

  apply(model: RankedResultViewModel['sync']): void {
    this.titleText.setText(model.title);
    this.progress.setProgress(
      model.progressValue,
      model.progressMax,
      model.progressTone,
    );
    this.statusText.setText(model.statusText);

    if (!model.detailText) {
      // 无详情态必须回到更紧凑的单段布局，避免沿用失败态/确认态的双段排版残留。
      this.statusText.setPosition(26, 200);
      this.statusText.setWordWrapWidth(140, true);
      this.detailText.setText('');
      this.detailText.setName('');
      this.detailText.setVisible(false);
      return;
    }

    // 带详情时采用“状态 + 详情”双段布局；这里优先保证文案留在卡片内部，
    // 不追求复用单段态的 y 基线。
    this.statusText.setPosition(26, 187);
    this.statusText.setWordWrapWidth(140, true);
    this.detailText.setFontSize('6px');
    this.detailText.setWordWrapWidth(246, true);
    this.detailText.setPosition(26, 198);
    this.detailText.setName('result.sync.detail');
    this.detailText.setText(model.detailText);
    this.detailText.setColor(
      model.detailTone === 'danger' ? '#ffcdc0' : '#d7c696',
    );
    this.detailText.setVisible(true);
  }
}
