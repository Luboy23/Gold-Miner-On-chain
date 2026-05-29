export type BrandFooterVariant = 'wide' | 'micro';

export type BrandFooterSceneKind =
  | 'menu'
  | 'goal'
  | 'gameplay'
  | 'adventure-center'
  | 'ranked-center'
  | 'shop'
  | 'result-casual'
  | 'result-verified';

export type BrandFooterLayout = {
  variant: BrandFooterVariant;
  x: number;
  y: number;
};

const FOOTER_LAYOUTS: Record<BrandFooterSceneKind, BrandFooterLayout> = {
  menu: { variant: 'wide', x: 302, y: 234 },
  goal: { variant: 'wide', x: 302, y: 234 },
  gameplay: { variant: 'wide', x: 302, y: 234 },
  'adventure-center': { variant: 'micro', x: 298, y: 212 },
  'ranked-center': { variant: 'micro', x: 298, y: 212 },
  shop: { variant: 'micro', x: 302, y: 214 },
  'result-casual': { variant: 'wide', x: 302, y: 234 },
  'result-verified': { variant: 'micro', x: 298, y: 216 },
};

export function getBrandFooterLayout(
  sceneKind: BrandFooterSceneKind,
): BrandFooterLayout {
  return FOOTER_LAYOUTS[sceneKind];
}
