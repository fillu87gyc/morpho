import seedrandom from 'seedrandom';

export interface SeededRNG {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  gauss(mean: number, stddev: number): number;
}

export function createRNG(seed: number | string): SeededRNG {
  const rng = seedrandom(String(seed));
  let cachedGauss: number | null = null;

  return {
    next: () => rng(),
    range: (min, max) => min + (max - min) * rng(),
    int: (min, max) => Math.floor(min + (max - min + 1) * rng()),
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(rng() * arr.length)] as T;
    },
    gauss: (mean, stddev) => {
      if (cachedGauss !== null) {
        const v = cachedGauss;
        cachedGauss = null;
        return mean + stddev * v;
      }
      let u = 0, v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      const z0 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const z1 = Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v);
      cachedGauss = z1;
      return mean + stddev * z0;
    },
  };
}
