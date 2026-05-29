import { expect, test } from '@playwright/test';

import {
  configureRankedSceneLayoutFixture,
  getNamedSceneBounds,
  getSceneTextEntries,
  openGame,
  prepareCleanStorage,
  waitForScene,
} from './helpers';

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function right(bounds: Bounds): number {
  return bounds.x + bounds.width;
}

function bottom(bounds: Bounds): number {
  return bounds.y + bounds.height;
}

function overlaps(left: Bounds, rightBounds: Bounds): boolean {
  return !(
    right(left) <= rightBounds.x ||
    right(rightBounds) <= left.x ||
    bottom(left) <= rightBounds.y ||
    bottom(rightBounds) <= left.y
  );
}

function expectInside(child: Bounds, parent: Bounds, padding = 0): void {
  expect(child.x).toBeGreaterThanOrEqual(parent.x + padding);
  expect(child.y).toBeGreaterThanOrEqual(parent.y + padding);
  expect(right(child)).toBeLessThanOrEqual(right(parent) - padding);
  expect(bottom(child)).toBeLessThanOrEqual(bottom(parent) - padding);
}

function expectInsideWithTolerance(
  child: Bounds,
  parent: Bounds,
  tolerance = 1,
): void {
  expect(child.x).toBeGreaterThanOrEqual(parent.x - tolerance);
  expect(child.y).toBeGreaterThanOrEqual(parent.y - tolerance);
  expect(right(child)).toBeLessThanOrEqual(right(parent) + tolerance);
  expect(bottom(child)).toBeLessThanOrEqual(bottom(parent) + tolerance);
}

function toBoundsMap(entries: Array<Bounds & { name: string }>): Record<string, Bounds> {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
      },
    ]),
  );
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('keeps the rebuilt ranked challenge layout contained and visually centered on two primary board modules', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');

  await configureRankedSceneLayoutFixture(page);

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'RankedScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const requiredNames = [
    'ranked.header.panel',
    'ranked.header.best',
    'ranked.board.leaderboard.panel',
    'ranked.board.history.panel',
    'ranked.board.leaderboard.empty',
    'ranked.board.history.empty',
    'ranked.status.banner',
    'ranked.actions.start',
    'ranked.actions.back',
  ];

  requiredNames.forEach((name) => {
    expect(bounds[name], `missing bounds for ${name}`).toBeDefined();
  });

  expect(bounds['ranked.summary.panel']).toBeUndefined();
  expect(bounds['ranked.summary.rules']).toBeUndefined();
  expect(bounds['ranked.summary.champion']).toBeUndefined();
  expect(bounds['ranked.tabs.leaderboard']).toBeUndefined();
  expect(bounds['ranked.tabs.history']).toBeUndefined();

  const headerPanel = { x: 16, y: 10, width: 288, height: 28 };
  const leaderboardPanel = { x: 160, y: 46, width: 144, height: 74 };
  const historyPanel = { x: 160, y: 124, width: 144, height: 74 };
  const statusPanel = { x: 16, y: 202, width: 288, height: 12 };
  const actionDock = { x: 16, y: 220, width: 288, height: 20 };

  expectInsideWithTolerance(bounds['ranked.header.best'], headerPanel, 2);
  expectInside(bounds['ranked.board.leaderboard.empty'], leaderboardPanel, 6);
  expectInside(bounds['ranked.board.history.empty'], historyPanel, 6);
  expectInsideWithTolerance(bounds['ranked.status.banner'], statusPanel, 1);
  expectInside(bounds['ranked.actions.start'], actionDock, 0);
  expectInside(bounds['ranked.actions.back'], actionDock, 0);

  expect(overlaps(bounds['ranked.board.leaderboard.panel'], bounds['ranked.board.history.panel'])).toBe(false);
  expect(overlaps(bounds['ranked.board.leaderboard.panel'], actionDock)).toBe(false);
  expect(overlaps(bounds['ranked.board.history.panel'], actionDock)).toBe(false);

  expect(bounds['ranked.board.leaderboard.panel'].width).toBeCloseTo(144, 0);
  expect(bounds['ranked.board.history.panel'].width).toBeCloseTo(144, 0);
  expect(bounds['ranked.board.leaderboard.panel'].x).toBeCloseTo(
    bounds['ranked.board.history.panel'].x,
    0,
  );
  expect(bounds['ranked.actions.start'].width).toBe(134);
  expect(bounds['ranked.actions.back'].width).toBe(148);

  const texts = await getSceneTextEntries(page, 'RankedScene');
  const visibleTexts = texts.filter((entry) => entry.visible).map((entry) => entry.text);

  expect(visibleTexts).toContain('排位中心');
  expect(visibleTexts).toContain('排行榜 前 5 名');
  expect(visibleTexts).toContain('我的最近 5 局');
  expect(visibleTexts).toContain('首个上榜成绩等你来打');
  expect(visibleTexts).toContain('打出有效成绩即可上榜');
  expect(visibleTexts).toContain('开始第一局挑战');

  expect(visibleTexts).not.toContain('60秒钻石冲榜');
  expect(visibleTexts).not.toContain('已连接');
  expect(visibleTexts).not.toContain('可挑战');
  expect(visibleTexts).not.toContain('待开榜');
});

