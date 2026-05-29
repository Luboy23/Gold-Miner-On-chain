/**
 * ResultActionDockController 只负责结果页底部双按钮的几何和状态映射。
 *
 * 它不决定“应该去哪”或“应该重试什么”，只把上层 view model 里的动作语义
 * 映射成按钮文案、色调和禁用态。这样结果页路由语义始终收口在 ResultScene /
 * buildResultViewModel，而不是分散到具体按钮组件里。
 */
import type Phaser from 'phaser';

import { createRankedButton } from '../../game/ranked-ui/result';
import type { RankedResultViewModel } from '../../game/types/index';

type ResultActionCallbacks = {
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
};

export class ResultActionDockController {
  private readonly primaryButton: ReturnType<typeof createRankedButton>;
  private readonly secondaryButton: ReturnType<typeof createRankedButton>;

  constructor(
    scene: Phaser.Scene,
    root: Phaser.GameObjects.Container,
    callbacks: ResultActionCallbacks,
  ) {
    this.primaryButton = createRankedButton(
      scene,
      {
        x: 16,
        y: 220,
        width: 134,
        height: 20,
      },
      {
        label: '',
        tone: 'muted',
        disabled: true,
      },
    );
    this.primaryButton.root.setName('result.actions.primary');
    this.primaryButton.onPress(callbacks.onPrimaryAction);

    this.secondaryButton = createRankedButton(
      scene,
      {
        x: 156,
        y: 220,
        width: 148,
        height: 20,
      },
      {
        label: '',
        tone: 'info',
        disabled: false,
      },
    );
    this.secondaryButton.root.setName('result.actions.secondary');
    this.secondaryButton.onPress(callbacks.onSecondaryAction);

    root.add([this.primaryButton.root, this.secondaryButton.root]);
  }

  apply(model: RankedResultViewModel['actions']): void {
    // 底部主按钮的 tone 只反映动作语义层级：继续/返回冒险中心属于主动作，
    // 返回首页是固定的尾部离场动作，不在这里反向决定业务分支。
    const primaryTone =
      model.primaryKind === 'go-menu'
        ? 'muted'
        : model.primaryKind === 'go-adventure'
          ? 'success'
          : model.primaryKind === 'retry-run'
            ? 'success'
            : 'accent';

    this.primaryButton.setLabel(model.primaryLabel, model.primaryHotkey);
    this.primaryButton.setTone(primaryTone);
    this.primaryButton.setDisabled(model.primaryKind === 'none');

    this.secondaryButton.setLabel(model.secondaryLabel, model.secondaryHotkey);
    this.secondaryButton.setTone(
      model.secondaryKind === 'go-menu'
        ? 'default'
        : model.secondaryKind === 'retry-run' || model.secondaryKind === 'go-adventure'
          ? 'info'
          : 'default',
    );
    this.secondaryButton.setDisabled(model.secondaryKind === 'none');
  }
}
