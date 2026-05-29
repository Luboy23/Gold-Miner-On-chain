import { LEVEL_DEFINITIONS } from '../data/levels';
import type { LevelDefinition, LevelGroup } from '../game/types/index';

function cloneLevelDefinition(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    entities: level.entities.map((entity) => ({ ...entity })),
  };
}

export class LevelSystem {
  getLevelDefinition(levelId: string): LevelDefinition | null {
    const definition = LEVEL_DEFINITIONS[levelId];

    if (!definition) {
      return null;
    }

    return cloneLevelDefinition(definition);
  }

  resolveLevelId(
    _seed: string,
    group: LevelGroup,
    forcedLevelId: string | null = null,
  ): string | null {
    if (forcedLevelId) {
      const forcedLevel = this.getLevelDefinition(forcedLevelId);
      if (forcedLevel && forcedLevel.group === group) {
        return forcedLevel.id;
      }
    }

    const levelId = `L${group}`;

    return this.getLevelDefinition(levelId)?.id ?? null;
  }
}

export const levelSystem = new LevelSystem();
