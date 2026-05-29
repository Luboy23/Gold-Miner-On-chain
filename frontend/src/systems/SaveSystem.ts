import { DEFAULT_SAVE_DATA, SAVE_STORAGE_KEY } from '../game/constants';
import type { SaveData } from '../game/types/index';

function cloneDefaultSave(): SaveData {
  return { ...DEFAULT_SAVE_DATA };
}

function isValidSaveData(value: unknown): value is SaveData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SaveData>;

  return (
    candidate.version === 1 &&
    typeof candidate.highScore === 'number' &&
    Number.isFinite(candidate.highScore) &&
    typeof candidate.highLevel === 'number' &&
    Number.isFinite(candidate.highLevel) &&
    typeof candidate.acknowledgedExperienceMode === 'boolean'
  );
}

function normalizeSaveData(value: SaveData): SaveData {
  return {
    version: 1,
    highScore: Math.max(0, Math.floor(value.highScore)),
    highLevel: Math.max(1, Math.floor(value.highLevel)),
    acknowledgedExperienceMode: value.acknowledgedExperienceMode,
  };
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class SaveSystem {
  load(): SaveData {
    const storage = getStorage();

    if (!storage) {
      return cloneDefaultSave();
    }

    const raw = storage.getItem(SAVE_STORAGE_KEY);

    if (!raw) {
      return cloneDefaultSave();
    }

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (!isValidSaveData(parsed)) {
        return cloneDefaultSave();
      }

      return normalizeSaveData(parsed);
    } catch {
      return cloneDefaultSave();
    }
  }

  save(data: SaveData): void {
    const storage = getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(normalizeSaveData(data)));
    } catch {
      // Ignore storage write failures in Sprint 1; the game stays playable.
    }
  }

  clear(): void {
    const storage = getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.removeItem(SAVE_STORAGE_KEY);
    } catch {
      // Ignore storage removal failures for now.
    }
  }
}

export const saveSystem = new SaveSystem();
