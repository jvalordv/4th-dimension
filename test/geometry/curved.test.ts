import { describe, expect, it } from 'vitest';
import {
  cliffordTorus, duocylinder, duocylinderComplex, hopfBasePoints, hopfFiber, hopfFibration, hopfShape,
  hypersphere, hypersphereComplex,
} from '../../src/geometry/curved';
import { hypervolumeByCones, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { hyperplaneW } from '../../src/math/hyperplane';
import { analyseSlice } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { dot4, length4, normalize4 } from '../../src/math/vec';
import type { TetComplex, Vec3, Vec4, WireMesh4 } from '../../src/math/types';

// Deterministic pseudo-random for reproducible "random" directions (same
// generator as test/core/core.test.ts).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

/** vol_4 of the 4-ball of radius R: π² R⁴ / 2. MATH.md §8.5 */
const ballHypervolume = (R: number): number => (Math.PI ** 2 * R ** 4) / 2;
/** Volume of the slice of the R-ball at offset c: (4/3) π (R² − c²)^{3/2}. MATH.md §8.5 */
const ballSliceVolume = (R: number, c: number): number => (4 / 3) * Math.PI * (R * R - c * c) ** 1.5;

/**
 * Distance from the origin to the nearest tet hyperplane: min over tets of
 * |N · a| / |N| with N = cross4(b−a, c−a, d−a). Every point of tet t is at
 * distance ≥ d_t from the origin, so for a star-shaped complex whose vertices
 * lie on the sphere of radius R the enclosed body B satisfies
 * ball(r_min) ⊆ B ⊆ ball(R): the upper inclusion because each flat tet lies
 * inside the (convex) ball containing its vertices, the lower because every
 * ray from the origin leaves B through a boundary point at distance ≥ r_min.
 */
function minFacetDistance(c: TetComplex): number {
  let rMin = Infinity;
  for (const t of c.tets) {
    const n = tetNormal(c.positions, t);
    rMin = Math.min(rMin, Math.abs(dot4(n, c.positions[t[0]])) / length4(n));
  }
  return rMin;
}

/**
 * Hopf map h(z1, z2) = (2 Re(z1 z̄2), 2 Im(z1 z̄2), |z1|² − |z2|²) with
 * z1 = x + iy, z2 = z + iw: z1 z̄2 = (x + iy)(z − iw) = (xz + yw) + i(yz − xw).
 * MATH.md §3.3
 */
const hopfMap = ([x, y, z, w]: Vec4): Vec3 => [2 * (x * z + y * w), 2 * (y * z - x * w), x * x + y * y - z * z - w * w];

/**
 * Area of the regular n-gon of circumradius r: n isosceles triangles with
 * legs r and apex angle 2π/n, each of area ½ r² sin(2π/n). Equals π r² times
 * the polygon correction (n/2π) sin(2π/n).
 */
const polygonArea = (r: number, n: number): number => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

/**
 * Length of the chord cut from the regular n-gon of circumradius r (vertices
 * at angles 2πj/n in the (z, w) plane) by the line w = c: the polygon is
 * convex, so the line meets its boundary in exactly two points (found by
 * intersecting each edge, endpoints on the line included) and the chord is
 * the difference of their z coordinates.
 */
function polygonChord(r: number, n: number, c: number): number {
  const zs: number[] = [];
  for (let j = 0; j < n; j++) {
    const a0 = (2 * Math.PI * j) / n;
    const a1 = (2 * Math.PI * (j + 1)) / n;
    const z0 = r * Math.cos(a0), w0 = r * Math.sin(a0);
    const z1 = r * Math.cos(a1), w1 = r * Math.sin(a1);
    const s0 = w0 - c, s1 = w1 - c;
    if (s0 === 0 && s1 === 0) continue;
    if ((s0 >= 0) !== (s1 >= 0) || s0 === 0 || s1 === 0) zs.push(z0 + (z1 - z0) * (s0 / (s0 - s1)));
  }
  return Math.max(...zs) - Math.min(...zs);
}

/** Whether the edges touching vertices [start, start + count) form exactly one closed loop through all of them. */
function isSingleLoop(wire: WireMesh4, start: number, count: number): boolean {
  const adj = new Map<number, number[]>();
  let edgeCount = 0;
  for (const [a, b] of wire.edges) {
    const inA = a >= start && a < start + count;
    const inB = b >= start && b < start + count;
    if (inA !== inB) return false; // an edge leaving the fibre
    if (!inA) continue;
    edgeCount++;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  if (edgeCount !== count) return false;
  for (let v = start; v < start + count; v++) if ((adj.get(v) ?? []).length !== 2) return false;
  // Walk the cycle from `start`; it must return there after exactly `count` steps.
  let prev = -1;
  let cur = start;
  for (let step = 0; step < count; step++) {
    const [p, q] = adj.get(cur) as [number, number];
    const next = p === prev ? q : p;
    prev = cur;
    cur = next;
  }
  return cur === start;
}

// ---------------------------------------------------------------------------

describe('hypersphere (MATH.md §8.5)', () => {
  const EXACT = ballHypervolume(1);
  // Relative hypervolume deficit (EXACT − v)/EXACT at levels 0..4, computed
  // once; the complexes are inscribed so the deficit is positive.
  const complexes = [0, 1, 2, 3, 4].map((level) => hypersphereComplex(1, level));
  const deficits = complexes.map((c) => (EXACT - hypervolumeByCones(c.positions, c.tets)) / EXACT);

  it('level 3 is built in well under a second', () => {
    const t0 = performance.now();
    hypersphere(1, 3);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('is a valid, closed, outward complex with 16·8^L tets at levels 0..3', () => {
    // Counts: each step maps a tet to 8 tets and adds one vertex per edge.
    // With (V, E, F, C) → (V + E, 2E + 3F + C, 4F + 8C, 8C) from the
    // 16-cell's (8, 24, 32, 16) (§8 table): V = 8, 32, 192, 1408.
    const expectedVertices = [8, 32, 192, 1408];
    for (let level = 0; level <= 3; level++) {
      const c = complexes[level];
      const v = validateTetComplex(c.positions, c.tets);
      expect(v.errors, `level ${level}`).toEqual([]);
      expect(v.degenerateTets).toBe(0);
      expect(c.tets.length).toBe(16 * 8 ** level);
      expect(c.positions.length).toBe(expectedVertices[level]);
      // Every vertex is projected to the sphere.
      for (const p of c.positions) expect(length4(p)).toBeCloseTo(1, 12);
      // Every tet is outward about the origin (§5.1): signed = unsigned sum.
      expect(signedHypervolume(c.positions, c.tets)).toBeCloseTo(hypervolumeByCones(c.positions, c.tets), 12);
    }
    const shape = hypersphere(1, 3);
    expect(shape.kind).toBe('curved');
    expect(shape.wire()).toBeNull();
    expect(shape.radius()).toBeCloseTo(1, 12);
    expect(shape.wRange()[0]).toBeCloseTo(-1, 12);
    expect(shape.wRange()[1]).toBeCloseTo(1, 12);
  });

  it('level 0 is the 16-cell with hypervolume 2/3', () => {
    // §8 table: the 16-cell with vertices ±e_i has 4-volume 2/3.
    expect(hypervolumeByCones(complexes[0].positions, complexes[0].tets)).toBeCloseTo(2 / 3, 12);
  });

  it('hypervolume converges to π²R⁴/2: 5.31 % low at level 3, shrinking each level', () => {
    // Measured deficit at level 3 is 0.053104; the bound 0.055 is set just
    // above it. Rigorous bracket ball(r_min) ⊆ B ⊆ ball(1) (minFacetDistance)
    // gives r_min⁴ ≤ v/EXACT ≤ 1; r_min = 0.97497 at level 3, so the deficit
    // is provably below 1 − r_min⁴ = 9.6 %.
    expect(deficits[3]).toBeGreaterThan(0);
    expect(deficits[3]).toBeLessThan(0.055);
    const rMin3 = minFacetDistance(complexes[3]);
    expect(deficits[3]).toBeLessThan(1 - rMin3 ** 4);
    // Convergence: the chord depth of a tet of size h is O(h²) and h halves
    // each level, so the deficit should asymptotically shrink by 4 per level.
    // Measured ratios: 0.623, 0.355, 0.277, 0.256. Assert strict decrease at
    // every level and a ratio below ½ (twice the asymptotic value, as margin)
    // from level 1 → 2 on, where the coarse 16-cell start no longer dominates.
    for (let level = 1; level <= 4; level++) {
      expect(deficits[level], `level ${level}`).toBeLessThan(deficits[level - 1]);
      if (level >= 2) expect(deficits[level] / deficits[level - 1], `ratio at level ${level}`).toBeLessThan(0.5);
    }
  });

  it('scales as R⁴ with the radius', () => {
    // vol_4 = π² R⁴ / 2, so vol(R) / vol(1) = R⁴ exactly for the same tessellation.
    const r2 = hypersphereComplex(2, 2);
    expect(hypervolumeByCones(r2.positions, r2.tets) / hypervolumeByCones(complexes[2].positions, complexes[2].tets))
      .toBeCloseTo(16, 10);
    const s = hypersphere(2, 1);
    expect(s.radius()).toBeCloseTo(2, 12);
    expect(s.wRange()).toEqual([-2, 2]);
  });

  it('slices at w = 0, 0.5, 0.9 are closed spheres with volume near (4/3)π(1 − c²)^{3/2}', () => {
    const shape3 = hypersphere(1, 3);
    const shape4 = hypersphere(1, 4);
    const rMin3 = minFacetDistance(complexes[3]);
    // Measured relative deficits at level 3: 0.02320 (c = 0), 0.05777 (0.5),
    // 0.16313 (0.9); bounds set just above each. The deficit grows with c:
    // a radial chord depth δ shrinks the slice radius ρ = √(1 − c²) by
    // δ/ρ (since dρ/dr = r/ρ), so the relative volume error is ≈ 3δ/(1 − c²),
    // 5.3× the equatorial value at c = 0.9. Rigorous bracket from
    // ball(r_min) ⊆ B ⊆ ball(1): (4/3)π(r_min² − c²)^{3/2} ≤ A(c) ≤ (4/3)π(1 − c²)^{3/2},
    // i.e. deficits of at most 7.3 %, 9.7 %, 36.4 % at level 3; the upper
    // bound gets a 1e-6 allowance for Float32 slice vertices.
    const measuredBound: Record<string, number> = { '0': 0.025, '0.5': 0.06, '0.9': 0.17 };
    for (const c of [0, 0.5, 0.9]) {
      const exact = ballSliceVolume(1, c);
      const a3 = analyseSlice(shape3.slice(hyperplaneW(c)));
      expect(a3.closed, `closed at ${c}`).toBe(true);
      expect(a3.consistent, `consistent at ${c}`).toBe(true);
      expect(a3.euler, `euler at ${c}`).toBe(2);
      expect(a3.volume).toBeGreaterThanOrEqual(ballSliceVolume(rMin3, c));
      expect(a3.volume).toBeLessThanOrEqual(exact * (1 + 1e-6));
      const deficit3 = (exact - a3.volume) / exact;
      expect(deficit3, `deficit at ${c}`).toBeLessThan(measuredBound[String(c)]);
      // Refinement improves every slice (§8.5: discrete versions converge).
      const a4 = analyseSlice(shape4.slice(hyperplaneW(c)));
      expect(a4.closed).toBe(true);
      expect(a4.euler).toBe(2);
      expect((exact - a4.volume) / exact).toBeLessThan(deficit3);
    }
  });

  it('slice volume integrates to the cone hypervolume along a random direction (§7)', () => {
    const shape = hypersphere(1, 3);
    const dir = randUnit4(rng(7));
    const cones = hypervolumeByCones(shape.complex.positions, shape.complex.tets);
    // Cavalieri: ∫A(c)dc = vol_4 for the same discrete body. Midpoint rule
    // with 200 steps; measured relative difference 5e-7, bound 0.5 %.
    expect(Math.abs(sliceVolumeIntegral(shape, dir, 200) / cones - 1)).toBeLessThan(0.005);
  });
});

// ---------------------------------------------------------------------------

describe('duocylinder and Clifford torus (MATH.md §8.6)', () => {
  const R1 = 0.8;
  const R2 = 0.5;
  const N = 48;
  const RINGS = 6;
  const shape = duocylinder(R1, R2, N, RINGS);
  const { positions, tets } = shape.complex;
  /** Polygon correction (n/2π) sin(2π/n): area of the inscribed regular n-gon over π r². */
  const polygonFactor = (N / (2 * Math.PI)) * Math.sin((2 * Math.PI) / N);

  it('is a valid closed complex of 6n²(2·rings − 1) non-degenerate tets', () => {
    // Disk: n fan triangles + 2n per ring gap = n(2·rings − 1) triangles;
    // each × n circle segments, 3 tets per prism, two solid tori:
    // 6 n² (2·rings − 1) = 152 064. Vertices: torus grid n² plus, per torus,
    // n × (centre + (rings − 1) inner rings of n): n² + 2n(1 + (rings − 1)n).
    const v = validateTetComplex(positions, tets);
    expect(v.errors).toEqual([]);
    expect(v.degenerateTets).toBe(0);
    expect(tets.length).toBe(6 * N * N * (2 * RINGS - 1));
    expect(positions.length).toBe(N * N + 2 * N * (1 + (RINGS - 1) * N));
    // Every vertex lies on the boundary ∂P1 × P2 ∪ P1 × ∂P2 of the polygon
    // product: inside both discs and on at least one boundary circle.
    for (const [x, y, z, w] of positions) {
      const a = Math.hypot(x, y) - R1;
      const b = Math.hypot(z, w) - R2;
      expect(a).toBeLessThanOrEqual(1e-12);
      expect(b).toBeLessThanOrEqual(1e-12);
      expect(Math.max(a, b)).toBeCloseTo(0, 12);
    }
    expect(signedHypervolume(positions, tets)).toBeCloseTo(hypervolumeByCones(positions, tets), 12);
    expect(shape.kind).toBe('curved');
    expect(shape.radius()).toBeCloseTo(Math.hypot(R1, R2), 12);
    expect(shape.wRange()).toEqual([-R2, R2]);
  });

  it('default construction is valid too', () => {
    const d = duocylinderComplex();
    expect(validateTetComplex(d.positions, d.tets).errors).toEqual([]);
  });

  it('hypervolume is exactly π² r1² r2² ((n/2π) sin(2π/n))² and near π² r1² r2²', () => {
    // The discretised solid is the product P1 × P2 of regular n-gons, with
    // 4-volume area(P1)·area(P2) = [π r1² f][π r2² f], f the polygon factor.
    // Exact up to round-off in a sum of 152 064 cone determinants (~1e-12).
    const exactDiscrete = Math.PI ** 2 * R1 ** 2 * R2 ** 2 * polygonFactor ** 2;
    const v = hypervolumeByCones(positions, tets);
    expect(Math.abs(v - exactDiscrete)).toBeLessThan(1e-9);
    // Continuum: 1 − f² = 1 − 0.99715² = 0.57 % for n = 48; loose bound 1 %,
    // and the inscribed polygons make the discrete value smaller.
    const continuum = Math.PI ** 2 * R1 ** 2 * R2 ** 2;
    expect(v).toBeLessThan(continuum);
    expect(1 - v / continuum).toBeLessThan(0.01);
  });

  it('slice by w = c is a closed cylinder of volume area(P1) × chord(P2, c)', () => {
    // P1 × P2 cut by w = c is P1 × { z : (z, c) ∈ P2 }, a prism over the
    // n-gon P1 of height equal to the chord of P2 at w = c, so its volume is
    // polygonArea(r1, n) · polygonChord(r2, n, c) exactly. The slicer is
    // exact for flat tets; the 1e-6 relative tolerance covers Float32 slice
    // vertices (2^-24 ≈ 6e-8 per coordinate; measured ≤ 2e-8). Continuum
    // (§8.6): cylinder of radius r1 and height 2√(r2² − c²). The ratio
    // discrete/continuum lies in [f · √((r2² cos²(π/n) − c²)/(r2² − c²)), 1]:
    // the area factor is f, and P2 lies between the circles of radius
    // r2 cos(π/n) (inscribed) and r2 (circumscribed), which bracket the chord.
    const area1 = polygonArea(R1, N);
    for (const c of [0, 0.2, 0.4]) {
      const a = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(a.closed, `closed at ${c}`).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      const exactDiscrete = area1 * polygonChord(R2, N, c);
      expect(Math.abs(a.volume / exactDiscrete - 1)).toBeLessThan(1e-6);
      const continuum = Math.PI * R1 * R1 * 2 * Math.sqrt(R2 * R2 - c * c);
      const lowerFactor = polygonFactor * Math.sqrt((R2 * R2 * Math.cos(Math.PI / N) ** 2 - c * c) / (R2 * R2 - c * c));
      expect(a.volume / continuum).toBeLessThanOrEqual(1 + 1e-6);
      expect(a.volume / continuum).toBeGreaterThanOrEqual(lowerFactor);
    }
  });

  it('slice volume integrates to the cone hypervolume along a random direction (§7)', () => {
    const dir = randUnit4(rng(7));
    const cones = hypervolumeByCones(positions, tets);
    // Cavalieri with the midpoint rule, 200 steps; measured relative
    // difference 2e-7, bound 0.5 %.
    expect(Math.abs(sliceVolumeIntegral(shape, dir, 200) / cones - 1)).toBeLessThan(0.005);
  }, 60000);

  it('wire is the Clifford torus grid shared with the complex', () => {
    const wire = shape.wire();
    expect(wire).not.toBeNull();
    if (!wire) return;
    const torus = cliffordTorus(R1, R2, N, N);
    expect(wire.positions).toEqual(torus.positions);
    // The first n² complex vertices are the torus grid itself.
    for (let i = 0; i < N * N; i++) expect(positions[i]).toEqual(torus.positions[i]);
  });

  it('cliffordTorus lies on both circles, has nm vertices, 2nm edges, nm quads (χ = 0)', () => {
    const n = 12;
    const m = 20;
    const t = cliffordTorus(Math.SQRT1_2, Math.SQRT1_2, n, m);
    expect(t.positions.length).toBe(n * m);
    expect(t.edges.length).toBe(2 * n * m);
    expect(t.faces.length).toBe(n * m);
    for (const f of t.faces) expect(f.length).toBe(4);
    // Torus: V − E + F = nm − 2nm + nm = 0.
    expect(t.positions.length - t.edges.length + t.faces.length).toBe(0);
    for (const [x, y, z, w] of t.positions) {
      expect(Math.hypot(x, y)).toBeCloseTo(Math.SQRT1_2, 12);
      expect(Math.hypot(z, w)).toBeCloseTo(Math.SQRT1_2, 12);
      // With r1 = r2 = 1/√2 the torus lies on the unit S³ (§8.6).
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
    }
    // Every edge joins grid neighbours: exactly one of the two circle
    // positions changes.
    for (const [a, b] of t.edges) {
      const p = t.positions[a];
      const q = t.positions[b];
      const sameXY = Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;
      const sameZW = Math.abs(p[2] - q[2]) < 1e-12 && Math.abs(p[3] - q[3]) < 1e-12;
      expect(sameXY !== sameZW).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('Hopf fibration (MATH.md §3.3)', () => {
  it('base points: exactly `count` unit vectors, pairwise distinct', () => {
    for (const count of [1, 2, 5, 13, 24, 100]) {
      const pts = hopfBasePoints(count);
      expect(pts.length).toBe(count);
      const keys = new Set<string>();
      for (const p of pts) {
        expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 12);
        keys.add(p.map((v) => v.toFixed(9)).join(','));
      }
      expect(keys.size).toBe(count);
    }
  });

  it('every fibre point has |p| = 1, each fibre is a closed loop and maps to its base point', () => {
    const fibers = 24;
    const points = 64;
    const wire = hopfFibration(fibers, points);
    expect(wire.positions.length).toBe(fibers * points);
    expect(wire.edges.length).toBe(fibers * points);
    expect(wire.faces).toEqual([]);
    const bases = hopfBasePoints(fibers);
    for (let f = 0; f < fibers; f++) {
      expect(isSingleLoop(wire, f * points, points), `fibre ${f}`).toBe(true);
      for (let k = 0; k < points; k++) {
        const p = wire.positions[f * points + k];
        expect(length4(p)).toBeCloseTo(1, 12);
        // The Hopf map is constant along the fibre and equals the base point.
        const h = hopfMap(p);
        for (let i = 0; i < 3; i++) expect(h[i]).toBeCloseTo(bases[f][i], 12);
      }
    }
  });

  it('fibres over the poles are the unit circles in the xy- and zw-planes', () => {
    // North pole b = (0,0,1): z1 = 1, z2 = 0, fibre {(e^{it}, 0)} ⊂ xy-plane.
    for (const p of hopfFiber([0, 0, 1], 8)) {
      expect(p[2]).toBeCloseTo(0, 12);
      expect(p[3]).toBeCloseTo(0, 12);
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 12);
    }
    // South pole b = (0,0,−1): z1 = 0, fibre {(0, e^{it})} ⊂ zw-plane.
    for (const p of hopfFiber([0, 0, -1], 8)) {
      expect(p[0]).toBeCloseTo(0, 12);
      expect(p[1]).toBeCloseTo(0, 12);
      expect(Math.hypot(p[2], p[3])).toBeCloseTo(1, 12);
    }
  });

  it('hopfShape is a wire-only curved shape on the unit S³ with empty slices', () => {
    const s = hopfShape();
    expect(s.kind).toBe('curved');
    expect(s.wire()?.edges.length).toBeGreaterThan(0);
    expect(s.wire()?.faces).toEqual([]);
    expect(s.radius()).toBe(1);
    expect(s.wRange()).toEqual([-1, 1]);
    const m = s.slice(hyperplaneW(0));
    expect(m.indices.length).toBe(0);
    expect(m.positions.length).toBe(0);
  });
});
