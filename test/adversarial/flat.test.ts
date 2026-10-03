/**
 * Adversarial tests for the Flatland module (MATH.md §11 and the R³
 * restrictions of §2, §3, §4). Every expected value below is derived in a
 * comment from MATH.md or from standard mathematics; nothing is copied from
 * the implementation. Random inputs come from a seeded generator so that a
 * failure is reproducible.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/math/types';
import { cross3, det3, dot3, length3, sub3 } from '../../src/math/vec';
import {
  FLAT_PLANES,
  MIN_DENOMINATOR,
  apply3,
  chart2,
  compositeRotation3,
  identity3,
  isOutOfPlane,
  mul3,
  planeChart,
  planeFromRotation,
  project2,
  rotation3,
  sliceScale2,
  transpose3,
  unchart2,
  zeroFlatAngles,
  type FlatAngles,
  type FlatPlane,
  type Mat3,
  type Vec2,
} from '../../src/flat/math';
import { removeCollinear, sliceMesh3, sliceMeshes3, sliceSection, type FlatSlice } from '../../src/flat/slice2';
import { FLAT_SHAPES, flatShapeBounds, octahedron, tetrahedron } from '../../src/flat/shapes';
import {
  box,
  cylinder,
  icosphere,
  mesh3Bounds,
  mesh3Volume,
  torus,
  transformMesh3,
  translateMesh3,
  validateMesh3,
  type Mesh3,
} from '../../src/geometry/mesh3';
import { signedArea2 } from '../../src/geometry/section';
import { humanParts } from '../../src/geometry/figures';

// ---- Helpers ---------------------------------------------------------------

/** mulberry32: a small seeded generator, uniform on [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform direction on S² by rejection from the cube (shell 0.2 < |v| ≤ 1 avoids short vectors). */
function randomUnit3(r: () => number): Vec3 {
  for (;;) {
    const v: Vec3 = [2 * r() - 1, 2 * r() - 1, 2 * r() - 1];
    const l = length3(v);
    if (l > 0.2 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
  }
}

/** Angle with |θ| ∈ [0.3, 2.8] and random sign: away from 0 and π, where sin θ would be small. */
const randomAngle = (r: () => number): number => (r() < 0.5 ? -1 : 1) * (0.3 + 2.5 * r());

const randomAngles = (r: () => number): FlatAngles => ({ XY: randomAngle(r), XZ: randomAngle(r), YZ: randomAngle(r) });

const expectNear = (actual: number, expected: number, tol: number, what = 'value'): void => {
  expect(Math.abs(actual - expected), `${what}: expected ${expected} ± ${tol}, got ${actual}`).toBeLessThanOrEqual(tol);
};

const expectVecNear = (actual: readonly number[], expected: readonly number[], tol: number, what = 'vector'): void => {
  expect(actual.length, `${what}: length`).toBe(expected.length);
  for (let k = 0; k < expected.length; k++) expectNear(actual[k], expected[k], tol, `${what}[${k}]`);
};

/** Frobenius norm of A − B. */
function matDistance(a: Mat3, b: Mat3): number {
  let s = 0;
  for (let k = 0; k < 9; k++) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s);
}

/** The two point lists agree as sets (equal counts, each expected point matched by a distinct actual point within tol). */
function expectSamePoints(actual: readonly (readonly number[])[], expected: readonly (readonly number[])[], tol: number, what = 'points'): void {
  expect(actual.length, `${what}: ${actual.length} points, expected ${expected.length}: ${JSON.stringify(actual)}`).toBe(expected.length);
  const used = new Array<boolean>(actual.length).fill(false);
  for (const e of expected) {
    const i = actual.findIndex((a, k) => !used[k] && a.every((x, d) => Math.abs(x - e[d]) <= tol));
    expect(i, `${what}: no match for ${JSON.stringify(e)} in ${JSON.stringify(actual)}`).toBeGreaterThanOrEqual(0);
    used[i] = true;
  }
}

/** Σ over triangles of the shoelace area in the chart (positive for counter-clockwise triangles). */
function triangleAreaSum(slice: FlatSlice): number {
  const { positions, indices } = slice.triangles;
  let a = 0;
  for (let k = 0; k < indices.length; k += 3) a += signedArea2([positions[indices[k]], positions[indices[k + 1]], positions[indices[k + 2]]]);
  return a;
}

/** Every triangle of the slice is counter-clockwise in the chart (strictly positive area). */
function expectTrianglesCcw(slice: FlatSlice, what = 'slice'): void {
  const { positions, indices } = slice.triangles;
  expect(indices.length % 3, `${what}: index count`).toBe(0);
  expect(slice.sourceZ.length, `${what}: sourceZ per position`).toBe(positions.length);
  for (let k = 0; k < indices.length; k += 3) {
    for (const i of [indices[k], indices[k + 1], indices[k + 2]]) {
      expect(Number.isInteger(i) && i >= 0 && i < positions.length, `${what}: index ${i} out of range`).toBe(true);
    }
    const a = signedArea2([positions[indices[k]], positions[indices[k + 1]], positions[indices[k + 2]]]);
    expect(a, `${what}: triangle ${k / 3} is not counter-clockwise`).toBeGreaterThan(0);
  }
}

/**
 * Midpoint-rule integral of the slice area along the unit direction n over
 * [lo, hi] (default: the mesh's origin-centred bounding interval [−R, R]).
 */
function cavalieri(mesh: Mesh3, n: Vec3, steps: number, range?: [number, number]): number {
  const R = mesh3Bounds(mesh).radius;
  const [lo, hi] = range ?? [-R, R];
  const dc = (hi - lo) / steps;
  let total = 0;
  for (let i = 0; i < steps; i++) total += sliceMesh3(mesh, planeChart(n, lo + (i + 0.5) * dc)).area;
  return total * dc;
}

const E_X: Vec3 = [1, 0, 0];
const E_Y: Vec3 = [0, 1, 0];
const E_Z: Vec3 = [0, 0, 1];
const SQRT3 = Math.sqrt(3);
const cube = (): Mesh3 => box(2, 2, 2);

// ---- §11 / §2.1: rotations of R³ ------------------------------------------

describe('rotation3 (§11, §2.1 restricted to R³)', () => {
  it('lists the three coordinate planes of R³ in the canonical order XY, XZ, YZ; only XY stays in Flatland', () => {
    // §2.1 canonical order XY, XZ, XW, YZ, YW, ZW with the w planes removed.
    expect([...FLAT_PLANES]).toEqual(['XY', 'XZ', 'YZ']);
    expect(isOutOfPlane('XY')).toBe(false);
    expect(isOutOfPlane('XZ')).toBe(true);
    expect(isOutOfPlane('YZ')).toBe(true);
    expect(zeroFlatAngles()).toEqual({ XY: 0, XZ: 0, YZ: 0 });
  });

  it('is special orthogonal (RᵀR = I, det R = +1) for random angles in every plane', () => {
    // §2.1: rotations are special orthogonal. Entries are cos/sin, so RᵀR
    // differs from I by a few ulps: tolerance 1e-14.
    const r = rng(1);
    for (let k = 0; k < 30; k++) {
      const plane = FLAT_PLANES[k % 3];
      const theta = randomAngle(r);
      const m = rotation3(plane, theta);
      expect(matDistance(mul3(transpose3(m), m), identity3()), `RᵀR for ${plane}(${theta})`).toBeLessThanOrEqual(1e-14);
      const det = det3([m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]);
      expectNear(det, 1, 1e-14, `det ${plane}(${theta})`);
    }
  });

  it('XZ(θ) turns e_x toward e_z: R e_x = cos θ e_x + sin θ e_z, the right-handed rotation about −y', () => {
    // §2.1 convention R_ij(θ) e_i = cos θ e_i + sin θ e_j, called out again in
    // §11 for XZ. The textbook R_y(φ) has R_y(φ) e_x = cos φ e_x − sin φ e_z,
    // so R_XZ(θ) = R_y(−θ): the (0,2) entry must be −sin θ, the (2,0) entry +sin θ.
    const theta = 0.7;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const m = rotation3('XZ', theta);
    expectVecNear(m, [c, 0, -s, 0, 1, 0, s, 0, c], 0, 'R_XZ entries');
    expectVecNear(apply3(m, E_X), [c, 0, s], 0, 'R_XZ e_x');
    expectVecNear(apply3(m, E_Z), [-s, 0, c], 0, 'R_XZ e_z');
    // Right-handed about −y: the textbook matrix about +y at angle −θ.
    const ry = (phi: number): Mat3 => [Math.cos(phi), 0, Math.sin(phi), 0, 1, 0, -Math.sin(phi), 0, Math.cos(phi)];
    expectVecNear(m, ry(-theta), 1e-15, 'R_XZ(θ) = R_y(−θ)');
  });

  it('XY(θ) turns e_x toward e_y and YZ(θ) turns e_y toward e_z (right-handed about +z and +x)', () => {
    const theta = -1.1;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    expectVecNear(apply3(rotation3('XY', theta), E_X), [c, s, 0], 0, 'R_XY e_x');
    expectVecNear(apply3(rotation3('XY', theta), E_Y), [-s, c, 0], 0, 'R_XY e_y');
    expectVecNear(apply3(rotation3('YZ', theta), E_Y), [0, c, s], 0, 'R_YZ e_y');
    expectVecNear(apply3(rotation3('YZ', theta), E_Z), [0, -s, c], 0, 'R_YZ e_z');
  });

  it('fixes the complementary axis exactly: XY fixes e_z, XZ fixes e_y, YZ fixes e_x', () => {
    // §2.1: R_ij(θ) e_k = e_k for k ∉ {i, j}. Exact, since the k-th row and column are those of I.
    for (const theta of [0.3, 2.0, -2.9]) {
      expect(apply3(rotation3('XY', theta), E_Z)).toEqual([0, 0, 1]);
      expect(apply3(rotation3('XZ', theta), E_Y)).toEqual([0, 1, 0]);
      expect(apply3(rotation3('YZ', theta), E_X)).toEqual([1, 0, 0]);
    }
  });

  it('is a one-parameter group: R(a)R(b) = R(a + b), R(0) = I, R(−θ) = Rᵀ, R(2π) = I', () => {
    const r = rng(2);
    for (const plane of FLAT_PLANES) {
      // −sin 0 is IEEE −0, which equals 0: compare by norm, not bit pattern.
      expect(matDistance(rotation3(plane, 0), identity3())).toBe(0);
      for (let k = 0; k < 5; k++) {
        const a = randomAngle(r);
        const b = randomAngle(r);
        // cos/sin of a + b vs products: angle-addition formulas hold to a few ulps.
        expect(matDistance(mul3(rotation3(plane, a), rotation3(plane, b)), rotation3(plane, a + b))).toBeLessThanOrEqual(1e-14);
        expect(matDistance(rotation3(plane, -a), transpose3(rotation3(plane, a)))).toBe(0);
      }
      // sin(2π) ≈ 2.4e-16 in floating point.
      expect(matDistance(rotation3(plane, 2 * Math.PI), identity3())).toBeLessThanOrEqual(1e-15);
    }
  });

  it('rotations in two different planes never commute (every pair of coordinate planes of R³ shares an axis)', () => {
    // §2.1: only rotations in disjoint planes commute. In R³ there is no
    // disjoint pair: XY∩XZ = x, XY∩YZ = y, XZ∩YZ = z. For XY(a), XZ(b) the
    // commutator AB − BA has entries sa(cb − 1), sb(1 − ca), ±sa·sb, so
    // ‖AB − BA‖_F² = 2sa²(1−cb)² + 2sb²(1−ca)² + 2sa²sb² ≥ 2 sin⁴(0.3) for
    // |a|, |b| ∈ [0.3, 2.8] (sin ≥ sin 0.3 there), i.e. ‖·‖_F ≥ 0.123; the
    // other two pairs are the same up to relabelling the axes. Assert > 0.1.
    const r = rng(3);
    const pairs: [FlatPlane, FlatPlane][] = [['XY', 'XZ'], ['XY', 'YZ'], ['XZ', 'YZ']];
    for (const [p, q] of pairs) {
      for (let k = 0; k < 6; k++) {
        const a = randomAngle(r);
        const b = randomAngle(r);
        const ab = mul3(rotation3(p, a), rotation3(q, b));
        const ba = mul3(rotation3(q, b), rotation3(p, a));
        expect(matDistance(ab, ba), `${p}(${a}) and ${q}(${b}) should not commute`).toBeGreaterThan(0.1);
      }
    }
  });
});

