import { expect, test, type Page } from '@playwright/test';

import {
  callSceneMethod,
  focusGameCanvas,
  getNamedSceneBounds,
  getSceneTextEntries,
  installMockWallet,
  mockAdventureCenterApi,
  openGame,
  prepareCleanStorage,
  simulateBackgroundElapsed,
  snapshot,
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

function toBoundsMap(
  entries: Array<Bounds & { name: string }>,
): Record<string, Bounds> {
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

async function clickNamedBoundsEntry(
  page: Page,
  sceneKey: string,
  entryName: string,
): Promise<void> {
  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  const bounds = (await getNamedSceneBounds(page, sceneKey)).find(
    (entry) => entry.name === entryName,
  );
  expect(bounds, `missing bounds for ${entryName}`).toBeDefined();

  const scaleX = (canvasBox?.width ?? 0) / 320;
  const scaleY = (canvasBox?.height ?? 0) / 240;

  await canvas.click({
    position: {
      x: (bounds!.x + bounds!.width / 2) * scaleX,
      y: (bounds!.y + bounds!.height / 2) * scaleY,
    },
  });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('opens adventure center from menu and renders the two-module layout', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'AdventureCenterScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const requiredNames = [
    'adventure.header.panel',
    'adventure.header.best',
    'adventure.board.history.panel',
    'adventure.board.summary.panel',
    'adventure.board.history.empty',
    'adventure.board.summary.empty',
    'adventure.status.banner',
    'adventure.actions.start',
    'adventure.actions.back',
  ];

  requiredNames.forEach((name) => {
    expect(bounds[name], `missing bounds for ${name}`).toBeDefined();
  });

  expect(bounds['adventure.board.history.panel'].width).toBeCloseTo(
    bounds['adventure.board.summary.panel'].width,
    0,
  );
  expect(bounds['adventure.board.history.panel'].y).toBeCloseTo(
    bounds['adventure.board.summary.panel'].y,
    0,
  );
  expect(right(bounds['adventure.board.history.panel'])).toBeLessThanOrEqual(
    bounds['adventure.board.summary.panel'].x,
  );
  expect(bounds['adventure.actions.start'].width).toBe(134);
  expect(bounds['adventure.actions.back'].width).toBe(148);
  expect(bounds['adventure.actions.start'].y).toBe(220);
  expect(bounds['adventure.actions.back'].y).toBe(220);

  const visibleTexts = (await getSceneTextEntries(page, 'AdventureCenterScene'))
    .filter((entry) => entry.visible)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('冒险中心');
  expect(visibleTexts).toContain('冒险记录');
  expect(visibleTexts).toContain('最佳进度');
  expect(visibleTexts).toContain('返回主菜单');
  expect(visibleTexts).toContain('开始第一局冒险');
  expect(visibleTexts).toContain('尚未建立最佳进度');
});

test('keeps adventure history and best-clear rows tall enough to avoid text overlap', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page, {
    history: [
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          reachedLevel: 1,
          completed: false,
          finalScore: 1120,
          totalDurationMs: 42000,
          purchasedItemCount: 0,
          evidenceHash:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
          submittedAt: 1_720_000_000_000,
        },
      },
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x3333333333333333333333333333333333333333333333333333333333333333',
          reachedLevel: 10,
          completed: true,
          finalScore: 980,
          totalDurationMs: 61000,
          purchasedItemCount: 2,
          evidenceHash:
            '0x4444444444444444444444444444444444444444444444444444444444444444',
          submittedAt: 1_720_000_100_000,
        },
      },
    ],
  });
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'AdventureCenterScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  expect(bounds['adventure.board.history.row.0']).toBeDefined();
  expect(bounds['adventure.board.summary.row.0']).toBeDefined();
  expect(bounds['adventure.board.history.row.0'].height).toBeGreaterThanOrEqual(20);
  expect(bounds['adventure.board.summary.row.0'].height).toBeGreaterThanOrEqual(20);

  const visibleTexts = (await getSceneTextEntries(page, 'AdventureCenterScene'))
    .filter((entry) => entry.visible)
    .map((entry) => entry.text);

  expect(visibleTexts).toContain('$1120 · 第1关');
  expect(visibleTexts).toContain('到达第1关');
  expect(visibleTexts).toContain('最高到达第10关');
  expect(visibleTexts).toContain('最高分 $1120');
});

