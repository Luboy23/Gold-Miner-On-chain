import { RunRng } from '../../systems/RunRng';
import type { LevelDefinition, LevelEntitySpawn, RunState } from '../../game/types/index';
import type { LevelEntity } from '../../objects/LevelEntity';

const RANKED_DIAMOND_SPAWN_POINTS = [
  { x: 56, y: 72 },
  { x: 106, y: 86 },
  { x: 214, y: 78 },
  { x: 276, y: 96 },
  { x: 74, y: 120 },
  { x: 160, y: 112 },
  { x: 244, y: 128 },
  { x: 108, y: 156 },
  { x: 206, y: 164 },
  { x: 58, y: 186 },
  { x: 156, y: 198 },
  { x: 268, y: 208 },
] as const;

type RankedDiamondSpawnPoint = (typeof RANKED_DIAMOND_SPAWN_POINTS)[number];

export class RankedLegacySpawnController {
  private spawnCycles: RankedDiamondSpawnPoint[][] = [];
  private spawnCursor = 0;

  reset(): void {
    this.spawnCycles = [];
    this.spawnCursor = 0;
  }

  spawnInitialDiamond(
    run: RunState | null,
    level: LevelDefinition | null,
    entities: LevelEntity[],
    createEntity: (
      spawn: LevelEntitySpawn,
      run: RunState,
      level: LevelDefinition,
      bagIndex: number | null,
    ) => LevelEntity,
  ): LevelEntity[] {
    this.reset();
    return this.spawnNextDiamond(run, level, entities, createEntity);
  }

  spawnNextDiamond(
    run: RunState | null,
    level: LevelDefinition | null,
    entities: LevelEntity[],
    createEntity: (
      spawn: LevelEntitySpawn,
      run: RunState,
      level: LevelDefinition,
      bagIndex: number | null,
    ) => LevelEntity,
  ): LevelEntity[] {
    if (!run || !level || run.mode !== 'ranked') {
      return entities;
    }

    const nextEntities = entities.filter((entity) => entity.isActive);
    const point = this.getNextSpawnPoint(run);
    const diamond = createEntity(
      {
        type: 'Diamond',
        x: point.x,
        y: point.y,
      },
      run,
      level,
      null,
    );
    nextEntities.push(diamond);
    this.spawnCursor += 1;
    return nextEntities;
  }

  private getNextSpawnPoint(run: RunState): RankedDiamondSpawnPoint {
    const cycleIndex = Math.floor(
      this.spawnCursor / RANKED_DIAMOND_SPAWN_POINTS.length,
    );
    const indexInCycle =
      this.spawnCursor % RANKED_DIAMOND_SPAWN_POINTS.length;
    const cycle = this.ensureCycle(run, cycleIndex);
    return cycle[indexInCycle];
  }

  private ensureCycle(run: RunState, cycleIndex: number): RankedDiamondSpawnPoint[] {
    const existing = this.spawnCycles[cycleIndex];

    if (existing) {
      return existing;
    }

    const seed = run.rankedContext?.challengeSeed ?? run.seed ?? 'ranked';
    const rng = new RunRng(`${seed}:cycle:${cycleIndex}`);
    const cycle = [...RANKED_DIAMOND_SPAWN_POINTS];

    for (let index = cycle.length - 1; index > 0; index -= 1) {
      const swapIndex = rng.nextInt(0, index);
      [cycle[index], cycle[swapIndex]] = [cycle[swapIndex], cycle[index]];
    }

    if (cycleIndex > 0 && cycle.length > 1) {
      const previousCycle = this.ensureCycle(run, cycleIndex - 1);
      const previousLast = previousCycle[previousCycle.length - 1];
      if (cycle[0].x === previousLast.x && cycle[0].y === previousLast.y) {
        [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
      }
    }

    this.spawnCycles[cycleIndex] = cycle;
    return cycle;
  }
}
