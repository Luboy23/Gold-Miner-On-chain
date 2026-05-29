import { expect, test, type Page } from '@playwright/test';

import {
  callSceneMethod,
  clickNamedSceneEntry,
  focusGameCanvas,
  getGoalSceneCountdownState,
  getNamedSceneBounds,
  getSceneTextEntries,
  openGame,
  prepareCleanStorage,
  simulateBackgroundElapsed,
  snapshot,
  waitForScene,
  waitForSceneExit,
} from './helpers';

type BoundsEntry = Awaited<ReturnType<typeof getNamedSceneBounds>>[number];

const CASUAL_GOAL_NAMES = [
  'goal.casual.panel',
  'goal.casual.headline',
  'goal.casual.primary',
  'goal.casual.level',
  'goal.casual.hint',
] as const;
const CASUAL_GOAL_MIN_SAFE_MARGIN = 7.5;

function boundsByName(
  entries: Awaited<ReturnType<typeof getNamedSceneBounds>>,
): Map<string, BoundsEntry> {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

function expectVisibleEntry(
  entries: Map<string, BoundsEntry>,
  name: string,
): BoundsEntry {
  const entry = entries.get(name);
  expect(entry, `Missing named goal layout entry ${name}`).toBeDefined();
  expect(entry?.visible, `${name} should be visible`).toBe(true);
  expect(entry?.alpha ?? 0, `${name} should have alpha`).toBeGreaterThan(0);
  return entry as BoundsEntry;
}

function expectCenteredCasualGoalLayout(
  entries: Awaited<ReturnType<typeof getNamedSceneBounds>>,
): void {
  const indexed = boundsByName(entries);
  const panel = expectVisibleEntry(indexed, 'goal.casual.panel');
  const textEntries = CASUAL_GOAL_NAMES.slice(1).map((name) =>
    expectVisibleEntry(indexed, name),
  );

  const minY = Math.min(...textEntries.map((entry) => entry.y));
  const maxY = Math.max(
    ...textEntries.map((entry) => entry.y + entry.height),
  );
  const stackCenterY = (minY + maxY) / 2;
  const panelCenterY = panel.y + panel.height / 2;
  const topMargin = minY - panel.y;
  const bottomMargin = panel.y + panel.height - maxY;

  expect(Math.abs(stackCenterY - panelCenterY)).toBeLessThanOrEqual(2);
  expect(topMargin).toBeGreaterThanOrEqual(CASUAL_GOAL_MIN_SAFE_MARGIN);
  expect(bottomMargin).toBeGreaterThanOrEqual(CASUAL_GOAL_MIN_SAFE_MARGIN);
}

function visibleTexts(
  entries: Awaited<ReturnType<typeof getSceneTextEntries>>,
): string[] {
  return entries
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);
}

function expectTextVisible(
  texts: string[],
  expected: string,
): void {
  expect(texts, `Expected GoalScene text "${expected}" to be visible.`).toContain(expected);
}

async function waitForGoalCountdownState(
  page: Page,
  remainingSec: 1 | 2 | 3,
  expectedHintText: string,
  timeout = 2200,
): Promise<void> {
  await expect
    .poll(() => getGoalSceneCountdownState(page), { timeout })
    .toMatchObject({
      remainingSec,
      hintText: expectedHintText,
    });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('centers next-goal casual copy inside the panel', async ({ page }) => {
  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  const entries = await getNamedSceneBounds(page, 'GoalScene');
  expectCenteredCasualGoalLayout(entries);
});

test('centers level-clear casual copy inside the panel', async ({ page }) => {
  await openGame(page, '?forceGoalReached=1&muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  const entries = await getNamedSceneBounds(page, 'GoalScene');
  expectCenteredCasualGoalLayout(entries);

  const texts = visibleTexts(await getSceneTextEntries(page, 'GoalScene'));
  expect(texts).toContain('进入下一关');
  expect(texts).not.toContain('进入\n下一关');
});

test('auto-advances next-goal after the 3 second countdown', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  expectTextVisible(
    visibleTexts(await getSceneTextEntries(page, 'GoalScene')),
    '3秒后自动进入下一关，点击面板或按回车可立即进入',
  );

  await waitForGoalCountdownState(
    page,
    2,
    '2秒后自动进入下一关，点击面板或按回车可立即进入',
  );

  await waitForGoalCountdownState(
    page,
    1,
    '1秒后自动进入下一关，点击面板或按回车可立即进入',
    2200,
  );

  await waitForScene(page, 'GameplayScene');
});

test('auto-advances level-clear to the shop after the 3 second countdown', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?forceGoalReached=1&muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  expectTextVisible(
    visibleTexts(await getSceneTextEntries(page, 'GoalScene')),
    '3秒后自动进入商店，点击面板或按回车可立即进入',
  );

  await waitForGoalCountdownState(
    page,
    2,
    '2秒后自动进入商店，点击面板或按回车可立即进入',
  );

  await waitForGoalCountdownState(
    page,
    1,
    '1秒后自动进入商店，点击面板或按回车可立即进入',
    2200,
  );

  await waitForScene(page, 'ShopScene');
});

test('pressing Enter still skips next-goal immediately without a delayed second transition', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await page.waitForTimeout(3300);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
});

test('clicking the casual goal panel skips next-goal immediately without a delayed second transition', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await clickNamedSceneEntry(page, 'GoalScene', 'goal.casual.panel');
  await waitForScene(page, 'GameplayScene');
  await page.waitForTimeout(3300);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
});

test('pressing Enter still skips level-clear immediately without a delayed second transition', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?forceGoalReached=1&muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'ShopScene');
  await page.waitForTimeout(3300);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['ShopScene']);
});

test('clicking the casual goal panel skips level-clear straight to the shop', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?forceGoalReached=1&muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  await clickNamedSceneEntry(page, 'GoalScene', 'goal.casual.panel');
  await waitForScene(page, 'ShopScene');
  await page.waitForTimeout(3300);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['ShopScene']);
});

test('keeps casual time moving while the window is unfocused', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await focusGameCanvas(page);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);

  const before = await snapshot(page);
  await simulateBackgroundElapsed(page, 1_000);
  await page.waitForTimeout(50);
  const after = await snapshot(page);

  expect(before.currentRunTimeRemainingSec).not.toBeNull();
  expect(after.currentRunTimeRemainingSec).not.toBeNull();
  expect(after.currentRunTimeRemainingSec!).toBeLessThan(
    before.currentRunTimeRemainingSec!,
  );
  expect(before.gameplayLayout?.hookTip).not.toBeNull();
  expect(after.gameplayLayout?.hookTip).not.toBeNull();
  expect(after.gameplayLayout?.hookTip).not.toEqual(before.gameplayLayout?.hookTip);
  expect(after.activeScenes).toEqual(['GameplayScene']);
});

test('pressing Space in the shop skips directly to the next goal', async ({
  page,
}) => {
  test.slow();

  await openGame(page, '?forceGoalReached=1&muteAudio=1');
  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');
  await waitForSceneExit(page, 'GameplayScene');
  await waitForScene(page, 'GoalScene');

  await page.keyboard.press('Enter');
  await waitForScene(page, 'ShopScene');

  await page.keyboard.press('Space');
  await waitForScene(page, 'GoalScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
});