test('keeps adventure history clipped inside the card and exposes internal scrolling state', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page, {
    history: [
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          reachedLevel: 1,
          completed: false,
          finalScore: 500,
          totalDurationMs: 42000,
          purchasedItemCount: 0,
          evidenceHash:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
          submittedAt: 1_720_000_000_000,
        },
      },
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x3333333333333333333333333333333333333333333333333333333333333333',
          reachedLevel: 1,
          completed: false,
          finalScore: 500,
          totalDurationMs: 42000,
          purchasedItemCount: 0,
          evidenceHash:
            '0x4444444444444444444444444444444444444444444444444444444444444444',
          submittedAt: 1_720_000_100_000,
        },
      },
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x5555555555555555555555555555555555555555555555555555555555555555',
          reachedLevel: 1,
          completed: false,
          finalScore: 500,
          totalDurationMs: 42000,
          purchasedItemCount: 0,
          evidenceHash:
            '0x6666666666666666666666666666666666666666666666666666666666666666',
          submittedAt: 1_720_000_200_000,
        },
      },
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x7777777777777777777777777777777777777777777777777777777777777777',
          reachedLevel: 1,
          completed: false,
          finalScore: 1120,
          totalDurationMs: 42000,
          purchasedItemCount: 0,
          evidenceHash:
            '0x8888888888888888888888888888888888888888888888888888888888888888',
          submittedAt: 1_720_000_300_000,
        },
      },
    ],
  });
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');

  const before = await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;
    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }
    const scene = game.scene.getScene('AdventureCenterScene') as {
      getHistoryScrollState?: () => {
        currentScrollY: number;
        maxScrollY: number;
        rowCount: number;
        scrollbarVisible: boolean;
      } | null;
    };
    return scene.getHistoryScrollState?.() ?? null;
  });

  expect(before).not.toBeNull();
  expect(before?.rowCount).toBe(4);
  expect(before?.maxScrollY ?? 0).toBeGreaterThan(0);
  expect(before?.scrollbarVisible).toBe(true);
  expect(before?.currentScrollY).toBe(0);

  await callSceneMethod(page, 'AdventureCenterScene', 'scrollHistoryDownForTests');

  const after = await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;
    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }
    const scene = game.scene.getScene('AdventureCenterScene') as {
      getHistoryScrollState?: () => {
        currentScrollY: number;
        maxScrollY: number;
        rowCount: number;
        scrollbarVisible: boolean;
      } | null;
    };
    return scene.getHistoryScrollState?.() ?? null;
  });

  expect(after).not.toBeNull();
  expect(after?.currentScrollY ?? 0).toBeGreaterThan(0);
  expect(after?.maxScrollY).toBe(before?.maxScrollY);
});

test('prepares campaign first and enters GoalScene only after second confirmation', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page, {
    history: [
      {
        player: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        result: {
          campaignId:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          reachedLevel: 4,
          completed: false,
          finalScore: 1800,
          totalDurationMs: 42000,
          purchasedItemCount: 1,
          evidenceHash:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
          submittedAt: 1_720_000_000_000,
        },
      },
    ],
  });
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await focusGameCanvas(page);

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

  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
  expect(state.adventureCenterStage).toBe('prepared-campaign');

  const textsAfterPrepare = await getSceneTextEntries(page, 'AdventureCenterScene');
  expect(
    textsAfterPrepare.some((entry) => entry.visible && entry.text.includes('进入第一关')),
  ).toBe(true);

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');

  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.currentRunLevelId).toBe('L1');
});

test('clicking the adventure start button follows the same two-step flow as Enter', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await focusGameCanvas(page);

  await clickNamedBoundsEntry(page, 'AdventureCenterScene', 'adventure.actions.start');

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

  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
  expect(state.adventureCenterStage).toBe('prepared-campaign');

  await clickNamedBoundsEntry(page, 'AdventureCenterScene', 'adventure.actions.start');
  await waitForScene(page, 'GoalScene');

  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
  expect(state.currentRunLevelId).toBe('L1');
});

test('keeps campaign time moving while the window is unfocused and resolves timeout immediately', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await focusGameCanvas(page);

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

  const before = await snapshot(page);
  expect(before.currentRunTimeRemainingSec).not.toBeNull();

  await simulateBackgroundElapsed(page, 61_000);
  await waitForScene(page, 'ResultScene', 15_000);

  const after = await snapshot(page);
  expect(after.activeScenes).toEqual(['ResultScene']);
});

