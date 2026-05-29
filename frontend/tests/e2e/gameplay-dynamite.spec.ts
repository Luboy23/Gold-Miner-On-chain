import { expect, test, type Page } from '@playwright/test';

import {
  callSceneMethod,
  openGame,
  prepareCleanStorage,
  startGameplayFromGoalScene,
  waitForScene,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

async function openGameplay(page: Page): Promise<void> {
  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await startGameplayFromGoalScene(page);
  await waitForScene(page, 'GameplayScene');
}

test('plays demo-style dynamite feedback and retracts the hook empty-handed', async ({
  page,
}) => {
  await openGameplay(page);

  const result = await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    const hook = scene.hookSystem as {
      state: string;
      angleDeg: number;
      length: number;
      caughtEntity: {
        isActive: boolean;
        isCaught: boolean;
      } | null;
      hookSprite: { play: (key: string) => unknown };
      snapshot: {
        state: string;
        collisionX: number;
        collisionY: number;
        explosiveFxVisible: boolean;
        explosiveFxX: number;
        explosiveFxY: number;
      };
      syncVisuals: () => void;
    } | null;
    const minerSprite = (
      scene.presentationController as {
        getMinerSprite?: () => { anims?: { getName: () => string } } | null;
      } | null
    )?.getMinerSprite?.() ?? null;

    if (!hook) {
      throw new Error('Missing hookSystem on GameplayScene.');
    }

    const target = (scene.entities as Array<{
      type: string;
      isActive: boolean;
      isCaught: boolean;
    }>).find((entity) => entity.isActive && !entity.isCaught && entity.type !== 'TNT');

    if (!target) {
      throw new Error('Missing active catch target in gameplay scene.');
    }

    scene.run = {
      ...(scene.run as Record<string, unknown>),
      dynamiteCount: 1,
    };

    hook.state = 'returning-loaded';
    hook.angleDeg = 18;
    hook.length = 84;
    hook.caughtEntity = target;
    hook.hookSprite.play('hook.grab-normal');
    hook.syncVisuals();

    const beforeBlast = {
      x: hook.snapshot.collisionX,
      y: hook.snapshot.collisionY,
    };
    const used = (scene.tryUseDynamite as (() => boolean)).call(scene);
    const after = hook.snapshot;
    const minerAnimation = minerSprite?.anims?.getName();

    return {
      used,
      hookState: after.state,
      minerAnimation,
      dynamiteCount: (scene.run as { dynamiteCount: number }).dynamiteCount,
      targetActive: target.isActive,
      targetCaught: target.isCaught,
      explosiveFxVisible: after.explosiveFxVisible,
      blastDistance: Math.hypot(
        after.explosiveFxX - beforeBlast.x,
        after.explosiveFxY - beforeBlast.y,
      ),
    };
  });

  expect(result.used).toBe(true);
  expect(result.hookState).toBe('returning-empty');
  expect(result.minerAnimation).toBe('miner.use-dynamite');
  expect(result.dynamiteCount).toBe(0);
  expect(result.targetActive).toBe(false);
  expect(result.targetCaught).toBe(false);
  expect(result.explosiveFxVisible).toBe(true);
  expect(result.blastDistance).toBeLessThan(0.01);

  await page.waitForFunction(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      return false;
    }

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    return (scene.hookSystem as { snapshot: { state: string } }).snapshot.state === 'swinging';
  });

  await page.waitForFunction(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      return false;
    }

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    const animation = (
      (scene.presentationController as {
        getMinerSprite?: () => { anims?: { getName: () => string } } | null;
      } | null)?.getMinerSprite?.() ?? null
    )?.anims?.getName();
    return animation !== 'miner.use-dynamite';
  });
});

test('does not consume dynamite or play the effect when nothing is caught', async ({
  page,
}) => {
  await openGameplay(page);

  const result = await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    const hook = scene.hookSystem as {
      state: string;
      length: number;
      caughtEntity: unknown;
      snapshot: {
        state: string;
        explosiveFxVisible: boolean;
      };
      syncVisuals: () => void;
    } | null;
    const minerSprite = (
      scene.presentationController as {
        getMinerSprite?: () => { anims?: { getName: () => string } } | null;
      } | null
    )?.getMinerSprite?.() ?? null;

    if (!hook) {
      throw new Error('Missing hookSystem on GameplayScene.');
    }

    scene.run = {
      ...(scene.run as Record<string, unknown>),
      dynamiteCount: 1,
    };

    hook.state = 'swinging';
    hook.length = 0;
    hook.caughtEntity = null;
    hook.syncVisuals();

    const used = (scene.tryUseDynamite as (() => boolean)).call(scene);
    const minerAnimation = minerSprite?.anims?.getName();

    return {
      used,
      hookState: hook.snapshot.state,
      minerAnimation,
      dynamiteCount: (scene.run as { dynamiteCount: number }).dynamiteCount,
      explosiveFxVisible: hook.snapshot.explosiveFxVisible,
    };
  });

  expect(result.used).toBe(false);
  expect(result.hookState).toBe('swinging');
  expect(result.minerAnimation).not.toBe('miner.use-dynamite');
  expect(result.dynamiteCount).toBe(1);
  expect(result.explosiveFxVisible).toBe(false);
});