describe('compositeRotation3 (§2.2 order restricted to R³)', () => {
  it('equals R_YZ · R_XZ · R_XY: XY applied first, then XZ, then YZ', () => {
    // §2.2: M = R_ZW R_YW R_YZ R_XW R_XZ R_XY; dropping the w planes leaves R_YZ R_XZ R_XY.
    const r = rng(4);
    for (let k = 0; k < 10; k++) {
      const angles = randomAngles(r);
      const expected = mul3(rotation3('YZ', angles.YZ), mul3(rotation3('XZ', angles.XZ), rotation3('XY', angles.XY)));
      expect(matDistance(compositeRotation3(angles), expected)).toBeLessThanOrEqual(1e-15);
      // Applying XY first means M e_x = R_YZ R_XZ (cos a e_x + sin a e_y).
      const first = apply3(rotation3('XY', angles.XY), E_X);
      expectVecNear(apply3(compositeRotation3(angles), E_X), apply3(mul3(rotation3('YZ', angles.YZ), rotation3('XZ', angles.XZ)), first), 1e-15, 'M e_x');
      // The reverse order is a different matrix (the planes share axes, see above).
      const reversed = mul3(rotation3('XY', angles.XY), mul3(rotation3('XZ', angles.XZ), rotation3('YZ', angles.YZ)));
      expect(matDistance(compositeRotation3(angles), reversed)).toBeGreaterThan(0.1);
    }
  });

  it('is the identity for zero angles, a single plane rotation when only that angle is set, and special orthogonal in general', () => {
    expect(compositeRotation3(zeroFlatAngles())).toEqual(identity3());
    for (const plane of FLAT_PLANES) {
      const angles = zeroFlatAngles();
      angles[plane] = 1.234;
      expect(compositeRotation3(angles)).toEqual(rotation3(plane, 1.234));
    }
    const r = rng(5);
    for (let k = 0; k < 10; k++) {
      const m = compositeRotation3(randomAngles(r));
      expect(matDistance(mul3(transpose3(m), m), identity3())).toBeLessThanOrEqual(1e-14);
      expectNear(det3([m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]), 1, 1e-14, 'det M');
    }
  });

  it('mul3 and apply3 implement the row-major product of §1: (M p)_r = Σ_c m[r·3 + c] p_c', () => {
    const a: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 10];
    const b: Mat3 = [0, 1, 0, 0, 0, 1, 1, 0, 0]; // cyclic permutation: b e_x = e_z, b e_y = e_x, b e_z = e_y
    // (a b) column c = a (b e_c): b e_x = e_z → column 3 of a = (3, 6, 10) ...
    expect(mul3(a, b)).toEqual([3, 1, 2, 6, 4, 5, 10, 7, 8]);
    expect(apply3(a, [1, 0, 0])).toEqual([1, 4, 7]);
    expect(apply3(a, [1, 1, 1])).toEqual([6, 15, 25]);
    expect(transpose3(a)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 10]);
  });
});

// ---- §11 / §3: projection to the plane -------------------------------------

describe('project2 and sliceScale2 (§11, §3 one dimension down)', () => {
  it('orthographic projection drops z', () => {
    expect(project2([0.3, -2, 7], { kind: 'orthographic' })).toEqual([0.3, -2]);
    expect(sliceScale2({ kind: 'orthographic' }, 0.9)).toBe(1);
  });

  it('the cube [−1, 1]³ from d = 3 is the square inside a square: scales exactly 3/2 at z = +1 and 3/4 at z = −1', () => {
    // §11: (x, y) · d / (d − z). d/(d − 1) = 3/2 and d/(d + 1) = 3/4 are exact in
    // binary floating point, and so is their product with ±1.
    const persp = { kind: 'perspective' as const, distance: 3 };
    for (const m of cube().positions) {
      const [x, y] = project2(m, persp);
      const s = m[2] > 0 ? 1.5 : 0.75;
      expect(x).toBe(m[0] * s);
      expect(y).toBe(m[1] * s);
    }
    expect(sliceScale2(persp, 1)).toBe(1.5);
    expect(sliceScale2(persp, -1)).toBe(0.75);
    expect(sliceScale2(persp, 0)).toBe(1);
  });

  it('project2 is sliceScale2 applied at the point’s own depth, for random points and eye distances', () => {
    const r = rng(6);
    for (let k = 0; k < 20; k++) {
      const d = 1 + 4 * r();
      const p: Vec3 = [2 * r() - 1, 2 * r() - 1, (2 * r() - 1) * 0.9 * d];
      const [x, y] = project2(p, { kind: 'perspective', distance: d });
      const s = sliceScale2({ kind: 'perspective', distance: d }, p[2]);
      expectNear(s, d / (d - p[2]), 1e-15, 'scale');
      expectNear(x, p[0] * s, 1e-15, 'x');
      expectNear(y, p[1] * s, 1e-15, 'y');
    }
  });

  it('points at or beyond the eye are pushed far away, never inverted (denominator clamped at MIN_DENOMINATOR)', () => {
    // §3.2 requires the treatment of w ≥ d to be documented as a clamp of the
    // denominator to a small positive value: scale = d / max(d − z, ε).
    const persp = { kind: 'perspective' as const, distance: 3 };
    const far = 3 / MIN_DENOMINATOR;
    expect(project2([1, -1, 3], persp)).toEqual([far, -far]);
    expect(project2([1, -1, 4], persp)).toEqual([far, -far]);
    expect(project2([1, -1, 3 - MIN_DENOMINATOR / 2], persp)).toEqual([far, -far]);
    expect(sliceScale2(persp, 5)).toBe(far);
    // The clamp is a parameter.
    expect(project2([1, 0, 10], persp, 0.5)).toEqual([6, 0]);
    expect(sliceScale2(persp, 10, 0.5)).toBe(6);
    // Just inside the clamp the formula is used unchanged: d/(d − z) = 1500
    // (3 − (3 − 0.002) is not exactly 0.002 in binary, hence 1e-9 relative).
    const [xNear, yNear] = project2([1, 0, 3 - 2 * MIN_DENOMINATOR], persp);
    expectNear(xNear, 3 / (2 * MIN_DENOMINATOR), 1e-9 * 1500, 'just inside the clamp');
    expect(yNear).toBe(0);
  });

  it('rejects a non-positive or non-finite eye distance', () => {
    expect(() => project2([0, 0, 0], { kind: 'perspective', distance: 0 })).toThrow();
    expect(() => project2([0, 0, 0], { kind: 'perspective', distance: -3 })).toThrow();
    expect(() => project2([0, 0, 0], { kind: 'perspective', distance: Number.NaN })).toThrow();
  });
});

// ---- §11 / §4: planes and charts ---------------------------------------------

