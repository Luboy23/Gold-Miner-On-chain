import Phaser from 'phaser';

import { gameState } from './gameState';
import type { RankedShadowParityDebugState } from './rankedShadowParity';
import {
  getRankedRuntimeMode,
  getRankedWasmAvailability,
} from './rankedWasmRuntime';
import { SCENE_KEYS } from './sceneKeys';
import type { DebugFlags } from './types/index';

export interface GoldMinerDevSnapshot {
  activeScenes: string[];
  visibleScenes: string[];
  playingSoundKeys: string[];
  soundCount: number;
  currentRunLevelGroup: number | null;
  currentRunLevelId: string | null;
  currentRunTimeRemainingSec: number | null;
  highScore: number;
  highLevel: number;
  entityCount: number | null;
  gameObjectCount: number | null;
  debugOverlayVisible: boolean | null;
  gameplayLayout: {
    hudRects: {
      score: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
      status: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
    };
    minerRect: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    hookOrigin: {
      x: number;
      y: number;
    } | null;
    hookTip: {
      x: number;
      y: number;
    } | null;
  } | null;
  rankedStartStage: string | null;
  rankedStartError: string | null;
  menuRankedStartStage: string | null;
  menuRankedStartError: string | null;
  adventureCenterStage: string | null;
  rankedWasm: {
    supported: boolean;
    reason: 'available' | 'module-missing' | 'init-failed';
  };
  rankedRuntimeMode: 'shadow' | 'authoritative';
  rankedRuntime: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number | null;
    durationMs: number | null;
    entityCount: number;
  } | null;
  rankedRuntimeFinalized: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number;
    durationMs: number;
  } | null;
  rankedShadowParity: RankedShadowParityDebugState | null;
  gameplayPauseMenuVisible: boolean;
  shopPauseMenuVisible: boolean;
  debug: DebugFlags;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getPlayingSoundKeys(game: Phaser.Game): string[] {
  const soundManager = game.sound as Phaser.Sound.BaseSoundManager & {
    sounds?: Phaser.Sound.BaseSound[];
  };

  return (soundManager.sounds ?? [])
    .filter((sound) => sound.isPlaying)
    .map((sound) => sound.key);
}

function getSoundCount(game: Phaser.Game): number {
  const soundManager = game.sound as Phaser.Sound.BaseSoundManager & {
    sounds?: Phaser.Sound.BaseSound[];
  };

  return soundManager.sounds?.length ?? 0;
}

interface GameplaySceneDevShape extends Phaser.Scene {
  entities?: Array<{ isActive: boolean }>;
  children: Phaser.GameObjects.DisplayList;
  getGameplayLayoutSnapshot?: () => GoldMinerDevSnapshot['gameplayLayout'];
  rankedDiamondRushController?: {
    getShadowParityDebugState?: () => RankedShadowParityDebugState;
    getAuthoritativeDebugState?: () => GoldMinerDevSnapshot['rankedRuntime'];
  } | null;
  presentationController?: {
    isCollisionDebugVisible?: () => boolean;
  } | null;
  isPauseMenuVisible?: () => boolean;
}

interface RankedSceneDevShape extends Phaser.Scene {
  rankedStartStage?: string | null;
  rankedStartError?: string | null;
}

interface MenuSceneDevShape extends Phaser.Scene {
  rankedQuickStartStage?: string | null;
  rankedQuickStartError?: string | null;
}

interface AdventureCenterSceneDevShape extends Phaser.Scene {
  preparedCampaign?: { campaignId: string } | null;
  actionInFlight?: boolean;
}

interface ShopSceneDevShape extends Phaser.Scene {
  isPauseMenuVisible?: () => boolean;
}

function getGameplaySnapshot(
  game: Phaser.Game,
): Pick<
  GoldMinerDevSnapshot,
  'entityCount' | 'gameObjectCount' | 'debugOverlayVisible' | 'gameplayLayout'
  | 'rankedShadowParity' | 'rankedRuntime'
