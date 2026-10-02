import { describe, expect, it } from 'vitest';
import { convexHull3 } from '../../src/geometry/hull3';
import { PHI, POLYTOPE_INFO, POLYTOPE_NAMES, polytopeShape, regularPolytope } from '../../src/geometry/polytopes';
import type { PolytopeName } from '../../src/geometry/polytopes';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { sliceTets } from '../../src/geometry/slice';
import { hypervolumeByCones, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice } from '../../src/geometry/trimesh';
import { hyperplane, hyperplaneW } from '../../src/math/hyperplane';
import { cross3, cross4, dist4, dot3, dot4, length4, normalize4, rejectFromUnit4, sub3, sub4 } from '../../src/math/vec';
import type { Polytope4, Vec3, Vec4 } from '../../src/math/types';

// Same deterministic generator as test/core/core.test.ts, so "random"
// directions are reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

/**
 * MATH.md §8 table, transcribed literally so the tests do not merely compare
 * the module with its own POLYTOPE_INFO.
 */
const CATALOGUE: Record<PolytopeName, { V: number; E: number; F: number; C: number; cell: CellName }> = {
  cell5: { V: 5, E: 10, F: 10, C: 5, cell: 'tetrahedron' },
  tesseract: { V: 16, E: 32, F: 24, C: 8, cell: 'cube' },
  cell16: { V: 8, E: 24, F: 32, C: 16, cell: 'tetrahedron' },
  cell24: { V: 24, E: 96, F: 96, C: 24, cell: 'octahedron' },
  cell120: { V: 600, E: 1200, F: 720, C: 120, cell: 'dodecahedron' },
  cell600: { V: 120, E: 720, F: 1200, C: 600, cell: 'tetrahedron' },
};

type CellName = 'tetrahedron' | 'cube' | 'octahedron' | 'dodecahedron';

/** Platonic solids: vertices, edges, faces, sides per face. */
const CELL_SHAPE: Record<CellName, { V: number; E: number; F: number; sides: number }> = {
  tetrahedron: { V: 4, E: 6, F: 4, sides: 3 },
  cube: { V: 8, E: 12, F: 6, sides: 4 },
  octahedron: { V: 6, E: 12, F: 8, sides: 3 },
  dodecahedron: { V: 20, E: 30, F: 12, sides: 5 },
};

/**
 * Edge lengths of the §8 coordinates.
 * - 5-cell: a = 2√2 (§8.1).
 * - Tesseract: vertices (±1,±1,±1,±1); adjacent ones differ in one coordinate by 2.
 * - 16-cell: |e_i − e_j| = √2.
 * - 24-cell: |(1,1,0,0) − (1,0,1,0)| = √2.
 * - 600-cell: a = 1/φ (§8.2).
 * - 120-cell: derived (§8.2 gives no closed form). Adjacent vertices are the
 *   normalised centroids ν1/|ν1|, ν2/|ν2| of 600-cell tets {p,q,r,s}, {p,q,r,t}
 *   sharing a face, so ν1 − ν2 = (s − t)/4. In the vertex figure at p (an
 *   icosahedron of edge a = 1/φ) s and t are the apexes of the two triangles
 *   on edge qr, at distance φ·a = 1, so |ν1 − ν2| = 1/4. A tet of edge a has
 *   circumradius a√6/4 and its vertices lie on the unit sphere, so
 *   |ν|² = 1 − 3a²/8 = 1 − 3/(8φ²) = (7 + 3√5)/16. Edge = (1/4)/|ν| = 1/√(7+3√5).
 */
const EDGE: Record<PolytopeName, number> = {
  cell5: 2 * Math.SQRT2,
  tesseract: 2,
  cell16: Math.SQRT2,
  cell24: Math.SQRT2,
  cell120: 1 / Math.sqrt(7 + 3 * Math.sqrt(5)),
  cell600: 1 / PHI,
};

/** §8 table: 5-cell √5/96·a⁴ with a = 2√2; tesseract 16; 16-cell 2/3; 24-cell 8. */
const HYPERVOLUME: Partial<Record<PolytopeName, number>> = {
  cell5: (Math.sqrt(5) / 96) * (2 * Math.SQRT2) ** 4,
  tesseract: 16,
  cell16: 2 / 3,
  cell24: 8,
};

const truePositions = (p: Polytope4): Vec4[] => p.positions.slice(0, p.vertexCount);
const circumradius = (p: Polytope4): number => Math.max(...truePositions(p).map(length4));
const cellVertexIndices = (p: Polytope4, cell: readonly number[]): number[] =>
  [...new Set(cell.flatMap((fi) => p.faces[fi]))];