describe('planeChart (§11, §4 one dimension down)', () => {
  it('gives an orthonormal basis of m^⊥ with det(u1, u2, m) = +1 for random normals of any length, and normalises the plane', () => {
    // §11: (u1, u2) orthonormal in m^⊥ with det(u1, u2, m) = +1, |m| = 1. A
    // normal of length L describes the same plane as (m/L, k/L).
    const r = rng(7);
    for (let k = 0; k < 60; k++) {
      const dir = randomUnit3(r);
      const len = 0.01 + 5 * r();
      const offset = 4 * r() - 2;
      const plane = planeChart([dir[0] * len, dir[1] * len, dir[2] * len], offset);
      const [u1, u2] = plane.basis;
      expectNear(length3(plane.normal), 1, 1e-14, 'unit normal');
      expectVecNear(plane.normal, dir, 1e-14, 'normal direction');
      expectNear(plane.offset, offset / len, 1e-12 * Math.abs(offset / len) + 1e-15, 'offset / |m|');
      expectNear(length3(u1), 1, 1e-14, '|u1|');
      expectNear(length3(u2), 1, 1e-14, '|u2|');
      expectNear(dot3(u1, u2), 0, 1e-14, 'u1·u2');
      expectNear(dot3(u1, plane.normal), 0, 1e-14, 'u1·m');
      expectNear(dot3(u2, plane.normal), 0, 1e-14, 'u2·m');
      expectNear(det3(u1, u2, plane.normal), 1, 1e-14, 'det(u1, u2, m)');
      // det +1 for an orthonormal triple is u1 × u2 = m.
      expectVecNear(cross3(u1, u2), plane.normal, 1e-14, 'u1 × u2');
    }
  });

  it('is exactly (e_x, e_y) for m = e_z, so a slice at z = c shows the object’s own x, y', () => {
    const plane = planeChart(E_Z, 0.25);
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.offset).toBe(0.25);
    expect(plane.basis[0]).toEqual([1, 0, 0]);
    expect(plane.basis[1]).toEqual([0, 1, 0]);
    expect(chart2(plane, [0.3, -0.7, 0.25])).toEqual([0.3, -0.7]);
    // The opposite normal keeps det +1 by flipping u2: (e_x, −e_y, −e_z) has det +1.
    const down = planeChart([0, 0, -1], 0.25);
    expectVecNear(down.basis[0], [1, 0, 0], 0, 'u1 for −e_z');
    expectVecNear(down.basis[1], [0, -1, 0], 0, 'u2 for −e_z');
    expectNear(det3(down.basis[0], down.basis[1], down.normal), 1, 0, 'det for −e_z');
  });

  it('is robust for m = ±e_x and ±e_y (where a seed along e_x would vanish) and still has det +1', () => {
    // For m = ±e_x, e_x has no component in m^⊥: u1 must come from elsewhere.
    // Any orthonormal (u1, u2) with u1 × u2 = m is admissible; check that and
    // that the result is exact (components 0, ±1).
    const cases: [Vec3, string][] = [[E_X, '+e_x'], [[-1, 0, 0], '−e_x'], [E_Y, '+e_y'], [[0, -1, 0], '−e_y']];
    for (const [m, name] of cases) {
      const plane = planeChart(m, 0);
      const [u1, u2] = plane.basis;
      expectNear(length3(u1), 1, 0, `|u1| for ${name}`);
      expectNear(length3(u2), 1, 0, `|u2| for ${name}`);
      expectNear(dot3(u1, u2), 0, 0, `u1·u2 for ${name}`);
      expectNear(dot3(u1, m), 0, 0, `u1·m for ${name}`);
      expectNear(dot3(u2, m), 0, 0, `u2·m for ${name}`);
      expectVecNear(cross3(u1, u2), m, 0, `u1 × u2 for ${name}`);
      for (const u of [u1, u2]) for (const x of u) expect([0, 1, -1]).toContain(x);
    }
  });

  it('stays orthonormal for normals a hair away from ±e_x, on both sides of any seed-switch threshold', () => {
    // A seed nearly parallel to m leaves a residue of length ~1e-6 whose
    // normalisation amplifies rounding by 1e6; a correct chart still returns
    // an orthonormal pair to 1e-12 (the "twice is enough" Gram–Schmidt bound).
    const normals: Vec3[] = [[1, 2e-6, 0], [1, 5e-7, 0], [1, 1e-6, 1e-6], [-1, 0, 3e-6], [-1, -1e-7, 0], [0.9999999, 1e-7, -1e-7], [1, 1e-3, -2e-3]];
    for (const m of normals) {
      const plane = planeChart(m, 1);
      const [u1, u2] = plane.basis;
      expectNear(length3(u1), 1, 1e-12, `|u1| near ${m}`);
      expectNear(length3(u2), 1, 1e-12, `|u2| near ${m}`);
      expectNear(dot3(u1, u2), 0, 1e-12, `u1·u2 near ${m}`);
      expectNear(dot3(u1, plane.normal), 0, 1e-12, `u1·m near ${m}`);
      expectNear(dot3(u2, plane.normal), 0, 1e-12, `u2·m near ${m}`);
      expectNear(det3(u1, u2, plane.normal), 1, 1e-12, `det near ${m}`);
    }
  });

  it('depends continuously on m near e_z: |u1 − e_x| ≤ 2ε and |u2 − e_y| ≤ 4ε for |m − e_z| ≈ ε', () => {
    // §4 (the requirement §11 inherits): the basis must be continuous in a
    // neighbourhood of the default normal. For m = (ε1, ε2, √(1 − ε²)) any
    // chart that reduces to (e_x, e_y) at e_z and is differentiable there
    // moves by O(ε). Concretely for the Gram–Schmidt chart u1 ∝ e_x − m_x m,
    // |u1 − e_x| = |ε1| + O(ε²) ≤ 2ε, and u2 = m × u1 gives
    // |u2 − e_y| ≤ |m − e_z| + |u1 − e_x| ≤ 3ε + O(ε²); assert 4ε.
    const r = rng(8);
    for (const eps of [1e-1, 1e-2, 1e-4, 1e-6, 1e-9]) {
      for (let k = 0; k < 8; k++) {
        const phi = 2 * Math.PI * r();
        const m: Vec3 = [eps * Math.cos(phi), eps * Math.sin(phi), Math.sqrt(1 - eps * eps)];
        const [u1, u2] = planeChart(m, 0).basis;
        expect(length3(sub3(u1, E_X)), `|u1 − e_x| at ε = ${eps}`).toBeLessThanOrEqual(2 * eps + 1e-15);
        expect(length3(sub3(u2, E_Y)), `|u2 − e_y| at ε = ${eps}`).toBeLessThanOrEqual(4 * eps + 1e-15);
      }
    }
  });

  it('rejects a zero normal', () => {
    expect(() => planeChart([0, 0, 0], 1)).toThrow();
  });

  it('chart2 and unchart2 invert each other: unchart2 ∘ chart2 is the identity on the plane and chart2 ∘ unchart2 on R²', () => {
    const r = rng(9);
    for (let k = 0; k < 20; k++) {
      const plane = planeChart(randomUnit3(r), 3 * r() - 1.5);
      const q: Vec2 = [4 * r() - 2, 4 * r() - 2];
      const p = unchart2(plane, q);
      // p lies in the plane: m · p = offset.
      expectNear(dot3(plane.normal, p), plane.offset, 1e-14, 'm · unchart2(q)');
      expectVecNear(chart2(plane, p), q, 1e-14, 'chart2(unchart2(q))');
      expectVecNear(unchart2(plane, chart2(plane, p)), p, 1e-14, 'unchart2(chart2(p))');
      // For an arbitrary point, unchart2 ∘ chart2 is the orthogonal projection onto the plane (§4: the normal component is killed).
      const x: Vec3 = [4 * r() - 2, 4 * r() - 2, 4 * r() - 2];
      const s = dot3(plane.normal, x) - plane.offset;
      expectVecNear(unchart2(plane, chart2(plane, x)), sub3(x, [plane.normal[0] * s, plane.normal[1] * s, plane.normal[2] * s]), 1e-14, 'projection');
    }
  });
});

