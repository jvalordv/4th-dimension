import { describe, expect, it } from 'vitest';
import { CROSSING_SNAP, marchingPentatopes, marchingTets3 } from '../../src/geometry/isosurface';
import { ball, box, ditorus, spheritorus, tiger, torisphere } from '../../src/geometry/sdf';
import type { Sdf4 } from '../../src/geometry/sdf';
import { analyseSlice, checkClosedOriented, signedVolume, triangleCount, vertexAt, weldVertices } from '../../src/geometry/trimesh';
import { hypervolumeByCones, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { sliceTets } from '../../src/geometry/slice';
import { hyperplaneW } from '../../src/math/hyperplane';
import { cross3, dot3, dot4, length3, sub3 } from '../../src/math/vec';
import type { TriMesh3, Vec3, Vec4 } from '../../src/math/types';

/** The 4D field restricted to the hyperplane w = c, in the chart (x, y, z). */
const atW = (f: Sdf4, c: number) => (q: Vec3): number => f([q[0], q[1], q[2], c]);

const cube = (R: number): [Vec3, Vec3] => [[-R, -R, -R], [R, R, R]];
const hypercube = (R: number): [Vec4, Vec4] => [[-R, -R, -R, -R], [R, R, R, R]];

/** Unit normals and areas of the triangles of a mesh. */
function triangleNormals(m: TriMesh3): Array<{ n: Vec3; area: number; centroid: Vec3 }> {
  const out: Array<{ n: Vec3; area: number; centroid: Vec3 }> = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = vertexAt(m, m.indices[t]);
    const b = vertexAt(m, m.indices[t + 1]);
    const c = vertexAt(m, m.indices[t + 2]);
    const cr = cross3(sub3(b, a), sub3(c, a));
    const len = length3(cr);
    out.push({
      n: len > 0 ? [cr[0] / len, cr[1] / len, cr[2] / len] : [0, 0, 0],
      area: len / 2,
      centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return out;
}

/** Deterministic pseudo-random numbers in [0, 1) (the generator used by test/core). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const ballSliceVolume = (c: number): number => (4 / 3) * Math.PI * (1 - c * c) ** 1.5;

// ---------------------------------------------------------------------------
// Marching tetrahedra (direct slice), MATH.md §9.3 and §6
// ---------------------------------------------------------------------------

describe('marchingTets3 on the unit ball slice (§9.3, §8.5)', () => {
  /*
   * The slice of ball(1) at w = c is the ball of radius ρ = √(1 − c²), volume
   * (4/3)π ρ³ (§8.5). The grid is [−1, 1]³ with n cells per axis, spacing h = 2/n.
   *
   * Sign of the error (rigorous). f = |p| − 1 is convex, so on each tet the
   * linear interpolant L of the vertex values satisfies f ≤ L, hence the
   * extracted region {L < 0} lies inside {f < 0}: the mesh volume is below
   * the exact one. Size of the error. Every output vertex is a chord-
   * interpolated point within h²/(2ρ)-ish of the sphere and each flat
   * facet lies a sagitta ~ h²/ρ·O(1) below it; summed over the sphere this
   * is ΔV/V = −c (h/ρ)² with c = 1/2 measured here at n = 24 and 48 (−0.50 and
   * −0.50 at c = 0; −0.56 at c = 0.5, where the unit grid is relatively
   * coarser for the smaller sphere). The test asserts |ΔV|/V ≤ 0.75 (h/ρ)²:
   * the measured constant with a 1.35× margin, small enough that a wrong
   * orientation, a missing triangle or a mis-placed crossing (errors of
   * order h, i.e. 10–50× larger) cannot pass.
   */
  const cases = [24, 48].flatMap((n) => [0, 0.5].map((c) => ({ n, c })));
  const errors = new Map<string, number>();

  for (const { n, c } of cases) {
    it(`resolution ${n}, c = ${c}: volume within 0.75 (h/ρ)², closed, Euler 2, outward`, () => {
      const m = marchingTets3(atW(ball(1), c), ...cube(1), n);
      const exact = ballSliceVolume(c);
      const h = 2 / n;
      const rho2 = 1 - c * c;
      const v = signedVolume(m);
      const rel = v / exact - 1;
      errors.set(`${n},${c}`, Math.abs(rel));
      expect(rel).toBeLessThan(0);
      expect(Math.abs(rel)).toBeLessThanOrEqual(0.75 * (h * h) / rho2);
      // Closed and consistently oriented as returned: vertices are shared by
      // grid edge, so no welding is needed. analyseSlice (which welds
      // transitively at 1e-6) must agree.
      const raw = checkClosedOriented(m);
      expect(raw.closed).toBe(true);
      expect(raw.consistent).toBe(true);
      expect(raw.euler).toBe(2);
      const a = analyseSlice(m);
      expect(a.closed && a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expect(a.volume).toBeCloseTo(v, 6);
      // Every non-degenerate triangle faces away from the centre (toward the
      // positive, outside corners): n · centroid > 0 for a ball about 0.
      for (const t of triangleNormals(m)) {
        if (t.area > 1e-9) expect(dot3(t.n, t.centroid)).toBeGreaterThan(0);
      }
    });
  }

  it('the error falls at least threefold when the spacing is halved (second order: ratio 4)', () => {
    for (const c of [0, 0.5]) {
      const coarse = errors.get(`24,${c}`) as number;
      const fine = errors.get(`48,${c}`) as number;
      // Measured ratios 4.0 (c = 0) and 4.0 (c = 0.5); 3 leaves room for the
      // phase of the sphere in the grid.
      expect(fine).toBeLessThan(coarse / 3);
    }
  });
});

describe('marchingTets3: vertex sharing, exact zeros, orientation, sourceW', () => {
  it('shares crossings by grid edge: a surface through grid vertices still welds exactly', () => {
    // [−1, 1] with 24 cells has spacing 1/12, so (4, 8, 8)/12 = (1, 2, 2)/3
    // has norm exactly 1: the unit sphere passes through grid vertices
    // (the value there is rounding noise, snapped to the exact zero of §6,
    // which counts as positive). Every crossing must still be a single
    // shared vertex: the raw mesh is closed and welding by position changes
    // nothing.
    const m = marchingTets3(atW(ball(1), 0), ...cube(1), 24);
    const raw = checkClosedOriented(m);
    expect(raw.closed && raw.consistent).toBe(true);
    expect(raw.euler).toBe(2);
    const welded = weldVertices(m, 1e-9);
    expect(welded.positions.length).toBe(m.positions.length);
  });

  it('a crossing within CROSSING_SNAP of a grid vertex is moved onto it; one farther away is not', () => {
    // g = x − c on [−1, 1]³ with 8 cells (h = 1/4, grid planes at multiples of 1/4). For c = 0.01 h above
    // the plane x = 0 the vertex values are g = −0.01 h (on the plane) and g = 0.99 h (next plane): a
    // crossing at 1% < 2% of the edge, snapped to the plane. For c = 0.1 h it stays at x = c. The same
    // field gives the same plane area either way (the plane is just placed at x = 0 or x = c).
    expect(CROSSING_SNAP).toBeCloseTo(0.02, 14);
    const h = 0.25;
    const run = (eps: number): Float32Array => marchingTets3((q) => q[0] - eps, ...cube(1), 8).positions;
    const snapped = run(0.01 * h);
    expect(snapped.length).toBeGreaterThan(30);
    for (let i = 0; i < snapped.length; i += 3) expect(Math.abs(snapped[i])).toBeLessThan(1e-7);
    const kept = run(0.1 * h);
    for (let i = 0; i < kept.length; i += 3) expect(Math.abs(kept[i] - 0.1 * h)).toBeLessThan(1e-6);
  });

  it('snapping leaves no two output vertices closer than 0.005 h (half the 0.57 · 2% h guaranteed by the snap)', () => {
    // Two crossings on different edges at the same grid vertex are at least SNAP · |edge| · sin(angle) apart, the
    // smallest angle between Freudenthal edges in 3D being arccos(√(2/3)) = 35.3° (0.58); a weld at 0.005 h
    // must therefore find nothing to merge. For h = 2/48 this is 2e-4, far above the 1e-6 of analyseSlice.
    for (const n of [24, 48]) {
      const m = marchingTets3(atW(torisphere(0.7, 0.3), 0.05), ...cube(1), n);
      const h = 2 / n;
      expect(weldVertices(m, 0.005 * h).positions.length).toBe(m.positions.length);
    }
  });

  it('zero counts as positive (§6): a field that is identically zero has no surface', () => {
    const m = marchingTets3(() => 0, ...cube(1), 4);
    expect(m.indices.length).toBe(0);
    expect(m.positions.length).toBe(0);
  });

  it('an all-positive and an all-negative field give the empty mesh', () => {
    expect(triangleCount(marchingTets3(() => 1, ...cube(1), 5))).toBe(0);
    expect(triangleCount(marchingTets3(() => -1, ...cube(1), 5))).toBe(0);
  });

  it('normals point toward the positive corners: g = ±(n·q − c) gives triangles facing ±n', () => {
    // Every crossing lies on the plane n·q = c (up to the snap of at most 2% of an edge,
    // which tilts a triangle by at most about 2°: measured min cosine 0.9994), so every
    // triangle of positive area lies in that plane and "toward the positive corners" means
    // along +n for g and −n for −g.
    const nv: Vec3 = [1, 2, 3].map((v) => v / Math.sqrt(14)) as Vec3;
    const g = (q: Vec3): number => dot3(nv, q) - 0.13;
    for (const sign of [1, -1]) {
      const m = marchingTets3((q) => sign * g(q), ...cube(1), [6, 7, 5]);
      const tris = triangleNormals(m).filter((t) => t.area > 1e-3);
      expect(tris.length).toBeGreaterThan(100);
      for (const t of tris) expect(dot3(t.n, nv) * sign).toBeGreaterThan(0.99);
    }
  });

  it('with no snapping the normals are exactly ±e_x: g = x − h/2 on the grid has every crossing at an edge midpoint', () => {
    // [−1, 1]³ with 8 cells: planes at multiples of 1/4, the field's zero at x = 1/8, so every crossing is at
    // t = 1/2 of an x-edge or of a diagonal (the field depends on x only): positions are dyadic, exact in
    // Float32, and each triangle lies in x = 1/8 with normal exactly +e_x.
    for (const sign of [1, -1]) {
      const m = marchingTets3((q) => sign * (q[0] - 0.125), ...cube(1), 8);
      const tris = triangleNormals(m).filter((t) => t.area > 1e-9);
      expect(tris.length).toBeGreaterThan(100);
      for (const t of tris) {
        expect(t.n[0] * sign).toBeCloseTo(1, 12);
        expect(t.centroid[0]).toBeCloseTo(0.125, 12);
      }
    }
  });

  it('sourceW is the attribute at each vertex, and 0 without one', () => {
    const attribute = (q: Vec3): number => q[0] + 2 * q[1] - 3 * q[2];
    const m = marchingTets3(atW(ball(1), 0), ...cube(1), 12, attribute);
    expect(m.sourceW.length).toBe(m.positions.length / 3);
    for (let i = 0; i < m.sourceW.length; i++) {
      const q = vertexAt(m, i);
      // sourceW is Float32 of the float64 attribute at the float64 position,
      // while positions are Float32 too: both roundings are ≤ 6e-8 relative to
      // magnitudes ≤ 3, so 1e-6 covers their combination.
      expect(Math.abs(m.sourceW[i] - attribute(q))).toBeLessThan(1e-6);
    }
    const plain = marchingTets3(atW(ball(1), 0), ...cube(1), 12);
    expect(plain.sourceW.every((v) => v === 0)).toBe(true);
    expect(plain.sourceW.length).toBe(plain.positions.length / 3);
  });

  it('the six Kuhn tets of neighbouring cubes agree on shared faces: random smooth fields close on anisotropic grids', () => {
    // A closed raw mesh (no welding) on a grid with different spacings per
    // axis can only happen if the diagonals of every shared face match.
    const r = rng(7);
    for (let trial = 0; trial < 4; trial++) {
      const p1 = r() * 6;
      const p2 = r() * 6;
      const p3 = r() * 6;
      // |q|² − 1 plus a ripple of amplitude 0.25 keeps the zero set inside |q| < 1.6.
      const g = (q: Vec3): number => q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - 1 +
        0.25 * Math.sin(5 * q[0] + p1) * Math.sin(4 * q[1] + p2) * Math.sin(3 * q[2] + p3);
      const m = marchingTets3(g, [-2, -1.9, -2.1], [2, 2.2, 1.8], [17, 23, 11]);
      const rep = checkClosedOriented(m);
      expect(triangleCount(m)).toBeGreaterThan(100);
      expect(rep.boundaryEdges).toBe(0);
      expect(rep.nonManifoldEdges).toBe(0);
      expect(rep.consistent).toBe(true);
      expect(signedVolume(m)).toBeGreaterThan(0);
    }
  });

  it('rejects malformed grids', () => {
    expect(() => marchingTets3(() => 1, ...cube(1), 0)).toThrow(RangeError);
    expect(() => marchingTets3(() => 1, ...cube(1), 2.5)).toThrow(RangeError);
    expect(() => marchingTets3(() => 1, [0, 0, 0], [1, 0, 1], 3)).toThrow(RangeError);
    expect(() => marchingTets3(() => 1, ...cube(1), [3, 3] as unknown as [number, number, number])).toThrow(RangeError);
  });
});

describe('marchingTets3 on the torus-like slices at w = 0 (§9.3 table)', () => {
  /*
   * Grid: [−R, R]³ with n = 48 cells, h = 2R/n, R the bound of each shape.
   * Exact slice volumes at w = 0, by Pappus or by the shell formula:
   *
   *  - spheritorus (0.7, 0.3): f(q, 0) = |(|q| − 0.7)| − 0.3 ≤ 0 is the thick
   *    spherical shell 0.4 ≤ |q| ≤ 1.0 (the set of points of R³ within r of the
   *    sphere of radius R): V = (4π/3)(1 − 0.4³) = 3.9207. Its boundary is two
   *    spheres, so the Euler characteristic is 2 + 2 = 4.
   *  - torisphere (0.7, 0.3): f(q, 0) = √((ρ − 0.7)² + z²) − 0.3 is the solid
   *    torus of major radius 0.7, minor 0.3: V = 2π² R r² = 1.2436, χ = 0.
   *  - tiger (0.6, 0.6, 0.25): f(q, 0) = √((ρ − R1)² + (|z| − R2)²) − r is two
   *    solid tori, one about the circle ρ = R1 at z = +R2 and one at z = −R2
   *    (they are disjoint: 2 R2 > 2 r): V = 2 · 2π² R1 r² = 4π² R1 r² = 1.4804,
   *    χ = 0 + 0 = 0.
   *  - ditorus (0.6, 0.25, 0.1): f(q, 0) = |√((ρ − R1)² + z²) − R2| − r is the
   *    hollow torus R2 − r ≤ s ≤ R2 + r about the circle of radius R1, s the
   *    distance to that circle: an annulus of area π((R2+r)² − (R2−r)²) =
   *    4π R2 r swept around R1 (centroid on the circle, Pappus):
   *    V = 2π R1 · 4π R2 r = 8π² R1 R2 r = 1.1844, boundary two tori, χ = 0.
   *
   * Tolerance. The sphere law of the test above bounds the error of each
   * boundary component by 0.75 (h/ρ)² of its own ball volume, (π h² ρ for a sphere
   * of radius ρ); a tube of radius ρ has at most that relative error per unit
   * volume, because the sphere has the largest mean curvature per volume. Each
   * test sums the bounds of its boundary components, tubes of radius ρ
   * weighing 0.75 (h/ρ)² times their own volume. Errors of opposite sign
   * (the inner boundary of a hollow solid is concave, so its mesh bulges the
   * other way) only help.
   */
  const check = (name: string, f: Sdf4, R: number, exact: number, euler: number, bound: (h: number) => number): void => {
    it(`${name}: closed, Euler ${euler}, volume ${exact.toFixed(4)} within the summed sphere/tube bounds`, () => {
      const n = 48;
      const h = (2 * R) / n;
      const m = marchingTets3(atW(f, 0), ...cube(R), n);
      const rep = checkClosedOriented(m);
      expect(rep.closed && rep.consistent).toBe(true);
      expect(rep.euler).toBe(euler);
      const v = signedVolume(m);
      expect(Math.abs(v - exact)).toBeLessThanOrEqual(bound(h));
      expect(v).toBeGreaterThan(0);
    });
  };

  check('spheritorus', spheritorus(0.7, 0.3), 1.0, (4 * Math.PI / 3) * (1 - 0.4 ** 3), 4,
    (h) => Math.PI * h * h * (1.0 + 0.4));
  check('torisphere', torisphere(0.7, 0.3), 1.0, 2 * Math.PI ** 2 * 0.7 * 0.3 ** 2, 0,
    (h) => 0.75 * (h / 0.3) ** 2 * (2 * Math.PI ** 2 * 0.7 * 0.3 ** 2));
  check('tiger', tiger(0.6, 0.6, 0.25), Math.hypot(0.6, 0.6) + 0.25, 4 * Math.PI ** 2 * 0.6 * 0.25 ** 2, 0,
    (h) => 0.75 * (h / 0.25) ** 2 * (4 * Math.PI ** 2 * 0.6 * 0.25 ** 2));
  check('ditorus', ditorus(0.6, 0.25, 0.1), 0.95, 8 * Math.PI ** 2 * 0.6 * 0.25 * 0.1, 0,
    (h) => 0.75 * (h / 0.35) ** 2 * (2 * Math.PI ** 2 * 0.6 * 0.35 ** 2) + 0.75 * (h / 0.15) ** 2 * (2 * Math.PI ** 2 * 0.6 * 0.15 ** 2));

  it('the torisphere slice converges at second order: error ratio ≥ 3 per halving of h', () => {
    // n = 24, 48, 96 gave relative errors 1.29%, 0.32%, 0.080% (ratios 4.0, 4.0).
    const exact = 2 * Math.PI ** 2 * 0.7 * 0.3 ** 2;
    const errs = [24, 48, 96].map((n) => {
      const m = marchingTets3(atW(torisphere(0.7, 0.3), 0), ...cube(1), n);
      return Math.abs(signedVolume(m) - exact);
    });
    expect(errs[1]).toBeLessThan(errs[0] / 3);
    expect(errs[2]).toBeLessThan(errs[1] / 3);
  });

  it('the spheritorus slice at w = c is the shell R ± √(r² − c²): V = 8πR²a + (8π/3)a³, a = √(r² − c²)', () => {
    // (4π/3)((R + a)³ − (R − a)³) with (R + a)³ − (R − a)³ = 6R²a + 2a³.
    // Tolerance as for the shell above, π h² (outer + inner radius) = 2π h² R.
    // It holds for c ≤ 0.2 (measured errors 0.0029 and 0.0055 against the bound
    // 0.0076 at n = 48): the field is a bound, not a distance, on a slice,
    // |∇f| = a/r < 1 there, and the interpolation error grows as 1/|∇f|, so
    // near c = r the constant degrades (next test).
    const R = 0.7;
    const r = 0.3;
    const n = 48;
    const h = 2 / n;
    for (const c of [0.1, 0.2]) {
      const a = Math.sqrt(r * r - c * c);
      const exact = 8 * Math.PI * R * R * a + (8 * Math.PI / 3) * a ** 3;
      const m = marchingTets3(atW(spheritorus(R, r), c), ...cube(1), n);
      const rep = checkClosedOriented(m);
      expect(rep.closed && rep.consistent).toBe(true);
      expect(rep.euler).toBe(4);
      expect(Math.abs(signedVolume(m) - exact)).toBeLessThanOrEqual(2 * Math.PI * h * h * R);
    }
  });

  it('near the end of the w range (c = 0.28, shell only 0.21 thick) the shell is still closed (Euler 4) and converges at second order', () => {
    // Measured errors at n = 24, 48, 96: 0.0649, 0.0154, 0.0039 (ratios 4.2, 3.9).
    const R = 0.7;
    const r = 0.3;
    const c = 0.28;
    const a = Math.sqrt(r * r - c * c);
    const exact = 8 * Math.PI * R * R * a + (8 * Math.PI / 3) * a ** 3;
    const errs = [24, 48, 96].map((n) => {
      const m = marchingTets3(atW(spheritorus(R, r), c), ...cube(1), n);
      const rep = checkClosedOriented(m);
      expect(rep.closed && rep.consistent).toBe(true);
      expect(rep.euler).toBe(4);
      return Math.abs(signedVolume(m) - exact);
    });
    expect(errs[1]).toBeLessThan(errs[0] / 3);
    expect(errs[2]).toBeLessThan(errs[1] / 3);
  });
});

// ---------------------------------------------------------------------------
// Marching pentatopes (extracted complex), MATH.md §9.3
// ---------------------------------------------------------------------------

describe('marchingPentatopes on the unit 4-ball (§9.3, §8.5)', () => {
  /*
   * ball(1) on [−1, 1]⁴ with n cells per axis, h = 2/n. π²/2 = 4.9348.
   *
   * Sign (rigorous): as in 3D, f is convex so the extracted region {L < 0}
   * is inside the ball and the signed hypervolume is below π²/2.
   * Size: the same chord/sagitta argument one dimension up gives
   * ΔV/V = −c (h/ρ)², measured c = 1.00 at all three resolutions
   * (−6.20%, −2.77%, −1.56% at n = 8, 12, 16: ×64, ×144, ×256 give 3.97, 3.99,
   * 3.99 per 1/n², c = 3.99/4). The test asserts |ΔV|/V ≤ 1.25 h² (measured
   * constant with a 1.25× margin).
   */
  const exact = Math.PI ** 2 / 2;
  const complexes = new Map<number, ReturnType<typeof marchingPentatopes>>();
  const errs = new Map<number, number>();

  for (const n of [8, 12, 16]) {
    it(`n = ${n}: valid complex, outward, hypervolume within 1.25 h² below π²/2`, () => {
      const cx = marchingPentatopes(ball(1), ...hypercube(1), n);
      complexes.set(n, cx);
      const h = 2 / n;
      // Closed, consistently oriented, no degenerate tets (§5.2).
      // (The face check keys 4 faces per tet by string, ~10 s at n = 16, so n = 16 is
      // validated through the closed-slice and signed-volume checks below instead.)
      if (n <= 12) {
        // Default tolerance: crossings are snapped off grid vertices, so no sliver tets remain.
        const v = validateTetComplex(cx.positions, cx.tets);
        expect(v.errors).toEqual([]);
        expect(v.degenerateTets).toBe(0);
        expect(v.boundaryFaces).toBe(0);
        expect(v.nonManifoldFaces).toBe(0);
        expect(v.inconsistentFaces).toBe(0);
      }
      const vol = signedHypervolume(cx.positions, cx.tets);
      const rel = vol / exact - 1;
      errs.set(n, Math.abs(rel));
      expect(rel).toBeLessThan(0);
      expect(Math.abs(rel)).toBeLessThanOrEqual(1.25 * h * h);
      // The ball is star-shaped about 0, so the cone form of §7 agrees with
      // the signed one exactly when every tet is outward oriented.
      expect(hypervolumeByCones(cx.positions, cx.tets)).toBeCloseTo(vol, 9);
      // Orientation (§5.1): N · (a − o) ≥ 0 for every tet. Slivers have
      // |N| ~ 1e-9 and a rounding-level dot product, hence the −1e-9.
      for (const t of cx.tets) {
        expect(dot4(tetNormal(cx.positions, t), cx.positions[t[0]])).toBeGreaterThan(-1e-9);
      }
    });
  }

  it('the error falls with refinement at second order (n = 8 → 16: ratio 4)', () => {
    expect(errs.get(12) as number).toBeLessThan(errs.get(8) as number);
    expect(errs.get(16) as number).toBeLessThan(errs.get(12) as number);
    // 0.0620 / 0.0156 = 3.97; asserting ≥ 3 over the doubling.
    expect((errs.get(8) as number) / (errs.get(16) as number)).toBeGreaterThan(3);
  });

  it('every vertex is within h² / (2(1 − 2h)) + 0.041 h of the surface, and inside it except for snapped vertices', () => {
    // Crossing point on an edge of length L ≤ 2h (the 4D diagonal of a cell).
    // f = |p| − 1 is convex, so the interpolated point is inside (f ≤ 0), and
    // its depth is at most the chord error L² max f'' / 8 with
    // f'' = (L² − (v·p̂)²)/|p| ≤ L²/|p| along the edge and |p| ≥ 1 − L at the
    // point, so the depth is at most L² / (8 (1 − L)) = 4h² / (8 (1 − 2h)) =
    // h² / (2 (1 − 2h)).
    // A crossing within CROSSING_SNAP of an edge end is moved onto that grid vertex
    // (isosurface.ts), whose value g_v satisfies |g_v| < SNAP |g_n| with
    // |g_n| ≤ |g_v| + L (f is 1-Lipschitz), so |g_v| ≤ SNAP L / (1 − SNAP) ≤ 0.0205 L =
    // 0.041 h: a snapped vertex is at most that far outside, or inside.
    const snapReach = (CROSSING_SNAP / (1 - CROSSING_SNAP)) * 2;
    for (const n of [8, 12, 16]) {
      const cx = complexes.get(n) ?? marchingPentatopes(ball(1), ...hypercube(1), n);
      const h = 2 / n;
      const f = ball(1);
      let deepest = 0;
      let outermost = 0;
      for (const p of cx.positions) {
        const v = f(p);
        outermost = Math.max(outermost, v);
        deepest = Math.max(deepest, -v);
      }
      expect(outermost).toBeLessThanOrEqual(snapReach * h + 1e-12);
      expect(deepest).toBeLessThanOrEqual((h * h) / (2 * (1 - 2 * h)) + snapReach * h);
    }
  });

  it('slicing the complex agrees with the direct slice within the sum of both discretisation errors (c = 0, 0.5)', () => {
    /*
     * Both volumes are below the exact (4/3)π ρ³, ρ² = 1 − c². The
     * a-priori bound of the direct slice at spacing h3 is 0.75 (h3/ρ)² V
     * (first describe); for the slice of the complex at spacing h4 it is
     * 1.0 (h4/ρ)² V (measured constant 0.50 at c = 0 and 0.56 at c = 0.5,
     * doubled). The two meshes must differ by no more than the sum of the
     * bounds, which is a statement about the two extractors being the same
     * surface, not about either matching the exact value.
     */
    const cx = complexes.get(16) ?? marchingPentatopes(ball(1), ...hypercube(1), 16);
    const h4 = 2 / 16;
    const h3 = 2 / 48;
    for (const c of [0, 0.5]) {
      const rho2 = 1 - c * c;
      const exactSlice = ballSliceVolume(c);
      const viaComplex = analyseSlice(sliceTets(cx.positions, cx.tets, hyperplaneW(c)));
      const direct = signedVolume(marchingTets3(atW(ball(1), c), ...cube(1), 48));
      // Positive-volume offset of a valid complex: closed, oriented, Euler 2 (§6).
      expect(viaComplex.closed && viaComplex.consistent).toBe(true);
      expect(viaComplex.euler).toBe(2);
      const eComplex = 1.0 * (h4 * h4 / rho2) * exactSlice;
      const eDirect = 0.75 * (h3 * h3 / rho2) * exactSlice;
      expect(viaComplex.volume).toBeLessThan(exactSlice);
      expect(exactSlice - viaComplex.volume).toBeLessThanOrEqual(eComplex);
      expect(exactSlice - direct).toBeLessThanOrEqual(eDirect);
      expect(Math.abs(viaComplex.volume - direct)).toBeLessThanOrEqual(eComplex + eDirect);
    }
  });

  it('a complex through exact zeros is closed: n = 12 puts the sphere through (1, 1, 1, 1)/2 ∈ grid', () => {
    // Spacing 1/6, so (3, 3, 3, 3)/6 has norm exactly 1 and so has (6, 0, 0, 0)/6:
    // many vertices are exactly on the surface (value 0, positive by §6).
    const cx = marchingPentatopes(ball(1), ...hypercube(1), 12);
    const v = validateTetComplex(cx.positions, cx.tets);
    // Default tolerance: the exact zeros collapse crossings onto grid vertices and the
    // collapsed tets are dropped, leaving no slivers.
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('accepts a per-axis resolution and bounds off the origin', () => {
    // ball centred at (0.3, 0, 0, 0): translate by evaluating at p − t.
    const f: Sdf4 = (p) => ball(0.5)([p[0] - 0.3, p[1], p[2], p[3]]);
    const cx = marchingPentatopes(f, [-0.5, -0.5, -0.5, -0.5], [1, 0.5, 0.5, 0.5], [9, 6, 6, 6]);
    const v = validateTetComplex(cx.positions, cx.tets);
    expect(v.errors).toEqual([]);
    const vol = signedHypervolume(cx.positions, cx.tets, [0.3, 0, 0, 0]);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan((Math.PI ** 2 / 2) * 0.5 ** 4);
  });

  it('rejects malformed grids and an empty field gives an empty complex', () => {
    expect(() => marchingPentatopes(ball(1), ...hypercube(1), 0)).toThrow(RangeError);
    expect(() => marchingPentatopes(ball(1), [0, 0, 0, 0], [1, 1, 0, 1], 3)).toThrow(RangeError);
    const none = marchingPentatopes(() => 1, ...hypercube(1), 3);
    expect(none.tets.length).toBe(0);
    expect(none.positions.length).toBe(0);
  });
});

describe('marchingPentatopes on box([1, 1, 1, 1]): grid-aligned faces (§9.3 table, 4-volume 16)', () => {
  /*
   * f is an exact signed distance and convex (the signed distance of a convex
   * set), so as for the ball the extracted solid lies inside the box and the
   * hypervolume is below 16.
   *
   * Aligned grid: the box [−1, 1]⁴ in the grid [−1.5, 1.5]⁴ with n = 6k cells
   * has its eight faces on grid hyperplanes, so every vertex on a face has
   * f = 0 exactly and counts as positive. Every hypercube is then wholly inside
   * or wholly outside the box, and a vertex inside the box is on a face
   * (f = 0, positive) or strictly inside (f < 0). A pentatope is therefore in
   * the extracted solid iff it has at least one strictly interior vertex,
   * and in that case the crossings on its edges to the positive vertices sit
   * exactly on those vertices (t = 0), so the boundary of the extracted
   * solid is the boundary of the union of those pentatopes:
   *
   *     hypervolume = (number of Freudenthal pentatopes of the inside
   *                    hypercubes with a vertex of f < 0) · h⁴ / 24    (exactly)
   *
   * The faces themselves (3-faces, away from lower-dimensional features) are
   * reproduced exactly; the deficit comes only from pentatopes all of whose
   * five vertices lie on the boundary (hypercubes touching two faces of
   * opposite orientation, e.g. x = −1 and y = +1: the chains that add y
   * before x never leave the boundary). For each of 12 two-faces (6 axis
   * pairs × 2 mixed sign pairs) there are (2/h)² such hypercubes and in 12
   * of the 24 chains of each: 12 (2/h)² · 12 · h⁴/24 = 24 h², so the deficit
   * tends to 24 h² from below (measured 16.75, 20.19, 22.05 h² at h = 1/2,
   * 1/4, 1/8; hypercubes touching three faces account for the shortfall).
   * The test asserts the exact count identity and deficit ≤ 24 h².
   */
  const f = box([1, 1, 1, 1]);

  /** Independent enumeration of the Freudenthal pentatopes of hypercubes inside the box with a vertex of f < 0. */
  function countInteriorPentatopes(h: number, lo: number, n: number): number {
    const perms: number[][] = [];
    const rec = (prefix: number[], rest: number[]): void => {
      if (!rest.length) { perms.push(prefix); return; }
      rest.forEach((r, i) => rec([...prefix, r], rest.filter((_, j) => j !== i)));
    };
    rec([], [0, 1, 2, 3]);
    let count = 0;
    const idx = [0, 0, 0, 0];
    for (idx[0] = 0; idx[0] < n; idx[0]++) for (idx[1] = 0; idx[1] < n; idx[1]++) {
      for (idx[2] = 0; idx[2] < n; idx[2]++) for (idx[3] = 0; idx[3] < n; idx[3]++) {
        const cellLo = idx.map((i) => lo + i * h);
        // Inside hypercubes only: every coordinate range within [−1, 1].
        if (cellLo.some((x) => x < -1 - 1e-9 || x + h > 1 + 1e-9)) continue;
        for (const sigma of perms) {
          const p = [...cellLo];
          let interior = f(p as Vec4) < -1e-12;
          for (const axis of sigma) {
            p[axis] += h;
            if (f(p as Vec4) < -1e-12) interior = true;
          }
          if (interior) count++;
        }
      }
    }
    return count;
  }

  for (const n of [6, 12]) {
    it(`aligned grid, n = ${n} (h = ${3 / n}): hypervolume = interior pentatopes · h⁴/24 exactly, deficit ≤ 24 h²`, () => {
      const lo = 1.5;
      const h = (2 * lo) / n;
      const cx = marchingPentatopes(f, ...hypercube(lo), n);
      const v = validateTetComplex(cx.positions, cx.tets);
      expect(v.errors).toEqual([]);
      const vol = signedHypervolume(cx.positions, cx.tets);
      const predicted = (countInteriorPentatopes(h, -lo, n) * h ** 4) / 24;
      expect(vol).toBeCloseTo(predicted, 9);
      expect(vol).toBeLessThan(16);
      expect(16 - vol).toBeLessThanOrEqual(24 * h * h);
      // Outward: the box is convex, so the cone form from the origin agrees.
      expect(hypervolumeByCones(cx.positions, cx.tets)).toBeCloseTo(vol, 9);
    });
  }

  it('the deficit shrinks as h² on the aligned grid: 4.19, 1.26, 0.34 at h = 1/2, 1/4, 1/8', () => {
    const deficits = [6, 12, 24].map((n) => {
      const cx = marchingPentatopes(f, ...hypercube(1.5), n);
      return 16 - signedHypervolume(cx.positions, cx.tets);
    });
    expect(deficits[1]).toBeLessThan(deficits[0] / 3);
    expect(deficits[2]).toBeLessThan(deficits[1] / 3);
  });

  it('off-grid faces: still valid, below 16, and the deficit stays within 24 h² for several phases', () => {
    /*
     * With the faces strictly between grid planes, crossings are interpolated
     * along edges where f is affine (|x| − 1) across a face, so the face
     * interiors are again exact; the shortfall is again confined to the
     * 2-faces, where f has a kink, and depends on the phase of the faces
     * relative to the grid: measured deficits/h² = 16.5, 10.5, 4.7, 19.8
     * at n = 10, 12, 14, 18 (phases 0.15, 0.39, 0.62, 0.08; the aligned
     * grid is the worst case, 24).
     */
    for (const n of [10, 12, 14, 18]) {
      const lo = 1.3;
      const h = (2 * lo) / n;
      const cx = marchingPentatopes(f, ...hypercube(lo), n);
      if (n <= 12) {
        const v = validateTetComplex(cx.positions, cx.tets);
        expect(v.errors).toEqual([]);
      }
      const vol = signedHypervolume(cx.positions, cx.tets);
      expect(vol).toBeLessThan(16);
      expect(16 - vol).toBeLessThanOrEqual(24 * h * h);
    }
  });
});

describe('marchingPentatopes on a solid that is not star-shaped (the torisphere, §7)', () => {
  /*
   * torisphere(0.6, 0.45): the set within r = 0.45 of the circle of radius R = 0.6
   * in the xy-plane, a 3-ball swept round a circle. It contains the origin?
   * No: the origin is at distance R = 0.6 > r from the circle, so the solid has a
   * hole and is not star-shaped about 0; only the signed form of §7 applies.
   * Exact 4-volume 2πR(4/3)πr³ = 1.4390 (Pappus, r < R). The tube law of the
   * ball one dimension up (measured ΔV/V = −0.49 (h/r)² at n = 8, 12, 16)
   * is asserted as ≤ 0.75 (h/r)².
   */
  const R = 0.6;
  const r = 0.45;
  const exact = 2 * Math.PI * R * (4 / 3) * Math.PI * r ** 3;
  const bound = R + r;
  const errs: number[] = [];

  for (const n of [8, 12, 16]) {
    it(`n = ${n}: valid, positive signed hypervolume within the tube bound`, () => {
      const cx = marchingPentatopes(torisphere(R, r), ...hypercube(bound), n);
      const v = validateTetComplex(cx.positions, cx.tets);
      expect(v.errors).toEqual([]);
      const vol = signedHypervolume(cx.positions, cx.tets);
      const h = (2 * bound) / n;
      const rel = vol / exact - 1;
      errs.push(Math.abs(rel));
      expect(rel).toBeLessThan(0);
      expect(Math.abs(rel)).toBeLessThanOrEqual(0.75 * (h / r) ** 2);
      // The cone form from the origin would overcount here (overlapping cones through the hole).
      expect(hypervolumeByCones(cx.positions, cx.tets)).toBeGreaterThan(vol);
      // Orientation toward the positive corners (§9.3), independent of any centre: the normal of every
      // non-degenerate tet has a positive dot product with the gradient of f (increasing f is outward) at
      // its centroid, by central differences (step 1e-5: truncation 1e-10, rounding 1e-11; |∇f| = 1 away
      // from the core circle, which is at distance ≥ r − gap from the surface). Every 5th tet. The
      // dot product is the cosine of the angle between the facet normal and ∇f, measured ≥ 0.77
      // at n = 8, 12 and ≥ 0.93 at n = 16 (median 0.98–0.995); a flipped tet would give about −0.8.
      const f = torisphere(R, r);
      const step = 1e-5;
      let checked = 0;
      for (let i = 0; i < cx.tets.length; i += 5) {
        const t = cx.tets[i];
        const nrm = tetNormal(cx.positions, t);
        const len = Math.hypot(nrm[0], nrm[1], nrm[2], nrm[3]);
        if (len < 1e-4) continue;
        const c: Vec4 = [0, 1, 2, 3].map((k) => (cx.positions[t[0]][k] + cx.positions[t[1]][k] + cx.positions[t[2]][k] + cx.positions[t[3]][k]) / 4) as Vec4;
        const grad = [0, 1, 2, 3].map((k) => {
          const hi: Vec4 = [c[0], c[1], c[2], c[3]];
          const lo: Vec4 = [c[0], c[1], c[2], c[3]];
          hi[k] += step;
          lo[k] -= step;
          return (f(hi) - f(lo)) / (2 * step);
        });
        expect(dot4(nrm, grad as Vec4) / len).toBeGreaterThan(0.5);
        checked++;
      }
      expect(checked).toBeGreaterThan(500);
    });
  }

  it('the error decreases with refinement', () => {
    expect(errs[1]).toBeLessThan(errs[0]);
    expect(errs[2]).toBeLessThan(errs[1]);
  });
});
