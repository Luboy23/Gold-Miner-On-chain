import type Phaser from 'phaser';

import { createRankedBadge, createRankedPanel } from '../../game/ranked-ui/result';
import { createUiText } from '../../game/uiText';
import type { RankedResultViewModel } from '../../game/types/index';

export class ResultHeaderController {
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly challengeText: Phaser.GameObjects.Text;
  private readonly badge: ReturnType<typeof createRankedBadge>;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container) {
    const panel = createRankedPanel(scene, {
      x: 16,
      y: 10,
      width: 288,
      height: 24,
    }).setName('result.header.panel');
    root.add(panel);

    this.titleText = createUiText(scene, 26, 22, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#f7d54a',
      },
    }).setOrigin(0, 0.5);
    this.challengeText = createUiText(scene, 118, 22, '', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: '#d7c696',
      },
    }).setOrigin(0, 0.5);

    this.badge = createRankedBadge(scene, 258, 22, {
      label: '',
      tone: 'accent',
      minWidth: 72,
      maxWidth: 80,
    });
    this.badge.root.setName('result.header.badge');

    root.add([this.titleText, this.challengeText, this.badge.root]);
  }

  apply(model: RankedResultViewModel['header']): void {
    this.titleText.setText(model.title);
    this.challengeText.setText(model.challengeLabel);
    this.badge.setLabel(model.syncBadgeLabel);
    this.badge.setTone(model.syncBadgeTone);
  }
}