describe('planeFromRotation (§4 one dimension down: rotate the object or rotate the plane)', () => {
  it('has normal Mᵀe_z and basis (Mᵀe_x, Mᵀe_y), orthonormal with det +1, for random rotations', () => {
    // Slicing M·S by e_z · q = c is slicing S by (Mᵀe_z) · p = c, and the
    // screen coordinates e_x · (M p), e_y · (M p) are (Mᵀe_x) · p, (Mᵀe_y) · p.
    const r = rng(10);
    for (let k = 0; k < 10; k++) {
      const m = compositeRotation3(randomAngles(r));
      const mt = transpose3(m);
      const plane = planeFromRotation(m, 0.4);
      expect(plane.offset).toBe(0.4);
      expectVecNear(plane.normal, apply3(mt, E_Z), 0, 'Mᵀe_z');
      expectVecNear(plane.basis[0], apply3(mt, E_X), 0, 'Mᵀe_x');
      expectVecNear(plane.basis[1], apply3(mt, E_Y), 0, 'Mᵀe_y');
      expectNear(length3(plane.normal), 1, 1e-14, '|normal|');
      expectNear(dot3(plane.basis[0], plane.basis[1]), 0, 1e-14, 'u1·u2');
      expectNear(det3(plane.basis[0], plane.basis[1], plane.normal), 1, 1e-14, 'det');
    }
    const id = planeFromRotation(identity3(), -0.3);
    expect(id).toEqual({ normal: [0, 0, 1], offset: -0.3, basis: [[1, 0, 0], [0, 1, 0]] });
  });

  it('slicing the rotated cube and tetrahedron by z = c equals slicing the originals by the rotated plane (same chart loops and area; 3D loops related by M)', () => {
    const r = rng(11);
    for (const mesh of [cube(), tetrahedron()]) {
      for (let k = 0; k < 6; k++) {
        const m = compositeRotation3(randomAngles(r));
        const c = 1.4 * r() - 0.7;
        const rotated = transformMesh3(mesh, (p) => apply3(m, p));
        const byZ = sliceSection(rotated, planeChart(E_Z, c));
        const byPlane = sliceSection(mesh, planeFromRotation(m, c));
        // |c| < 0.7 is inside both solids' inscribed balls (cube: 1; regular
        // tetrahedron of edge 2√2: inradius a/√24 = 2√2/√24 = 1/√3 ≈ 0.577...
        // for |c| up to 0.7 the plane may miss the tetrahedron's inball but
        // still cuts it, since its circumradius is √3), so each slice is one
        // convex polygon.
        expect(byZ.loops.length, 'loop count').toBe(1);
        expect(byPlane.loops.length, 'loop count').toBe(1);
        expectNear(byZ.area, byPlane.area, 1e-12, 'area');
        expectSamePoints(byZ.loops[0], byPlane.loops[0], 1e-12, 'chart loop');
        // The 3D points of the rotated slice are M times those of the original slice.
        expectSamePoints(byZ.loops3[0], byPlane.loops3[0].map((p) => apply3(m, p)), 1e-12, '3D loop');
        // The triangulated slices agree too, and both are counter-clockwise in their charts.
        const triZ = sliceMesh3(rotated, planeChart(E_Z, c));
        const triP = sliceMesh3(mesh, planeFromRotation(m, c));
        expectTrianglesCcw(triZ, 'rotated-mesh slice');
        expectTrianglesCcw(triP, 'rotated-plane slice');
        expectNear(triangleAreaSum(triZ), byZ.area, 1e-12, 'triangle area (rotated mesh)');
        expectNear(triangleAreaSum(triP), byZ.area, 1e-12, 'triangle area (rotated plane)');
        // Colour data: the rotated-plane slice reports the object's own z, the rotated-mesh slice the rotated z = c.
        for (const z of triZ.sourceZ) expectNear(z, c, 1e-12, 'sourceZ of rotated mesh');
        const rotatedPlane = planeFromRotation(m, c);
        triP.sourceZ.forEach((z, i) => expectNear(z, unchart2(rotatedPlane, triP.triangles.positions[i])[2], 1e-12, 'sourceZ of rotated plane'));
      }
    }
  });
});

// ---- §11 known answers: the cube ---------------------------------------------

describe('sliceMesh3 of the cube [−1, 1]³ (§11 known answers)', () => {
  it('along e_z at any |c| < 1 is the square with corners (±1, ±1), area 4, one counter-clockwise loop of 4 vertices, 4 as sourceZ = c', () => {
    // §11: "the cube [−1, 1]³ sliced by z = c, |c| < 1, is a square of area 4".
    // The lateral faces are split by a diagonal; the crossing on the diagonal
    // lies on the straight cut across the face and must not appear as a vertex.
    for (const c of [-0.9, -0.3, 0, 0.3, 0.77, 0.999]) {
      const slice = sliceMesh3(cube(), planeChart(E_Z, c));
      expect(slice.loops.length, `loops at c = ${c}`).toBe(1);
      expectSamePoints(slice.loops[0], [[-1, -1], [1, -1], [1, 1], [-1, 1]], 1e-14, `square at c = ${c}`);
      expect(signedArea2(slice.loops[0]), 'counter-clockwise').toBeGreaterThan(0);
      expectNear(slice.area, 4, 1e-14, `area at c = ${c}`);
      expectTrianglesCcw(slice);
      expectNear(triangleAreaSum(slice), 4, 1e-14, 'triangle area');
      expect(slice.triangles.indices.length).toBe(6); // a quadrilateral is two triangles
      for (const z of slice.sourceZ) expectNear(z, c, 1e-15, 'sourceZ');
    }
  });

  it('through the origin perpendicular to (1,1,1) is the regular hexagon on the six edge midpoints: side √2, area 3√3', () => {
    // §11: vertices at the six edge midpoints. The midpoints with x+y+z = 0 are
    // the permutations of (1, −1, 0). Consecutive ones differ in two coordinates
    // by 1, so the side is √2, and a regular hexagon of side s has area
    // (3√3/2)s² = 3√3. Exactly those six points, no diagonal crossings.
    const plane = planeChart([1, 1, 1], 0);
    const section = sliceSection(cube(), plane);
    const midpoints: Vec3[] = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
    expect(section.loops3.length).toBe(1);
    expectSamePoints(section.loops3[0], midpoints, 1e-12, 'hexagon vertices');
    const loop = section.loops3[0];
    for (let i = 0; i < 6; i++) expectNear(length3(sub3(loop[(i + 1) % 6], loop[i])), Math.SQRT2, 1e-12, `side ${i}`);
    expectNear(section.area, 3 * SQRT3, 1e-12, 'hexagon area');
    // The chart loop is the same hexagon (unchart2 maps it back) and is counter-clockwise.
    const slice = sliceMesh3(cube(), plane);
    expect(slice.loops.length).toBe(1);
    expect(slice.loops[0].length).toBe(6);
    expectSamePoints(slice.loops[0].map((q) => unchart2(plane, q)), midpoints, 1e-12, 'uncharted hexagon');
    expectNear(signedArea2(slice.loops[0]), 3 * SQRT3, 1e-12, 'signed area (counter-clockwise)');
    expectNear(slice.area, 3 * SQRT3, 1e-12, 'slice.area');
    expectTrianglesCcw(slice);
    expectNear(triangleAreaSum(slice), 3 * SQRT3, 1e-12, 'triangle area');
    expect(slice.triangles.indices.length).toBe(12); // hexagon = 4 triangles
    // Colour: z of the hexagon vertices is in {−1, 0, 1}, carried through sourceZ.
    for (const z of slice.sourceZ) expect([-1, 0, 1].some((v) => Math.abs(v - z) < 1e-12), `sourceZ ${z}`).toBe(true);
  });

  it('at x + y + z = ±1.5 (planeChart([1,1,1], ±1.5)) is a triangle on the quarter-points of the three corner edges: area 9√3/8', () => {
    // planeChart rescales (m, k) = ((1,1,1), 1.5) to the plane x + y + z = 1.5.
    // On the edge (1, 1, t) the sum is 2 + t = 1.5 at t = −1/2, a quarter of the
    // way from (1, 1, −1) toward (1, 1, 1). Vertices (1, 1, −½), (1, −½, 1),
    // (−½, 1, 1); side √(1.5² + 1.5²) = 1.5√2; area (√3/4)(1.5√2)² = 9√3/8.
    // The mirror plane x + y + z = −1.5 gives the negatives.
    for (const sign of [1, -1]) {
      const plane = planeChart([1, 1, 1], 1.5 * sign);
      expectNear(plane.offset, (1.5 * sign) / SQRT3, 1e-15, 'normalised offset');
      const section = sliceSection(cube(), plane);
      const expected: Vec3[] = [[1, 1, -0.5], [1, -0.5, 1], [-0.5, 1, 1]].map((p) => [p[0] * sign, p[1] * sign, p[2] * sign]);
      expect(section.loops3.length).toBe(1);
      expectSamePoints(section.loops3[0], expected, 1e-12, `triangle at ${sign * 1.5}`);
      expectNear(section.area, (9 * SQRT3) / 8, 1e-12, 'triangle area');
      const slice = sliceMesh3(cube(), plane);
      expect(slice.loops[0].length).toBe(3);
      expect(signedArea2(slice.loops[0]), 'counter-clockwise about the normal, on both sides of the origin').toBeGreaterThan(0);
      expectNear(triangleAreaSum(slice), (9 * SQRT3) / 8, 1e-12, 'triangle area');
    }
  });

  it('at unit-normal offset c = 1.5 along (1,1,1)/√3 is the triangle with vertices (1, 1, t) etc., t = 1.5√3 − 2, area (√3/2)(1 − t)²', () => {
    // n · p = c with |n| = 1 is x + y + z = c√3. On the edge (1, 1, t): t = 1.5√3 − 2 ≈ 0.598.
    // Side (1 − t)√2, area (√3/4)·2(1 − t)² = (√3/2)(1 − t)².
    const n: Vec3 = [1 / SQRT3, 1 / SQRT3, 1 / SQRT3];
    const t = 1.5 * SQRT3 - 2;
    const section = sliceSection(cube(), planeChart(n, 1.5));
    expect(section.loops3.length).toBe(1);
    expectSamePoints(section.loops3[0], [[1, 1, t], [1, t, 1], [t, 1, 1]], 1e-12, 'triangle');
    expectNear(section.area, (SQRT3 / 2) * (1 - t) ** 2, 1e-12, 'area');
  });

  it('moving the (1,1,1)/√3 plane from corner to corner gives point, triangle, hexagon, triangle, point', () => {
    // §11 / §8.4 analogue. Corner offsets ±√3 (a point, zero area); the three
    // neighbours of a corner sit at ±1/√3, so |c| ∈ (1/√3, √3) gives a
    // triangle and |c| < 1/√3 a hexagon. At |c| = 1/√3 the plane holds three
    // cube vertices: the triangle on them has side 2√2 and area (√3/4)·8 = 2√3.
    const n: Vec3 = [1 / SQRT3, 1 / SQRT3, 1 / SQRT3];
    const counts = [-1.2, -0.3, 0, 0.3, 1.2].map((c) => sliceMesh3(cube(), planeChart(n, c)).loops.map((l) => l.length));
    expect(counts).toEqual([[3], [6], [6], [6], [3]]);
    for (const c of [-1.8, 1.8, -SQRT3, SQRT3]) {
      const slice = sliceMesh3(cube(), planeChart(n, c));
      expect(slice.area, `area at c = ${c}`).toBeLessThanOrEqual(1e-12);
      for (const loop of slice.loops) expect(Math.abs(signedArea2(loop))).toBeLessThanOrEqual(1e-12);
    }
    for (const sign of [1, -1]) {
      const section = sliceSection(cube(), planeChart(n, sign / SQRT3));
      expectNear(section.area, 2 * SQRT3, 1e-9, `area at c = ${sign}/√3`);
      expect(section.loops3.length).toBe(1);
      expectSamePoints(section.loops3[0], [[1, 1, -1], [1, -1, 1], [-1, 1, 1]].map((p) => [p[0] * sign, p[1] * sign, p[2] * sign]), 1e-9, 'corner triangle');
    }
    // Area is continuous across the vertex offset: just below and above 1/√3 both ≈ 2√3.
    for (const dc of [-1e-6, 1e-6]) expectNear(sliceMesh3(cube(), planeChart(n, 1 / SQRT3 + dc)).area, 2 * SQRT3, 1e-4, 'continuity');
  });

  it('is empty beyond |c| = √3 along (1,1,1)/√3 and beyond |c| = 1 along e_z', () => {
    for (const [n, c] of [[[1 / SQRT3, 1 / SQRT3, 1 / SQRT3], 1.75], [[1 / SQRT3, 1 / SQRT3, 1 / SQRT3], -2], [E_Z, 1.0001], [E_Z, -3]] as [Vec3, number][]) {
      const slice = sliceMesh3(cube(), planeChart(n, c));
      expect(slice.loops).toEqual([]);
      expect(slice.area).toBe(0);
      expect(slice.triangles.indices.length).toBe(0);
      expect(slice.triangles.positions.length).toBe(0);
      expect(slice.sourceZ.length).toBe(0);
    }
  });

  it('follows the limit-from-below convention at the faces: the full square at z = +1, nothing at z = −1', () => {
    // §6 (which §11 inherits through §9.1): zero signed distance counts as
    // positive, equivalent to slicing at c − ε. At c = 1 the slice is the
    // whole top face (area 4), at c = −1 it is empty.
    const top = sliceMesh3(cube(), planeChart(E_Z, 1));
    expect(top.loops.length).toBe(1);
    expectSamePoints(top.loops[0], [[-1, -1], [1, -1], [1, 1], [-1, 1]], 1e-14, 'top face');
    expect(signedArea2(top.loops[0])).toBeGreaterThan(0);
    expectNear(top.area, 4, 1e-14, 'area at z = 1');
    expectTrianglesCcw(top);
    expectNear(triangleAreaSum(top), 4, 1e-14, 'triangles at z = 1');
    for (const z of top.sourceZ) expect(z).toBe(1);
    const bottom = sliceMesh3(cube(), planeChart(E_Z, -1));
    expect(bottom.loops).toEqual([]);
    expect(bottom.area).toBe(0);
    expect(bottom.triangles.indices.length).toBe(0);
    // Same convention on the other axes.
    expectNear(sliceMesh3(cube(), planeChart(E_X, 1)).area, 4, 1e-14, 'x = 1');
    expect(sliceMesh3(cube(), planeChart(E_X, -1)).area).toBe(0);
    expectNear(sliceMesh3(cube(), planeChart([0, -1, 0], 1)).area, 4, 1e-14, '−y = 1, i.e. y = −1 seen from below');
    expect(sliceMesh3(cube(), planeChart([0, -1, 0], -1)).area).toBe(0);
  });

  it('through two opposite edges (x + y = 0) is the 2 × 2√2 rectangle on four cube vertices; through one edge (x + y = 2) it is empty', () => {
    // The plane x + y = 0 contains the edges {x = −1, y = 1} and {x = 1, y = −1}
    // (z free). The section is the rectangle with those four cube corners,
    // sides 2 (along z) and 2√2 (the face diagonal): area 4√2. Vertices lying
    // exactly in the plane must not break the chaining or duplicate points.
    const section = sliceSection(cube(), planeChart([1, 1, 0], 0));
    expect(section.loops3.length).toBe(1);
    expectSamePoints(section.loops3[0], [[-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1]], 1e-12, 'rectangle');
    expectNear(section.area, 4 * Math.SQRT2, 1e-12, 'rectangle area');
    const slice = sliceMesh3(cube(), planeChart([1, 1, 0], 0));
    expect(signedArea2(slice.loops[0])).toBeGreaterThan(0);
    expectNear(triangleAreaSum(slice), 4 * Math.SQRT2, 1e-12, 'triangles');
    // x + y = 2 touches only the edge x = y = 1: a degenerate (zero-area) slice.
    const edge = sliceMesh3(cube(), planeChart([1, 1, 0], 2));
    expect(edge.area).toBeLessThanOrEqual(1e-12);
    expect(edge.triangles.indices.length).toBe(0);
  });
});

