/**
 * ResultAnalysisController 负责结果页右侧信息卡的两种展示模式：
 * - ranked：竞技诊断
 * - campaign：历史记录
 *
 * 这里的核心约束是：右侧卡片虽然复用了同一块几何区域，但 campaign 历史与
 * ranked 诊断是两套完全不同的展示语义。controller 只按 view model 分流渲染，
 * 不在这里推导任何排行榜或历史真值。
 */
import type Phaser from 'phaser';

import {
  createRankedBadge,
  createRankedPanel,
} from '../../game/ranked-ui/result';
import {
  createRankedEmptyState,
  createRankedListRow,
} from '../../game/ranked-ui/lists';
import { createUiText } from '../../game/uiText';
import type { RankedResultViewModel } from '../../game/types/index';

export class ResultAnalysisController {
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly verdictBadge: ReturnType<typeof createRankedBadge>;
  private readonly pbDeltaText: Phaser.GameObjects.Text;
  private readonly timeDeltaText: Phaser.GameObjects.Text;
  private readonly retryHintText: Phaser.GameObjects.Text;
  private readonly historyContainer: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container) {
    const panel = createRankedPanel(scene, {
      x: 160,
      y: 44,
      width: 144,
      height: 124,
    }).setName('result.analysis.panel');
    root.add(panel);

    this.titleText = createUiText(scene, 170, 56, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
      },
    }).setOrigin(0, 0.5);

    this.verdictBadge = createRankedBadge(scene, 232, 80, {
      label: '',
      tone: 'info',
      minWidth: 116,
      maxWidth: 116,
      fixedWidth: 116,
    });

    this.pbDeltaText = createUiText(scene, 170, 102, '', {
      variant: 'body',
      script: 'mixed',
      style: {
        fontSize: '9px',
        color: '#fff8de',
        wordWrap: { width: 120 },
      },
    }).setOrigin(0, 0);

    this.timeDeltaText = createUiText(scene, 170, 124, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
        wordWrap: { width: 120 },
      },
    }).setOrigin(0, 0);

    this.retryHintText = createUiText(scene, 170, 146, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#b9f7a4',
        wordWrap: { width: 120 },
      },
    })
      .setOrigin(0, 0)
      .setName('result.analysis.retryHint');

    this.historyContainer = scene.add.container(170, 72).setName('result.analysis.history');

    root.add([
      this.titleText,
      this.verdictBadge.root,
      this.pbDeltaText,
      this.timeDeltaText,
      this.retryHintText,
      this.historyContainer,
    ]);
  }

  apply(model: RankedResultViewModel['analysis']): void {
    this.titleText.setText(model.title);
    this.historyContainer.removeAll(true);

    if (model.kind === 'history') {
      // campaign 历史模式下，右侧卡片退化成只读列表，不再显示 ranked verdict/pb/time delta。
      this.verdictBadge.root.setVisible(false);
      this.pbDeltaText.setVisible(false).setText('');
      this.timeDeltaText.setVisible(false).setText('');
      this.retryHintText.setVisible(false).setText('');

      if (model.rows.length > 0) {
        model.rows.slice(0, 3).forEach((row, index) => {
          const rendered = createRankedListRow(sceneRef(this.titleText), {
            x: 0,
            y: index * 26,
            width: 122,
            height: 24,
          }, row);
          rendered.setName(`result.analysis.history.row.${index}`);
          this.historyContainer.add(rendered);
        });
        return;
      }

      if (model.emptyState) {
        const empty = createRankedEmptyState(sceneRef(this.titleText), {
          x: 0,
          y: 4,
          width: 122,
          height: 84,
        }, model.emptyState);
        empty.setName('result.analysis.history.empty');
        this.historyContainer.add(empty);
      }
      return;
    }

    // ranked 诊断模式与 campaign 历史模式互斥；只要不是 history，就恢复完整竞技诊断排版。
    this.verdictBadge.root.setVisible(true);
    this.pbDeltaText.setVisible(true);
    this.timeDeltaText.setVisible(true);
    this.retryHintText.setVisible(true);
    this.verdictBadge.setLabel(model.verdictLabel);
    this.verdictBadge.setTone(model.verdictTone);
    this.pbDeltaText.setText(model.pbDeltaLabel);
    this.timeDeltaText.setText(model.timeDeltaLabel);
    this.retryHintText.setText(model.retryHint);
  }
}

function sceneRef(text: Phaser.GameObjects.Text): Phaser.Scene {
  return text.scene;
}