> {
  if (!game.scene.isActive(SCENE_KEYS.Gameplay)) {
    return {
      entityCount: null,
      gameObjectCount: null,
      debugOverlayVisible: null,
      gameplayLayout: null,
      rankedRuntime: null,
      rankedShadowParity: null,
    };
  }

  const gameplayScene = game.scene.getScene(
    SCENE_KEYS.Gameplay,
  ) as GameplaySceneDevShape;

  return {
    entityCount:
      gameplayScene.entities?.filter((entity) => entity.isActive).length ?? 0,
    gameObjectCount: gameplayScene.children.list.length,
    debugOverlayVisible:
      gameplayScene.presentationController?.isCollisionDebugVisible?.() ?? false,
    gameplayLayout: gameplayScene.getGameplayLayoutSnapshot?.() ?? null,
    rankedRuntime:
      gameplayScene.rankedDiamondRushController?.getAuthoritativeDebugState?.() ?? null,
    rankedShadowParity:
      gameplayScene.rankedDiamondRushController?.getShadowParityDebugState?.() ?? null,
  };
}

export function attachGoldMinerDevtools(game: Phaser.Game): void {
  if (!import.meta.env.DEV) {
    return;
  }

  window.__goldMinerDev = {
    snapshot: (): GoldMinerDevSnapshot => {
      const snapshot = gameState.snapshot;
      const activeScenes = game.scene
        .getScenes(true)
        .map((scene) => scene.scene.key);
      const visibleScenes = game.scene
        .getScenes(true)
        .filter((scene) => scene.scene.settings.visible)
        .map((scene) => scene.scene.key);
      const playingSoundKeys = getPlayingSoundKeys(game);
      const soundCount = getSoundCount(game);
      const gameplaySnapshot = getGameplaySnapshot(game);
      const rankedScene = game.scene.isActive(SCENE_KEYS.Ranked)
        ? (game.scene.getScene(SCENE_KEYS.Ranked) as RankedSceneDevShape)
        : null;
      const menuScene = game.scene.isActive(SCENE_KEYS.Menu)
        ? (game.scene.getScene(SCENE_KEYS.Menu) as MenuSceneDevShape)
        : null;
      const adventureCenterScene = game.scene.isActive(SCENE_KEYS.AdventureCenter)
        ? (game.scene.getScene(SCENE_KEYS.AdventureCenter) as AdventureCenterSceneDevShape)
        : null;
      const gameplayScene = game.scene.isActive(SCENE_KEYS.Gameplay)
        ? (game.scene.getScene(SCENE_KEYS.Gameplay) as GameplaySceneDevShape)
        : null;
      const shopScene = game.scene.isActive(SCENE_KEYS.Shop)
        ? (game.scene.getScene(SCENE_KEYS.Shop) as ShopSceneDevShape)
        : null;

      return {
        activeScenes: uniqueSorted(activeScenes),
        visibleScenes: uniqueSorted(visibleScenes),
        playingSoundKeys: uniqueSorted(playingSoundKeys),
        soundCount,
        currentRunLevelGroup: snapshot.currentRun?.levelGroup ?? null,
        currentRunLevelId: snapshot.currentRun?.levelId ?? null,
        currentRunTimeRemainingSec: snapshot.currentRun?.timeRemainingSec ?? null,
        highScore: snapshot.save.highScore,
        highLevel: snapshot.save.highLevel,
        entityCount: gameplaySnapshot.entityCount,
        gameObjectCount: gameplaySnapshot.gameObjectCount,
        debugOverlayVisible: gameplaySnapshot.debugOverlayVisible,
        gameplayLayout: gameplaySnapshot.gameplayLayout,
        rankedStartStage: rankedScene?.rankedStartStage ?? null,
        rankedStartError: rankedScene?.rankedStartError ?? null,
        menuRankedStartStage: menuScene?.rankedQuickStartStage ?? null,
        menuRankedStartError: menuScene?.rankedQuickStartError ?? null,
        adventureCenterStage: adventureCenterScene?.preparedCampaign
          ? 'prepared-campaign'
          : adventureCenterScene?.actionInFlight
            ? 'preparing-campaign'
            : null,
        rankedWasm: getRankedWasmAvailability(),
        rankedRuntimeMode: getRankedRuntimeMode(),
        rankedRuntime: gameplaySnapshot.rankedRuntime,
        rankedRuntimeFinalized: gameState.latestRankedRuntimeFinalized,
        rankedShadowParity: gameplaySnapshot.rankedShadowParity,
        gameplayPauseMenuVisible: gameplayScene?.isPauseMenuVisible?.() ?? false,
        shopPauseMenuVisible: shopScene?.isPauseMenuVisible?.() ?? false,
        debug: { ...snapshot.debug },
      };
    },
  };
}
