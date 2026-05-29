import { expect, test, type Page } from '@playwright/test';

import {
  clickNamedSceneEntry,
  getNamedSceneBounds,
  getSceneTextEntries,
  openGame,
  prepareCleanStorage,
  waitForScene,
} from './helpers';

async function openResultScene(
  page: Page,
  payload: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene('MenuScene') as {
      scene?: {
        start: (key: string, payload?: Record<string, unknown>) => void;
      };
    };

    if (!menuScene.scene?.start) {
      throw new Error('MenuScene cannot start ResultScene in DEV mode.');
    }

    menuScene.scene.start('ResultScene', { result: (window as typeof window & {
      __goldMinerResultPayload?: Record<string, unknown>;
    }).__goldMinerResultPayload });
  });
  await waitForScene(page, 'ResultScene');
}

async function startMockedResultScene(
  page: Page,
  result: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((nextResult) => {
    (window as typeof window & {
      __goldMinerResultPayload?: Record<string, unknown>;
    }).__goldMinerResultPayload = nextResult;
  }, result);

  await openResultScene(page, result);
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('clicking the casual result panel returns to the menu like Enter', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'casual',
    levelGroup: 3,
    levelId: 'L3',
    goal: 1200,
    score: 980,
    reachedGoal: false,
    endedAtFinalLevel: false,
    elapsedSec: 42,
    purchasedItems: [],
    seed: 'casual-test-seed',
    caughtCount: 7,
    rankedEvidence: null,
    campaignEvidence: null,
  });

  const texts = await getSceneTextEntries(page, 'ResultScene');
  expect(
    texts.some(
      (entry) =>
        entry.visible && entry.text.includes('点击面板或按回车返回主菜单'),
    ),
  ).toBe(true);

  await clickNamedSceneEntry(page, 'ResultScene', 'result.casual.panel');
  await waitForScene(page, 'MenuScene');
});

test('clicking the campaign primary action button returns to adventure center', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'campaign',
    levelGroup: 2,
    levelId: 'L2',
    goal: 900,
    score: 1280,
    reachedGoal: true,
    endedAtFinalLevel: false,
    elapsedSec: 51,
    purchasedItems: [],
    seed: 'campaign-click-seed',
    caughtCount: 5,
    rankedEvidence: null,
    campaignEvidence: {
      protocolVersion: 2,
      simulationVersion: 1,
      campaignId:
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      campaignSeed:
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      clientBuildHash:
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      levels: [],
      purchases: [],
      finalScore: 1280,
    },
  });

  await clickNamedSceneEntry(page, 'ResultScene', 'result.actions.primary');
  await waitForScene(page, 'AdventureCenterScene');
});

test('clicking the campaign secondary action button returns to the menu and shows 第N关 labels', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'campaign',
    levelGroup: 3,
    levelId: 'L3',
    goal: 1400,
    score: 1661,
    reachedGoal: true,
    endedAtFinalLevel: false,
    elapsedSec: 59,
    purchasedItems: [],
    seed: 'campaign-label-seed',
    caughtCount: 7,
    rankedEvidence: null,
    campaignEvidence: {
      protocolVersion: 2,
      simulationVersion: 1,
      campaignId:
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      campaignSeed:
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      clientBuildHash:
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      levels: [],
      purchases: [],
      finalScore: 1661,
    },
  });

  const texts = await getSceneTextEntries(page, 'ResultScene');
  const visibleTexts = texts
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('第3关');
  expect(visibleTexts).not.toContain('L3');

  await clickNamedSceneEntry(page, 'ResultScene', 'result.actions.secondary');
  await waitForScene(page, 'MenuScene');
});

