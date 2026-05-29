import { test } from '@playwright/test';

import {
  callSceneMethod,
  expectSceneTextMetrics,
  expectUiFontsReady,
  openGame,
  prepareCleanStorage,
  startGameplayFromGoalScene,
  waitForScene,
  waitForSceneExit,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('applies shared text metrics across menu, ranked, goal, gameplay, and result scenes', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await expectUiFontsReady(page);
  await expectSceneTextMetrics(page, 'MenuScene');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');
  await expectSceneTextMetrics(page, 'RankedScene');

  await page.keyboard.press('Escape');
  await waitForScene(page, 'MenuScene');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await expectSceneTextMetrics(page, 'GoalScene');

  await startGameplayFromGoalScene(page);
  await waitForScene(page, 'GameplayScene');
  await expectSceneTextMetrics(page, 'GameplayScene');

  await callSceneMethod(page, 'GameplayScene', 'failRun');
  await waitForScene(page, 'ResultScene');
  await expectSceneTextMetrics(page, 'ResultScene');
});

test('applies shared text metrics inside the shop scene', async ({ page }) => {
  await openGame(page, '?forceGoalReached=1&muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');

  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'ShopScene');
  await expectSceneTextMetrics(page, 'ShopScene');

  await page.keyboard.press('Escape');
  await expectSceneTextMetrics(page, 'ShopScene');
});
