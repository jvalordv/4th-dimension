import { describe, expect, it } from 'vitest';
import { placeholderTesseract, tesseractData } from '../../src/app/placeholder-tesseract';
import { hypervolumeByCones, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice } from '../../src/geometry/trimesh';
import { hyperplaneW } from '../../src/math/hyperplane';

const differingCoords = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((n, v, k) => n + (v !== b[k] ? 1 : 0), 0);

describe('placeholder tesseract (MATH.md §8, §8.4)', () => {
  const data = tesseractData();
  const shape = placeholderTesseract();

  it('has the catalogue counts: 16 vertices, 32 edges, 24 square faces', () => {
    expect(data.wire.positions).toHaveLength(16);
    expect(data.wire.edges).toHaveLength(32);
    expect(data.wire.faces).toHaveLength(24);
    for (const p of data.wire.positions) for (const v of p) expect(Math.abs(v)).toBe(1);
    // Euler with the 8 cubic cells of the table: V − E + F − C = 16 − 32 + 24 − 8 = 0.
    expect(16 - 32 + 24 - 8).toBe(0);
  });
  it('edges join vertices differing in exactly one coordinate (length 2), each in 3 squares', () => {
    const edgeKey = (i: number, j: number): string => (i < j ? `${i},${j}` : `${j},${i}`);
    const faceCount = new Map<string, number>();
    for (const [i, j] of data.wire.edges) {
      expect(differingCoords(data.wire.positions[i], data.wire.positions[j])).toBe(1);
      faceCount.set(edgeKey(i, j), 0);
    }
    expect(faceCount.size).toBe(32);
    for (const f of data.wire.faces) {
      expect(f).toHaveLength(4);
      expect(new Set(f).size).toBe(4);
      for (let k = 0; k < 4; k++) {
        const a = f[k];
        const b = f[(k + 1) % 4];
        expect(differingCoords(data.wire.positions[a], data.wire.positions[b])).toBe(1);
        const key = edgeKey(a, b);
        expect(faceCount.has(key)).toBe(true);
        faceCount.set(key, (faceCount.get(key) ?? 0) + 1);
      }
      // All four corners share the two fixed coordinates.
      const fixedAxes = [0, 1, 2, 3].filter((ax) => f.every((v) => data.wire.positions[v][ax] === data.wire.positions[f[0]][ax]));
      expect(fixedAxes).toHaveLength(2);
    }
    // 24 squares · 4 edges / 32 edges = 3 squares per edge.
    for (const n of faceCount.values()) expect(n).toBe(3);
    const distinct = new Set(data.wire.faces.map((f) => [...f].sort((a, b) => a - b).join(',')));
    expect(distinct.size).toBe(24);
  });
  it('tet complex is valid with 96 tets and hypervolume 16', () => {
    expect(data.positions).toHaveLength(24); // 16 vertices + 8 cell centroids
    const v = validateTetComplex(data.positions, data.tets);
    expect(v.errors).toEqual([]);
    expect(v.tetCount).toBe(96);
    expect(hypervolumeByCones(data.positions, data.tets)).toBeCloseTo(16, 10);
  });
  it('Shape4: radius 2, w range [−1, 1], wire attached', () => {
    expect(shape.name).toBe('Tesseract');
    expect(shape.kind).toBe('polytope');
    expect(shape.radius()).toBe(2); // |(1,1,1,1)| = 2
    expect(shape.wRange()).toEqual([-1, 1]);
    expect(shape.wire()?.edges).toHaveLength(32);
  });
  it('slice at w = 0.3 is a closed cube of volume 8 (§8.4)', () => {
    const a = analyseSlice(shape.slice(hyperplaneW(0.3)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(2);
    // Float32 positions: relative error ~1e-7 on a volume of 8.
    expect(a.volume).toBeCloseTo(8, 5);
  });
});