test('keeps the rebuilt campaign failed result layout contained and detail text inside the sync panel', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'campaign',
    levelGroup: 1,
    levelId: 'L1',
    goal: 600,
    score: 0,
    reachedGoal: true,
    endedAtFinalLevel: false,
    elapsedSec: 45,
    purchasedItems: [],
    seed: 'campaign-test-seed',
    caughtCount: 0,
    rankedEvidence: null,
    campaignEvidence: null,
  });

  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('ResultScene') as {
      rankedSyncStage?: string;
      rankedSyncMessage?: string;
      renderRankedResult?: () => void;
      result?: { mode?: string };
    };

    if (scene.result?.mode !== 'campaign' || !scene.renderRankedResult) {
      throw new Error('ResultScene is not in campaign mode.');
    }

    scene.rankedSyncStage = 'failed';
    scene.rankedSyncMessage = 'API request failed: 500 fetch level config for L1 v1';
    scene.renderRankedResult();
  });

  const bounds = await getNamedSceneBounds(page, 'ResultScene');
  const byName = Object.fromEntries(bounds.map((entry) => [entry.name, entry]));

  expect(byName['result.header.panel']).toBeDefined();
  expect(byName['result.header.badge']).toBeDefined();
  expect(byName['result.summary.panel']).toBeDefined();
  expect(byName['result.sync.panel']).toBeDefined();
  expect(byName['result.summary.primary']).toBeDefined();
  expect(byName['result.sync.progress']).toBeDefined();
  expect(byName['result.sync.status']).toBeDefined();
  expect(byName['result.sync.detail']).toBeDefined();
  expect(byName['result.actions.primary']).toBeDefined();
  expect(byName['result.actions.secondary']).toBeDefined();

  const summaryPanel = byName['result.summary.panel']!;
  const syncPanel = byName['result.sync.panel']!;
  const syncStatus = byName['result.sync.status']!;
  const detail = byName['result.sync.detail']!;
  const primaryAction = byName['result.actions.primary']!;
  const secondaryAction = byName['result.actions.secondary']!;

  expect(syncStatus.x).toBeGreaterThanOrEqual(syncPanel.x + 8);
  expect(syncStatus.y).toBeGreaterThanOrEqual(syncPanel.y + 8);
  expect(syncStatus.x + syncStatus.width).toBeLessThanOrEqual(
    syncPanel.x + syncPanel.width - 8,
  );
  expect(syncStatus.y + syncStatus.height).toBeLessThanOrEqual(
    syncPanel.y + syncPanel.height,
  );
  expect(detail.x).toBeGreaterThanOrEqual(syncStatus.x);
  expect(detail.y).toBeGreaterThanOrEqual(
    Math.floor(syncStatus.y + syncStatus.height - 1),
  );
  expect(detail.x + detail.width).toBeLessThanOrEqual(
    syncPanel.x + syncPanel.width - 8,
  );
  expect(detail.y + detail.height).toBeLessThanOrEqual(
    syncPanel.y + syncPanel.height,
  );
  expect(syncPanel.y).toBeGreaterThan(summaryPanel.y + summaryPanel.height - 4);
  expect(syncPanel.y + syncPanel.height).toBeLessThanOrEqual(primaryAction.y - 6);
  expect(syncPanel.y + syncPanel.height).toBeLessThanOrEqual(secondaryAction.y - 6);

  const texts = await getSceneTextEntries(page, 'ResultScene');
  const visibleTexts = texts
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('提交失败');
  expect(visibleTexts).toContain('第1关');
  expect(visibleTexts).toContain('历史记录');
  expect(visibleTexts).toContain('返回冒险中心');
  expect(visibleTexts).toContain('返回主菜单');
  expect(visibleTexts).toContain('[Esc]');
  expect(visibleTexts).toContain('提交失败，可重试');
  expect(
    visibleTexts.some((entry) =>
      entry.includes('API request failed: 500 fetch level config for L1 v1'),
    ),
  ).toBe(true);
});

test('keeps the rebuilt ranked confirmed result layout contained with sync detail and analysis hint inside their panels', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'ranked',
    levelGroup: 1,
    levelId: 'diamond_rush_60',
    goal: 0,
    score: 0,
    reachedGoal: true,
    endedAtFinalLevel: false,
    elapsedSec: 60,
    purchasedItems: [],
    seed: 'ranked-test-seed',
    caughtCount: 3,
    rankedEvidence: null,
    campaignEvidence: null,
  });

  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('ResultScene') as {
      rankedSyncStage?: string;
      rankedSyncMessage?: string;
      renderRankedResult?: () => void;
      result?: { mode?: string };
    };

    if (scene.result?.mode !== 'ranked' || !scene.renderRankedResult) {
      throw new Error('ResultScene is not in ranked mode.');
    }

    scene.rankedSyncStage = 'confirmed';
    scene.rankedSyncMessage = '排位成绩已上榜。';
    scene.renderRankedResult();
  });

  const bounds = await getNamedSceneBounds(page, 'ResultScene');
  const byName = Object.fromEntries(bounds.map((entry) => [entry.name, entry]));

  expect(byName['result.header.badge']).toBeDefined();
  expect(byName['result.summary.primary']).toBeDefined();
  expect(byName['result.summary.level']).toBeDefined();
  expect(byName['result.summary.outcome']).toBeDefined();
  expect(byName['result.sync.panel']).toBeDefined();
  expect(byName['result.sync.progress']).toBeDefined();
  expect(byName['result.sync.status']).toBeDefined();
  expect(byName['result.sync.detail']).toBeDefined();
  expect(byName['result.actions.primary']).toBeDefined();
  expect(byName['result.actions.secondary']).toBeDefined();
  expect(byName['result.analysis.panel']).toBeDefined();
  expect(byName['result.analysis.retryHint']).toBeDefined();

  const syncPanel = byName['result.sync.panel']!;
  const syncStatus = byName['result.sync.status']!;
  const detail = byName['result.sync.detail']!;
  const primaryAction = byName['result.actions.primary']!;
  const secondaryAction = byName['result.actions.secondary']!;
  const analysisPanel = byName['result.analysis.panel']!;
  const retryHint = byName['result.analysis.retryHint']!;

  expect(syncStatus.x).toBeGreaterThanOrEqual(syncPanel.x + 8);
  expect(syncStatus.y).toBeGreaterThanOrEqual(syncPanel.y + 8);
  expect(syncStatus.x + syncStatus.width).toBeLessThanOrEqual(
    syncPanel.x + syncPanel.width - 8,
  );
  expect(syncStatus.y + syncStatus.height).toBeLessThanOrEqual(
    syncPanel.y + syncPanel.height,
  );
  expect(detail.x).toBeGreaterThanOrEqual(syncPanel.x + 8);
  expect(detail.y).toBeGreaterThanOrEqual(
    Math.floor(syncStatus.y + syncStatus.height - 1),
  );
  expect(detail.x + detail.width).toBeLessThanOrEqual(
    syncPanel.x + syncPanel.width - 8,
  );
  expect(detail.y + detail.height).toBeLessThanOrEqual(
    syncPanel.y + syncPanel.height,
  );
  expect(detail.y + detail.height).toBeLessThanOrEqual(primaryAction.y - 10);
  expect(detail.y + detail.height).toBeLessThanOrEqual(secondaryAction.y - 10);
  expect(retryHint.x).toBeGreaterThanOrEqual(analysisPanel.x + 8);
  expect(retryHint.y).toBeGreaterThan(analysisPanel.y + analysisPanel.height / 2);
  expect(retryHint.x + retryHint.width).toBeLessThanOrEqual(
    analysisPanel.x + analysisPanel.width - 8,
  );
  expect(retryHint.y + retryHint.height).toBeLessThanOrEqual(
    analysisPanel.y + analysisPanel.height - 8,
  );

  const badges = bounds.filter((entry) => entry.name === 'result.header.badge');
  expect(badges).toHaveLength(1);

  const texts = await getSceneTextEntries(page, 'ResultScene');
  const visibleTexts = texts
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('排位成绩已上榜');
  expect(visibleTexts).toContain('已计入排行榜。');
  expect(visibleTexts).toContain('建议继续冲更高成绩。');
  expect(visibleTexts).toContain('[Esc]');
});

