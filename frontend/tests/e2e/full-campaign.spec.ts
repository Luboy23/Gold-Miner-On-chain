import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  expectNoGoalMusic,
  installMockWallet,
  mockAdventureCenterApi,
  openGame,
  prepareCleanStorage,
  readCurrentRun,
  snapshot,
  waitForScene,
  waitForSceneExit,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('runs the full L1-L10 campaign with forceGoalReached', async ({ page }) => {
  await openGame(page, '?forceGoalReached=1&muteAudio=1');

  const menuState = await snapshot(page);
  expect(menuState.debug.forceGoalReached).toBe(true);
  expect(menuState.debug.muteAudio).toBe(true);

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  for (let levelGroup = 1; levelGroup <= 10; levelGroup += 1) {
    const goalState = await snapshot(page);
    expect(goalState.currentRunLevelGroup).toBe(levelGroup);

    await page.keyboard.press('Enter');
    await waitForScene(page, 'GameplayScene');
    await waitForSceneExit(page, 'GameplayScene');

    if (levelGroup < 10) {
      await waitForScene(page, 'GoalScene');
      const levelClearState = await snapshot(page);
      expect(levelClearState.currentRunLevelGroup).toBe(levelGroup + 1);

      await page.keyboard.press('Enter');
      await waitForScene(page, 'ShopScene');
      await expectNoGoalMusic(page);

      await page.keyboard.press('Space');
      await waitForScene(page, 'GoalScene');
    } else {
      await waitForScene(page, 'ResultScene');
      break;
    }
  }

  const resultState = await snapshot(page);
  expect(resultState.activeScenes).toEqual(['ResultScene']);
  await expectNoGoalMusic(page);
});

test('records campaign evidence with post-purchase level baselines before sync', async ({ page }) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await openGame(page, '?forceGoalReached=1&muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => {
      const dev = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => { adventureCenterStage: string | null } };
      }).__goldMinerDev;
      return dev?.snapshot().adventureCenterStage === 'prepared-campaign';
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'ShopScene');
  await page.keyboard.press('Enter');
  const postPurchaseRun = (await readCurrentRun(page)) as {
    score: number;
    campaignContext?: {
      levelStartScore: number;
      purchases: Array<{
        shopLevelGroup: number;
        itemId: string;
        price: number;
      }>;
    };
  } | null;
  expect(postPurchaseRun).toBeTruthy();
  expect(postPurchaseRun?.campaignContext).toBeTruthy();
  expect(postPurchaseRun?.campaignContext?.purchases.length).toBe(1);
  expect(postPurchaseRun?.campaignContext?.purchases[0]?.shopLevelGroup).toBe(2);
  expect(postPurchaseRun?.campaignContext?.levelStartScore).toBe(postPurchaseRun?.score);

  const postPurchaseScore = postPurchaseRun?.score ?? 0;
  await page.keyboard.press('Space');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  const currentRun = await readCurrentRun(page);

  expect(currentRun).toBeTruthy();

  const campaignContext = (currentRun as {
    score: number;
    campaignContext?: {
      completedLevels: Array<{
        levelGroup: number;
        scoreDelta: number;
        cleared: boolean;
      }>;
      purchases: Array<{
        shopLevelGroup: number;
        itemId: string;
        price: number;
      }>;
      levelStartScore: number;
    };
  }).campaignContext;

  expect(campaignContext).toBeTruthy();
  expect(campaignContext?.purchases.length).toBe(1);
  expect(campaignContext?.purchases[0]?.shopLevelGroup).toBe(2);
  expect(campaignContext?.completedLevels.length).toBe(2);
  expect(campaignContext?.completedLevels[0]?.scoreDelta).toBeGreaterThan(0);
  expect(campaignContext?.completedLevels[1]?.scoreDelta).toBeGreaterThan(0);
  expect(campaignContext?.completedLevels[1]?.scoreDelta).toBe(
    (currentRun as { score: number }).score - postPurchaseScore,
  );
});