// ---- Known slices of the other catalogue solids ------------------------------

describe('known slices of the tetrahedron, octahedron, ball and cylinder', () => {
  it('tetrahedron along e_z: the rectangle (1, c), (c, 1), (−1, −c), (−c, −1) of area 2(1 − c²); empty where the plane holds an edge (c = ±1)', () => {
    // Vertices (1,1,1), (−1,−1,1) at z = 1 and (1,−1,−1), (−1,1,−1) at z = −1.
    // On the edge (1,1,1)→(1,−1,−1) the point at z = c is (1, c, c); likewise
    // (c, 1, c), (−1, −c, c), (−c, −1, c): a rectangle with sides √2(1 − c)
    // and √2(1 + c), area 2(1 − c²). ∫₋₁¹ 2(1 − c²) dc = 8/3 = vol.
    const tet = tetrahedron();
    expectNear(mesh3Volume(tet), 8 / 3, 1e-14, 'tetrahedron volume');
    for (const c of [-0.5, 0, 0.3, 0.9]) {
      const slice = sliceMesh3(tet, planeChart(E_Z, c));
      expect(slice.loops.length).toBe(1);
      expectSamePoints(slice.loops[0], [[1, c], [c, 1], [-1, -c], [-c, -1]], 1e-14, `rectangle at c = ${c}`);
      expect(signedArea2(slice.loops[0])).toBeGreaterThan(0);
      expectNear(slice.area, 2 * (1 - c * c), 1e-14, `area at c = ${c}`);
      expectTrianglesCcw(slice);
      expectNear(triangleAreaSum(slice), 2 * (1 - c * c), 1e-14, 'triangle area');
    }
    // z = ±1 contains an edge of the tetrahedron: limit from below is zero-area (§6).
    for (const c of [1, -1]) {
      const slice = sliceMesh3(tet, planeChart(E_Z, c));
      expect(slice.area, `area at c = ${c}`).toBeLessThanOrEqual(1e-12);
      expect(slice.triangles.indices.length).toBe(0);
    }
  });

  it('tetrahedron perpendicular to (1,1,1) through the origin: the triangle (1, −½, −½), (−½, 1, −½), (−½, −½, 1), area 9√3/8', () => {
    // The vertex (1,1,1) has x+y+z = 3, the other three have −1. On the edge
    // (1,1,1) + s·(0,−2,−2) the sum is 3 − 4s = 0 at s = 3/4: (1, −½, −½).
    // Side 1.5√2, area (√3/4)(4.5) = 9√3/8.
    const section = sliceSection(tetrahedron(), planeChart([1, 1, 1], 0));
    expect(section.loops3.length).toBe(1);
    expectSamePoints(section.loops3[0], [[1, -0.5, -0.5], [-0.5, 1, -0.5], [-0.5, -0.5, 1]], 1e-12, 'triangle');
    expectNear(section.area, (9 * SQRT3) / 8, 1e-12, 'area');
  });

  it('octahedron along e_z: the square |x| + |y| ≤ 1 − |c| of area 2(1 − |c|)², a point at c = ±1', () => {
    // Faces (±e_x, ±e_y, ±e_z): the section at height c is the square with
    // vertices (±(1 − |c|), 0), (0, ±(1 − |c|)), area 2(1 − |c|)². ∫ = 4/3 = vol.
    const oct = octahedron();
    expectNear(mesh3Volume(oct), 4 / 3, 1e-14, 'octahedron volume');
    for (const c of [-0.5, 0, 0.3, 0.9]) {
      const h = 1 - Math.abs(c);
      const slice = sliceMesh3(oct, planeChart(E_Z, c));
      expect(slice.loops.length).toBe(1);
      expectSamePoints(slice.loops[0], [[h, 0], [0, h], [-h, 0], [0, -h]], 1e-14, `square at c = ${c}`);
      expect(signedArea2(slice.loops[0])).toBeGreaterThan(0);
      expectNear(slice.area, 2 * h * h, 1e-14, `area at c = ${c}`);
      expectTrianglesCcw(slice);
      expectNear(triangleAreaSum(slice), 2 * h * h, 1e-14, 'triangle area');
    }
    for (const c of [1, -1]) expect(sliceMesh3(oct, planeChart(E_Z, c)).area).toBeLessThanOrEqual(1e-12);
  });

  it('ball (icosphere level 3): disc areas lie between π(ρ_in² − c²) and π(1 − c²), within 1% of π(1 − c²) at |c| ≤ 0.5', () => {
    // §11: the ball of radius R gives discs of area π(R² − c²). The icosphere
    // is a convex polyhedron with all vertices on the unit sphere, so it
    // contains the ball of radius ρ_in = min distance from the origin to a
    // face plane and is contained in the unit ball. Its section at offset c
    // therefore contains the disc of radius √(ρ_in² − c²) and lies inside the
    // disc of radius √(1 − c²): π(ρ_in² − c²) ≤ A(c) ≤ π(1 − c²). This is
    // rigorous, direction independent, and tightens with refinement
    // (ρ_in ≈ 0.995 at level 3, so the relative deficit at c = 0 is ≤ 1%).
    const ball = icosphere(1, 3);
    let rhoIn = Infinity;
    for (const [a, b, c] of ball.triangles) {
      const p = ball.positions[a];
      const n = cross3(sub3(ball.positions[b], p), sub3(ball.positions[c], p));
      rhoIn = Math.min(rhoIn, Math.abs(dot3(n, p)) / length3(n));
    }
    expect(rhoIn).toBeGreaterThan(0.99);
    const r = rng(12);
    const directions: Vec3[] = [E_Z, E_X, randomUnit3(r), randomUnit3(r), randomUnit3(r)];
    for (const n of directions) {
      for (const c of [0, 0.3, 0.5, 0.7, 0.9]) {
        const slice = sliceMesh3(ball, planeChart(n, c));
        expect(slice.loops.length, `one loop at c = ${c}`).toBe(1);
        expect(signedArea2(slice.loops[0])).toBeGreaterThan(0);
        const upper = Math.PI * (1 - c * c);
        const lower = Math.PI * (rhoIn * rhoIn - c * c);
        expect(slice.area, `A(${c}) ≤ π(1 − c²)`).toBeLessThanOrEqual(upper + 1e-12);
        expect(slice.area, `A(${c}) ≥ π(ρ_in² − c²)`).toBeGreaterThanOrEqual(lower - 1e-12);
        if (c <= 0.5) expectNear(slice.area, upper, 0.01 * upper, `A(${c}) within 1%`);
        expectTrianglesCcw(slice);
        expectNear(triangleAreaSum(slice), slice.area, 1e-12, 'triangle area');
      }
    }
    // A point at the pole and nothing beyond.
    expect(sliceMesh3(ball, planeChart(E_Z, 1)).area).toBeLessThanOrEqual(1e-12);
    expect(sliceMesh3(ball, planeChart(E_Z, 1.01)).loops).toEqual([]);
  });

  it('cylinder along its axis: the regular 48-gon of area 24 sin(2π/48) for |c| < 1, the full cap at c = 1 and nothing at c = −1', () => {
    // cylinder(1, 2, 48): regular 48-gon of circumradius 1, area (n/2) sin(2π/n) = 24 sin(π/24).
    // Both caps are fans about a centre vertex; the lateral quads are split by diagonals whose
    // crossings are collinear with the ring vertices and must be dropped.
    const cyl = cylinder(1, 2, 48);
    const polygon = 24 * Math.sin(Math.PI / 24);
    for (const c of [-0.99, -0.4, 0, 0.6]) {
      const slice = sliceMesh3(cyl, planeChart(E_Z, c));
      expect(slice.loops.length).toBe(1);
      expect(slice.loops[0].length, `48 vertices at c = ${c}`).toBe(48);
      for (const q of slice.loops[0]) expectNear(Math.hypot(q[0], q[1]), 1, 1e-12, 'on the unit circle');
      expectNear(slice.area, polygon, 1e-12, `area at c = ${c}`);
      expectNear(signedArea2(slice.loops[0]), polygon, 1e-12, 'counter-clockwise');
      expectTrianglesCcw(slice);
      expectNear(triangleAreaSum(slice), polygon, 1e-12, 'triangle area');
    }
    expectNear(sliceMesh3(cyl, planeChart(E_Z, 1)).area, polygon, 1e-12, 'top cap (limit from below)');
    expect(sliceMesh3(cyl, planeChart(E_Z, -1)).area).toBe(0);
    expect(sliceMesh3(cyl, planeChart(E_Z, -1)).loops).toEqual([]);
    // Across the axis (x = 0): the 2 × 2 rectangle y, z ∈ [−1, 1] (ring vertices at ±e_y exist since 48 ≡ 0 mod 4).
    const across = sliceMesh3(cyl, planeChart(E_X, 0));
    expect(across.loops.length).toBe(1);
    expectNear(across.area, 4, 1e-12, 'rectangle across the axis');
    expect(across.loops[0].length, 'four corners only (axis-parallel edges and fan spokes are collinear with them)').toBe(4);
  });
});