const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * Distance from the origin to the 3-flat of a cell: |n̂ · p0| with n̂ the unit
 * cross4 (§5.1) of three independent edge vectors from the cell's vertex p0.
 * Coplanar triples (cross4 ≈ 0) are skipped.
 */
function cellFlatDistance(p: Polytope4, cell: readonly number[]): number {
  const verts = cellVertexIndices(p, cell);
  const p0 = p.positions[verts[0]];
  const d1 = sub4(p.positions[verts[1]], p0);
  const d2 = sub4(p.positions[verts[2]], p0);
  for (let k = 3; k < verts.length; k++) {
    const n = cross4(d1, d2, sub4(p.positions[verts[k]], p0));
    if (length4(n) > 1e-9) return Math.abs(dot4(normalize4(n), p0));
  }
  throw new Error('cell is not 3-dimensional');
}

describe('convexHull3', () => {
  it('finds the 6 outward quads of a cube and the 8 triangles of an octahedron', () => {
    const cube: Vec3[] = [];
    for (let i = 0; i < 8; i++) cube.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    const h = convexHull3(cube);
    expect(h.faces.length).toBe(6);
    h.faces.forEach((f, k) => {
      expect(f.length).toBe(4);
      // Counter-clockwise from outside: cross(v1−v0, v2−v0) along the normal,
      // and the normal points away from the centre (origin).
      const n = cross3(sub3(cube[f[1]], cube[f[0]]), sub3(cube[f[2]], cube[f[0]]));
      expect(dot3(n, h.normals[k])).toBeGreaterThan(0);
      expect(dot3(h.normals[k], cube[f[0]])).toBeGreaterThan(0);
    });
    const oct: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    expect(convexHull3(oct).faces.map((f) => f.length)).toEqual(Array<number>(8).fill(3));
  });
  it('rejects a point strictly inside the hull', () => {
    const tet: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.1, 0.1, 0.1]];
    expect(() => convexHull3(tet)).toThrow(/inside/);
  });
});

describe('construction', () => {
  // First use of the 120-cell in this file, so the timer sees a cold build.
  it('builds the 120-cell in under 2 seconds and memoises every polytope', () => {
    const t0 = performance.now();
    const p = regularPolytope('cell120');
    expect(performance.now() - t0).toBeLessThan(2000);
    for (const name of POLYTOPE_NAMES) expect(regularPolytope(name)).toBe(regularPolytope(name));
    expect(regularPolytope('cell120')).toBe(p);
  });
  it('POLYTOPE_INFO carries the §8 catalogue values', () => {
    for (const name of POLYTOPE_NAMES) {
      const info = POLYTOPE_INFO[name];
      expect(info.counts).toEqual({ V: CATALOGUE[name].V, E: CATALOGUE[name].E, F: CATALOGUE[name].F, C: CATALOGUE[name].C });
      expect(info.cellName).toBe(CATALOGUE[name].cell);
      expect(info.edgeLength).toBeCloseTo(EDGE[name], 12);
      const vol = HYPERVOLUME[name];
      if (vol === undefined) expect(info.hypervolume).toBeNull();
      else expect(info.hypervolume).toBeCloseTo(vol, 12);
    }
  });
});