test('keeps campaign catch progression consistent after an unfocused background catch window', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await focusGameCanvas(page);

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
  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;
    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }
    const scene = game.scene.getScene('GameplayScene') as {
      hookSystem?: {
        angleDeg?: number;
        fire?: () => void;
      } | null;
    };
    if (!scene.hookSystem?.fire) {
      throw new Error('Missing GameplayScene hookSystem in DEV mode.');
    }
    scene.hookSystem.angleDeg = -3;
    scene.hookSystem.fire();
  });

  await page.waitForFunction(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;
    if (!game) {
      return false;
    }
    const scene = game.scene.getScene('GameplayScene') as {
      hookSystem?: { snapshot?: { state?: string | null } } | null;
    };
    return scene.hookSystem?.snapshot?.state === 'returning-loaded';
  });

  const before = await snapshot(page);
  expect(before.currentRunTimeRemainingSec).not.toBeNull();
  expect(before.gameplayLayout?.hookTip).not.toBeNull();

  await simulateBackgroundElapsed(page, 61_000);
  await waitForScene(page, 'ResultScene', 15_000);

  const after = await snapshot(page);
  const resultPayload = await page.evaluate(() => {
    return (window as typeof window & {
      __goldMinerResultPayload?: {
        mode?: string;
        score?: number;
        caughtCount?: number;
        campaignEvidence?: {
          finalScore: number;
          levels: Array<{
            summary: {
              score: number;
              caughtCount: number;
            };
          }>;
        } | null;
      };
    }).__goldMinerResultPayload ?? null;
  });

  expect(after.activeScenes).toEqual(['ResultScene']);
  expect(resultPayload?.mode).toBe('campaign');
  expect(resultPayload?.campaignEvidence).not.toBeNull();
  expect(resultPayload?.caughtCount ?? 0).toBeGreaterThan(0);
  expect(resultPayload?.score ?? 0).toBeGreaterThan(0);
  expect(resultPayload?.campaignEvidence?.finalScore ?? 0).toBeGreaterThan(0);
  expect(
    resultPayload?.campaignEvidence?.levels.at(-1)?.summary.caughtCount ?? 0,
  ).toBeGreaterThan(0);
  expect(
    resultPayload?.campaignEvidence?.levels.at(-1)?.summary.score ?? 0,
  ).toBeGreaterThan(0);
});

test('returning to adventure center from the first campaign shop does not upload campaign evidence', async ({
  page,
}) => {
  test.setTimeout(30_000);

  let capturedEvidence:
    | {
        levels: Array<{
          levelId: string;
          summary: {
            finishedTick: number;
            caughtCount: number;
            score: number;
          };
          actions: Array<{ kind: string; tick: number }>;
        }>;
      }
    | null = null;

  await installMockWallet(page, 'string-payload-only');
  await mockAdventureCenterApi(page);
  await page.route(/http:\/\/127\.0\.0\.1:8788\/api\/campaigns\/[^/]+\/evidence$/, async (route) => {
    const payload = route.request().postDataJSON() as {
      evidence?: typeof capturedEvidence;
    };
    capturedEvidence = payload.evidence ?? null;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'validated' }),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:8788\/api\/campaigns\/[^/]+\/status$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'confirmed',
        reachedLevel: 1,
        completed: false,
        finalScore: 0,
        totalDurationMs: 0,
        purchasedItemCount: 0,
        lastError: null,
      }),
    });
  });
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'AdventureCenterScene');
  await focusGameCanvas(page);

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

  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;
    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }
    const scene = game.scene.getScene('GameplayScene') as {
      run?: {
        score: number;
        scoreView: number;
        caughtCount: number;
        levelGroup: number;
        timeRemainingSec: number;
        status: string;
        rankedContext?: {
          logicTick: number;
          timeLimitTicks: number;
          lastDiamondTick: number;
          actions: Array<{ kind: string; tick: number }>;
        } | null;
      };
      scoreTimerSystem?: {
        timeRemainingSec?: number;
        score?: number;
        scoreView?: number;
        reachedGoal?: boolean;
      };
      outcomeController?: {
        completeLevel?: (
          run: unknown,
          scoreTimerSystem: unknown,
          authoritativeRankedFinalized?: unknown,
        ) => Promise<void>;
      } | null;
      stepGameplay?: (deltaSec: number, rankedFixedStep: boolean) => void;
    };
    if (
      !scene.run ||
      !scene.scoreTimerSystem ||
      !scene.outcomeController?.completeLevel ||
      !scene.run.rankedContext
    ) {
      throw new Error('GameplayScene is missing campaign runtime state.');
    }

    scene.run = {
      ...scene.run,
      score: 1661,
      scoreView: 1661,
      caughtCount: 1,
      timeRemainingSec: 1 / 60 + 0.000001,
      status: 'playing',
      rankedContext: {
        ...scene.run.rankedContext,
        logicTick: scene.run.rankedContext.timeLimitTicks - 1,
        lastDiamondTick: 60,
        actions: [{ kind: 'fireHook', tick: 59 }],
      },
    };
    scene.scoreTimerSystem.timeRemainingSec = 1 / 60 + 0.000001;
    scene.scoreTimerSystem.score = 1661;
    scene.scoreTimerSystem.scoreView = 1661;
    scene.scoreTimerSystem.reachedGoal = true;
    void scene.outcomeController.completeLevel(scene.run, scene.scoreTimerSystem, null);
  });

  await waitForScene(page, 'GoalScene', 15_000);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'ShopScene', 15_000);
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
  await waitForScene(page, 'AdventureCenterScene', 15_000);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
  expect(capturedEvidence).toBeNull();
});