// ---- Loops, holes, orientation and triangulation ---------------------------

describe('loops, holes and triangulation (§11: outer loops counter-clockwise, holes by nesting parity)', () => {
  const ring = torus(1, 0.4, 48, 24);
  const sin48 = Math.sin((2 * Math.PI) / 48);

  it('torus at z = 0: one counter-clockwise outer 48-gon at ρ = 1.4 and one clockwise hole at ρ = 0.6; area = outer − hole', () => {
    // torus(R = 1, r = 0.4, 48, 24) has vertex rings at v = 0 (ρ = 1.4, z = 0)
    // and v = π (ρ = 0.6, z = 0). The section at z = 0 is exactly those two
    // regular 48-gons; a regular n-gon of circumradius ρ has area
    // (n/2) ρ² sin(2π/n). Outer: 24·1.96·sin(2π/48); hole: 24·0.36·sin(2π/48);
    // region area 24·1.6·sin(2π/48) ≈ 5.0122.
    const slice = sliceMesh3(ring, planeChart(E_Z, 0));
    expect(slice.loops.length).toBe(2);
    const signed = slice.loops.map(signedArea2).sort((a, b) => b - a);
    expectNear(signed[0], 24 * 1.96 * sin48, 1e-12, 'outer loop counter-clockwise');
    expectNear(signed[1], -24 * 0.36 * sin48, 1e-12, 'hole clockwise');
    expectNear(slice.area, 24 * 1.6 * sin48, 1e-12, 'annulus area');
    for (const loop of slice.loops) {
      expect(loop.length).toBe(48);
      const rho = signedArea2(loop) > 0 ? 1.4 : 0.6;
      for (const q of loop) expectNear(Math.hypot(q[0], q[1]), rho, 1e-12, 'ring radius');
    }
    expectTrianglesCcw(slice);
    expectNear(triangleAreaSum(slice), 24 * 1.6 * sin48, 1e-12, 'triangulated area');
    for (const z of slice.sourceZ) expectNear(z, 0, 1e-15, 'sourceZ');
  });

  it('torus at a generic height z = 0.25: outer counter-clockwise, hole clockwise, area = |outer| − |hole|, triangles cover exactly that', () => {
    const slice = sliceMesh3(ring, planeChart(E_Z, 0.25));
    expect(slice.loops.length).toBe(2);
    const signed = slice.loops.map(signedArea2);
    const outer = Math.max(...signed);
    const hole = Math.min(...signed);
    expect(outer).toBeGreaterThan(0);
    expect(hole).toBeLessThan(0);
    expectNear(slice.area, outer + hole, 1e-12, 'outer − hole');
    // The annulus lies between the tube's inner and outer cut radii: 1 − √(0.16 − 0.0625) < ρ < 1 + √(0.16 − 0.0625) for the round torus; the polygonal tube is inside the round one.
    const half = Math.sqrt(0.16 - 0.0625);
    for (const loop of slice.loops) for (const q of loop) {
      const rho = Math.hypot(q[0], q[1]);
      expect(rho).toBeGreaterThanOrEqual(1 - half - 1e-12);
      expect(rho).toBeLessThanOrEqual(1 + half + 1e-12);
    }
    expectTrianglesCcw(slice);
    expectNear(triangleAreaSum(slice), slice.area, 1e-12, 'triangulated area equals outer − hole');
    // Triangle vertices are the loop points (the triangulation shares them), and every loop point is used.
    const loopPoints = slice.loops.flat();
    expect(slice.triangles.positions.length).toBe(loopPoints.length);
    expectSamePoints(slice.triangles.positions, loopPoints, 0, 'triangle vertices = loop points');
    expect(new Set(slice.triangles.indices).size).toBe(loopPoints.length);
    for (const z of slice.sourceZ) expectNear(z, 0.25, 1e-15, 'sourceZ');
  });

  it('torus on its side (plane x = 0): two separate counter-clockwise discs, each the tube’s regular 24-gon of area 12·0.16·sin(2π/24)', () => {
    // §11: "turned on its side, the ring splits into two separate discs". The
    // tube cross-section is a regular 24-gon of circumradius 0.4: area
    // (24/2)·0.4²·sin(2π/24). Both loops are outer loops (nesting depth 0).
    const disc = 12 * 0.16 * Math.sin((2 * Math.PI) / 24);
    const slice = sliceMesh3(ring, planeChart(E_X, 0));
    expect(slice.loops.length).toBe(2);
    for (const loop of slice.loops) {
      expect(loop.length).toBe(24);
      expectNear(signedArea2(loop), disc, 1e-12, 'disc, counter-clockwise');
    }
    expectNear(slice.area, 2 * disc, 1e-12, 'two discs');
    expectTrianglesCcw(slice);
    expectNear(triangleAreaSum(slice), 2 * disc, 1e-12, 'triangulated area');
    // Centres at y = ±1: the mean of each 24-gon's vertices.
    const centres = slice.loops.map((l) => l.reduce((s, q) => s + q[0], 0) / l.length).sort((a, b) => a - b);
    expectVecNear(centres, [-1, 1], 1e-12, 'disc centres along u1 = e_y');
  });

  it('the tangent plane z = r = 0.4 gives zero area and no triangles (limit from below: an infinitely thin ring)', () => {
    const slice = sliceMesh3(ring, planeChart(E_Z, 0.4));
    expect(slice.area).toBeLessThanOrEqual(1e-12);
    expect(slice.triangles.indices.length).toBe(0);
    expect(sliceMesh3(ring, planeChart(E_Z, 0.4001)).loops).toEqual([]);
    expect(sliceMesh3(ring, planeChart(E_Z, -0.4)).loops).toEqual([]);
  });

  it('convex solids cut by random planes through their interior give exactly one counter-clockwise loop whose triangulation covers it', () => {
    const r = rng(13);
    const solids: [string, Mesh3, number][] = [['cube', cube(), 0.9], ['tetrahedron', tetrahedron(), 0.5], ['octahedron', octahedron(), 0.5], ['ball', icosphere(1, 2), 0.9]];
    for (const [name, mesh, reach] of solids) {
      for (let k = 0; k < 12; k++) {
        const plane = planeChart(randomUnit3(r), (2 * r() - 1) * reach * 0.5);
        const slice = sliceMesh3(mesh, plane);
        expect(slice.loops.length, `${name}: one loop`).toBe(1);
        const loop = slice.loops[0];
        expect(loop.length, `${name}: a polygon`).toBeGreaterThanOrEqual(3);
        expect(signedArea2(loop), `${name}: counter-clockwise`).toBeGreaterThan(0);
        expectNear(slice.area, signedArea2(loop), 1e-12, `${name}: area`);
        expectTrianglesCcw(slice, name);
        expectNear(triangleAreaSum(slice), slice.area, 1e-12, `${name}: triangulated area`);
        expect(slice.triangles.indices.length, `${name}: n − 2 triangles`).toBe(3 * (loop.length - 2));
        // The loop lies in the plane: unchart2 of every chart point has the loop's z as sourceZ, and loop points are convex-position (no vertex inside the polygon).
        const pts3 = loop.map((q) => unchart2(plane, q));
        slice.sourceZ.forEach((z, i) => expectNear(z, unchart2(plane, slice.triangles.positions[i])[2], 1e-12, `${name}: sourceZ`));
        for (const p of pts3) expectNear(dot3(plane.normal, p), plane.offset, 1e-12, `${name}: in plane`);
      }
    }
  });

  it('sourceZ is the object’s own z of each slice vertex (unchart2 of the chart point), not the chart coordinate', () => {
    const plane = planeChart([0.3, -0.5, 0.8], 0.2);
    const slice = sliceMesh3(cube(), plane);
    expect(slice.triangles.positions.length).toBeGreaterThan(0);
    slice.triangles.positions.forEach((q, i) => {
      const p = unchart2(plane, q);
      expectNear(slice.sourceZ[i], p[2], 1e-12, 'sourceZ = z');
      // and it is a genuine cube boundary point: max |coordinate| = 1.
      expectNear(Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])), 1, 1e-12, 'on the cube');
    });
  });

  it('sliceMeshes3 concatenates parts: loops and triangles of each part, offset indices, area = Σ part areas (overlaps counted twice)', () => {
    const a = cube();
    const b = translateMesh3(cube(), [1.5, 0, 0]); // overlaps a on x ∈ [0.5, 1]
    const plane = planeChart(E_Z, 0.2);
    const sa = sliceMesh3(a, plane);
    const sb = sliceMesh3(b, plane);
    const both = sliceMeshes3([a, b], plane);
    expect(both.loops.length).toBe(sa.loops.length + sb.loops.length);
    expect(both.loops).toEqual([...sa.loops, ...sb.loops]);
    expectNear(both.area, sa.area + sb.area, 1e-14, 'sum of areas (8, overlap counted twice)');
    expectNear(both.area, 8, 1e-14, '4 + 4');
    expect(both.triangles.positions.length).toBe(sa.triangles.positions.length + sb.triangles.positions.length);
    expect(both.sourceZ.length).toBe(both.triangles.positions.length);
    expectTrianglesCcw(both);
    expectNear(triangleAreaSum(both), 8, 1e-14, 'triangles of both');
    // The second part's indices are shifted by the first part's vertex count.
    const shift = sa.triangles.positions.length;
    expect([...both.triangles.indices.slice(sa.triangles.indices.length)]).toEqual(sb.triangles.indices.map((i) => i + shift));
    expect(sliceMeshes3([], plane)).toEqual({ loops: [], triangles: { positions: [], indices: [] }, sourceZ: [], area: 0 });
  });

  it('the human at shoulder height: torso and two upper arms as three separate counter-clockwise loops, area = Σ parts', () => {
    // figures.ts: upper arms are centred at 5.55 heads (y = (5.55 − 3.75)·(2/7.5) = 0.48)
    // at x = ±0.85 heads with radius 0.17 heads, so they span |x| ∈ [0.68, 1.02]
    // heads; the torso's straight part (4.5 .. 5.9 heads) is 1.25·0.5 = 0.625 heads
    // half-wide: the three sections are disjoint, so the plane y = 0.48 meets
    // exactly three parts, each in one loop.
    const parts = humanParts();
    const plane = planeChart(E_Y, 0.48);
    const slice = sliceMeshes3(parts, plane);
    const individual = parts.map((m) => sliceMesh3(m, plane));
    expect(individual.filter((s) => s.loops.length > 0).length).toBe(3);
    expect(slice.loops.length).toBe(3);
    for (const loop of slice.loops) expect(signedArea2(loop)).toBeGreaterThan(0);
    expectNear(slice.area, individual.reduce((s, x) => s + x.area, 0), 1e-14, 'sum of part areas');
    expectNear(triangleAreaSum(slice), slice.area, 1e-12, 'triangulated');
    expectTrianglesCcw(slice, 'human');
    // chart (e_y) basis: u1 = e_x (e_x rejected from e_y is e_x), u2 = e_y × e_x = −e_z. Arm centres at x = ±0.85·(2/7.5).
    const centres = slice.loops.map((l) => l.reduce((s, q) => s + q[0], 0) / l.length).sort((a, b) => a - b);
    expectNear(centres[0], (-0.85 * 2) / 7.5, 1e-9, 'left arm');
    expectNear(centres[1], 0, 1e-9, 'torso');
    expectNear(centres[2], (0.85 * 2) / 7.5, 1e-9, 'right arm');
  });
});

