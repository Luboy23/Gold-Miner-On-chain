import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  getSceneTextEntries,
  installMockWallet,
  mockAdventureCenterApi,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  simulateBackgroundElapsed,
  snapshot,
  waitForScene,
} from './helpers';

function visibleTexts(entries: Awaited<ReturnType<typeof getSceneTextEntries>>): string[] {
  return entries
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('smoke: experience entry opens the confirmation modal first', async ({ page }) => {
  await openGame(page, '?muteAudio=1');
  await page.keyboard.press('Enter');

  const texts = await getSceneTextEntries(page, 'MenuScene');
  expect(
    texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度')),
  ).toBe(true);
});

test('smoke: adventure center can prepare and start a campaign', async ({ page }) => {
  await installMockWallet(page, 'string-payload-only');
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

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
});

test('smoke: ranked quick start reaches gameplay after session signing', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.rankedRuntimeMode).toBe('authoritative');
});

test('smoke: ranked result upload reaches confirmed state', async ({ page }) => {
  let capturedFinishedTick: number | null = null;

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);

  await page.route('http://127.0.0.1:8788/api/ranked/runs', async (route) => {
    const request = route.request().postDataJSON() as {
      evidence?: { finishedTick?: number };
    };
    capturedFinishedTick = request.evidence?.finishedTick ?? null;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'validated' }),
    });
  });

  await page.route(
    /http:\/\/127\.0\.0\.1:8788\/api\/ranked\/sessions\/[^/]+\/finalize$/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    },
  );

  await page.route(
    /http:\/\/127\.0\.0\.1:8788\/api\/ranked\/sessions\/[^/]+\/status$/,
    async (route) => {
      const sessionId = route.request().url().split('/sessions/')[1]?.split('/status')[0];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId:
            sessionId ??
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'confirmed',
          validatedRuns: 1,
          submittedRuns: 1,
          confirmedRuns: 1,
          failedRuns: 0,
          txHashes: [],
          lastError: null,
        }),
      });
    },
  );

  await openGame(page, '?muteAudio=1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  await simulateBackgroundElapsed(page, 60_000);
  await waitForScene(page, 'ResultScene');
  await page.waitForFunction(
    () => {
      const game = (window as typeof window & {
        __goldMinerGame?: {
          scene: {
            getScene: (key: string) => {
              children: { list: Array<Record<string, unknown>> };
            };
          };
        };
      }).__goldMinerGame;

      if (!game) {
        return false;
      }

      const scene = game.scene.getScene('ResultScene');
      const queue = [...scene.children.list];
      const texts: string[] = [];

      while (queue.length > 0) {
        const next = queue.shift() as Record<string, unknown>;
        const visible = (next.visible as boolean | undefined) !== false;
        const alpha = typeof next.alpha === 'number' ? (next.alpha as number) : 1;

        if (visible && alpha > 0 && next.type === 'Text' && typeof next.text === 'string') {
          texts.push(next.text);
        }

        const childList = (next.list as Array<Record<string, unknown>> | undefined) ?? [];
        queue.push(...childList);
      }

      return texts.includes('已上榜') || texts.includes('提交失败');
    },
    undefined,
    { timeout: 8_000 },
  );

  const texts = visibleTexts(await getSceneTextEntries(page, 'ResultScene'));
  expect(texts).toContain('已上榜');
  expect(capturedFinishedTick).toBe(3600);
});

test('smoke: pause menu can return casual gameplay to the menu', async ({ page }) => {
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

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
});