test('keeps ranked leaderboard and recent-run rows contained and readable when data is present', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');

  await configureRankedSceneLayoutFixture(page);

  await page.evaluate(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const rankedScene = game.scene.getScene('RankedScene') as {
      leaderboard?: Array<{ result: { diamondsCaught: number; lastDiamondAtMs: number } }>;
      history?: Array<{ result: { diamondsCaught: number; lastDiamondAtMs: number } }>;
      refreshView?: (state: unknown) => void;
    };

    rankedScene.leaderboard = [
      { result: { diamondsCaught: 5, lastDiamondAtMs: 10900 } },
      { result: { diamondsCaught: 4, lastDiamondAtMs: 12100 } },
      { result: { diamondsCaught: 4, lastDiamondAtMs: 13800 } },
      { result: { diamondsCaught: 3, lastDiamondAtMs: 14100 } },
      { result: { diamondsCaught: 3, lastDiamondAtMs: 15700 } },
    ];
    rankedScene.history = [
      { result: { diamondsCaught: 4, lastDiamondAtMs: 11600 } },
      { result: { diamondsCaught: 3, lastDiamondAtMs: 12200 } },
      { result: { diamondsCaught: 3, lastDiamondAtMs: 14500 } },
      { result: { diamondsCaught: 2, lastDiamondAtMs: 16300 } },
      { result: { diamondsCaught: 1, lastDiamondAtMs: 18900 } },
    ];

    rankedScene.refreshView?.(web3State.snapshot);
  });

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'RankedScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const leaderboardPanel = bounds['ranked.board.leaderboard.panel'];
  const historyPanel = bounds['ranked.board.history.panel'];

  expect(leaderboardPanel).toBeDefined();
  expect(historyPanel).toBeDefined();
  expect(bounds['ranked.board.leaderboard.empty']).toBeUndefined();
  expect(bounds['ranked.board.history.empty']).toBeUndefined();

  for (let index = 0; index < 5; index += 1) {
    const leaderboardRow = bounds[`ranked.board.leaderboard.row.${index}`];
    const historyRow = bounds[`ranked.board.history.row.${index}`];

    expect(leaderboardRow, `missing leaderboard row ${index}`).toBeDefined();
    expect(historyRow, `missing history row ${index}`).toBeDefined();
    expect(leaderboardRow!.x).toBeGreaterThanOrEqual(leaderboardPanel.x + 8);
    expect(right(leaderboardRow!)).toBeLessThanOrEqual(right(leaderboardPanel) - 8);
    expect(leaderboardRow!.y).toBeGreaterThanOrEqual(leaderboardPanel.y + 24);
    expect(bottom(leaderboardRow!)).toBeLessThanOrEqual(bottom(leaderboardPanel));
    expect(historyRow!.x).toBeGreaterThanOrEqual(historyPanel.x + 8);
    expect(right(historyRow!)).toBeLessThanOrEqual(right(historyPanel) - 8);
    expect(historyRow!.y).toBeGreaterThanOrEqual(historyPanel.y + 24);
    expect(bottom(historyRow!)).toBeLessThanOrEqual(bottom(historyPanel));
    expect(leaderboardRow!.height).toBeGreaterThanOrEqual(9);
    expect(historyRow!.height).toBeGreaterThanOrEqual(9);
  }

  const visibleTexts = (await getSceneTextEntries(page, 'RankedScene'))
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('#1');
  expect(visibleTexts).toContain('5 钻');
  expect(visibleTexts).toContain('10.9s');
  expect(visibleTexts).toContain('18.9s');
});
