import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  installMockWallet,
  mockAdventureCenterApi,
  openGame,
  prepareCleanStorage,
  snapshot,
  waitForScene,
  waitForSceneExit,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('returns casual shop to menu from the pause menu', async ({ page }) => {
  await openGame(page, '?forceGoalReached=1&muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');
  await waitForScene(page, 'ShopScene');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { shopPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().shopPauseMenuVisible === true;
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MenuScene');
});

test('returns campaign shop to adventure center from the pause menu', async ({
  page,
}) => {
  await installMockWallet(page, 'success');
  await mockAdventureCenterApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { adventureCenterStage: string | null } };
    }).__goldMinerDev;
    return devtools?.snapshot().adventureCenterStage === 'prepared-campaign';
  });
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await callSceneMethod(page, 'GameplayScene', 'forceCurrentLevelGoalReached');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');
  await waitForScene(page, 'ShopScene');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { shopPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().shopPauseMenuVisible === true;
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
});

test('restarts from shop pause menu back into the previous gameplay level', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await callSceneMethod(page, 'GameplayScene', 'forceCurrentLevelGoalReached');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');
  await waitForScene(page, 'ShopScene');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { shopPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().shopPauseMenuVisible === true;
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelGroup).toBe(1);
});