describe('§8 vertex coordinates', () => {
  it('5-cell: every pair at distance 2√2, circumradius 4/√5, centroid at the origin (§8.1)', () => {
    const v = truePositions(regularPolytope('cell5'));
    for (let i = 0; i < 5; i++) {
      expect(length4(v[i])).toBeCloseTo(4 / Math.sqrt(5), 12);
      for (let j = i + 1; j < 5; j++) expect(dist4(v[i], v[j])).toBeCloseTo(2 * Math.SQRT2, 12);
    }
    const sum = v.reduce((acc, p) => acc.map((x, k) => x + p[k]) as Vec4, [0, 0, 0, 0] as Vec4);
    sum.forEach((x) => expect(x).toBeCloseTo(0, 12));
  });
  it('tesseract vertices are (±1,±1,±1,±1), 16-cell vertices are ±e_i (§8)', () => {
    const t = truePositions(regularPolytope('tesseract'));
    expect(new Set(t.map((p) => p.join(','))).size).toBe(16);
    for (const p of t) p.forEach((x) => expect(Math.abs(x)).toBe(1));
    const c = truePositions(regularPolytope('cell16'));
    expect(new Set(c.map((p) => p.join(','))).size).toBe(8);
    for (const p of c) {
      expect(p.filter((x) => x !== 0).length).toBe(1);
      expect(length4(p)).toBe(1);
    }
  });
  it('24-cell vertices are the permutations of (±1,±1,0,0) (§8)', () => {
    const v = truePositions(regularPolytope('cell24'));
    expect(new Set(v.map((p) => p.join(','))).size).toBe(24);
    for (const p of v) expect([...p].map(Math.abs).sort().join(',')).toBe('0,0,1,1');
  });
  it('600-cell: 120 unit vertices, 8 + 16 + 96 by type, each with 12 neighbours at 1/φ (§8.2)', () => {
    const p = regularPolytope('cell600');
    const v = truePositions(p);
    expect(new Set(v.map((q) => q.map((x) => x.toFixed(12)).join(',')).values()).size).toBe(120);
    let axis = 0;
    let halves = 0;
    let golden = 0;
    for (const q of v) {
      expect(length4(q)).toBeCloseTo(1, 12);
      const mags = [...q].map(Math.abs).sort((a, b) => a - b);
      if (mags[3] === 1 && mags[2] === 0) axis++;
      else if (mags.every((m) => m === 0.5)) halves++;
      else if (mags[0] === 0 && Math.abs(mags[1] - 1 / (2 * PHI)) < 1e-12 && mags[2] === 0.5 && Math.abs(mags[3] - PHI / 2) < 1e-12) golden++;
    }
    expect([axis, halves, golden]).toEqual([8, 16, 96]);
    const degree = new Array<number>(120).fill(0);
    for (const [a, b] of p.edges) { degree[a]++; degree[b]++; }
    expect(degree.every((d) => d === 12)).toBe(true);
  });
  it('600-cell golden vertices use even permutations only (§8.2)', () => {
    // The parity of a permutation moving (φ/2, 1/2, 1/(2φ), 0) into slots
    // (s0, s1, s2, s3) is the parity of (s0, s1, s2, s3) as a permutation.
    const v = truePositions(regularPolytope('cell600'));
    const slotOf = (m: number): number => {
      if (Math.abs(m - PHI / 2) < 1e-12) return 0;
      if (m === 0.5) return 1;
      if (Math.abs(m - 1 / (2 * PHI)) < 1e-12) return 2;
      return 3;
    };
    for (const q of v) {
      const mags = q.map(Math.abs);
      if (!mags.includes(0) || mags.includes(1)) continue; // not a golden vertex
      const perm = mags.map(slotOf);
      let inversions = 0;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) if (perm[a] > perm[b]) inversions++;
      expect(inversions % 2).toBe(0);
    }
  });
  it('120-cell vertices are the 600 normalised cell centroids of the 600-cell (§8.2)', () => {
    const c600 = regularPolytope('cell600');
    const c120 = regularPolytope('cell120');
    const v600 = truePositions(c600);
    const centroids = new Set<string>();
    for (const cell of c600.cells) {
      const idx = cellVertexIndices(c600, cell);
      expect(idx.length).toBe(4);
      const c: Vec4 = [0, 0, 0, 0];
      for (const i of idx) for (let k = 0; k < 4; k++) c[k] += v600[i][k] / 4;
      centroids.add(normalize4(c).map((x) => x.toFixed(9)).join(','));
    }
    expect(centroids.size).toBe(600);
    for (const q of truePositions(c120)) {
      expect(length4(q)).toBeCloseTo(1, 12);
      expect(centroids.has(q.map((x) => x.toFixed(9)).join(','))).toBe(true);
    }
  });
});

