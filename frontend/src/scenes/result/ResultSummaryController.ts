/**
 * ResultSummaryController 负责结果页左侧“本局成绩”主摘要卡。
 *
 * 这张卡始终承载当前 run 的主结果：大数字、关卡/挑战标签、结果 badge 和一句摘要。
 * 它不理解同步状态，也不区分 campaign/ranked 的后续操作，只负责稳定展示主结果真相。
 */
import type Phaser from 'phaser';

import { createRankedBadge, createRankedPanel } from '../../game/ranked-ui/result';
import { createUiText } from '../../game/uiText';
import type { RankedResultViewModel } from '../../game/types/index';

export class ResultSummaryController {
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly primaryText: Phaser.GameObjects.Text;
  private readonly summaryText: Phaser.GameObjects.Text;
  private readonly levelBadge: ReturnType<typeof createRankedBadge>;
  private readonly outcomeBadge: ReturnType<typeof createRankedBadge>;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container) {
    const panel = createRankedPanel(scene, {
      x: 16,
      y: 44,
      width: 138,
      height: 124,
    }).setName('result.summary.panel');
    root.add(panel);

    this.titleText = createUiText(scene, 26, 56, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
      },
    }).setOrigin(0, 0.5);

    this.primaryText = createUiText(scene, 26, 92, '', {
      variant: 'value',
      script: 'mixed',
      style: {
        fontSize: '30px',
        color: '#fff8de',
      },
    })
      .setOrigin(0, 0.5)
      .setName('result.summary.primary');

    this.levelBadge = createRankedBadge(scene, 85, 118, {
      label: '',
      tone: 'muted',
      minWidth: 82,
      maxWidth: 82,
      fixedWidth: 82,
    });
    this.levelBadge.root.setName('result.summary.level');

    this.outcomeBadge = createRankedBadge(scene, 85, 139, {
      label: '',
      tone: 'success',
      minWidth: 122,
      maxWidth: 122,
      fixedWidth: 122,
    });
    this.outcomeBadge.root.setName('result.summary.outcome');

    this.summaryText = createUiText(scene, 26, 157, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
        wordWrap: { width: 120 },
      },
    }).setOrigin(0, 0.5);

    root.add([
      this.titleText,
      this.primaryText,
      this.levelBadge.root,
      this.outcomeBadge.root,
      this.summaryText,
    ]);
  }

  apply(model: RankedResultViewModel['summary']): void {
    // 左侧摘要卡只消费已经整理好的 summary view model，不在这里做数值格式推导。
    this.titleText.setText(model.title);
    this.primaryText.setText(model.primaryValue);
    this.levelBadge.setLabel(model.levelLabel);
    this.outcomeBadge.setLabel(model.outcomeLabel);
    this.outcomeBadge.setTone(model.outcomeTone);
    this.summaryText.setText(model.summaryText);
  }
}
