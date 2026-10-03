import { describe, expect, it } from 'vitest';
import {
  apply3, chart2, compositeRotation3, identity3, mul3, planeChart, planeFromRotation, project2, rotation3,
  sliceScale2, transpose3, unchart2, zeroFlatAngles,
  type FlatPlane, type Mat3,
} from '../../src/flat/math';
import { projectPerspective } from '../../src/math/projection';
import { cross3, det3, dot3, length3, sub3 } from '../../src/math/vec';
import type { Vec3 } from '../../src/math/types';

/*
 * Tolerances. All quantities here are products and sums of a handful of
 * float64 numbers of order 1 (matrix entries cos θ, sin θ; unit vectors), so
 * each result carries a few ulps, ≲ 10 · 2.2e-16. A tolerance of 1e-14 is
 * ~50 ulps: generous, yet 10 orders of magnitude below any real error (a
 * wrong sign or order changes entries by O(1)).
 */
const TOL = 1e-14;

const PLANES: FlatPlane[] = ['XY', 'XZ', 'YZ'];
const ANGLES = [0, 0.3, -1.1, Math.PI / 2, 2.5, -Math.PI];
const E_X: Vec3 = [1, 0, 0];
const E_Y: Vec3 = [0, 1, 0];
const E_Z: Vec3 = [0, 0, 1];

const expectVec = (a: readonly number[], b: readonly number[], tol = TOL): void => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThanOrEqual(tol));
};
const det3m = (m: Mat3): number => det3([m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]);

describe('rotation3 (MATH.md §11, §2.1 restricted to R^3)', () => {
  it('is orthogonal with determinant +1 for every plane and angle', () => {
    for (const plane of PLANES) {
      for (const theta of ANGLES) {
        const r = rotation3(plane, theta);
        // R^T R = I
        const rtr = mul3(transpose3(r), r);
        expectVec(rtr, identity3());
        expect(Math.abs(det3m(r) - 1)).toBeLessThanOrEqual(TOL);
      }
    }
  });

  it('is the identity at θ = 0 and keeps the complementary axis fixed', () => {
    // Entry-wise exact (−sin 0 is −0, which equals 0 numerically but not under Object.is).
    for (const plane of PLANES) expectVec(rotation3(plane, 0), identity3(), 0);
    // XY fixes e_z, XZ fixes e_y, YZ fixes e_x (the axis not in the plane), exactly.
    expect(apply3(rotation3('XY', 1.234), E_Z)).toEqual(E_Z);
    expect(apply3(rotation3('XZ', 1.234), E_Y)).toEqual(E_Y);
    expect(apply3(rotation3('YZ', 1.234), E_X)).toEqual(E_X);
  });

  it('turns e_i toward e_j: XZ(π/2) e_x = e_z, XY(π/2) e_x = e_y, YZ(π/2) e_y = e_z', () => {
    // R_ij(θ) e_i = cos θ e_i + sin θ e_j; at θ = π/2 the cosine is 6.1e-17, hence the tolerance.
    expectVec(apply3(rotation3('XZ', Math.PI / 2), E_X), E_Z);
    expectVec(apply3(rotation3('XY', Math.PI / 2), E_X), E_Y);
    expectVec(apply3(rotation3('YZ', Math.PI / 2), E_Y), E_Z);
    // and the other column: R_ij(θ) e_j = −sin θ e_i + cos θ e_j.
    expectVec(apply3(rotation3('XZ', Math.PI / 2), E_Z), [-1, 0, 0]);
    // General angle, XZ: e_x ↦ (cos θ, 0, sin θ).
    expectVec(apply3(rotation3('XZ', 0.7), E_X), [Math.cos(0.7), 0, Math.sin(0.7)]);
  });

  it('XZ is the right-handed rotation about −y (§2.1): R_XZ(θ) = R_y(−θ), R_y(φ) e_x = cos φ e_x − sin φ e_z', () => {
    const phi = -0.9;
    expectVec(apply3(rotation3('XZ', 0.9), E_X), [Math.cos(phi), 0, -Math.sin(phi)]);
  });

  it('satisfies the addition law R(a) R(b) = R(a + b) and R(θ)^{-1} = R(−θ)', () => {
    for (const plane of PLANES) {
      expectVec(mul3(rotation3(plane, 0.4), rotation3(plane, -1.3)), rotation3(plane, 0.4 - 1.3));
      expectVec(mul3(rotation3(plane, 0.8), rotation3(plane, -0.8)), identity3());
      expectVec(transpose3(rotation3(plane, 0.8)), rotation3(plane, -0.8));
    }
  });
});

