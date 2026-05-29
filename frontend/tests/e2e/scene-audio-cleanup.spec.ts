import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  expectNoGoalMusic,
  openGame,
  prepareCleanStorage,
  snapshot,
  waitForScene,
  waitForSceneExit,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('cleans up scenes and goal music across the visible loop', async ({
  page,
}) => {
  await openGame(page, '?forceGoalReached=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.playingSoundKeys).toEqual(['goal']);

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await expectNoGoalMusic(page);

  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.playingSoundKeys).toEqual(['madeGoal']);

  await waitForScene(page, 'ShopScene');
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['ShopScene']);
  expect(state.visibleScenes).toEqual(['ShopScene']);
  expect(state.currentRunLevelGroup).toBe(2);
  await expectNoGoalMusic(page);

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
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
  await expectNoGoalMusic(page);
  expect(state.visibleScenes).toEqual(['MenuScene']);
});

test('stops goal music when GoalScene auto-advances without manual input', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?forceGoalReached=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.playingSoundKeys).toEqual(['goal']);

  await waitForScene(page, 'GameplayScene');
  await expectNoGoalMusic(page);

  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.playingSoundKeys).toEqual(['madeGoal']);

  await waitForScene(page, 'ShopScene');
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['ShopScene']);
  expect(state.visibleScenes).toEqual(['ShopScene']);
  await expectNoGoalMusic(page);
});
