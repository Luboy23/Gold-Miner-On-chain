import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  getSceneTextEntries,
  installMockWallet,
  mockAdventureCenterApi,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  snapshot,
  waitForScene,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('pauses casual gameplay while the pause menu is open and resumes on cancel', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  await page.waitForTimeout(200);
  const before = await snapshot(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { gameplayPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().gameplayPauseMenuVisible === true;
  });

  await page.waitForTimeout(1200);
  const paused = await snapshot(page);
  expect(paused.activeScenes).toEqual(['GameplayScene']);
  expect(paused.gameplayPauseMenuVisible).toBe(true);
  expect(paused.currentRunTimeRemainingSec).not.toBeNull();
  expect(before.currentRunTimeRemainingSec).not.toBeNull();
  expect(
    Math.abs(
      (paused.currentRunTimeRemainingSec ?? 0) -
        (before.currentRunTimeRemainingSec ?? 0),
    ),
  ).toBeLessThanOrEqual(1 / 60);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { gameplayPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().gameplayPauseMenuVisible === false;
  });

  await page.waitForTimeout(400);
  const resumed = await snapshot(page);
  expect(resumed.activeScenes).toEqual(['GameplayScene']);
  expect(resumed.currentRunTimeRemainingSec).not.toBeNull();
  expect(resumed.currentRunTimeRemainingSec!).toBeLessThan(paused.currentRunTimeRemainingSec!);
});

test('returns campaign gameplay to adventure center with a status message after confirming exit', async ({
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
  await waitForScene(page, 'AdventureCenterScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
  const texts = (await getSceneTextEntries(page, 'AdventureCenterScene'))
    .filter((entry) => entry.visible && entry.alpha > 0)
    .map((entry) => entry.text);
  expect(texts).toContain('已退出本次冒险');
});

test('returns ranked gameplay to ranked center with a status message after confirming exit', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');
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
  await waitForScene(page, 'RankedScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['RankedScene']);
  const texts = (await getSceneTextEntries(page, 'RankedScene'))
    .filter((entry) => entry.visible && entry.alpha > 0)
    .map((entry) => entry.text);
  expect(texts).toContain('已退出本次挑战');
});

test('returns casual gameplay to menu from the pause menu', async ({ page }) => {
  await openGame(page, '?muteAudio=1');

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
});

test('restarts casual gameplay from the pause menu', async ({ page }) => {
  await openGame(page, '?muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await page.waitForTimeout(400);
  const beforeRestart = await snapshot(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => { gameplayPauseMenuVisible: boolean } };
    }).__goldMinerDev;
    return devtools?.snapshot().gameplayPauseMenuVisible === true;
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await page.waitForTimeout(200);

  const afterRestart = await snapshot(page);
  expect(afterRestart.activeScenes).toEqual(['GameplayScene']);
  expect(afterRestart.currentRunLevelId).toBe(beforeRestart.currentRunLevelId);
  expect(afterRestart.currentRunTimeRemainingSec).not.toBeNull();
  expect(beforeRestart.currentRunTimeRemainingSec).not.toBeNull();
  expect(afterRestart.currentRunTimeRemainingSec!).toBeGreaterThanOrEqual(
    beforeRestart.currentRunTimeRemainingSec!,
  );
});
