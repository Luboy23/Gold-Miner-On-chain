/**
 * GameplayInputController 负责把 Phaser 键盘事件收口成“单帧输入快照”。
 *
 * 这里的约束是：scene/gameplay loop 只消费离散帧输入，而不是直接在业务代码里查询按键对象。
 * 这样可以让输入语义保持稳定，也方便 replay/调试路径复用同一套输入面。
 */
import Phaser from 'phaser';

export type GameplayFrameInput = {
  firePressed: boolean;
  dynamitePressed: boolean;
  escapePressed: boolean;
  toggleCollisionDebug: boolean;
  toggleForceGoalReached: boolean;
};

export class GameplayInputController {
  private readonly scene: Phaser.Scene;
  private downKey: Phaser.Input.Keyboard.Key | null = null;
  private upKey: Phaser.Input.Keyboard.Key | null = null;
  private escKey: Phaser.Input.Keyboard.Key | null = null;
  private shiftKey: Phaser.Input.Keyboard.Key | null = null;
  private cKey: Phaser.Input.Keyboard.Key | null = null;
  private gKey: Phaser.Input.Keyboard.Key | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(): void {
    const keyboard = this.scene.input.keyboard;

    if (!keyboard) {
      return;
    }

    // gameplay 当前只暴露有限输入面：发钩、炸药、退出和 DEV 快捷键。
    this.downKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.upKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.escKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.cKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.gKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);
  }

  destroy(): void {
    this.downKey?.destroy();
    this.upKey?.destroy();
    this.escKey?.destroy();
    this.shiftKey?.destroy();
    this.cKey?.destroy();
    this.gKey?.destroy();
    this.downKey = null;
    this.upKey = null;
    this.escKey = null;
    this.shiftKey = null;
    this.cKey = null;
    this.gKey = null;
  }

  isEscapeDown(): boolean {
    return Boolean(this.escKey?.isDown);
  }

  pollFrameInput(): GameplayFrameInput {
    // 这里只返回“这一帧是否刚触发”的离散输入，不保存长按状态机。
    return {
      firePressed: Boolean(
        this.downKey && Phaser.Input.Keyboard.JustDown(this.downKey),
      ),
      dynamitePressed: Boolean(
        this.upKey && Phaser.Input.Keyboard.JustDown(this.upKey),
      ),
      escapePressed: Boolean(
        this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey),
      ),
      toggleCollisionDebug: Boolean(
        import.meta.env.DEV &&
          this.cKey &&
          Phaser.Input.Keyboard.JustDown(this.cKey) &&
          this.shiftKey?.isDown,
      ),
      toggleForceGoalReached: Boolean(
        import.meta.env.DEV &&
          this.gKey &&
          Phaser.Input.Keyboard.JustDown(this.gKey) &&
          this.shiftKey?.isDown,
      ),
    };
  }
}
