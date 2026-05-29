import { test } from '@playwright/test';

import {
  callSceneMethod,
  expectNoGoalMusic,
  expectOnlyActiveScene,
  openGame,
  prepareCleanStorage,
  waitForScene,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('returns cleanly to menu after 5 restart loops', async ({ page }) => {
  await openGame(page);

  for (let cycle = 1; cycle <= 5; cycle += 1) {
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
    await expectOnlyActiveScene(page, 'MenuScene');
    await expectNoGoalMusic(page);
  }
});
