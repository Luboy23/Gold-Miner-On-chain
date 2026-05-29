import type { LevelGroup, LevelTheme, SaveData, TemporaryBuffs } from './types/index';

export const LOGIC_WIDTH = 320;
export const LOGIC_HEIGHT = 240;
export const LOGIC_CENTER_X = LOGIC_WIDTH / 2;
export const LOGIC_CENTER_Y = LOGIC_HEIGHT / 2;
export const RENDER_SCALE = 4;
export const RENDER_WIDTH = LOGIC_WIDTH * RENDER_SCALE;
export const RENDER_HEIGHT = LOGIC_HEIGHT * RENDER_SCALE;
export const GAMEPLAY_TOP_HEIGHT = 40;
export const GAMEPLAY_BACKGROUND_HEIGHT = LOGIC_HEIGHT - GAMEPLAY_TOP_HEIGHT;
export const DEFAULT_TIME_LIMIT_SEC = 61;
export const RANKED_PROTOCOL_VERSION = 2;
export const RANKED_SIMULATION_VERSION = 1;
export const RANKED_LOGIC_FPS = 60;
export const RANKED_LOGIC_FRAME_SEC = 1 / RANKED_LOGIC_FPS;
export const FINAL_LEVEL_GROUP: LevelGroup = 10;
export const SAVE_STORAGE_KEY = 'gold-miner-onchain.save.v1';
export const PLAYER_POSITION = { x: 165, y: 39 } as const;
export const HOOK_ORIGIN = { x: 158, y: 30 } as const;
export const HOOK_COLLISION_OFFSET = 13;
export const HOOK_MIN_ANGLE = -75;
export const HOOK_MAX_ANGLE = 75;
export const HOOK_ROTATE_SPEED = 65;
export const HOOK_MAX_LENGTH = 230;
export const HOOK_GRAB_SPEED = 100;
export const HOOK_EMPTY_RETURN_SPEED = 180;
export const HOOK_COLLISION_RADIUS = 6;
export const HOOK_RESOLVE_DURATION_SEC = 1;
export const MAX_DYNAMITE_COUNT = 12;
export const QUESTION_BAG_EXTRA_EFFECT_CHANCE = 0.2;
export const QUESTION_BAG_EXTRA_DYNAMITE_CHANCE = 0.2;
export const DEFAULT_STRENGTH_MULTIPLIER = 1;
export const STRENGTH_DRINK_MULTIPLIER = 1.75;
export const MAX_STRENGTH_MULTIPLIER = 6;
export const MOVING_ENTITY_IDLE_DURATION_SEC = 1;
export const MOVING_ENTITY_PIXELS_PER_SECOND = 60;
export const MOVING_ENTITY_TURN_THRESHOLD = 1;

export const DEFAULT_SAVE_DATA: SaveData = {
  version: 1,
  highScore: 0,
  highLevel: 1,
  acknowledgedExperienceMode: false,
};

export const DEFAULT_TEMPORARY_BUFFS: TemporaryBuffs = {
  strengthDrink: 0,
  luckyClover: 0,
  rockCollectorsBook: 0,
  gemPolish: 0,
};

export const GOAL_BY_LEVEL: Record<LevelGroup, number> = {
  1: 600,
  2: 950,
  3: 1400,
  4: 1900,
  5: 2500,
  6: 3200,
  7: 4050,
  8: 5000,
  9: 6100,
  10: 7400,
};

export const LEVEL_THEME_BACKGROUND_KEYS: Record<
  LevelTheme,
  'levelA' | 'levelB' | 'levelC' | 'levelD' | 'levelE'
> = {
  LevelA: 'levelA',
  LevelB: 'levelB',
  LevelC: 'levelC',
  LevelD: 'levelD',
  LevelE: 'levelE',
};

export const ANIMATION_KEYS = {
  minerIdle: 'miner.idle',
  minerGrab: 'miner.grab',
  minerGrabBack: 'miner.grab-back',
  minerUseDynamite: 'miner.use-dynamite',
  minerStrengthen: 'miner.strengthen',
  shopkeeperIdle: 'shopkeeper.idle',
  shopkeeperSad: 'shopkeeper.sad',
  hookIdle: 'hook.idle',
  hookGrabNormal: 'hook.grab-normal',
  hookGrabMini: 'hook.grab-mini',
  moleIdle: 'mole.idle',
  moleMove: 'mole.move',
  moleDiamondIdle: 'mole-diamond.idle',
  moleDiamondMove: 'mole-diamond.move',
  fxGoldBig: 'fx.gold-big',
  fxExplosive: 'fx.explosive',
  fxExplosiveLarge: 'fx.explosive-large',
} as const;