describe.each(POLYTOPE_NAMES)('%s (MATH.md §8)', (name) => {
  const cat = CATALOGUE[name];
  const cellShape = CELL_SHAPE[cat.cell];

  it('has the catalogue V, E, F, C, satisfies Euler, and appends one centroid per cell', () => {
    const p = regularPolytope(name);
    expect(p.name).toBe(name);
    expect(p.vertexCount).toBe(cat.V);
    expect(p.edges.length).toBe(cat.E);
    expect(p.faces.length).toBe(cat.F);
    expect(p.cells.length).toBe(cat.C);
    expect(p.vertexCount - p.edges.length + p.faces.length - p.cells.length).toBe(0);
    expect(p.positions.length).toBe(cat.V + cat.C);
    // Tets: one fan tet per face vertex beyond two, counted once per cell on the face.
    let expectedTets = 0;
    for (const cell of p.cells) for (const fi of cell) expectedTets += p.faces[fi].length - 2;
    expect(p.tets.length).toBe(expectedTets);
  });

  it('every edge has the §8 edge length', () => {
    const p = regularPolytope(name);
    // Coordinates carry only round-off (≈1e-16 relative), so 1e-9 is loose
    // for the arithmetic yet a tiny fraction of the shortest edge (0.27).
    for (const [a, b] of p.edges) {
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(p.vertexCount);
      expect(Math.abs(dist4(p.positions[a], p.positions[b]) - EDGE[name])).toBeLessThan(1e-9);
    }
    expect(new Set(p.edges.map(([a, b]) => edgeKey(a, b))).size).toBe(cat.E);
  });

  it('every face is a planar, strictly convex polygon listed in cyclic order', () => {
    const p = regularPolytope(name);
    for (const face of p.faces) {
      expect(face.length).toBe(cellShape.sides);
      expect(new Set(face).size).toBe(face.length);
      const p0 = p.positions[face[0]];
      // Orthonormal 2D frame of the face plane from the first two edges.
      const u = normalize4(sub4(p.positions[face[1]], p0));
      const v = normalize4(rejectFromUnit4(sub4(p.positions[face[2]], p0), u));
      const q = face.map((i): [number, number] => {
        const d = sub4(p.positions[i], p0);
        // Planarity: the residual off span(u, v) is round-off only.
        const residual = rejectFromUnit4(rejectFromUnit4(d, u), v);
        expect(length4(residual)).toBeLessThan(1e-9 * EDGE[name]);
        return [dot4(u, d), dot4(v, d)];
      });
      // Consecutive edge turns all have the same sign (strict convexity) and
      // the exterior angles sum to 2π (a simple cycle, not a star polygon;
      // a pentagram would also turn consistently but through 4π).
      let turning = 0;
      let sign = 0;
      for (let k = 0; k < q.length; k++) {
        const a = q[k];
        const b = q[(k + 1) % q.length];
        const c = q[(k + 2) % q.length];
        const e1 = [b[0] - a[0], b[1] - a[1]];
        const e2 = [c[0] - b[0], c[1] - b[1]];
        const cross = e1[0] * e2[1] - e1[1] * e2[0];
        const dot = e1[0] * e2[0] + e1[1] * e2[1];
        expect(Math.abs(cross)).toBeGreaterThan(1e-9 * EDGE[name] ** 2);
        if (sign === 0) sign = Math.sign(cross);
        expect(Math.sign(cross)).toBe(sign);
        turning += Math.atan2(cross, dot);
      }
      expect(Math.abs(turning)).toBeCloseTo(2 * Math.PI, 9);
    }
  });

  it(`every cell is a ${cat.cell} whose face edges each belong to exactly two of its faces`, () => {
    const p = regularPolytope(name);
    const cellsOnFace = new Array<number>(p.faces.length).fill(0);
    for (const cell of p.cells) {
      expect(cell.length).toBe(cellShape.F);
      expect(new Set(cell).size).toBe(cell.length);
      expect(cellVertexIndices(p, cell).length).toBe(cellShape.V);
      const count = new Map<string, number>();
      for (const fi of cell) {
        cellsOnFace[fi]++;
        const f = p.faces[fi];
        for (let k = 0; k < f.length; k++) {
          const key = edgeKey(f[k], f[(k + 1) % f.length]);
          count.set(key, (count.get(key) ?? 0) + 1);
        }
      }
      expect(count.size).toBe(cellShape.E);
      for (const n of count.values()) expect(n).toBe(2);
    }
    // Each face separates exactly two cells (the boundary is a closed 3-manifold).
    expect(cellsOnFace.every((n) => n === 2)).toBe(true);
  });

  it('facets are supporting: all vertices lie on the inner side of every cell 3-flat (§8.3)', () => {
    const p = regularPolytope(name);
    const verts = truePositions(p);
    for (const cell of p.cells) {
      const idx = cellVertexIndices(p, cell);
      const p0 = p.positions[idx[0]];
      const d1 = sub4(p.positions[idx[1]], p0);
      const d2 = sub4(p.positions[idx[2]], p0);
      let n: Vec4 | null = null;
      for (let k = 3; k < idx.length && !n; k++) {
        const c = cross4(d1, d2, sub4(p.positions[idx[k]], p0));
        if (length4(c) > 1e-9) n = normalize4(c);
      }
      if (!n) throw new Error('degenerate cell');
      // Outward normal: away from the origin, which is interior (§8).
      if (dot4(n, p0) < 0) n = [-n[0], -n[1], -n[2], -n[3]];
      const offset = dot4(n, p0);
      const inCell = new Set(idx);
      let maxOnCell = 0;
      let maxOutside = -Infinity;
      verts.forEach((v, i) => {
        const s = dot4(n, v) - offset;
        if (inCell.has(i)) maxOnCell = Math.max(maxOnCell, Math.abs(s));
        else maxOutside = Math.max(maxOutside, s);
      });
      expect(maxOnCell).toBeLessThan(1e-9); // cell vertices lie in the 3-flat (round-off only)
      expect(maxOutside).toBeLessThan(-1e-6); // all others strictly inside, by far more than round-off
    }
  });

  it('is a valid, outward-oriented tet complex with no degenerate tets (§5.2)', () => {
    const p = regularPolytope(name);
    const v = validateTetComplex(p.positions, p.tets, { allowDegenerate: false });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.degenerateTets).toBe(0);
    expect(v.tetCount).toBe(p.tets.length);
  });

  it('polytopeShape wraps it as a polytope TetShape drawing the true vertices', () => {
    const p = regularPolytope(name);
    const s = polytopeShape(name);
    expect(s.kind).toBe('polytope');
    expect(s.name).toBe(name);
    const wire = s.wire();
    expect(wire).not.toBeNull();
    expect(wire?.positions.length).toBe(cat.V);
    expect(wire?.edges).toBe(p.edges);
    expect(wire?.faces).toBe(p.faces);
    // Centroids lie inside, so the bounding radius is the circumradius.
    expect(s.radius()).toBeCloseTo(circumradius(p), 12);
  });
});

