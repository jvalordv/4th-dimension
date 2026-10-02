import { describe, expect, it } from 'vitest';
import { apply4, determinant4, identity4, mul4, orthogonalityError, approxEqualMat4 } from '../../src/math/mat4';
import { compositeRotation, doubleRotation, rotation, ROTATION_PLANES, zeroAngles } from '../../src/math/rotation';
import { chart, chartBasis, hyperplane, hyperplaneFromRotation, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { cross4, det4, dot4, normalize4 } from '../../src/math/vec';
import { projectPerspective } from '../../src/math/projection';
import { hypervolumeByCones, validateTetComplex } from '../../src/geometry/tets';
import { sliceTets } from '../../src/geometry/slice';
import { analyseSlice, signedVolume, weldVertices, dropDegenerateTriangles } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral, TetShape } from '../../src/geometry/shape';
import { tesseractFixture } from './tesseract-fixture';
import type { Vec4 } from '../../src/math/types';

// Deterministic pseudo-random for reproducible "random" directions.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

describe('rotations (MATH.md §2)', () => {
  it('are special orthogonal in every plane', () => {
    for (const plane of ROTATION_PLANES) {
      const m = rotation(plane, 0.7);
      expect(orthogonalityError(m)).toBeLessThan(1e-12);
      expect(determinant4(m)).toBeCloseTo(1, 12);
    }
  });
  it('turn e_i toward e_j and fix the complementary plane', () => {
    const m = rotation('XW', Math.PI / 2);
    const ex: Vec4 = [1, 0, 0, 0];
    const r = apply4(m, ex);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[3]).toBeCloseTo(1, 12);
    expect(apply4(m, [0, 1, 0, 0])).toEqual([0, 1, 0, 0]);
    expect(apply4(m, [0, 0, 1, 0])).toEqual([0, 0, 1, 0]);
  });
  it('add angles in the same plane and commute in disjoint planes only', () => {
    expect(approxEqualMat4(mul4(rotation('YZ', 0.3), rotation('YZ', 0.4)), rotation('YZ', 0.7))).toBe(true);
    const a = rotation('XY', 0.5), b = rotation('ZW', 1.1), c = rotation('XZ', 0.9);
    expect(approxEqualMat4(mul4(a, b), mul4(b, a))).toBe(true);
    expect(approxEqualMat4(mul4(a, c), mul4(c, a))).toBe(false);
  });
  it('isoclinic double rotation turns every vector by the same angle', () => {
    const alpha = 0.6;
    const m = doubleRotation(alpha, alpha);
    const r = rng(1);
    for (let i = 0; i < 20; i++) {
      const v = randUnit4(r);
      expect(dot4(v, apply4(m, v))).toBeCloseTo(Math.cos(alpha), 12);
    }
  });
  it('composite applies XY first and ZW last', () => {
    const angles = { ...zeroAngles(), XY: 0.3, ZW: 0.8 };
    const expected = mul4(rotation('ZW', 0.8), rotation('XY', 0.3));
    expect(approxEqualMat4(compositeRotation(angles), expected)).toBe(true);
    expect(approxEqualMat4(compositeRotation(zeroAngles()), identity4())).toBe(true);
  });
});

describe('cross4 and det4 (MATH.md §5.1)', () => {
  it('is orthogonal to its arguments and positively oriented', () => {
    const r = rng(2);
    for (let i = 0; i < 20; i++) {
      const u = randUnit4(r), v = randUnit4(r), w = randUnit4(r);
      const x = cross4(u, v, w);
      expect(dot4(x, u)).toBeCloseTo(0, 12);
      expect(dot4(x, v)).toBeCloseTo(0, 12);
      expect(dot4(x, w)).toBeCloseTo(0, 12);
      expect(det4(x, u, v, w)).toBeGreaterThan(0);
    }
  });
  it('cross4(e_y, e_z, e_w) = e_x', () => {
    expect(cross4([0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1])).toEqual([1, -0, 0, -0]);
  });
});

describe('perspective projection (MATH.md §3.2)', () => {
  it('scales by d/(d−w)', () => {
    expect(projectPerspective([1, 1, 1, 1], 3)).toEqual([1.5, 1.5, 1.5]);
    expect(projectPerspective([1, 1, 1, -1], 3)).toEqual([0.75, 0.75, 0.75]);
  });
});

