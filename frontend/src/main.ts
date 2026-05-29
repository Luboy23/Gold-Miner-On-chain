import Phaser from 'phaser';

import './style.css';
import { GAME_CONFIG } from './game/config';
import type { DebugFlags } from './game/types';

declare global {
  interface Window {
    __goldMinerGame?: Phaser.Game;
    __goldMinerDev?: {
      snapshot: () => {
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
        debug: DebugFlags;
      };
    };
    __goldMinerResultPayload?: unknown;
  }
}

const container = document.querySelector<HTMLDivElement>('#app');

if (!container) {
  throw new Error('Missing #app container for Phaser bootstrap.');
}

const game = new Phaser.Game(GAME_CONFIG);

if (import.meta.env.DEV) {
  window.__goldMinerGame = game;
  void import('./game/devtools').then(({ attachGoldMinerDevtools }) => {
    attachGoldMinerDevtools(game);
  });
}
