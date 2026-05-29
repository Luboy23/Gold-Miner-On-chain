import Phaser from 'phaser';

export type UiTextVariant = 'heading' | 'body' | 'caption' | 'status' | 'value';
export type UiTextScript = 'latin' | 'mixed';

type UiTextMetricsOptions = {
  variant: UiTextVariant;
  script: UiTextScript;
};

type UiTextOptions = UiTextMetricsOptions & {
  style?: Phaser.Types.GameObjects.Text.TextStyle;
};

type UiTextPadding = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const UI_FONT_MIXED =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
export const UI_FONT_LATIN = 'Visitor, "Pixel Square", monospace';
export const UI_FONT_DISPLAY = 'Kurland, Georgia, serif';

const TEST_STRING_BY_SCRIPT: Record<UiTextScript, string> = {
  latin: '|MÉqgyjp',
  mixed: '回国田Ag|Éqgyjp',
};

const PADDING_BY_VARIANT: Record<UiTextVariant, UiTextPadding> = {
  heading: { left: 1, top: 4, right: 1, bottom: 2 },
  value: { left: 1, top: 4, right: 1, bottom: 2 },
  body: { left: 1, top: 3, right: 1, bottom: 2 },
  caption: { left: 1, top: 3, right: 1, bottom: 2 },
  status: { left: 1, top: 3, right: 1, bottom: 2 },
};

function resolveFontFamily({ variant, script }: UiTextMetricsOptions): string {
  if (script === 'latin') {
    return variant === 'value' ? UI_FONT_DISPLAY : UI_FONT_LATIN;
  }

  return UI_FONT_MIXED;
}

export function createUiText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  options: UiTextOptions,
): Phaser.GameObjects.Text {
  const text = scene.add.text(x, y, value, {
    ...options.style,
    fontFamily: options.style?.fontFamily ?? resolveFontFamily(options),
  });

  return applyUiTextMetrics(text, options);
}

export function applyUiTextMetrics(
  text: Phaser.GameObjects.Text,
  options: UiTextMetricsOptions,
): Phaser.GameObjects.Text {
  text.style.setTestString(TEST_STRING_BY_SCRIPT[options.script]);

  const padding = PADDING_BY_VARIANT[options.variant];
  text.setPadding(padding.left, padding.top, padding.right, padding.bottom);

  return text;
}
