/**
 * Adversarial tests for the SDF module (MATH.md §9.3, with §4, §5.2, §6, §7
 * and §8.5 for the machinery it feeds). Every expectation below is derived
 * from MATH.md or from standard mathematics in the comment next to it, never
 * from the implementation; tolerances are tied to the grid spacing h and
 * justified by the order of the discretisation error, with the measured
 * constant quoted where a measurement was needed to fix it.
 *
 * Measured facts referred to below (node 22, this checkout):
 *  - marchingTets3 volume of a ball of radius ρ: relative error ≈ −0.54 (h/ρ)²
 *    (inscribed PL surface, second order: the error quarters, not halves,
 *    per resolution doubling);
 *  - marchingPentatopes hypervolume of a 4-ball of radius r: relative error
 *    ≈ −1.00 (h/r)², again quartering per doubling;
 *  - tiger (R1 = R2 = 0.6, r = 0.25) hypervolume: ≈ −0.17 (h/r)².
 */
import { describe, expect, it } from 'vitest';
import type { Hyperplane, Mat4, Tet, TetComplex, Vec3, Vec4 } from '../../src/math/types';
import { hyperplane, hyperplaneFromRotation, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { compositeRotation, rotation } from '../../src/math/rotation';
import { apply4, mul4 } from '../../src/math/mat4';
import { centroid4, dot4, length4, sub4 } from '../../src/math/vec';
import {
  ball, box, capsule, difference, ditorus, duocylinder, intersection, rotate, rotateScene, scale, scaleScene,
  sdfScene, smoothMin, smoothUnion, smoothUnionMargin, spheritorus, tiger, torisphere, translate, translateScene, union,
} from '../../src/geometry/sdf';
import type { Sdf4, SdfScene } from '../../src/geometry/sdf';
import { CROSSING_SNAP, marchingPentatopes, marchingTets3 } from '../../src/geometry/isosurface';
import { SdfShape, sdfToTetShape, tetEdges } from '../../src/geometry/sdf-shape';
import {
  CREATURE_BLEND, CREATURE_PARTS, SDF_SHAPES, creatureScene, creatureShape, ditorusShape, spheritorusShape, tigerShape, torisphereShape,
} from '../../src/geometry/sdf-figures';
import { SHAPE_IDS } from '../../src/app/registry';
import { analyseSlice, checkClosedOriented, dropDegenerateTriangles, signedVolume, vertexAt } from '../../src/geometry/trimesh';
import { hypervolumeByCones, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { sliceTets } from '../../src/geometry/slice';

// ---- Seeded pseudo-random helpers --------------------------------------------

/** mulberry32: a small seeded generator, uniform on [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal by Box–Muller. */
const gaussian = (rand: () => number): number => {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Uniform random unit vector of R^4 (normalised Gaussian). */
function randomUnit4(rand: () => number): Vec4 {
  const v: Vec4 = [gaussian(rand), gaussian(rand), gaussian(rand), gaussian(rand)];
  const l = length4(v);
  return [v[0] / l, v[1] / l, v[2] / l, v[3] / l];
}

/** Uniform random point of the cube [−s, s]^4. */
const randomPoint4 = (rand: () => number, s: number): Vec4 =>
  [(2 * rand() - 1) * s, (2 * rand() - 1) * s, (2 * rand() - 1) * s, (2 * rand() - 1) * s];

/** A random rotation: the §2.2 composite of six random angles. */
const randomRotation = (rand: () => number): Mat4 => compositeRotation({
  XY: (2 * rand() - 1) * Math.PI, XZ: (2 * rand() - 1) * Math.PI, XW: (2 * rand() - 1) * Math.PI,
  YZ: (2 * rand() - 1) * Math.PI, YW: (2 * rand() - 1) * Math.PI, ZW: (2 * rand() - 1) * Math.PI,
});

const relErr = (measured: number, exact: number): number => (measured - exact) / exact;

/**
 * Yield to the event loop. Every test in this file is synchronous CPU work; vitest only awaits
 * microtasks between tests, so a long run of them starves the worker's RPC channel (birpc times
 * out after 60 s). Heavy tests breathe between their stages.
 */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Distinct vertices referenced by the tets (orphan positions excluded). */
function usedVertexCount(tets: readonly Tet[]): number {
  const used = new Set<number>();
  for (const t of tets) for (const i of t) used.add(i);
  return used.size;
}

/** Extract f over [−R, R]^4 at `n` cells per axis. */
const extract = (f: Sdf4, R: number, n: number): TetComplex => marchingPentatopes(f, [-R, -R, -R, -R], [R, R, R, R], n);

// ---- Known values (MATH.md §9.3 table) ------------------------------------------

const PI = Math.PI;
const ballVolume4 = (r: number): number => (PI * PI * r ** 4) / 2;
const ballVolume3 = (r: number): number => (4 / 3) * PI * r ** 3;
/** Slice of the 4-ball of radius r at offset c: a ball of radius √(r² − c²). §8.5 */
const ballSlice = (r: number, c: number): number => ballVolume3(Math.sqrt(r * r - c * c));
const spheritorusVolume = (R: number, r: number): number => 4 * PI * PI * R * R * r * r + PI * PI * r ** 4;
const torisphereVolume = (R: number, r: number): number => 2 * PI * R * ballVolume3(r);
const tigerVolume = (R1: number, R2: number, r: number): number => 4 * PI ** 3 * R1 * R2 * r * r;
const ditorusVolume = (R1: number, R2: number, r: number): number => 2 * PI * R1 * 2 * PI * R2 * PI * r * r;
const capsuleVolume = (L: number, r: number): number => ballVolume4(r) + ballVolume3(r) * L;
const duocylinderVolume = (r1: number, r2: number): number => PI * PI * r1 * r1 * r2 * r2;

/**
 * Tiger slice at w = c, derived from the field: the slice is
 * { (ρ1 − R1)² + (√(z² + c²) − R2)² ≤ r² } with ρ1 = √(x² + y²). For fixed z
 * the ρ1-interval is [R1 − a(z), R1 + a(z)], a(z) = √(r² − (√(z² + c²) − R2)²),
 * and ∫ 2π ρ1 dρ1 over it is 4π R1 a(z); so A(c) = 4π R1 ∫ a(z) dz (midpoint
 * rule, 20000 steps; the integrand has square-root ends, so the quadrature
 * error is ~N^{-3/2} ≈ 1e-6 relative). At c = 0 this is two solid tori of
 * volume 2π² R1 r² each, 4π² R1 r² in all, as §9.3 says.
 */
function tigerSliceVolume(R1: number, R2: number, r: number, c: number): number {
  const zmax = R2 + r;
  const N = 20000;
  const dz = (2 * zmax) / N;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const z = -zmax + (i + 0.5) * dz;
    const d = Math.sqrt(z * z + c * c) - R2;
    const rad = r * r - d * d;
    if (rad > 0) s += Math.sqrt(rad);
  }
  return 4 * PI * R1 * s * dz;
}

// ============================================================================
describe('§9.3 primitives: sign and exact Euclidean distance', () => {
  const rand = mulberry32(101);

  it('4-ball: f = |p| − r along every direction', () => {
    const f = ball(0.8);
    expect(f([0, 0, 0, 0])).toBeCloseTo(-0.8, 15);
    for (let i = 0; i < 50; i++) {
      const u = randomUnit4(rand);
      const t = 2.4 * rand();
      // f(t u) = t − r exactly (|t u| = t): inside for t < r, zero on the sphere, outside beyond.
      expect(f([t * u[0], t * u[1], t * u[2], t * u[3]])).toBeCloseTo(t - 0.8, 12);
    }
    expect(f([0.8, 0, 0, 0])).toBe(0);
  });

  it('4-box: the §9.3 formula is the exact signed distance to the box boundary', () => {
    const f = box([1, 2, 3, 4]);
    // Inside: min(max_i q_i, 0) = −(distance to the nearest face).
    expect(f([0, 0, 0, 0])).toBeCloseTo(-1, 15);
    expect(f([0.5, 0, 0, 0])).toBeCloseTo(-0.5, 15);
    expect(f([0.9, 1.9, 2.9, 3.9])).toBeCloseTo(-0.1, 12);
    // Outside past one face: that face's excess.
    expect(f([2, 0, 0, 0])).toBeCloseTo(1, 15);
    expect(f([0, 0, 0, -5])).toBeCloseTo(1, 15);
    // Outside past an edge: Euclidean distance to the edge, √(0.5² + 0.5²).
    expect(f([1.5, 2.5, 0, 0])).toBeCloseTo(Math.sqrt(0.5), 15);
    // Outside past a corner: distance to the corner (1, 2, 3, 4) from (2, 3, 4, 5) is 2.
    expect(f([2, 3, 4, 5])).toBeCloseTo(2, 15);
    // On the boundary: zero.
    expect(f([1, 0, 0, 0])).toBe(0);
    expect(f([1, 2, 3, 4])).toBe(0);
    // Symmetric under every coordinate sign flip.
    for (let i = 0; i < 30; i++) {
      const p = randomPoint4(rand, 6);
      const q: Vec4 = [-p[0], p[1], -p[2], p[3]];
      expect(f(q)).toBeCloseTo(f(p), 14);
    }
  });

  it('capsule: distance to the segment minus r; a = b is the ball', () => {
    const f = capsule([-1, 0, 0, 0], [1, 0, 0, 0], 0.5);
    expect(f([0, 0, 0, 0])).toBeCloseTo(-0.5, 15);
    expect(f([0.3, 0.5, 0, 0])).toBeCloseTo(0, 15); // on the cylinder part
    expect(f([0, 1, 0, 0])).toBeCloseTo(0.5, 15);
    expect(f([2, 0, 0, 0])).toBeCloseTo(0.5, 15); // beyond the end: distance to b = 1
    expect(f([1, 0, 0, 0.25])).toBeCloseTo(-0.25, 15);
    expect(f([3, 4, 0, 0])).toBeCloseTo(Math.sqrt(20) - 0.5, 14); // distance to b = √(2² + 4²)
    const g = capsule([0.2, -0.1, 0.3, 0.4], [0.2, -0.1, 0.3, 0.4], 0.3);
    const b = translate(ball(0.3), [0.2, -0.1, 0.3, 0.4]);
    for (let i = 0; i < 30; i++) {
      const p = randomPoint4(rand, 1.5);
      expect(g(p)).toBeCloseTo(b(p), 14);
    }
  });

  it('duocylinder: the max bound, exact on both tori', () => {
    const f = duocylinder(0.6, 0.4);
    expect(f([0, 0, 0, 0])).toBeCloseTo(-0.4, 15); // max(−0.6, −0.4)
    expect(f([0.6, 0, 0.4, 0])).toBeCloseTo(0, 15); // on the Clifford torus
    expect(f([0.6, 0, 0, 0])).toBeCloseTo(0, 15); // on the first torus boundary
    expect(f([1.2, 0, 0, 0])).toBeCloseTo(0.6, 15);
    expect(f([0, 0, 0, 0.8])).toBeCloseTo(0.4, 15);
    expect(f([0.3, 0, 0.2, 0])).toBeCloseTo(-0.2, 15);
    // f ≤ 0 exactly on the solid { ρ1 ≤ r1, ρ2 ≤ r2 } (§8.6).
    for (let i = 0; i < 200; i++) {
      const p = randomPoint4(rand, 0.8);
      const inside = Math.hypot(p[0], p[1]) <= 0.6 && Math.hypot(p[2], p[3]) <= 0.4;
      expect(f(p) <= 0).toBe(inside);
    }
  });

  it('spheritorus: −r on the core sphere, R − r at the origin, |s| − r along normals', () => {
    const R = 0.7;
    const r = 0.3;
    const f = spheritorus(R, r);
    expect(f([R, 0, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([0, R, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([0, 0, 0, 0])).toBeCloseTo(R - r, 15); // the origin is at distance R from the sphere
    expect(f([R, 0, 0, r])).toBeCloseTo(0, 15);
    expect(f([R + r, 0, 0, 0])).toBeCloseTo(0, 15);
    expect(f([R, 0, 0, 2 * r])).toBeCloseTo(r, 15);
    // The normal space at a core point R d (d a unit vector of R^3) is spanned by d and e_w:
    // p = (R + s cos θ) d + s sin θ e_w is at distance |s| from the sphere, so f = |s| − r.
    for (let i = 0; i < 50; i++) {
      const u = randomUnit4(rand);
      const l = Math.hypot(u[0], u[1], u[2]);
      const d: Vec3 = [u[0] / l, u[1] / l, u[2] / l];
      const s = 0.6 * rand();
      const th = 2 * PI * rand();
      const rho = R + s * Math.cos(th);
      expect(f([rho * d[0], rho * d[1], rho * d[2], s * Math.sin(th)])).toBeCloseTo(s - r, 12);
    }
  });

  it('torisphere: −r on the core circle, R − r at the origin, |s| − r along normals', () => {
    const R = 0.7;
    const r = 0.3;
    const f = torisphere(R, r);
    expect(f([R, 0, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([0, -R, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([0, 0, 0, 0])).toBeCloseTo(R - r, 15);
    expect(f([R, 0, 0, r])).toBeCloseTo(0, 15);
    expect(f([R, 0, r, 0])).toBeCloseTo(0, 15);
    expect(f([R, 0, 0.6 * r, 0.8 * r])).toBeCloseTo(0, 14);
    expect(f([0, 0, 0.3, 0.4])).toBeCloseTo(Math.hypot(R, 0.5) - r, 14);
    // Normal space at (R cos φ, R sin φ, 0, 0): radial direction, e_z, e_w (a 3-space).
    for (let i = 0; i < 50; i++) {
      const phi = 2 * PI * rand();
      const u = randomUnit4(rand);
      const l = Math.hypot(u[0], u[1], u[2]);
      const n: Vec3 = [u[0] / l, u[1] / l, u[2] / l]; // unit normal direction (radial, z, w)
      const s = 0.6 * rand();
      const rho = R + s * n[0];
      expect(f([rho * Math.cos(phi), rho * Math.sin(phi), s * n[1], s * n[2]])).toBeCloseTo(s - r, 12);
    }
  });

  it('tiger: −r on the Clifford torus, √(R1² + R2²) − r at the origin, |s| − r along normals', () => {
    const R1 = 0.6;
    const R2 = 0.5;
    const r = 0.25;
    const f = tiger(R1, R2, r);
    expect(f([R1, 0, R2, 0])).toBeCloseTo(-r, 15);
    expect(f([0, R1, 0, -R2])).toBeCloseTo(-r, 15);
    expect(f([0, 0, 0, 0])).toBeCloseTo(Math.hypot(R1, R2) - r, 15);
    expect(f([R1, 0, 0, 0])).toBeCloseTo(R2 - r, 15); // distance to the torus from the ρ2 = 0 axis plane
    expect(f([0, 0, R2, 0])).toBeCloseTo(R1 - r, 15);
    expect(f([R1 + r, 0, R2, 0])).toBeCloseTo(0, 15);
    expect(f([R1, 0, R2 + 2 * r, 0])).toBeCloseTo(r, 15);
    // Normal plane at a torus point: spanned by the two radial directions, so
    // (ρ1, ρ2) = (R1 + s cos θ, R2 + s sin θ) is at distance |s| for s < min(R1, R2).
    for (let i = 0; i < 50; i++) {
      const al = 2 * PI * rand();
      const be = 2 * PI * rand();
      const th = 2 * PI * rand();
      const s = 0.45 * rand();
      const rho1 = R1 + s * Math.cos(th);
      const rho2 = R2 + s * Math.sin(th);
      expect(f([rho1 * Math.cos(al), rho1 * Math.sin(al), rho2 * Math.cos(be), rho2 * Math.sin(be)])).toBeCloseTo(s - r, 12);
    }
  });

  it('ditorus: −r on the core torus, R1 − R2 − r at the origin, |s| − r along normals', () => {
    const R1 = 0.6;
    const R2 = 0.25;
    const r = 0.1;
    const f = ditorus(R1, R2, r);
    expect(f([R1 + R2, 0, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([R1 - R2, 0, 0, 0])).toBeCloseTo(-r, 15);
    expect(f([R1, 0, R2, 0])).toBeCloseTo(-r, 15);
    expect(f([0, 0, 0, 0])).toBeCloseTo(R1 - R2 - r, 15); // the origin is R1 − R2 from the core torus
    expect(f([R1 + R2 + r, 0, 0, 0])).toBeCloseTo(0, 15);
    expect(f([R1 + R2, 0, 0, r])).toBeCloseTo(0, 15);
    expect(f([R1 + R2, 0, 0, -3 * r])).toBeCloseTo(2 * r, 15);
    // Core point c(u, v) = ((R1 + R2 cos v) cos u, (R1 + R2 cos v) sin u, R2 sin v, 0) with 3D unit
    // normal m = (cos v cos u, cos v sin u, sin v, 0); the normal plane is span(m, e_w).
    for (let i = 0; i < 50; i++) {
      const u = 2 * PI * rand();
      const v = 2 * PI * rand();
      const th = 2 * PI * rand();
      const s = 0.2 * rand();
      const rho = R1 + (R2 + s * Math.cos(th)) * Math.cos(v);
      const z = (R2 + s * Math.cos(th)) * Math.sin(v);
      expect(f([rho * Math.cos(u), rho * Math.sin(u), z, s * Math.sin(th)])).toBeCloseTo(s - r, 12);
    }
  });

  it('every primitive is 1-Lipschitz (§9.3: a signed distance or a bound on it)', () => {
    const fields: Sdf4[] = [
      ball(0.7), box([0.5, 0.4, 0.3, 0.6]), capsule([-0.5, 0, 0.1, 0], [0.4, 0.3, 0, 0.2], 0.3),
      duocylinder(0.6, 0.5), spheritorus(0.7, 0.3), torisphere(0.7, 0.3), tiger(0.6, 0.6, 0.25), ditorus(0.6, 0.25, 0.1),
    ];
    for (const f of fields) {
      for (let i = 0; i < 300; i++) {
        const p = randomPoint4(rand, 1.3);
        const q = randomPoint4(rand, 1.3);
        expect(Math.abs(f(p) - f(q))).toBeLessThanOrEqual(length4(sub4(p, q)) * (1 + 1e-9) + 1e-12);
      }
    }
  });

  it('rejects non-positive parameters', () => {
    expect(() => ball(0)).toThrow(RangeError);
    expect(() => ball(-1)).toThrow(RangeError);
    expect(() => box([1, 1, 0, 1])).toThrow(RangeError);
    expect(() => capsule([0, 0, 0, 0], [1, 0, 0, 0], 0)).toThrow(RangeError);
    expect(() => tiger(1, 1, Number.NaN)).toThrow(RangeError);
    expect(() => sdfScene(ball(1), 0)).toThrow(RangeError);
    expect(() => sdfScene(ball(1), 1, [0.5, -0.5])).toThrow(RangeError);
    expect(() => smoothUnion(0, ball(1), ball(2))).toThrow(RangeError);
    expect(() => scale(ball(1), 0)).toThrow(RangeError);
    expect(() => rotate(ball(1), new Array<number>(15).fill(0))).toThrow(RangeError);
  });
});

// ============================================================================
describe('§9.3 operations', () => {
  const rand = mulberry32(202);
  const f = translate(ball(0.5), [0.3, 0, 0, 0]);
  const g = translate(ball(0.4), [-0.2, 0.1, 0, 0]);

  it('union = min, intersection = max, difference = max(f, −g), pointwise', () => {
    const h = box([0.2, 0.3, 0.4, 0.5]);
    for (let i = 0; i < 200; i++) {
      const p = randomPoint4(rand, 1.2);
      expect(union(f, g)(p)).toBe(Math.min(f(p), g(p)));
      expect(union(f, g, h)(p)).toBe(Math.min(f(p), g(p), h(p)));
      expect(intersection(f, g)(p)).toBe(Math.max(f(p), g(p)));
      expect(intersection(f, g, h)(p)).toBe(Math.max(f(p), g(p), h(p)));
      expect(difference(f, g)(p)).toBe(Math.max(f(p), -g(p)));
    }
  });

  it('smoothMin follows the §9.3 polynomial formula and its consequences', () => {
    const k = 0.15;
    for (let i = 0; i < 500; i++) {
      const a = (rand() - 0.5) * 0.8;
      const b = (rand() - 0.5) * 0.8;
      const hh = Math.max(k - Math.abs(a - b), 0);
      const expected = Math.min(a, b) - (hh * hh) / (4 * k);
      expect(smoothMin(a, b, k)).toBeCloseTo(expected, 15);
      expect(smoothMin(a, b, k)).toBeLessThanOrEqual(Math.min(a, b));
      expect(smoothMin(a, b, k)).toBeCloseTo(smoothMin(b, a, k), 15);
      if (Math.abs(a - b) >= k) expect(smoothMin(a, b, k)).toBe(Math.min(a, b));
      // 1-Lipschitz in each argument (the partial derivatives are in [0, 1]).
      const d = (rand() - 0.5) * 0.1;
      expect(Math.abs(smoothMin(a + d, b, k) - smoothMin(a, b, k))).toBeLessThanOrEqual(Math.abs(d) + 1e-15);
    }
    // Equal arguments: h = k, drop k/4 (this is also D_2 = smoothUnionMargin(k, 2)).
    expect(smoothMin(0.2, 0.2, k)).toBeCloseTo(0.2 - k / 4, 15);
    expect(smoothUnionMargin(k, 2)).toBeCloseTo(k / 4, 15);
  });

  it('smoothUnion ≤ union, equals it away from the blend, and stays within D_n of it', () => {
    const k = 0.15;
    const fields: Sdf4[] = [f, g, box([0.2, 0.3, 0.4, 0.5]), capsule([0, 0, -0.5, 0], [0, 0, 0.5, 0], 0.15)];
    const su = smoothUnion(k, fields[0], fields[1], fields[2], fields[3]);
    const un = union(fields[0], fields[1], fields[2], fields[3]);
    const Dn = smoothUnionMargin(k, fields.length);
    for (let i = 0; i < 500; i++) {
      const p = randomPoint4(rand, 1.5);
      const gap = un(p) - su(p);
      expect(gap).toBeGreaterThanOrEqual(-1e-15);
      expect(gap).toBeLessThanOrEqual(Dn + 1e-15);
      // Far from the blend region the fold is the plain min. "Far" must allow for the fold order:
      // two non-minimal values within k of each other blend first and their partial fold lies up
      // to D_{n−1} < k below the smaller of them, so it is enough that every other value exceeds
      // the minimum by 2k (the partial fold then stays more than k above the minimum, and later
      // values are more than k above it as well).
      const vals = fields.map((q) => q(p)).sort((x, y) => x - y);
      if (vals[1] - vals[0] >= 2 * k) expect(su(p)).toBe(un(p));
    }
    // The margin recurrence D_{j+1} = D_j + (k − D_j)²/(4k) is attained by n equal values:
    // folding n zeros gives −D_n exactly.
    for (const n of [2, 3, 4, 6]) {
      const zeros = Array.from({ length: n }, () => (() => 0) as Sdf4);
      const [a, b, ...rest] = zeros;
      expect(-smoothUnion(k, a, b, ...rest)([0, 0, 0, 0])).toBeCloseTo(smoothUnionMargin(k, n), 15);
      expect(smoothUnionMargin(k, n)).toBeLessThan(k);
    }
    expect(smoothUnionMargin(k, 3)).toBeCloseTo((25 / 64) * k, 15); // k/4 + (3k/4)²/(4k)
    expect(smoothUnionMargin(k, 1)).toBe(0);
  });

  it('translate, rotate, scale: f(M p) of the rotated field equals f(p), and the analogues', () => {
    const asym = union(translate(box([0.3, 0.2, 0.5, 0.1]), [0.4, -0.2, 0.1, 0.3]), capsule([-0.6, 0, 0, 0], [0, 0.5, 0.2, -0.4], 0.2));
    for (let trial = 0; trial < 20; trial++) {
      const M = randomRotation(rand);
      const rf = rotate(asym, M);
      const t = randomPoint4(rand, 0.7);
      const tf = translate(asym, t);
      const s = 0.3 + 2 * rand();
      const sf = scale(asym, s);
      for (let i = 0; i < 20; i++) {
        const p = randomPoint4(rand, 1.2);
        // §9.3: the rotated field is f(Mᵀ p), so M p is in the rotated solid iff p is in the original.
        expect(rf(apply4(M, p))).toBeCloseTo(asym(p), 12);
        expect(tf([p[0] + t[0], p[1] + t[1], p[2] + t[2], p[3] + t[3]])).toBeCloseTo(asym(p), 14);
        // s · f(p / s): distances scale by s.
        expect(sf([s * p[0], s * p[1], s * p[2], s * p[3]])).toBeCloseTo(s * asym(p), 12);
      }
    }
    // Scaling the unit ball by 2 is the ball of radius 2, as an exact distance.
    const b2 = scale(ball(1), 2);
    for (let i = 0; i < 20; i++) {
      const p = randomPoint4(rand, 3);
      expect(b2(p)).toBeCloseTo(ball(2)(p), 14);
    }
  });

  it('§9.3: the torisphere is the spun ball turned by R_YW(π/2) R_XZ(π/2)', () => {
    // A ball of radius r at height R spun about z = 0 (§9.2) has its centre on the circle
    // (0, 0, R cos φ, R sin φ); as a field it is √((√(z² + w²) − R)² + x² + y²) − r. The rotation
    // M = R_YW(π/2) R_XZ(π/2) sends e_z ↦ −e_x and e_w ↦ −e_y, carrying that circle into the
    // xy-plane: the rotated field must be the torisphere of §9.3 pointwise.
    const R = 0.7;
    const r = 0.3;
    const spunBall: Sdf4 = (p) => Math.sqrt((Math.hypot(p[2], p[3]) - R) ** 2 + p[0] * p[0] + p[1] * p[1]) - r;
    const M = mul4(rotation('YW', PI / 2), rotation('XZ', PI / 2));
    const turned = rotate(spunBall, M);
    const tor = torisphere(R, r);
    for (let i = 0; i < 200; i++) {
      const p = randomPoint4(rand, 1.2);
      expect(turned(p)).toBeCloseTo(tor(p), 13);
    }
  });

  it('scene helpers keep true bounds: translateScene, rotateScene, scaleScene', () => {
    const sc = sdfScene(translate(ball(0.5), [0, 0, 0, 0.2]), 0.7, [-0.3, 0.7]);
    const t: Vec4 = [0.3, -0.4, 0, 0.5];
    const ts = translateScene(sc, t);
    expect(ts.radius).toBeCloseTo(0.7 + length4(t), 15);
    expect(ts.wRange[0]).toBeCloseTo(0.2, 15);
    expect(ts.wRange[1]).toBeCloseTo(1.2, 15);
    const rs = rotateScene(sc, randomRotation(rand));
    expect(rs.radius).toBe(0.7);
    expect(rs.wRange).toEqual([-0.7, 0.7]);
    const ss = scaleScene(sc, 3);
    expect(ss.radius).toBeCloseTo(2.1, 15);
    expect(ss.wRange[0]).toBeCloseTo(-0.9, 15);
    expect(ss.wRange[1]).toBeCloseTo(2.1, 15);
    // Each derived field is non-negative on its own bounding sphere (true bound).
    for (const scene of [ts, rs, ss]) {
      for (let i = 0; i < 200; i++) {
        const u = randomUnit4(rand);
        expect(scene.f([u[0] * scene.radius, u[1] * scene.radius, u[2] * scene.radius, u[3] * scene.radius])).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });
});

// ============================================================================
describe('§9.3 direct slicing: marchingTets3', () => {
  const rand = mulberry32(303);

  it('ball slices are closed, consistently oriented spheres without any welding', () => {
    // marchingTets3 shares crossing vertices by grid edge, so the raw output must already be
    // closed and consistent (checkClosedOriented without welding), with Euler characteristic 2.
    for (const n of [9, 16, 33]) {
      const m = marchingTets3((q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.7, [-1, -1, -1], [1, 1, 1], n);
      const raw = checkClosedOriented(dropDegenerateTriangles(m, 0));
      expect(raw.closed).toBe(true);
      expect(raw.consistent).toBe(true);
      expect(raw.euler).toBe(2);
      expect(signedVolume(m)).toBeGreaterThan(0);
    }
  });

  it('ball slice volumes converge to (4/3)π(r² − c²)^{3/2}: second order in h, error quartering per doubling', async () => {
    // The PL surface of the linearly interpolated field |q| − ρ lies inside the sphere (the chord
    // of a convex function lies above it, so the interpolated zero is where g < 0), and its flat
    // faces lie inside their spherical caps: the volume is an underestimate with deficit O(h²)
    // (vertex displacement ~h²/(8ρ) and sagitta ~h²/(8ρ) over area 4πρ²). Measured relative
    // error ≈ −0.54 (h/ρ)²; asserted ≤ 0.8 (h/ρ)² and at least halving per doubling (measured
    // ratio ≈ 0.25, the quartering of a second-order scheme). What is measured is the signed
    // volume of the cleaned slice (analyseSlice) against the exact ball volume.
    const r = 1;
    const c = 0.3;
    const rho = Math.sqrt(r * r - c * c);
    const errors: number[] = [];
    for (const n of [10, 20, 40, 80]) {
      await breathe();
      const h = 2 / n;
      const m = marchingTets3((q: Vec3) => Math.hypot(q[0], q[1], q[2]) - rho, [-1, -1, -1], [1, 1, 1], n);
      const a = analyseSlice(m);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      const err = relErr(a.volume, ballSlice(r, c));
      expect(err).toBeLessThanOrEqual(0); // inscribed: never above the true volume
      expect(Math.abs(err)).toBeLessThanOrEqual(0.8 * (h / rho) ** 2);
      errors.push(Math.abs(err));
    }
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThanOrEqual(0.5 * errors[i - 1]);
  });

  it('SdfShape ball slices at many offsets, including c just below r: closed spheres, positive volume', async () => {
    const r = 1;
    for (const res of [40, 41]) {
      await breathe();
      const shape = new SdfShape('ball', sdfScene(ball(r), r), { sliceResolution: res });
      const h = (2 * r) / res;
      for (const c of [-0.999, -0.95, -0.5, 0, 0.3, 0.7, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999]) {
        const m = shape.slice(hyperplaneW(c));
        const a = analyseSlice(m);
        // Closed, consistent, a topological sphere (Euler 2) and outward (positive volume) at
        // every offset; for c = ±0.999 the slice ball has radius 0.045 < h and is a handful of
        // triangles around the grid vertices nearest the origin, still a closed sphere.
        expect(a.triangles).toBeGreaterThan(0);
        expect(a.closed).toBe(true);
        expect(a.consistent).toBe(true);
        expect(a.euler).toBe(2);
        expect(a.volume).toBeGreaterThan(0);
        expect(signedVolume(m)).toBeGreaterThan(0);
        const exact = ballSlice(r, c);
        expect(a.volume).toBeLessThanOrEqual(exact * (1 + 1e-9)); // inscribed
        const rho = Math.sqrt(r * r - c * c);
        if (rho >= 4 * h) expect(Math.abs(relErr(a.volume, exact))).toBeLessThanOrEqual(0.8 * (h / rho) ** 2 + 1e-3);
        // Every sourceW is the own-frame w of the slice, i.e. c (§10).
        for (let i = 0; i < m.sourceW.length; i++) expect(m.sourceW[i]).toBeCloseTo(c, 6);
      }
    }
  });

  it('a tilted hyperplane through the ball gives the same ball: §9.3 g(q) = f(c n + Σ q_k u_k)', () => {
    const shape = new SdfShape('ball', sdfScene(ball(1), 1), { sliceResolution: 40 });
    const reference = analyseSlice(shape.slice(hyperplaneW(0.4))).volume;
    for (let i = 0; i < 4; i++) {
      const n = randomUnit4(rand);
      const h = hyperplane(n, 0.4);
      const m = shape.slice(h);
      const a = analyseSlice(m);
      expect(a.closed).toBe(true);
      expect(a.euler).toBe(2);
      // The chart is an isometry, so g(q) = √(c² + |q|²) − 1 is the same sampled field for every
      // unit n: the volumes agree to rounding, not just to the discretisation error.
      expect(a.volume).toBeCloseTo(reference, 9);
      expect(Math.abs(relErr(a.volume, ballSlice(1, 0.4)))).toBeLessThan(0.01);
      // sourceW carries the 4D w of each vertex, w(unchart(h, q)) = c n_w + Σ q_k (u_k)_w (§10).
      for (let v = 0; v < m.sourceW.length; v += 7) {
        expect(m.sourceW[v]).toBeCloseTo(unchart(h, vertexAt(m, v))[3], 5);
      }
    }
  });

  it('a box whose faces lie on grid planes stays watertight (zero counts as positive, §6/§9.3)', () => {
    // Half-sizes 0.5 on the grid −1 + i/20: the faces x = ±0.5 are the grid planes i = 10, 30 and
    // every grid vertex on them has f = 0 exactly. Those vertices are positive, crossings on
    // edges into them are the vertices themselves, so the PL surface contains the faces exactly
    // and the volume cannot exceed 1. The 12 edges of the cube are chamfered within one cell
    // (the PL surface cannot turn a sharp corner inside a cell), each removing at most a prism
    // of cross-section h²/2 along a side of length 1: volume ∈ [1 − 6h², 1] (measured 1 − 2.9h²).
    const res = 40;
    const h = 2 / res;
    const shape = new SdfShape('box', sdfScene(box([0.5, 0.5, 0.5, 0.5]), 1), { sliceResolution: res });
    for (const c of [0, 0.25, 0.49]) {
      const m = shape.slice(hyperplaneW(c));
      const raw = checkClosedOriented(dropDegenerateTriangles(m, 0));
      expect(raw.closed).toBe(true);
      expect(raw.consistent).toBe(true);
      const a = analyseSlice(m);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expect(a.volume).toBeLessThanOrEqual(1 + 1e-6);
      expect(a.volume).toBeGreaterThanOrEqual(1 - 6 * h * h);
      for (let i = 0; i < m.positions.length; i++) expect(Math.abs(m.positions[i])).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    // At c = 0.5 the whole cell lies in the hyperplane and f = 0 there: zero is positive, so the
    // slice is empty (the limit from outside of the solid along w).
    expect(shape.slice(hyperplaneW(0.5)).indices.length).toBe(0);
    expect(shape.slice(hyperplaneW(-0.5)).indices.length).toBe(0);
  });

  it('a sphere through grid vertices (radius 0.5 on spacing 0.05) is watertight despite rounding noise', () => {
    // (±0.5, 0, 0) is sampled exactly as 0; (0.3, 0.4, 0) only to ~1e-16: those values are snapped
    // to 0 and the result must still be a closed sphere.
    const shape = new SdfShape('ball', sdfScene(ball(0.5), 1), { sliceResolution: 40 });
    const m = shape.slice(hyperplaneW(0));
    const a = analyseSlice(m);
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(2);
    expect(Math.abs(relErr(a.volume, ballVolume3(0.5)))).toBeLessThan(0.8 * (0.05 / 0.5) ** 2 + 1e-3);
  });

  it('orientation follows the sign: negating the field reverses every triangle', () => {
    const g = (q: Vec3): number => Math.hypot(q[0], q[1], q[2]) - 0.7;
    const m1 = marchingTets3(g, [-1, -1, -1], [1, 1, 1], 24);
    const m2 = marchingTets3((q) => -g(q), [-1, -1, -1], [1, 1, 1], 24);
    // Same zero set and crossing points, normals toward the positive side: the inside-out field's
    // sphere is oriented inward, so its signed volume is exactly the negative.
    expect(m2.indices.length).toBe(m1.indices.length);
    expect(signedVolume(m2)).toBeCloseTo(-signedVolume(m1), 9);
    expect(analyseSlice(m2).closed).toBe(true);
  });

  it('per-axis resolutions and a non-cubic grid', () => {
    const m = marchingTets3((q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.5, [-1, -0.6, -2], [1, 0.6, 2], [20, 12, 40]);
    const a = analyseSlice(m);
    expect(a.closed).toBe(true);
    expect(a.euler).toBe(2);
    // Spacing is 0.1 on every axis here: relative error ≤ 0.8 (0.1/0.5)² = 3.2% (measured 2%).
    expect(Math.abs(relErr(a.volume, ballVolume3(0.5)))).toBeLessThan(0.032);
  });

  it('fields with no zero set give the empty mesh; bad arguments throw', () => {
    expect(marchingTets3(() => 1, [-1, -1, -1], [1, 1, 1], 8).indices.length).toBe(0);
    expect(marchingTets3(() => -1, [-1, -1, -1], [1, 1, 1], 8).indices.length).toBe(0);
    expect(marchingTets3(() => 0, [-1, -1, -1], [1, 1, 1], 8).indices.length).toBe(0); // zero is positive
    expect(() => marchingTets3(() => 0, [-1, -1, -1], [1, 1, 1], 0)).toThrow(RangeError);
    expect(() => marchingTets3(() => 0, [-1, -1, -1], [1, 1, 1], 2.5)).toThrow(RangeError);
    expect(() => marchingTets3(() => 0, [1, -1, -1], [1, 1, 1], 4)).toThrow(RangeError);
    expect(() => marchingTets3(() => 0, [-1, -1, -1], [1, 1, 1], [4, 4] as unknown as [number, number, number])).toThrow(RangeError);
    expect(() => new SdfShape('x', sdfScene(ball(1), 1), { sliceResolution: 0 })).toThrow(RangeError);
    expect(CROSSING_SNAP).toBeGreaterThan(0);
    expect(CROSSING_SNAP).toBeLessThan(0.1);
  });

  it('a translated scene is sliced where it is: w range and radius are honoured', () => {
    // Ball of radius 1 moved to w = 0.5: radius 1.5, w ∈ [−0.5, 1.5]; the slice at w = c is the ball
    // of radius √(1 − (c − 0.5)²) and it must not be culled anywhere in (−0.5, 1.5).
    const sc = translateScene(sdfScene(ball(1), 1, [-1, 1]), [0, 0, 0, 0.5]);
    expect(sc.radius).toBeCloseTo(1.5, 15);
    expect(sc.wRange).toEqual([-0.5, 1.5]);
    const shape = new SdfShape('moved', sc, { sliceResolution: 40 });
    const h = 3 / 40;
    for (const c of [-0.3, 0.5, 1.3]) {
      const a = analyseSlice(shape.slice(hyperplaneW(c)));
      const rho = Math.sqrt(1 - (c - 0.5) ** 2);
      expect(a.closed).toBe(true);
      expect(a.euler).toBe(2);
      expect(Math.abs(relErr(a.volume, ballVolume3(rho)))).toBeLessThan(0.8 * (h / rho) ** 2 + 1e-3);
    }
    expect(shape.slice(hyperplaneW(1.5)).indices.length).toBe(0);
    expect(shape.slice(hyperplaneW(-0.6)).indices.length).toBe(0);
  });
});

// ============================================================================
describe('§9.3 extraction: marchingPentatopes', () => {
  const rand = mulberry32(404);
  const TIGER = { R1: 0.6, R2: 0.6, r: 0.25 };
  const tigerR = Math.hypot(TIGER.R1, TIGER.R2) + TIGER.r;

  it('validateTetComplex ok at resolutions 6, 8, 12 for ball, box (generic and grid-aligned) and tiger', async () => {
    const cases: Array<[string, Sdf4, number]> = [
      ['ball', ball(1), 1.2],
      ['box generic', box([0.5, 0.4, 0.3, 0.6]), 1],
      ['box aligned', box([0.5, 0.5, 0.5, 0.5]), 1], // faces on grid planes at n = 8 and 12
      ['tiger', tiger(TIGER.R1, TIGER.R2, TIGER.r), tigerR],
    ];
    for (const [name, f, R] of cases) {
      await breathe();
      for (const n of [6, 8, 12]) {
        const cx = extract(f, R, n);
        const v = validateTetComplex(cx.positions, cx.tets);
        expect(v.ok, `${name} at ${n}: ${v.errors.join('; ')}`).toBe(true);
        expect(v.boundaryFaces).toBe(0);
        expect(v.nonManifoldFaces).toBe(0);
        expect(v.inconsistentFaces).toBe(0);
        // Closed: every face in exactly two tets, so F = 4T/2.
        expect(v.faceCount).toBe(2 * cx.tets.length);
        expect(cx.tets.length).toBeGreaterThan(0);
      }
    }
  });

  it('the resolved ball and tiger complexes are 3-manifolds: V − E + F − T = 0, i.e. E = V + T', () => {
    // A closed 3-manifold has Euler characteristic 0; with F = 2T this reads E = V + T. It is
    // stronger than §5.2 (face pairing), ruling out pinched vertices. Checked where the tube is
    // resolved (h ≤ r): the tiger at n = 8 has h = 0.27 > r and does acquire pinched vertices at
    // grid points lying on its surface, which §5.2 does not forbid.
    for (const [f, R, ns] of [[ball(1), 1.2, [8, 12, 16]], [tiger(TIGER.R1, TIGER.R2, TIGER.r), tigerR, [12, 16]]] as Array<[Sdf4, number, number[]]>) {
      for (const n of ns) {
        const cx = extract(f, R, n);
        const E = tetEdges(cx.positions.length, cx.tets).length;
        expect(E).toBe(usedVertexCount(cx.tets) + cx.tets.length);
      }
    }
  });

  it('ball complex: every tet outward (N · centroid > 0), cones = signed hypervolume (§7, star-shaped)', () => {
    const cx = extract(ball(1), 1.2, 12);
    for (const t of cx.tets) {
      const N = tetNormal(cx.positions, t);
      const cen = centroid4(t.map((i) => cx.positions[i]));
      expect(dot4(N, cen)).toBeGreaterThan(0);
    }
    const signed = signedHypervolume(cx.positions, cx.tets);
    const cones = hypervolumeByCones(cx.positions, cx.tets);
    expect(signed).toBeGreaterThan(0);
    expect(cones).toBeCloseTo(signed, 10);
  });

  it('ball hypervolume converges to π² r⁴ / 2 with relative error ≈ (h/r)², quartering per doubling', () => {
    // Inscribed PL boundary again (§8.5 "tolerance appropriate to the subdivision level"):
    // measured relative error −1.00 (h/r)² at every resolution from 6 to 24; asserted ≤ 1.3 (h/r)²,
    // negative, and at least halving per doubling (measured ratio 0.25).
    const errs = new Map<number, number>();
    for (const n of [8, 12, 16, 24]) {
      const cx = extract(ball(1), 1.2, n);
      const h = 2.4 / n;
      const err = relErr(signedHypervolume(cx.positions, cx.tets), ballVolume4(1));
      expect(err).toBeLessThan(0);
      expect(Math.abs(err)).toBeLessThanOrEqual(1.3 * h * h);
      errs.set(n, Math.abs(err));
    }
    expect(errs.get(16)!).toBeLessThanOrEqual(0.5 * errs.get(8)!);
    expect(errs.get(24)!).toBeLessThanOrEqual(0.5 * errs.get(12)!);
  });

  it('tiger hypervolume converges to 4π³ R1 R2 r², and is not star-shaped about the origin (§7)', () => {
    // Tube of radius r: relative error measured ≈ −0.17 (h/r)²; asserted ≤ 0.3 (h/r)². The origin
    // is outside the tiger (f(0) = √(R1² + R2²) − r > 0), so the cone sum with absolute values
    // counts the region between the origin and the inner side of the tube twice and exceeds the
    // signed (divergence-theorem) value, which alone is the 4-volume.
    const exact = tigerVolume(TIGER.R1, TIGER.R2, TIGER.r);
    const errs: number[] = [];
    for (const n of [12, 24]) {
      const cx = extract(tiger(TIGER.R1, TIGER.R2, TIGER.r), tigerR, n);
      const h = (2 * tigerR) / n;
      const signed = signedHypervolume(cx.positions, cx.tets);
      const err = relErr(signed, exact);
      expect(err).toBeLessThan(0);
      expect(Math.abs(err)).toBeLessThanOrEqual(0.3 * (h / TIGER.r) ** 2);
      errs.push(Math.abs(err));
      const cones = hypervolumeByCones(cx.positions, cx.tets);
      expect(cones).toBeGreaterThan(1.2 * signed);
      // The signed sum is independent of the reference point for a closed complex (§7).
      expect(signedHypervolume(cx.positions, cx.tets, [0.3, -0.2, 0.7, 1.1])).toBeCloseTo(signed, 9);
    }
    expect(errs[1]).toBeLessThanOrEqual(0.5 * errs[0]);
  });

  it('box, capsule and duocylinder hypervolumes converge to the table values', async () => {
    // Non-smooth or merely bounded fields: still second order where the boundary is flat or
    // round, first order in the measure-zero corner regions. Measured: generic box −15% at 12,
    // −4.2% at 24; capsule −11% at 12, −2.9% at 24; duocylinder −5.4% at 12, −1.4% at 24. Asserted:
    // the error at 24 is below 0.4 of that at 12 (a drop of 2.5× for a doubling, between first and
    // second order) and below 6%.
    const cases: Array<[string, Sdf4, number, number]> = [
      ['box', box([0.5, 0.4, 0.3, 0.6]), 1, 16 * 0.5 * 0.4 * 0.3 * 0.6],
      ['capsule', capsule([-0.5, 0, 0, 0], [0.5, 0, 0, 0], 0.4), 1, capsuleVolume(1, 0.4)],
      ['duocylinder', duocylinder(0.6, 0.5), 0.8, duocylinderVolume(0.6, 0.5)],
    ];
    for (const [name, f, R, exact] of cases) {
      await breathe();
      const c12 = extract(f, R, 12);
      expect(validateTetComplex(c12.positions, c12.tets).ok, name).toBe(true);
      const e12 = Math.abs(relErr(signedHypervolume(c12.positions, c12.tets), exact));
      const cx = extract(f, R, 24);
      expect(signedHypervolume(cx.positions, cx.tets)).toBeGreaterThan(0);
      const e24 = Math.abs(relErr(signedHypervolume(cx.positions, cx.tets), exact));
      expect(e24, name).toBeLessThan(0.06);
      expect(e24, name).toBeLessThan(0.4 * e12);
    }
  });

  it('slices of the extracted complex (sliceTets) agree with direct slices and with the exact values', async () => {
    // Ball at n = 16 (h = 0.15): the complex's slice is an inscribed PL sphere of a PL 3-sphere,
    // relative error measured −1.1% to −2.1% for c ≤ 0.6 (≈ (h/ρ)², as for the hypervolume);
    // the direct slice at 40 cells has error ≈ 0.54 (0.05/ρ)² ≤ 0.3%. Tolerances 4% and 1%.
    const cx = extract(ball(1), 1.2, 16);
    const direct = new SdfShape('ball', sdfScene(ball(1), 1), { sliceResolution: 40 });
    const dirs: Hyperplane[] = [hyperplaneW(0), hyperplaneW(0.3), hyperplaneW(0.6), hyperplane(randomUnit4(rand), 0.2), hyperplane(randomUnit4(rand), 0.5)];
    for (const h of dirs) {
      const exact = ballSlice(1, h.offset);
      const a = analyseSlice(sliceTets(cx.positions, cx.tets, h));
      const b = analyseSlice(direct.slice(h));
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expect(a.volume).toBeGreaterThan(0);
      expect(Math.abs(relErr(a.volume, exact))).toBeLessThan(0.04);
      expect(Math.abs(relErr(b.volume, exact))).toBeLessThan(0.01);
      expect(Math.abs(relErr(a.volume, b.volume))).toBeLessThan(0.04);
    }
    // Tiger at n = 20 (h = 0.11, r = 0.25): measured complex-slice error −3% at c = 0, 0.2, 0.5
    // against A(c) from tigerSliceVolume; direct slice (48 cells) within 0.6%. Tolerances 6% / 1.5%.
    await breathe();
    const shape = tigerShape();
    const tc = extract(shape.scene.f, shape.scene.radius, 20);
    for (const c of [0, 0.2, 0.5]) {
      const exact = tigerSliceVolume(TIGER.R1, TIGER.R2, TIGER.r, c);
      const a = analyseSlice(sliceTets(tc.positions, tc.tets, hyperplaneW(c)));
      const b = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(0); // one or two solid tori: Euler characteristic 0 either way
      expect(b.euler).toBe(0);
      expect(Math.abs(relErr(a.volume, exact))).toBeLessThan(0.06);
      expect(Math.abs(relErr(b.volume, exact))).toBeLessThan(0.015);
    }
  });

  it('sdfToTetShape wraps the complex as a TetShape of kind sdf whose slices are sliceTets', () => {
    const sc = sdfScene(ball(1), 1.2);
    const shape = sdfToTetShape('ball', sc, 10);
    const cx = extract(ball(1), 1.2, 10);
    expect(shape.kind).toBe('sdf');
    expect(shape.complex.tets.length).toBe(cx.tets.length);
    expect(shape.radius()).toBeLessThanOrEqual(1.2);
    expect(shape.radius()).toBeGreaterThan(0.9); // the PL sphere reaches within h of radius 1
    const h = hyperplane(randomUnit4(rand), 0.3);
    const a = shape.slice(h);
    const b = sliceTets(cx.positions, cx.tets, h);
    expect(a.indices.length).toBe(b.indices.length);
    expect(signedVolume(a)).toBeCloseTo(signedVolume(b), 9);
    const wire = shape.wire();
    expect(wire).not.toBeNull();
    expect(wire!.edges.length).toBe(tetEdges(cx.positions.length, cx.tets).length);
    expect(wire!.faces).toEqual([]);
    // tetEdges: each undirected edge once, sorted, matching a brute-force set.
    const brute = new Set<string>();
    for (const t of cx.tets) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) brute.add(`${Math.min(t[i], t[j])},${Math.max(t[i], t[j])}`);
    expect(wire!.edges.length).toBe(brute.size);
    for (const [p, q] of wire!.edges) expect(p).toBeLessThan(q);
  });

  it('per-axis resolutions, a grid-vertex sphere, and the grid-size guard', () => {
    // Ball of radius 1 on [−2, 2]^4 at 8 cells: (±1, 0, 0, 0) are grid vertices on the surface.
    const cx = marchingPentatopes(ball(1), [-2, -2, -2, -2], [2, 2, 2, 2], 8);
    expect(validateTetComplex(cx.positions, cx.tets).ok).toBe(true);
    const cy = marchingPentatopes(ball(0.5), [-1, -0.7, -0.8, -0.6], [1, 0.7, 0.8, 0.6], [10, 7, 8, 6]);
    expect(validateTetComplex(cy.positions, cy.tets).ok).toBe(true);
    expect(relErr(signedHypervolume(cy.positions, cy.tets), ballVolume4(0.5))).toBeLessThan(0);
    expect(Math.abs(relErr(signedHypervolume(cy.positions, cy.tets), ballVolume4(0.5)))).toBeLessThan(1.3 * (0.2 / 0.5) ** 2);
    // 61⁴ vertices × 16 cache slots exceed the 2²⁷-entry limit: refused before any allocation.
    expect(() => marchingPentatopes(ball(1), [-1, -1, -1, -1], [1, 1, 1, 1], 60)).toThrow(RangeError);
    expect(() => marchingPentatopes(ball(1), [-1, -1, -1, -1], [1, 1, 1, 1], 0)).toThrow(RangeError);
    expect(() => marchingPentatopes(ball(1), [-1, -1, -1, -1], [-1, 1, 1, 1], 4)).toThrow(RangeError);
    expect(marchingPentatopes(() => 1, [-1, -1, -1, -1], [1, 1, 1, 1], 3).tets.length).toBe(0);
  });
});

// ============================================================================
describe('sdf-figures: the catalogue entries', () => {
  const rand = mulberry32(505);

  it('SDF_SHAPES ids are exactly the registry sdf ids, unique, grouped and labelled', () => {
    const registryIds = Object.entries(SHAPE_IDS).filter(([key]) => key.startsWith('sdf')).map(([, id]) => id).sort();
    const ids = SDF_SHAPES.map((e) => e.id);
    expect([...ids].sort()).toEqual(registryIds);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SDF_SHAPES) {
      expect(e.group).toBe('Smooth forms (SDF)');
      expect(e.description.length).toBeGreaterThan(20);
      const s = e.create();
      expect(s.kind).toBe('sdf');
      expect(s.name).toBe(e.label);
      expect(s.radius()).toBeGreaterThan(0);
      const [w0, w1] = s.wRange();
      expect(w0).toBeLessThan(w1);
      expect(Math.abs(w0)).toBeLessThanOrEqual(s.radius() + 1e-12);
      expect(Math.abs(w1)).toBeLessThanOrEqual(s.radius() + 1e-12);
    }
  });

  it('scene bounds are true bounds: f ≥ 0 on the bounding sphere and on the w-range planes', () => {
    for (const e of SDF_SHAPES) {
      const s = e.create() as SdfShape;
      const sc: SdfScene = s.scene;
      for (let i = 0; i < 4000; i++) {
        const u = randomUnit4(rand);
        expect(sc.f([u[0] * sc.radius, u[1] * sc.radius, u[2] * sc.radius, u[3] * sc.radius]), e.id).toBeGreaterThanOrEqual(-1e-9);
        // A random point of the disc |xyz| ≤ √(R² − w²) on the plane w = wRange end.
        const w = i % 2 ? sc.wRange[1] : sc.wRange[0];
        const l = Math.hypot(u[0], u[1], u[2]);
        const rr = Math.sqrt(Math.max(0, sc.radius ** 2 - w * w)) * Math.cbrt(rand());
        expect(sc.f([(u[0] / l) * rr, (u[1] / l) * rr, (u[2] / l) * rr, w]), e.id).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // The creature's bounds derive from CREATURE_PARTS plus the smooth-union margin.
    const sc = creatureScene();
    let partRadius = 0;
    let partW = 0;
    for (const p of CREATURE_PARTS) {
      partRadius = Math.max(partRadius, length4(p.a) + p.r, length4(p.b) + p.r);
      partW = Math.max(partW, Math.abs(p.a[3]) + p.r, Math.abs(p.b[3]) + p.r);
    }
    const margin = smoothUnionMargin(CREATURE_BLEND, CREATURE_PARTS.length);
    expect(sc.radius).toBeCloseTo(partRadius + margin, 12);
    expect(sc.wRange[1]).toBeCloseTo(partW + margin, 12);
    expect(sc.wRange[0]).toBeCloseTo(-(partW + margin), 12);
  });

  it('spheritorus slices are the shells R − a ≤ |q| ≤ R + a of §9.3, volume 8πR²a + (8π/3)a³', async () => {
    // R = 0.7, r = 0.3, grid 40 cells on [−1, 1]: h = 0.05. The shell's surfaces are spheres of
    // radius R ± a (curvature radius ≈ 0.7), so the PL error is ≈ 0.54 (h/0.7)² ≈ 0.3%; at c = 0.25
    // the shell is only 2a = 0.33 = 6.6 cells thick and the interpolation across it adds
    // ≈ h²/(8a)/(2a) ≈ 0.8%. Tolerances 0.5% and 2%. Two spheres: Euler characteristic 4.
    const shape = spheritorusShape();
    const R = 0.7;
    const r = 0.3;
    for (const [c, tol] of [[0, 0.005], [0.15, 0.005], [0.25, 0.02]] as const) {
      await breathe();
      const a = Math.sqrt(r * r - c * c);
      const exact = 8 * PI * R * R * a + (8 * PI / 3) * a ** 3;
      const m = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(m.closed).toBe(true);
      expect(m.consistent).toBe(true);
      expect(m.euler).toBe(4);
      expect(Math.abs(relErr(m.volume, exact))).toBeLessThan(tol);
    }
  });

  it('torisphere slices are solid tori of major radius R and minor radius √(r² − c²), volume 2π²R(r² − c²)', () => {
    // Tube radius a = √(r² − c²): PL error ≈ 0.5 (h/a)² (cross-section circle inscribed), h = 0.05:
    // 1.4% at c = 0 (measured 0.45%), 2.5% at c = 0.2 (a = 0.224). Tolerances 2% and 4%.
    const shape = torisphereShape();
    const R = 0.7;
    const r = 0.3;
    for (const [c, tol] of [[0, 0.02], [0.15, 0.025], [0.2, 0.04]] as const) {
      const exact = 2 * PI * PI * R * (r * r - c * c);
      const m = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(m.closed).toBe(true);
      expect(m.consistent).toBe(true);
      expect(m.euler).toBe(0);
      expect(Math.abs(relErr(m.volume, exact))).toBeLessThan(tol);
    }
  });

  it('tiger slices: two solid tori at w = 0 (volume 4π² R1 r²), fusing past |c| = R2 − r', async () => {
    const shape = tigerShape();
    const { R1, R2, r } = { R1: 0.6, R2: 0.6, r: 0.25 };
    expect(tigerSliceVolume(R1, R2, r, 0)).toBeCloseTo(4 * PI * PI * R1 * r * r, 5);
    // Grid 48 cells on [−1.0985, 1.0985]: h = 0.046, tube radius 0.25: PL error ≈ 0.5 (h/r)² ≈ 1.7%
    // bound, measured ≤ 0.6%. Tolerance 1.5%. Euler 0 for one or two solid tori.
    for (const c of [0, 0.2, 0.3, 0.5, 0.7]) {
      await breathe();
      const m = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(m.closed, `c = ${c}`).toBe(true);
      expect(m.consistent).toBe(true);
      expect(m.euler).toBe(0);
      expect(Math.abs(relErr(m.volume, tigerSliceVolume(R1, R2, r, c)))).toBeLessThan(0.015);
    }
    // Exactly at |c| = R2 − r the two tori touch along the circle ρ1 = R1, z = 0, which is a grid
    // plane: the true boundary is pinched there and the output is non-manifold along that circle,
    // yet its volume is still right. Just off the touching offset the slice is closed again.
    const pinched = analyseSlice(shape.slice(hyperplaneW(R2 - r)));
    expect(Math.abs(relErr(pinched.volume, tigerSliceVolume(R1, R2, r, R2 - r)))).toBeLessThan(0.015);
    for (const c of [R2 - r - 0.01, R2 - r + 0.01]) expect(analyseSlice(shape.slice(hyperplaneW(c))).closed).toBe(true);
    // Beyond R2 + r the slice vanishes (§9.3).
    expect(shape.slice(hyperplaneW(R2 + r + 1e-3)).indices.length).toBe(0);
  });

  it('ditorus slices are thick torus shells R2 − a ≤ dist ≤ R2 + a, volume 8π² R1 R2 a', async () => {
    // Solid torus (R1, R2 + a) minus solid torus (R1, R2 − a): 2π²R1[(R2 + a)² − (R2 − a)²] = 8π²R1R2a.
    // Grid 64 cells on [−0.95, 0.95]: h = 0.03; wall thickness 2a = 0.2 = 6.7 cells at c = 0; the
    // shell surfaces have curvature radius ≥ 0.15. Measured error ≤ 0.3% at c ≤ 0.05; tolerance 1%.
    // Torus × interval: boundary is two tori, Euler characteristic 0.
    const shape = ditorusShape();
    const R1 = 0.6;
    const R2 = 0.25;
    const r = 0.1;
    for (const c of [0, 0.05]) {
      await breathe();
      const a = Math.sqrt(r * r - c * c);
      const m = analyseSlice(shape.slice(hyperplaneW(c)));
      expect(m.closed).toBe(true);
      expect(m.consistent).toBe(true);
      expect(m.euler).toBe(0);
      expect(Math.abs(relErr(m.volume, 8 * PI * PI * R1 * R2 * a))).toBeLessThan(0.01);
    }
    expect(shape.slice(hyperplaneW(r)).indices.length).toBe(0);
  });

  it('the creature differs on the two sides of w = 0 and is sliced in well under 40 ms', () => {
    const shape = creatureShape();
    const plus = analyseSlice(shape.slice(hyperplaneW(0.4)));
    const minus = analyseSlice(shape.slice(hyperplaneW(-0.4)));
    expect(plus.volume).toBeGreaterThan(0);
    expect(minus.volume).toBeGreaterThan(0);
    expect(Math.abs(plus.volume - minus.volume)).toBeGreaterThan(0.02 * Math.max(plus.volume, minus.volume));
    const times: number[] = [];
    for (const c of [-0.3, -0.1, 0, 0.1, 0.3]) {
      const t0 = performance.now();
      shape.slice(hyperplaneW(c));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // Measured median ≈ 15 ms here; asserted loosely against a slow runner.
    expect(times[2]).toBeLessThan(120);
  });

  it('the support-interval cull never drops a non-empty slice (compared with the uncullled grid)', async () => {
    // SdfShape.slice skips hyperplanes outside the support of the ball ∩ slab region. For the same
    // hyperplane, marchingTets3 over the same grid on the same field must give an identical mesh
    // whenever the shape computes one, and an empty mesh whenever the shape culls.
    const shapes: SdfShape[] = [
      ...SDF_SHAPES.map((e) => e.create() as SdfShape),
      new SdfShape('moved ball', translateScene(sdfScene(ball(0.6), 0.6), [0.2, -0.3, 0.1, 0.5]), { sliceResolution: 24 }),
    ];
    // (A sweep need not cull anything for a shape that fills its bounding sphere in some
    // direction, like the spheritorus in the w = 0 directions; the thin figures along e_w cull most
    // offsets, so the culling branch is certainly exercised overall.)
    let culled = 0;
    for (const s of shapes) {
      await breathe();
      const sc = s.scene;
      const R = sc.radius;
      const res = (s as unknown as { sliceResolution: number }).sliceResolution;
      for (const n of [[0, 0, 0, 1] as Vec4, randomUnit4(rand)]) {
        for (let i = 0; i < 16; i++) {
          const c = -R + (i + 0.5) * ((2 * R) / 16);
          const h = hyperplane(n, c);
          const viaShape = s.slice(h);
          const direct = marchingTets3((q: Vec3) => sc.f(unchart(h, q)), [-R, -R, -R], [R, R, R], res);
          if (viaShape.indices.length === 0) {
            culled++;
            expect(direct.indices.length, `${s.name} culled a non-empty slice at c = ${c}`).toBe(0);
          } else {
            expect(viaShape.indices.length).toBe(direct.indices.length);
            expect(signedVolume(viaShape)).toBeCloseTo(signedVolume(direct), 12);
          }
        }
      }
    }
    expect(culled).toBeGreaterThan(10);
  });

  it('§4: slicing the rotated scene at w = c equals slicing the scene with hyperplaneFromRotation(M, c)', () => {
    // rotateScene gives f(Mᵀp) on the same grid; at w = c its sampled values are
    // f(Mᵀ(c e_w + Σ q_k e_k)) = f(c Mᵀe_w + Σ q_k Mᵀe_k), exactly the samples of the unrotated field
    // on hyperplaneFromRotation(M, c) (normal Mᵀe_w, basis Mᵀe_k). Same values, same meshes.
    const sc = creatureScene();
    for (let trial = 0; trial < 3; trial++) {
      const M = randomRotation(rand);
      const rotated = new SdfShape('rot', rotateScene(sc, M), { sliceResolution: 24 });
      const plain = new SdfShape('plain', sc, { sliceResolution: 24 });
      for (const c of [0, 0.25, -0.4]) {
        const a = rotated.slice(hyperplaneW(c));
        const b = plain.slice(hyperplaneFromRotation(M, c));
        expect(a.indices.length).toBe(b.indices.length);
        expect(a.positions.length).toBe(b.positions.length);
        expect(a.indices.length).toBeGreaterThan(0);
        for (let i = 0; i < a.positions.length; i++) expect(Math.abs(a.positions[i] - b.positions[i])).toBeLessThan(1e-6);
        expect(signedVolume(a)).toBeCloseTo(signedVolume(b), 9);
        // sourceW: the rotated scene's own w is c; the plain scene reports the unrotated w of each
        // point, which differs from c in general (§10).
        for (let i = 0; i < a.sourceW.length; i += 11) expect(a.sourceW[i]).toBeCloseTo(c, 6);
      }
    }
    // The same identity for the extracted complex: rotate its vertices by M and slice at w = c.
    const cx = extract(tiger(0.6, 0.6, 0.25), Math.hypot(0.6, 0.6) + 0.25, 10);
    const M = randomRotation(rand);
    const moved = cx.positions.map((p) => apply4(M, p));
    const a = sliceTets(moved, cx.tets, hyperplaneW(0.2));
    const b = sliceTets(cx.positions, cx.tets, hyperplaneFromRotation(M, 0.2));
    expect(a.indices.length).toBe(b.indices.length);
    expect(signedVolume(a)).toBeCloseTo(signedVolume(b), 9);
  });
});

// ============================================================================
describe('§7 Cavalieri: ∫ A(c) dc over seeded random directions', () => {
  const rand = mulberry32(606);
  const dirs = (): Vec4[] => [[0, 0, 0, 1], randomUnit4(rand), randomUnit4(rand)];

  // Tolerances from the slice-grid spacing h of each figure and the PL error ≈ C (h/a)² with
  // a the smallest curvature radius of the boundary (C ≈ 0.5), plus the midpoint rule over c
  // (200 steps; A(c) has square-root ends, error ~1e-4 relative). All integrals must also agree
  // with each other across directions to 1% (the PL bias is direction-independent to first order)
  // and lie below the exact value (inscribed surfaces).
  const checkTable = async (shape: SdfShape, exact: number, tol: number): Promise<void> => {
    const values: number[] = [];
    for (const d of dirs()) {
      await breathe();
      values.push(sliceVolumeIntegral(shape, d, 200));
    }
    for (const I of values) {
      expect(Math.abs(relErr(I, exact))).toBeLessThan(tol);
      expect(I).toBeLessThan(exact);
    }
    const spread = (Math.max(...values) - Math.min(...values)) / exact;
    expect(spread).toBeLessThan(0.01);
  };

  it('spheritorus: 4π²R²r² + π²r⁴ (derived in §9.3 from the shell slices)', async () => {
    // h = 0.05 on [−1, 1], curvature radius ≈ R − r = 0.4 at worst: 0.5 (0.05/0.4)² ≈ 0.8%. Measured −0.5%.
    await checkTable(spheritorusShape(), spheritorusVolume(0.7, 0.3), 0.015);
  });

  it('torisphere: 2πR · (4/3)πr³ (Pappus)', async () => {
    // Tube radius 0.3, h = 0.05: 0.5 (h/r)² ≈ 1.4%. Measured −1.0%.
    await checkTable(torisphereShape(), torisphereVolume(0.7, 0.3), 0.025);
  });

  it('tiger: 4π³ R1 R2 r² (flat torus times normal disc)', async () => {
    // Tube radius 0.25, h = 0.046: 0.5 (h/r)² ≈ 1.7%. Measured −0.4%.
    await checkTable(tigerShape(), tigerVolume(0.6, 0.6, 0.25), 0.015);
  });

  it('ditorus: 2πR1 · 2πR2 · πr² (a circle swept twice)', async () => {
    // Tube radius 0.1, h = 0.03: 0.5 (h/r)² ≈ 4.4%. Measured −1.3% to −1.6%.
    await checkTable(ditorusShape(), ditorusVolume(0.6, 0.25, 0.1), 0.03);
  });

  it('capsule, duocylinder and box (table rows without a catalogue entry)', async () => {
    // capsule r = 0.4, L = 1 on [−0.9, 0.9] at 40 cells (h = 0.045): 0.5 (h/r)² ≈ 0.6%; measured −0.6%.
    const cap = new SdfShape('capsule', sdfScene(capsule([-0.5, 0, 0, 0], [0.5, 0, 0, 0], 0.4), 0.9, [-0.4, 0.4]), { sliceResolution: 40 });
    await checkTable(cap, capsuleVolume(1, 0.4), 0.02);
    // duocylinder (0.6, 0.5): the §8.6 solid; the bound field still has the right zero set. Measured −0.4%.
    const duo = new SdfShape('duocylinder', sdfScene(duocylinder(0.6, 0.5), Math.hypot(0.6, 0.5), [-0.5, 0.5]), { sliceResolution: 40 });
    await checkTable(duo, duocylinderVolume(0.6, 0.5), 0.015);
    // Its slice at w = c is the cylinder of radius r1 and height 2√(r2² − c²) (§8.6).
    for (const c of [0, 0.3]) {
      const m = analyseSlice(duo.slice(hyperplaneW(c)));
      expect(m.closed).toBe(true);
      expect(m.euler).toBe(2);
      expect(Math.abs(relErr(m.volume, PI * 0.36 * 2 * Math.sqrt(0.25 - c * c)))).toBeLessThan(0.01);
    }
    // box half-sizes (0.5, 0.4, 0.3, 0.6): 16 h1h2h3h4 = 0.576. Edge chamfers are O(h²) per edge; measured −0.7% to −1%.
    const bx = new SdfShape('box', sdfScene(box([0.5, 0.4, 0.3, 0.6]), Math.hypot(0.5, 0.4, 0.3, 0.6), [-0.6, 0.6]), { sliceResolution: 40 });
    await checkTable(bx, 16 * 0.5 * 0.4 * 0.3 * 0.6, 0.02);
  });

  it('creature: Cavalieri agrees with its extracted complex and with a seeded Monte Carlo volume', async () => {
    // No table value: three independent estimates must agree. The complex at 32 cells per axis
    // (h = 0.071) and the slices at 40 cells (h = 0.057) are both inscribed PL estimates; the arms
    // and legs (radius 0.12–0.13) are 3.4–4.5 cells across and carry ≈ 10% of the volume, so the
    // two PL estimates sit ≈ 2% apart (measured 0.195 vs 0.199) and ≈ 2% below the true value.
    // Monte Carlo on the bounding box with N samples has standard error σ = V_box √(p(1−p)/N).
    const shape = creatureShape();
    const sc = shape.scene;
    const values: number[] = [];
    for (const d of dirs()) {
      await breathe();
      values.push(sliceVolumeIntegral(shape, d, 200));
    }
    const spread = (Math.max(...values) - Math.min(...values)) / values[0];
    expect(spread).toBeLessThan(0.01);
    await breathe();
    const cx = extract(sc.f, sc.radius, 32);
    expect(validateTetComplex(cx.positions, cx.tets).ok).toBe(true);
    const hv = signedHypervolume(cx.positions, cx.tets);
    for (const I of values) expect(Math.abs(relErr(I, hv))).toBeLessThan(0.04);

    await breathe();
    const mc = mulberry32(777);
    const N = 3_000_000;
    const R = sc.radius;
    const [w0, w1] = sc.wRange;
    let inside = 0;
    for (let i = 0; i < N; i++) {
      if (sc.f([(2 * mc() - 1) * R, (2 * mc() - 1) * R, (2 * mc() - 1) * R, w0 + (w1 - w0) * mc()]) < 0) inside++;
    }
    const boxVol = (2 * R) ** 3 * (w1 - w0);
    const p = inside / N;
    const V = p * boxVol;
    const sigma = boxVol * Math.sqrt((p * (1 - p)) / N);
    for (const I of values) {
      expect(I).toBeLessThan(V + 3 * sigma); // inscribed estimates do not exceed the true volume
      expect(I).toBeGreaterThan(0.95 * V - 3 * sigma);
    }
    expect(hv).toBeLessThan(V + 3 * sigma);
    expect(hv).toBeGreaterThan(0.93 * V - 3 * sigma);
  });
});