test('keeps the rebuilt campaign confirmed result layout contained with detail text inside the sync panel', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await startMockedResultScene(page, {
    mode: 'campaign',
    levelGroup: 1,
    levelId: 'L1',
    goal: 600,
    score: 500,
    reachedGoal: true,
    endedAtFinalLevel: false,
    elapsedSec: 60,
    purchasedItems: [],
    seed: 'campaign-confirmed-seed',
    caughtCount: 1,
    rankedEvidence: null,
    campaignEvidence: {
      protocolVersion: 2,
      simulationVersion: 1,
      campaignId:
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      campaignSeed:
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      clientBuildHash:
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      levels: [],
      purchases: [],
      finalScore: 500,
    },
  });

  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('ResultScene') as {
      rankedSyncStage?: string;
      rankedSyncMessage?: string;
      renderRankedResult?: () => void;
      result?: { mode?: string };
    };

    if (scene.result?.mode !== 'campaign' || !scene.renderRankedResult) {
      throw new Error('ResultScene is not in campaign mode.');
    }

    scene.rankedSyncStage = 'confirmed';
    scene.rankedSyncMessage = '冒险成绩已记录。';
    scene.renderRankedResult();
  });

  const bounds = await getNamedSceneBounds(page, 'ResultScene');
  const byName = Object.fromEntries(bounds.map((entry) => [entry.name, entry]));

  expect(byName['result.sync.panel']).toBeDefined();
  expect(byName['result.sync.status']).toBeDefined();
  expect(byName['result.sync.detail']).toBeDefined();
  expect(byName['result.actions.primary']).toBeDefined();
  expect(byName['result.actions.secondary']).toBeDefined();

  const syncPanel = byName['result.sync.panel']!;
  const syncStatus = byName['result.sync.status']!;
  const detail = byName['result.sync.detail']!;
  const primaryAction = byName['result.actions.primary']!;
  const secondaryAction = byName['result.actions.secondary']!;

  expect(syncStatus.x).toBeGreaterThanOrEqual(syncPanel.x + 8);
  expect(syncStatus.y).toBeGreaterThanOrEqual(syncPanel.y + 8);
  expect(detail.x).toBeGreaterThanOrEqual(syncPanel.x + 8);
  expect(detail.y).toBeGreaterThanOrEqual(Math.floor(syncStatus.y + syncStatus.height - 1));
  expect(detail.y + detail.height).toBeLessThanOrEqual(primaryAction.y - 10);
  expect(syncPanel.y + syncPanel.height).toBeLessThanOrEqual(primaryAction.y - 6);
  expect(syncPanel.y + syncPanel.height).toBeLessThanOrEqual(secondaryAction.y - 6);

  const texts = await getSceneTextEntries(page, 'ResultScene');
  const visibleTexts = texts
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('冒险成绩已记录');
  expect(visibleTexts).toContain('已计入通关榜。');
  expect(visibleTexts).toContain('[Esc]');
});
