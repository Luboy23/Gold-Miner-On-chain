import type { RankedUiTone } from '../types/index';

export interface RankedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RankedFitTextOptions {
  ellipsis?: string;
}

export type TonePalette = {
  fill: number;
  fillAlt: number;
  stroke: number;
  accent: number;
  text: string;
  mutedText: string;
};

export const TONE_PALETTES: Record<RankedUiTone, TonePalette> = {
  default: {
    fill: 0x1a120b,
    fillAlt: 0x2a180c,
    stroke: 0xf7d54a,
    accent: 0xef8804,
    text: '#fff4d0',
    mutedText: '#d7c696',
  },
  accent: {
    fill: 0x2a180c,
    fillAlt: 0x40210b,
    stroke: 0xf7d54a,
    accent: 0xef8804,
    text: '#fff7de',
    mutedText: '#f7d54a',
  },
  success: {
    fill: 0x11210d,
    fillAlt: 0x193414,
    stroke: 0x9af76b,
    accent: 0x9af76b,
    text: '#efffe6',
    mutedText: '#b9f7a4',
  },
  info: {
    fill: 0x0f1d20,
    fillAlt: 0x133035,
    stroke: 0x8ff8ff,
    accent: 0x8ff8ff,
    text: '#ecffff',
    mutedText: '#a8eff6',
  },
  danger: {
    fill: 0x28110c,
    fillAlt: 0x431912,
    stroke: 0xffb29d,
    accent: 0xffb29d,
    text: '#fff1eb',
    mutedText: '#ffcdc0',
  },
  muted: {
    fill: 0x15100c,
    fillAlt: 0x1f1710,
    stroke: 0x8c6c42,
    accent: 0x8c6c42,
    text: '#d8c29b',
    mutedText: '#a78c67',
  },
};

export const DISABLED_BUTTON_PALETTE: TonePalette = {
  fill: 0x16120f,
  fillAlt: 0x1d1713,
  stroke: 0x5b4b36,
  accent: 0x5b4b36,
  text: '#9c8b6f',
  mutedText: '#756753',
};

export const BUTTON_HOVER_LIFT = 0.08;
export const BUTTON_PRESS_DARKEN = 0.12;

export function getPalette(tone: RankedUiTone): TonePalette {
  return TONE_PALETTES[tone];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function adjustHex(value: number, delta: number): number {
  const r = clamp(((value >> 16) & 0xff) + Math.round(255 * delta), 0, 255);
  const g = clamp(((value >> 8) & 0xff) + Math.round(255 * delta), 0, 255);
  const b = clamp((value & 0xff) + Math.round(255 * delta), 0, 255);
  return (r << 16) | (g << 8) | b;
}

export function inferTextScript(value: string): 'latin' | 'mixed' {
  return /[\u3400-\u9fff]/.test(value) ? 'mixed' : 'latin';
}