describe('compositeRotation3: XY first, then XZ, then YZ (§2.2)', () => {
  it('is the identity for zero angles and a single rotation for a single angle', () => {
    expect(compositeRotation3(zeroFlatAngles())).toEqual(identity3());
    for (const plane of PLANES) {
      const angles = zeroFlatAngles();
      angles[plane] = 0.77;
      expectVec(compositeRotation3(angles), rotation3(plane, 0.77));
    }
  });

  it('equals R_YZ · R_XZ · R_XY and differs from the reverse order', () => {
    const angles = { XY: 0.3, XZ: 0.5, YZ: 0.7 };
    const expected = mul3(rotation3('YZ', 0.7), mul3(rotation3('XZ', 0.5), rotation3('XY', 0.3)));
    expectVec(compositeRotation3(angles), expected);
    const reversed = mul3(rotation3('XY', 0.3), mul3(rotation3('XZ', 0.5), rotation3('YZ', 0.7)));
    const gap = Math.max(...expected.map((x, i) => Math.abs(x - reversed[i])));
    // The planes share axes, so the order matters: the matrices differ by O(0.1) at these angles.
    expect(gap).toBeGreaterThan(0.05);
  });

  it('applies XY first: e_y under (π/2, π/2, π/2) goes e_y → −e_x → −e_z → +e_y', () => {
    // XY(π/2) e_y = −e_x; XZ(π/2)(−e_x) = −e_z; YZ(π/2)(−e_z) = −(−e_y) = e_y.
    // The reverse order gives e_y → e_z → −e_x → −e_y, so this pins the order.
    const m = compositeRotation3({ XY: Math.PI / 2, XZ: Math.PI / 2, YZ: Math.PI / 2 });
    expectVec(apply3(m, E_Y), E_Y);
  });

  it('is orthogonal with determinant +1 for generic angles', () => {
    const m = compositeRotation3({ XY: 0.4, XZ: -1.2, YZ: 2.1 });
    expectVec(mul3(transpose3(m), m), identity3());
    expect(Math.abs(det3m(m) - 1)).toBeLessThanOrEqual(TOL);
  });
});

describe('project2 (§11, §3)', () => {
  const cubeCorners = (): Vec3[] => {
    const out: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
    return out;
  };

  it('perspective from d = 3: the cube is a square at scale 3/2 (z = +1) and one at scale 3/4 (z = −1)', () => {
    // (x, y) · d / (d − z): z = +1 gives 3/2, z = −1 gives 3/4 (exact in float64: 3/2 and 3/4 are dyadic).
    for (const p of cubeCorners()) {
      const scale = p[2] === 1 ? 3 / 2 : 3 / 4;
      expect(project2(p, { kind: 'perspective', distance: 3 })).toEqual([p[0] * scale, p[1] * scale]);
    }
  });

  it('orthographic drops z', () => {
    for (const p of cubeCorners()) expect(project2(p, { kind: 'orthographic' })).toEqual([p[0], p[1]]);
  });

  it('leaves the plane z = 0 fixed under perspective (d / (d − 0) = 1)', () => {
    expect(project2([0.3, -0.7, 0], { kind: 'perspective', distance: 5 })).toEqual([0.3, -0.7]);
  });

  it('applies the same denominator clamp as projectPerspective (src/math/projection.ts)', () => {
    // (x, y, z) in Flatland corresponds to the 4D point (x, y, 0, z) of §3.2.
    for (const z of [-2, 0, 1.5, 2.999, 3, 3.5, 10]) {
      const flat = project2([1, 2, z], { kind: 'perspective', distance: 3 });
      const four = projectPerspective([1, 2, 0, z], 3);
      expect(flat).toEqual([four[0], four[1]]);
    }
    // At or beyond the eye the point is sent far away, not inverted: d/1e-3 = 3000.
    expect(project2([1, 1, 3], { kind: 'perspective', distance: 3 })).toEqual([3000, 3000]);
    expect(project2([1, 1, 4], { kind: 'perspective', distance: 3 })).toEqual([3000, 3000]);
  });

  it('rejects a non-positive eye distance', () => {
    expect(() => project2([0, 0, 0], { kind: 'perspective', distance: 0 })).toThrow();
    expect(() => project2([0, 0, 0], { kind: 'perspective', distance: -1 })).toThrow();
  });

  it('sliceScale2 is d/(d − c) under perspective and 1 under orthographic', () => {
    expect(sliceScale2({ kind: 'perspective', distance: 3 }, 1)).toBe(3 / 2);
    expect(sliceScale2({ kind: 'perspective', distance: 3 }, -1)).toBe(3 / 4);
    expect(sliceScale2({ kind: 'orthographic' }, 1)).toBe(1);
    // Consistent with project2: a point of the plane z = c lands at sliceScale2 · (x, y).
    const c = 0.6;
    const q = project2([0.4, -0.9, c], { kind: 'perspective', distance: 3 });
    const s = sliceScale2({ kind: 'perspective', distance: 3 }, c);
    expectVec(q, [0.4 * s, -0.9 * s]);
  });
});

