function xmur3(seed: string): () => number {
  let hash = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return (): number => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;

  return (): number => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = Math.imul(value ^ (value >>> 15), value | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export class RunRng {
  private readonly nextValue: () => number;

  constructor(seed: string) {
    this.nextValue = mulberry32(xmur3(seed)());
  }

  next(): number {
    return this.nextValue();
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    return (
      Math.floor(this.next() * (maxInclusive - minInclusive + 1)) + minInclusive
    );
  }
}