describe('hypervolume (MATH.md §7, §8)', () => {
  it.each(['tesseract', 'cell16', 'cell24', 'cell5'] as const)('%s matches the §8 table to 1e-9', (name) => {
    const p = regularPolytope(name);
    const expected = HYPERVOLUME[name] as number;
    expect(Math.abs(hypervolumeByCones(p.positions, p.tets) - expected)).toBeLessThan(1e-9);
  });

  it.each(['cell600', 'cell120'] as const)('%s lies between its inscribed and circumscribed 4-balls and matches the slice integral', (name) => {
    const p = regularPolytope(name);
    const vol = hypervolumeByCones(p.positions, p.tets);
    const rIn = Math.min(...p.cells.map((cell) => cellFlatDistance(p, cell)));
    const rOut = circumradius(p);
    // §8.5: vol_4 of a 4-ball of radius R is π² R⁴ / 2.
    const ball = (r: number): number => (Math.PI ** 2 * r ** 4) / 2;
    expect(rIn).toBeLessThan(rOut);
    expect(vol).toBeGreaterThan(ball(rIn));
    expect(vol).toBeLessThan(ball(rOut));
    // Cavalieri (§7) along two seeded directions. The midpoint rule with 200
    // steps over [−1, 1] is accurate to about 1e-6 relative here; 1% is the
    // stated acceptance threshold.
    const shape = polytopeShape(name);
    const r = rng(name === 'cell600' ? 600 : 120);
    for (let i = 0; i < 2; i++) {
      const integral = sliceVolumeIntegral(shape, randUnit4(r), 200);
      expect(Math.abs(integral - vol) / vol).toBeLessThan(0.01);
    }
  });
});

describe('tesseract slices from this module (MATH.md §8.4)', () => {
  // Slice positions are Float32, so volumes are good to about 1e-6 relative;
  // 5 decimal places matches test/core/core.test.ts.
  it('w = 0.3: cube of volume 8; (1,1,1,1)/2 at 0: octahedron of volume 32/3; (1,1,0,0)/√2 at 0: prism of volume 8√2', () => {
    const { positions, tets } = regularPolytope('tesseract');
    const cube = analyseSlice(sliceTets(positions, tets, hyperplaneW(0.3)));
    expect(cube.closed).toBe(true);
    expect(cube.consistent).toBe(true);
    expect(cube.volume).toBeCloseTo(8, 5);
    const oct = analyseSlice(sliceTets(positions, tets, hyperplane([1, 1, 1, 1], 0)));
    expect(oct.closed).toBe(true);
    expect(oct.consistent).toBe(true);
    expect(oct.volume).toBeCloseTo(32 / 3, 5);
    const prism = analyseSlice(sliceTets(positions, tets, hyperplane([1, 1, 0, 0], 0)));
    expect(prism.closed).toBe(true);
    expect(prism.consistent).toBe(true);
    expect(prism.volume).toBeCloseTo(8 * Math.SQRT2, 5);
  });
});
