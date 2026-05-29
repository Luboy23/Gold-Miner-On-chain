import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  expectNoGoalMusic,
  openGame,
  prepareCleanStorage,
  readSaveData,
  snapshot,
  waitForScene,
  waitForSceneExit,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('@long-play keeps gameplay stable during an extended idle session', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await openGame(page, '?level=L8&infiniteTime=1&showHitCircles=1&muteAudio=1');

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await page.waitForTimeout(2600);

  const initialState = await snapshot(page);
  expect(initialState.currentRunLevelId).toBe('L8');
  expect(initialState.debug.infiniteTime).toBe(true);
  expect(initialState.debugOverlayVisible).toBe(true);
  expect(initialState.entityCount).toBeGreaterThan(0);
  expect(initialState.gameObjectCount).toBeGreaterThan(0);

  await page.waitForTimeout(6000);

  const laterState = await snapshot(page);
  expect(laterState.activeScenes).toEqual(['GameplayScene']);
  expect(laterState.currentRunLevelId).toBe('L8');
  expect(laterState.entityCount).toBe(initialState.entityCount);
  expect(laterState.gameObjectCount).toBeLessThanOrEqual(
    initialState.gameObjectCount,
  );
  expect(initialState.gameObjectCount - laterState.gameObjectCount).toBeLessThanOrEqual(1);
  expect(laterState.debugOverlayVisible).toBe(true);
  await expectNoGoalMusic(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { gameplayPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().gameplayPauseMenuVisible === true;
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MenuScene');
});

test('@long-play keeps experience runs ephemeral across repeated win and fail loops', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await openGame(page, '?forceGoalReached=1&muteAudio=1');

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');

  for (let levelGroup = 1; levelGroup <= 10; levelGroup += 1) {
    await page.keyboard.press('Enter');
    await waitForScene(page, 'GameplayScene');
    await waitForSceneExit(page, 'GameplayScene');

    if (levelGroup < 10) {
      await waitForScene(page, 'GoalScene');
      await page.keyboard.press('Enter');
      await waitForScene(page, 'ShopScene');
      await page.keyboard.press('Space');
      await waitForScene(page, 'GoalScene');
    } else {
      await waitForScene(page, 'ResultScene');
    }
  }

  const winSave = await readSaveData(page);
  expect(winSave).toEqual({
    version: 1,
    highScore: 0,
    highLevel: 1,
    acknowledgedExperienceMode: true,
  });

  await page.keyboard.press('Enter');
  await waitForScene(page, 'MenuScene');

  await openGame(page, '?muteAudio=1');

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
    await waitForScene(page, 'GoalScene');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'GameplayScene');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const devtools = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => { gameplayPauseMenuVisible: boolean } };
      }).__goldMinerDev;
      return devtools?.snapshot().gameplayPauseMenuVisible === true;
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'MenuScene');
  }

  const finalSave = await readSaveData(page);
  expect(finalSave).toEqual({
    version: 1,
    highScore: 0,
    highLevel: 1,
    acknowledgedExperienceMode: true,
  });

  const menuState = await snapshot(page);
  expect(menuState.activeScenes).toEqual(['MenuScene']);
  await expectNoGoalMusic(page);
});
