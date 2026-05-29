import { expect, test } from '@playwright/test';

import {
  getSceneTextEntries,
  installMockWallet,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  simulateBackgroundElapsed,
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

test('syncs a ranked clear at the exact tick budget without uploading an out-of-range finishedTick', async ({
  page,
}) => {
  test.setTimeout(30_000);

  let capturedFinishedTick: number | null = null;
  let capturedActionTicks: number[] = [];

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);

  await page.route('http://127.0.0.1:8788/api/ranked/runs', async (route) => {
    const request = route.request().postDataJSON() as {
      evidence?: {
        finishedTick?: number;
        actions?: Array<{ tick: number }>;
      };
    };

    capturedFinishedTick = request.evidence?.finishedTick ?? null;
    capturedActionTicks = request.evidence?.actions?.map((action) => action.tick) ?? [];

    if (
      capturedFinishedTick === null ||
      capturedFinishedTick > 3600 ||
      capturedActionTicks.some((tick) => tick >= capturedFinishedTick)
    ) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            capturedFinishedTick !== null && capturedFinishedTick > 3600
              ? 'finishedTick exceeds timeLimitTicks'
              : 'action tick must be inside the run window',
        }),
      });
      return;
    }

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

        const childList =
          (next.list as Array<Record<string, unknown>> | undefined) ?? [];
        queue.push(...childList);
      }

      return texts.includes('已上榜') || texts.includes('提交失败');
    },
    undefined,
    { timeout: 8_000 },
  );

  const texts = visibleTexts(await getSceneTextEntries(page, 'ResultScene'));
  expect(texts).toContain('已上榜');
  expect(texts).not.toContain('提交失败');
  expect(capturedFinishedTick).toBe(3600);
  expect(capturedActionTicks.every((tick) => tick < 3600)).toBe(true);
});