describe('hyperplane chart (MATH.md §4)', () => {
  it('is the identity on xyz for n = e_w', () => {
    expect(chartBasis([0, 0, 0, 1])).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
  });
  it('builds a right-handed orthonormal basis for random normals and inverts', () => {
    const r = rng(3);
    for (let i = 0; i < 30; i++) {
      const h = hyperplane(randUnit4(r), r() - 0.5);
      const [u1, u2, u3] = h.basis;
      for (const u of [u1, u2, u3]) {
        expect(dot4(u, u)).toBeCloseTo(1, 12);
        expect(dot4(u, h.normal)).toBeCloseTo(0, 12);
      }
      expect(dot4(u1, u2)).toBeCloseTo(0, 12);
      expect(dot4(u1, u3)).toBeCloseTo(0, 12);
      expect(dot4(u2, u3)).toBeCloseTo(0, 12);
      expect(det4(u1, u2, u3, h.normal)).toBeCloseTo(1, 12);
      const q: [number, number, number] = [r(), r(), r()];
      const p = unchart(h, q);
      expect(dot4(h.normal, p)).toBeCloseTo(h.offset, 12);
      const back = chart(h, p);
      q.forEach((v, k) => expect(back[k]).toBeCloseTo(v, 12));
    }
  });
  it('handles normals near the coordinate axes', () => {
    for (const n of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [1e-9, 0, 0, 1], [-1, 0, 0, 0]] as Vec4[]) {
      const [u1, u2, u3] = chartBasis(n);
      expect(det4(u1, u2, u3, normalize4(n))).toBeCloseTo(1, 9);
    }
  });
});

describe('tesseract slices (MATH.md §8.4)', () => {
  const { positions, tets } = tesseractFixture();
  const shape = new TetShape('tesseract', 'polytope', { positions, tets }, null);

  it('fixture is a valid tet complex with 96 tets and hypervolume 16', () => {
    const v = validateTetComplex(positions, tets);
    expect(v.errors).toEqual([]);
    expect(v.tetCount).toBe(96);
    expect(hypervolumeByCones(positions, tets)).toBeCloseTo(16, 10);
  });
  it('slice at w = 0.3 is a closed cube of volume 8', () => {
    const a = analyseSlice(sliceTets(positions, tets, hyperplaneW(0.3)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(2);
    expect(a.volume).toBeCloseTo(8, 5);
  });
  it('slices with vertices on the hyperplane are the limit from below and stay watertight', () => {
    for (const c of [1, 0, 0.999999, -0.999999]) {
      const a = analyseSlice(sliceTets(positions, tets, hyperplaneW(c)), 1e-5);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.volume).toBeCloseTo(8, 4);
    }
    expect(sliceTets(positions, tets, hyperplaneW(-1)).indices.length).toBe(0);
  });
  it('central diagonal slice is the octahedron with volume 32/3 and 6 extreme vertices', () => {
    const h = hyperplane([1, 1, 1, 1], 0);
    const m = dropDegenerateTriangles(weldVertices(sliceTets(positions, tets, h), 1e-6));
    const a = analyseSlice(m);
    expect(a.closed).toBe(true);
    expect(a.euler).toBe(2);
    expect(a.volume).toBeCloseTo(32 / 3, 5);
    // Extreme vertices of {Σp = 0, |p_i| ≤ 1} are the six permutations of
    // (1,1,-1,-1): slice vertices with every 4D coordinate at ±1. Other slice
    // vertices come from cone edges and face diagonals and lie inside faces.
    const used = new Set(Array.from(m.indices));
    const extreme = new Set<string>();
    for (const i of used) {
      const p = unchart(h, [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]);
      if (p.every((v) => Math.abs(Math.abs(v) - 1) < 1e-5)) extreme.add(p.map((v) => Math.sign(v)).join(','));
      expect(Math.max(...p.map(Math.abs))).toBeLessThan(1 + 1e-5);
    }
    expect(extreme.size).toBe(6);
  });
  it('slice along (1,1,0,0) at 0 has volume 8√2', () => {
    const a = analyseSlice(sliceTets(positions, tets, hyperplane([1, 1, 0, 0], 0)));
    expect(a.volume).toBeCloseTo(8 * Math.SQRT2, 5);
  });
  it('slice volume integrates to the hypervolume in any direction', () => {
    const r = rng(4);
    for (let i = 0; i < 4; i++) {
      expect(sliceVolumeIntegral(shape, randUnit4(r), 400)).toBeCloseTo(16, 1);
    }
    expect(sliceVolumeIntegral(shape, [0, 0, 0, 1], 400)).toBeCloseTo(16, 6);
  });
  it('hyperplaneFromRotation matches slicing the rotated shape at w = c', () => {
    const m = compositeRotation({ XY: 0.4, XZ: -0.3, XW: 0.9, YZ: 0.2, YW: -0.7, ZW: 0.5 });
    const rotated = positions.map((p) => apply4(m, p));
    const direct = sliceTets(rotated, tets, hyperplaneW(0.35));
    const viaH = sliceTets(positions, tets, hyperplaneFromRotation(m, 0.35));
    expect(signedVolume(viaH)).toBeCloseTo(signedVolume(direct), 6);
    const key = (mesh: typeof direct): string[] =>
      Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
        [0, 1, 2].map((k) => mesh.positions[3 * i + k].toFixed(4)).join(',')).sort();
    expect(key(viaH)).toEqual(key(direct));
  });
});
