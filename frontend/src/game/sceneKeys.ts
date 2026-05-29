export const SCENE_KEYS = {
  Boot: 'BootScene',
  Preloader: 'PreloaderScene',
  Menu: 'MenuScene',
  Ranked: 'RankedScene',
  AdventureCenter: 'AdventureCenterScene',
  Goal: 'GoalScene',
  Gameplay: 'GameplayScene',
  Shop: 'ShopScene',
  Result: 'ResultScene',
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];
