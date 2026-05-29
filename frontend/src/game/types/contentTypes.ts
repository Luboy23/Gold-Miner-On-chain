export interface AssetManifest {
  basePath: string;
  images: Record<string, Record<string, string>>;
  audio: {
    sfx: Record<string, string>;
    music: Record<string, string>;
  };
  fonts: Record<string, string>;
  spriteSheets: Record<
    string,
    {
      path: string;
      frameWidth: number;
      frameHeight: number;
    }
  >;
}

export type LevelGroup = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type LevelTheme = 'LevelA' | 'LevelB' | 'LevelC' | 'LevelD' | 'LevelE';
export type BonusTier = 'low' | 'normal' | 'high';

export type ShopItemId =
  | 'dynamite'
  | 'strengthDrink'
  | 'luckyClover'
  | 'rockCollectorsBook'
  | 'gemPolish';

export type ShopOfferState = 'available' | 'sold';

export interface ShopItemConfig {
  id: ShopItemId;
  textureKey: ShopItemId;
  label: string;
  description: string;
}

export interface ShopOffer {
  itemId: ShopItemId;
  price: number;
  state: ShopOfferState;
}

export type MoveDirection = 'Left' | 'Right';

export type EntityType =
  | 'MiniGold'
  | 'NormalGold'
  | 'NormalGoldPlus'
  | 'BigGold'
  | 'MiniRock'
  | 'NormalRock'
  | 'BigRock'
  | 'QuestionBag'
  | 'Diamond'
  | 'Skull'
  | 'Bone'
  | 'TNT'
  | 'Mole'
  | 'MoleWithDiamond';

export interface TemporaryBuffs {
  strengthDrink: 0 | 1;
  luckyClover: 0 | 1;
  rockCollectorsBook: 0 | 1;
  gemPolish: 0 | 1;
}

export interface CatchAnchor {
  xRatio: number;
  yRatio: number;
}

export interface MovingEntityConfig {
  speed: number;
  moveRange: number;
}

export interface ExplosiveEntityConfig {
  destroyedTextureKey: string;
  explosionRadius: number;
}

export interface EntityConfig {
  id: EntityType;
  family: 'static' | 'random-bag' | 'moving' | 'explosive';
  textureKey: string;
  mass: number;
  baseBonus: number;
  bonusTier: BonusTier;
  collisionRadius: number;
  catchAnchor: CatchAnchor;
  randomBag?: {
    massMin: number;
    massMax: number;
    bonusBase: number;
    bonusRatioMin: number;
    bonusRatioMax: number;
    extraEffectChance: number;
  };
  moving?: MovingEntityConfig;
  explosive?: ExplosiveEntityConfig;
}

export interface LevelEntitySpawn {
  type: EntityType;
  x: number;
  y: number;
  dir?: MoveDirection;
}

export interface LevelDefinition {
  id: string;
  group: LevelGroup;
  theme: LevelTheme;
  timeLimitSec: number;
  entities: LevelEntitySpawn[];
}