describe('planeChart (§11, §4 one dimension down)', () => {
  const normals: Vec3[] = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
    [1, 1, 1], [1, -2, 3], [-0.3, 0.2, 0.9], [1e-3, 0, 1], [0.7, 0.7, 0.01],
  ];

  it('is exactly (e_x, e_y) for the normal e_z, whatever the offset', () => {
    const plane = planeChart([0, 0, 1], 0.25);
    expect(plane.basis[0]).toEqual([1, 0, 0]);
    expect(plane.basis[1]).toEqual([0, 1, 0]);
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.offset).toBe(0.25);
  });

  it('is an orthonormal basis of normal^⊥ with det(u1, u2, m) = +1 and u1 × u2 = m', () => {
    for (const n of normals) {
      const { normal: m, basis: [u1, u2] } = planeChart(n, 0.5);
      expect(Math.abs(length3(m) - 1)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(length3(u1) - 1)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(length3(u2) - 1)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(dot3(u1, u2))).toBeLessThanOrEqual(TOL);
      expect(Math.abs(dot3(u1, m))).toBeLessThanOrEqual(TOL);
      expect(Math.abs(dot3(u2, m))).toBeLessThanOrEqual(TOL);
      expect(Math.abs(det3(u1, u2, m) - 1)).toBeLessThanOrEqual(TOL);
      expectVec(cross3(u1, u2), m);
    }
  });

  it('normalises a non-unit normal and rescales the offset with it', () => {
    // 2z = 4 is the plane z = 2.
    const plane = planeChart([0, 0, 2], 4);
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.offset).toBe(2);
    expect(() => planeChart([0, 0, 0], 1)).toThrow();
  });

  it('depends continuously on the normal near e_z', () => {
    // |u(m_ε) − u(e_z)| ≤ the Lipschitz constant (here ≤ 2) times |m_ε − e_z| ≈ ε.
    for (const eps of [1e-3, 1e-6]) {
      for (const dir of [[1, 0], [0, 1], [0.6, -0.8]]) {
        const p = planeChart([eps * dir[0], eps * dir[1], 1], 0);
        expect(length3(sub3(p.basis[0], E_X))).toBeLessThanOrEqual(2 * eps);
        expect(length3(sub3(p.basis[1], E_Y))).toBeLessThanOrEqual(2 * eps);
      }
    }
  });

  it('chart2 / unchart2 are inverse isometries between the plane and R^2', () => {
    const plane = planeChart([1, -2, 3], 0.8);
    for (const q of [[0, 0], [1, 0], [0.3, -0.8], [-2, 5]] as const) {
      const p = unchart2(plane, [q[0], q[1]]);
      // p lies on the plane: m · p = offset.
      expect(Math.abs(dot3(plane.normal, p) - plane.offset)).toBeLessThanOrEqual(1e-13);
      expectVec(chart2(plane, p), q, 1e-13);
    }
    // Isometry: distances in the chart equal distances in the plane.
    const a = unchart2(plane, [0.1, 0.2]);
    const b = unchart2(plane, [-0.4, 0.9]);
    expect(Math.abs(length3(sub3(a, b)) - Math.hypot(0.5, 0.7))).toBeLessThanOrEqual(1e-13);
    // unchart2 ∘ chart2 is the orthogonal projection onto the plane.
    const p: Vec3 = [0.9, -0.4, 1.7];
    const back = unchart2(plane, chart2(plane, p));
    const dist = dot3(plane.normal, p) - plane.offset;
    expectVec(back, [p[0] - dist * plane.normal[0], p[1] - dist * plane.normal[1], p[2] - dist * plane.normal[2]], 1e-13);
  });
});

describe('planeFromRotation (§4 one dimension down)', () => {
  const m = compositeRotation3({ XY: 0.4, XZ: -1.2, YZ: 2.1 });

  it('takes the normal as the third row and the basis as the first two rows of M', () => {
    const plane = planeFromRotation(m, 0.3);
    expect(plane.normal).toEqual([m[6], m[7], m[8]]);
    expect(plane.basis[0]).toEqual([m[0], m[1], m[2]]);
    expect(plane.basis[1]).toEqual([m[3], m[4], m[5]]);
    expect(plane.offset).toBe(0.3);
    expect(Math.abs(det3(plane.basis[0], plane.basis[1], plane.normal) - 1)).toBeLessThanOrEqual(TOL);
  });

  it('is the identity chart (e_x, e_y, e_z) for M = I', () => {
    const plane = planeFromRotation(identity3(), 0.1);
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.basis).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it('slices the unrotated object as z = c slices the rotated one: M · unchart2(q) = (q_0, q_1, c)', () => {
    const c = -0.35;
    const plane = planeFromRotation(m, c);
    for (const q of [[0, 0], [0.3, -0.8], [1.5, 2]] as const) {
      expectVec(apply3(m, unchart2(plane, [q[0], q[1]])), [q[0], q[1], c], 1e-13);
    }
    // And chart2 reads off the rotated x, y of any point: chart2(p) = ((M p)_x, (M p)_y).
    const p: Vec3 = [0.2, 0.9, -0.6];
    const rotated = apply3(m, p);
    expectVec(chart2(plane, p), [rotated[0], rotated[1]], 1e-13);
  });
});
