import { expect, test } from '@playwright/test';

import {
  callSceneMethod,
  getNamedSceneBounds,
  getSceneTextEntries,
  installMockWallet,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  snapshot,
  startGameplayFromGoalScene,
  waitForScene,
} from './helpers';

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function visibleTexts(entries: Awaited<ReturnType<typeof getSceneTextEntries>>): string[] {
  return entries
    .filter((entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0)
    .map((entry) => entry.text);
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('keeps the classic casual HUD clear of the miner and uses balanced Chinese gameplay labels', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await startGameplayFromGoalScene(page);
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  const layout = state.gameplayLayout;
  expect(layout).not.toBeNull();
  expect(layout?.hudRects.score).not.toBeNull();
  expect(layout?.hudRects.status).not.toBeNull();
  expect(layout?.minerRect).not.toBeNull();

  expect(overlaps(layout!.hudRects.score!, layout!.minerRect!)).toBe(false);
  expect(overlaps(layout!.hudRects.status!, layout!.minerRect!)).toBe(false);

  const texts = visibleTexts(await getSceneTextEntries(page, 'GameplayScene'));
  expect(texts).toContain('金币');
  expect(texts).toContain('$0');
  expect(texts).toContain('目标');
  expect(texts).toContain('$600');
  expect(texts).toContain('剩余');
  expect(texts.some((text) => /^\d{1,2}秒$/.test(text))).toBe(true);
  expect(texts).toContain('炸药');
  expect(texts).toContain('x0');
  expect(texts.some((text) => text.includes('RANKED'))).toBe(false);
  expect(texts.some((text) => text.includes('得分 / 目标'))).toBe(false);
  expect(texts.some((text) => text.includes('关卡'))).toBe(false);
  expect(texts.some((text) => text.includes('L1_1'))).toBe(false);
  expect(texts.some((text) => text.includes('下键出钩'))).toBe(false);
  expect(texts.some((text) => text.includes('↓ 出钩'))).toBe(false);

  const namedBounds = await getNamedSceneBounds(page, 'GameplayScene');
  const visibleDynamiteIcons = namedBounds.filter(
    (entry) =>
      entry.name.startsWith('gameplay.hud.dynamite.') &&
      entry.visible &&
      entry.alpha > 0,
  );
  expect(visibleDynamiteIcons).toHaveLength(0);
});

test('keeps the ranked HUD out of the top-center safe zone', async ({ page }) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  const layout = state.gameplayLayout;
  expect(layout).not.toBeNull();
  expect(layout?.hookOrigin).toEqual({ x: 158, y: 30 });

  const safeZone = {
    x: 112,
    y: 0,
    width: 96,
    height: 28,
  };

  expect(overlaps(layout!.hudRects.score!, safeZone)).toBe(false);
  expect(overlaps(layout!.hudRects.status!, safeZone)).toBe(false);

  const texts = visibleTexts(await getSceneTextEntries(page, 'GameplayScene'));
  expect(texts).toContain('钻石');
  expect(texts).toContain('钻石挑战');
  expect(texts).toContain('挑战');
  expect(texts).toContain('道具');
  expect(texts.some((text) => text === '禁用' || text === '禁用道具')).toBe(true);
  expect(texts.some((text) => text.includes('diamond_rush_60'))).toBe(false);
  expect(texts.some((text) => text.includes('炸药'))).toBe(false);
});

test('shows reward float text, restores the classic HUD, and refreshes dynamite icons', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await callSceneMethod(page, 'MenuScene', 'startLocalAdventureGame');
  await waitForScene(page, 'GoalScene');
  await startGameplayFromGoalScene(page);
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

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    const handleCatchResult = scene.handleCatchResult as ((result: unknown) => void) | undefined;

    if (typeof handleCatchResult !== 'function') {
      throw new Error('Missing handleCatchResult on GameplayScene.');
    }

    handleCatchResult.call(scene, {
      entityType: 'MiniGold',
      bonus: 120,
      bonusTier: 'high',
      rewardKind: 'money',
      feedbackText: '+$120',
      dynamiteDelta: 0,
      grantsStrengthBoost: false,
    });
  });

  await page.waitForTimeout(100);

  let texts = visibleTexts(await getSceneTextEntries(page, 'GameplayScene'));
  expect(texts).toContain('+$120');

  await page.waitForFunction(() => {
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

    const scene = game.scene.getScene('GameplayScene');
    const queue = [...scene.children.list];
    const visibleTexts: string[] = [];

    while (queue.length > 0) {
      const next = queue.shift() as Record<string, unknown>;
      const visible = (next.visible as boolean | undefined) !== false;
      const alpha = typeof next.alpha === 'number' ? (next.alpha as number) : 1;

      if (visible && alpha > 0 && next.type === 'Text' && typeof next.text === 'string') {
        visibleTexts.push(next.text);
      }

      const childList =
        (next.list as Array<Record<string, unknown>> | undefined) ?? [];
      queue.push(...childList);
    }

    return visibleTexts.includes('目标') && visibleTexts.includes('$600') && !visibleTexts.includes('+$120');
  });

  texts = visibleTexts(await getSceneTextEntries(page, 'GameplayScene'));
  expect(texts).toContain('目标');
  expect(texts).toContain('$600');
  expect(texts).not.toContain('+$120');

  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('GameplayScene') as Record<string, unknown>;
    const handleCatchResult = scene.handleCatchResult as ((result: unknown) => void) | undefined;

    if (typeof handleCatchResult !== 'function') {
      throw new Error('Missing handleCatchResult on GameplayScene.');
    }

    handleCatchResult.call(scene, {
      entityType: 'QuestionBag',
      bonus: 0,
      bonusTier: 'normal',
      rewardKind: 'dynamite',
      feedbackText: '+1 炸药',
      dynamiteDelta: 1,
      grantsStrengthBoost: false,
    });
  });

  await page.waitForTimeout(100);

  texts = visibleTexts(await getSceneTextEntries(page, 'GameplayScene'));
  expect(texts).toContain('+1 炸药');
  expect(texts).toContain('x1');

  const namedBounds = await getNamedSceneBounds(page, 'GameplayScene');
  const visibleDynamiteIcons = namedBounds.filter(
    (entry) =>
      entry.name.startsWith('gameplay.hud.dynamite.') &&
      entry.visible &&
      entry.alpha > 0,
  );
  expect(visibleDynamiteIcons).toHaveLength(1);
});
