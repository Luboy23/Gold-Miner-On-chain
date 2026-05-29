import type { AssetManifest } from './contentTypes';
import type {
  GoalSceneMode,
  RunRestartSnapshot,
  RunResult,
  RunState,
} from './runTypes';
import type { RankedUiTone } from './viewModelTypes';

export interface PreloaderSceneData {
  manifest: AssetManifest;
}

export interface GoalScenePayload {
  mode: GoalSceneMode;
  run: RunState;
  restartSnapshot?: RunRestartSnapshot;
}

export interface GameplayScenePayload {
  run: RunState;
  restartSnapshot?: RunRestartSnapshot;
}

export interface ShopScenePayload {
  run: RunState;
  restartSnapshot?: RunRestartSnapshot;
}

export interface ResultScenePayload {
  result: RunResult;
}

export interface RankedScenePayload {
  statusMessage?: string;
  statusTone?: RankedUiTone;
}
export interface AdventureCenterScenePayload {
  statusMessage?: string;
  statusTone?: RankedUiTone;
}

export interface ScenePayloads {
  RankedScene: RankedScenePayload | undefined;
  AdventureCenterScene: AdventureCenterScenePayload | undefined;
  GoalScene: GoalScenePayload;
  GameplayScene: GameplayScenePayload;
  ShopScene: ShopScenePayload;
  ResultScene: ResultScenePayload;
}

export const MENU_SELECTIONS = {
  ExperienceStart: 'experience-start',
  AdventureStart: 'adventure-start',
  AdventureCenter: 'adventure-center',
  RankedStart: 'ranked-start',
  RankedCenter: 'ranked-center',
} as const;

export type MenuSelection =
  (typeof MENU_SELECTIONS)[keyof typeof MENU_SELECTIONS];

export function isAssetManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AssetManifest>;

  return (
    typeof candidate.basePath === 'string' &&
    typeof candidate.images === 'object' &&
    typeof candidate.audio === 'object' &&
    typeof candidate.fonts === 'object' &&
    typeof candidate.spriteSheets === 'object'
  );
}