describe('removeCollinear', () => {
  it('drops points on straight runs (face-diagonal crossings) and keeps corners, cyclically', () => {
    // A unit square with the midpoint of every side inserted, starting at a midpoint
    // so that the wrap-around case is exercised.
    const loop: Vec3[] = [[0.5, 0, 0], [1, 0, 0], [1, 0.5, 0], [1, 1, 0], [0.5, 1, 0], [0, 1, 0], [0, 0.5, 0], [0, 0, 0]];
    const out = removeCollinear(loop, 1e-9);
    expectSamePoints(out, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], 0, 'corners');
    // Order preserved (cyclic).
    const start = out.findIndex((p) => p[0] === 1 && p[1] === 0);
    expect(out.map((_, i) => out[(start + i) % 4])).toEqual([[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]]);
  });

  it('respects the tolerance: a vertex within tol of the chord goes, one beyond it stays; reversals (spikes) stay', () => {
    const base: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    const within = base.map((p) => [...p] as Vec3);
    within[1] = [1, 0.5e-6, 0];
    expect(removeCollinear(within, 1e-6).length).toBe(4);
    const beyond = base.map((p) => [...p] as Vec3);
    beyond[1] = [1, 2e-6, 0];
    expect(removeCollinear(beyond, 1e-6).length).toBe(5);
    // A spike: b lies on the line through a and c but beyond c (the loop reverses direction). It is a genuine feature, kept.
    const spike: Vec3[] = [[0, 0, 0], [3, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    expect(removeCollinear(spike, 1e-9).length).toBe(5);
  });

  it('returns loops of three or fewer points unchanged (as copies)', () => {
    const tri: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    const out = removeCollinear(tri, 1);
    expect(out).toEqual(tri);
    expect(out[0]).not.toBe(tri[0]);
    expect(removeCollinear([], 1)).toEqual([]);
  });
});

// ---- Cavalieri -------------------------------------------------------------

describe('Cavalieri (§11): the integral of slice area over the offset is the 3-volume', () => {
  it('cube along e_z: ∫₋₁¹ A dc = 8 to round-off (A ≡ 4 on the interior, no sampled plane hits a face)', () => {
    // Midpoints of 100 steps on [−1, 1] never hit ±1, each slice is the exact
    // square of area 4, so the sum is 100·4·0.02 = 8 up to ~1e-14 of rounding.
    expectNear(cavalieri(cube(), E_Z, 100, [-1, 1]), 8, 1e-12, '∫ A');
    // The same for the cylinder: 48-gon area × 2.
    expectNear(cavalieri(cylinder(1, 2, 48), E_Z, 100, [-1, 1]), 2 * 24 * Math.sin(Math.PI / 24), 1e-12, 'cylinder ∫ A');
    expectNear(mesh3Volume(cylinder(1, 2, 48)), 2 * 24 * Math.sin(Math.PI / 24), 1e-12, 'cylinder volume');
  });

  it('tetrahedron and octahedron along e_z: ∫ 2(1 − c²) = 8/3 and ∫ 2(1 − |c|)² = 4/3 with the midpoint rule’s exact h²/3 error', () => {
    // On a quadratic the midpoint rule errs by (b − a)h²A''/24 per the Euler–
    // Maclaurin formula: with A'' = ∓4 on [−1, 1] and h = 0.01 that is h²/3 =
    // 3.3e-5 (the octahedron's kink at 0 sits on a cell boundary for an even
    // step count, so each half is a pure quadratic). Tolerance 5e-5.
    expectNear(cavalieri(tetrahedron(), E_Z, 200, [-1, 1]), 8 / 3, 5e-5, 'tetrahedron');
    expectNear(cavalieri(octahedron(), E_Z, 200, [-1, 1]), 4 / 3, 5e-5, 'octahedron');
  });

  it('cube, tetrahedron, octahedron, ball, torus and cylinder along random directions: 400 midpoint steps over [−R, R] agree with mesh3Volume to 1e-4 relative', () => {
    // For a generic direction A(c) is continuous and piecewise smooth (for a
    // polyhedron piecewise quadratic, with kinks at the vertex offsets; for the
    // torus and the icosphere likewise, with many small kinks). The midpoint
    // rule then errs by O(h²): (2R)·h²·max|A''|/24 on the smooth parts plus
    // ≤ h²|ΔA'|/8 per kink, with h = 2R/400 ≤ 0.01 — of order 1e-5 relative.
    // 1e-4 relative leaves a factor of several over that bound. The exact
    // volumes are 8, 8/3, 4/3 (polyhedra) and the generators' documented
    // closed forms for the ball, torus and cylinder are what mesh3Volume gives.
    const r = rng(14);
    const solids: [string, Mesh3][] = [
      ['cube', cube()],
      ['tetrahedron', tetrahedron()],
      ['octahedron', octahedron()],
      ['ball', icosphere(1, 3)],
      ['torus', torus(1, 0.4, 48, 24)],
      ['cylinder', cylinder(1, 2, 48)],
    ];
    const exact: Record<string, number> = { cube: 8, tetrahedron: 8 / 3, octahedron: 4 / 3 };
    for (const [name, mesh] of solids) {
      const vol = mesh3Volume(mesh);
      if (exact[name] !== undefined) expectNear(vol, exact[name], 1e-13, `${name} volume`);
      for (let k = 0; k < 3; k++) {
        const n = randomUnit3(r);
        expectNear(cavalieri(mesh, n, 400), vol, 1e-4 * vol, `${name} along ${n.map((x) => x.toFixed(3))}`);
      }
    }
  });

  it('ball and torus along e_z: the integral recovers the polyhedral volume (and the ball’s is within 1% of 4π/3)', () => {
    // The torus annulus width behaves like √(0.4² − c²) near |c| = 0.4, so the
    // midpoint rule's error is O(h^1.5) there: with 800 steps on [−1.4, 1.4],
    // h = 3.5e-3 and h^1.5 ≈ 2e-4 times a constant of order 1; tolerance 1e-3.
    // The icosphere's A(c) is Lipschitz; 400 steps and 1e-4 relative suffice.
    const ball = icosphere(1, 3);
    const vBall = mesh3Volume(ball);
    expectNear(cavalieri(ball, E_Z, 400, [-1, 1]), vBall, 1e-4 * vBall, 'ball ∫ A');
    expectNear(vBall, (4 * Math.PI) / 3, 0.01 * (4 * Math.PI) / 3, 'icosphere(1, 3) volume vs ball');
    const ring = torus(1, 0.4, 48, 24);
    const vRing = mesh3Volume(ring);
    expectNear(cavalieri(ring, E_Z, 800, [-0.4, 0.4]), vRing, 1e-3, 'torus ∫ A along e_z');
    // Exact generator volume per mesh3.ts: 2π²Rr² · (m/2π) sin(2π/m) · (n/2π) sin(2π/n).
    const m = 48;
    const nn = 24;
    expectNear(vRing, 2 * Math.PI ** 2 * 0.16 * ((m / (2 * Math.PI)) * Math.sin((2 * Math.PI) / m)) * ((nn / (2 * Math.PI)) * Math.sin((2 * Math.PI) / nn)), 1e-12, 'torus volume closed form');
  });
});

// ---- The catalogue --------------------------------------------------------

describe('FLAT_SHAPES catalogue (§11, §9 requirements on the meshes)', () => {
  it('every entry builds closed, consistently oriented, non-degenerate meshes with positive volume, fresh on each call', () => {
    for (const [id, entry] of Object.entries(FLAT_SHAPES)) {
      const meshes = entry.create();
      expect(meshes.length, `${id}: at least one part`).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const v = validateMesh3(mesh);
        expect(v.errors, `${id}: ${v.errors.join('; ')}`).toEqual([]);
        expect(v.ok && v.closed && v.consistent, `${id}: valid`).toBe(true);
        expect(mesh3Volume(mesh), `${id}: positive volume (outward orientation)`).toBeGreaterThan(0);
        // Closed orientable surfaces: sphere (χ = 2) or torus (χ = 0).
        expect([0, 2], `${id}: Euler characteristic ${v.euler}`).toContain(v.euler);
        expect(v.euler).toBe(id === 'torus' ? 0 : 2);
      }
      const again = entry.create();
      expect(again).not.toBe(meshes);
      expect(again[0]).not.toBe(meshes[0]);
      expect(again[0].positions).not.toBe(meshes[0].positions);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FLAT_SHAPES).sort()).toEqual(['ball', 'cube', 'cylinder', 'human', 'octahedron', 'tetrahedron', 'torus']);
  });

  it('the cube is [−1, 1]³ with the textbook eye distance d = 3; the ball has unit radius; the torus has R = 1, r = 0.4; the cylinder radius 1, height 2', () => {
    const [c] = FLAT_SHAPES.cube.create();
    expect(FLAT_SHAPES.cube.eyeDistance).toBe(3);
    expect(c.positions.length).toBe(8);
    for (const p of c.positions) for (const x of p) expect(Math.abs(x)).toBe(1);
    expectNear(mesh3Volume(c), 8, 1e-14, 'cube volume');
    const [b] = FLAT_SHAPES.ball.create();
    for (const p of b.positions) expectNear(length3(p), 1, 1e-14, 'ball vertex radius');
    const [t] = FLAT_SHAPES.torus.create();
    const bt = mesh3Bounds(t);
    expectVecNear(bt.max, [1.4, 1.4, 0.4], 1e-12, 'torus max');
    expectVecNear(bt.min, [-1.4, -1.4, -0.4], 1e-12, 'torus min');
    const [cy] = FLAT_SHAPES.cylinder.create();
    const bc = mesh3Bounds(cy);
    expectVecNear(bc.max, [1, 1, 1], 1e-12, 'cylinder max');
    expectVecNear(bc.min, [-1, -1, -1], 1e-12, 'cylinder min');
    const [tet] = FLAT_SHAPES.tetrahedron.create();
    expectNear(mesh3Volume(tet), 8 / 3, 1e-14, 'tetrahedron 8/3');
    // Regular: all six edges 2√2.
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expectNear(length3(sub3(tet.positions[i], tet.positions[j])), 2 * Math.SQRT2, 1e-14, `edge ${i}${j}`);
    const [oct] = FLAT_SHAPES.octahedron.create();
    expectNear(mesh3Volume(oct), 4 / 3, 1e-14, 'octahedron 4/3');
  });

  it('the human has 16 parts, each closed with positive volume, standing between y = −1 and y = +1 and centred in x', () => {
    const parts = FLAT_SHAPES.human.create();
    expect(parts.length).toBe(16);
    let ymin = Infinity;
    let ymax = -Infinity;
    let xmin = Infinity;
    let xmax = -Infinity;
    for (const part of parts) {
      const v = validateMesh3(part);
      expect(v.errors).toEqual([]);
      expect(v.euler).toBe(2);
      expect(mesh3Volume(part)).toBeGreaterThan(0);
      const b = mesh3Bounds(part);
      ymin = Math.min(ymin, b.min[1]);
      ymax = Math.max(ymax, b.max[1]);
      xmin = Math.min(xmin, b.min[0]);
      xmax = Math.max(xmax, b.max[0]);
    }
    expectNear(ymin, -1, 1e-12, 'soles');
    expectNear(ymax, 1, 1e-12, 'crown');
    expectNear(xmin + xmax, 0, 1e-12, 'left-right symmetric');
  });

  it('flatShapeBounds: cube radius √3 and z ∈ [−1, 1]; the union of the parts for the human; zeros when empty', () => {
    const cb = flatShapeBounds(FLAT_SHAPES.cube.create());
    expectNear(cb.radius, SQRT3, 1e-14, 'cube radius');
    expect(cb.zRange).toEqual([-1, 1]);
    const parts = FLAT_SHAPES.human.create();
    const hb = flatShapeBounds(parts);
    const bounds = parts.map(mesh3Bounds);
    expect(hb.radius).toBe(Math.max(...bounds.map((b) => b.radius)));
    expect(hb.zRange[0]).toBe(Math.min(...bounds.map((b) => b.min[2])));
    expect(hb.zRange[1]).toBe(Math.max(...bounds.map((b) => b.max[2])));
    expect(hb.zRange[0]).toBeLessThan(0);
    expect(hb.zRange[1]).toBeGreaterThan(0);
    expect(flatShapeBounds([])).toEqual({ radius: 0, zRange: [0, 0] });
    const tb = flatShapeBounds(FLAT_SHAPES.torus.create());
    expectVecNear(tb.zRange, [-0.4, 0.4], 1e-12, 'torus z range');
    expectNear(tb.radius, 1.4, 1e-12, 'torus radius');
  });
});
