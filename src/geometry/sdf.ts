/**
 * Signed distance fields on R^4 (MATH.md §9.3): a solid is given implicitly
 * by f : R^4 → R with f ≤ 0 inside, f > 0 outside, and f Lipschitz with
 * constant 1 (a true signed distance) or at least a bound on the distance to
 * the surface. This module holds the primitives of the §9.3 table, the
 * operations on fields, and the SdfScene that pairs a field with the bounds
 * the extractors need. The extractors themselves are in isosurface.ts.
 *
 * Every primitive is written with scalar arithmetic only (no intermediate
 * Vec4 allocations): a field is evaluated once per grid vertex, up to 10^5
 * times per slice, and this is the hot path of the SDF viewer.
 */
import type { Mat4, Vec4 } from '../math/types';
import { length4 } from '../math/vec';

/** A scalar field on R^4: f ≤ 0 inside the solid, f > 0 outside. §9.3 */
export type Sdf4 = (p: Vec4) => number;

/**
 * A field with the bounds needed to extract it: the solid lies inside the
 * origin-centred ball of radius `radius` (so inside [−radius, radius]^4, the
 * extraction grid of §9.3), and its w coordinate lies in `wRange` (the ends
 * of the slice-view colour gradient, §10). The bounds must be true bounds,
 * not estimates: a solid that reaches the grid boundary gives an open mesh.
 */
export interface SdfScene {
  f: Sdf4;
  radius: number;
  wRange: [number, number];
}

const assertPositive = (what: string, v: number): void => {
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`${what} must be a positive finite number, got ${v}`);
};

/**
 * Build a scene from a field and explicit bounds. `wRange` defaults to
 * [−radius, radius], which is always valid because |w| ≤ |p| ≤ radius.
 */
export function sdfScene(f: Sdf4, radius: number, wRange: [number, number] = [-radius, radius]): SdfScene {
  assertPositive('sdfScene radius', radius);
  if (!(wRange[0] <= wRange[1])) throw new RangeError(`sdfScene wRange must satisfy min ≤ max, got [${wRange[0]}, ${wRange[1]}]`);
  return { f, radius, wRange: [wRange[0], wRange[1]] };
}

// ---- Primitives (§9.3 table) ----------------------------------------------

/** 4-ball of radius r: |p| − r. 4-volume π² r⁴ / 2. */
export function ball(r: number): Sdf4 {
  assertPositive('ball radius', r);
  return (p) => Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + p[3] * p[3]) - r;
}

/**
 * 4-box with half-sizes h: q_i = |p_i| − h_i, f = |max(q, 0)| + min(max_i q_i, 0).
 * An exact signed distance. 4-volume 16 h_1 h_2 h_3 h_4.
 */
export function box(h: Vec4): Sdf4 {
  for (const hi of h) assertPositive('box half-size', hi);
  const [h0, h1, h2, h3] = h;
  return (p) => {
    const q0 = Math.abs(p[0]) - h0;
    const q1 = Math.abs(p[1]) - h1;
    const q2 = Math.abs(p[2]) - h2;
    const q3 = Math.abs(p[3]) - h3;
    const m0 = q0 > 0 ? q0 : 0;
    const m1 = q1 > 0 ? q1 : 0;
    const m2 = q2 > 0 ? q2 : 0;
    const m3 = q3 > 0 ? q3 : 0;
    const inside = Math.min(Math.max(q0, q1, q2, q3), 0);
    return Math.sqrt(m0 * m0 + m1 * m1 + m2 * m2 + m3 * m3) + inside;
  };
}

/**
 * Capsule: the set within r of the segment ab. f = |p − a − t(b − a)| − r,
 * t = clamp((p − a)·(b − a) / |b − a|², 0, 1). A degenerate segment (a = b)
 * is a ball. 4-volume: ball (π² r⁴ / 2) plus cylinder ((4/3)π r³ · |b − a|).
 */
export function capsule(a: Vec4, b: Vec4, r: number): Sdf4 {
  assertPositive('capsule radius', r);
  const [ax, ay, az, aw] = a;
  const bax = b[0] - ax;
  const bay = b[1] - ay;
  const baz = b[2] - az;
  const baw = b[3] - aw;
  const baba = bax * bax + bay * bay + baz * baz + baw * baw;
  const inv = baba > 0 ? 1 / baba : 0;
  return (p) => {
    const px = p[0] - ax;
    const py = p[1] - ay;
    const pz = p[2] - az;
    const pw = p[3] - aw;
    let t = (px * bax + py * bay + pz * baz + pw * baw) * inv;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - t * bax;
    const dy = py - t * bay;
    const dz = pz - t * baz;
    const dw = pw - t * baw;
    return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) - r;
  };
}

/**
 * Duocylinder: max(√(x²+y²) − r1, √(z²+w²) − r2). A bound (exact on the
 * two tori of its boundary), 1-Lipschitz as a max of 1-Lipschitz fields.
 * 4-volume π² r1² r2².
 */
export function duocylinder(r1: number, r2: number): Sdf4 {
  assertPositive('duocylinder r1', r1);
  assertPositive('duocylinder r2', r2);
  return (p) => Math.max(Math.sqrt(p[0] * p[0] + p[1] * p[1]) - r1, Math.sqrt(p[2] * p[2] + p[3] * p[3]) - r2);
}

/**
 * Spheritorus: √((√(x²+y²+z²) − R)² + w²) − r, the set within r of the
 * 2-sphere of radius R in the hyperplane w = 0 (S² × D², boundary S² × S¹).
 * Its w = 0 slice is the thick spherical shell R − r ≤ |q| ≤ R + r. Needs
 * r < R. 4-volume 4π² R² r² + π² r⁴ (derived in test/geometry/sdf.test.ts;
 * the table of MATH.md §9.3 prints the torisphere's value, 2πR·(4/3)π r³,
 * which belongs to the set within r of a *circle*, not of a sphere).
 */
export function spheritorus(R: number, r: number): Sdf4 {
  assertPositive('spheritorus R', R);
  assertPositive('spheritorus r', r);
  return (p) => {
    const a = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - R;
    return Math.sqrt(a * a + p[3] * p[3]) - r;
  };
}

/**
 * Torisphere: √((√(x²+y²) − R)² + z² + w²) − r, the set within r of the
 * circle of radius R in the xy-plane (a 3-ball swept around a circle,
 * S¹ × B³). Needs r < R. 4-volume 2πR · (4/3)π r³ (Pappus).
 */
export function torisphere(R: number, r: number): Sdf4 {
  assertPositive('torisphere R', R);
  assertPositive('torisphere r', r);
  return (p) => {
    const a = Math.sqrt(p[0] * p[0] + p[1] * p[1]) - R;
    return Math.sqrt(a * a + p[2] * p[2] + p[3] * p[3]) - r;
  };
}

/**
 * Tiger (the Clifford-torus tube):
 * √((√(x²+y²) − R1)² + (√(z²+w²) − R2)²) − r, the set within r of the flat
 * torus ρ1 = R1, ρ2 = R2. Needs r < min(R1, R2). 4-volume 4π³ R1 R2 r².
 */
export function tiger(R1: number, R2: number, r: number): Sdf4 {
  assertPositive('tiger R1', R1);
  assertPositive('tiger R2', R2);
  assertPositive('tiger r', r);
  return (p) => {
    const a = Math.sqrt(p[0] * p[0] + p[1] * p[1]) - R1;
    const b = Math.sqrt(p[2] * p[2] + p[3] * p[3]) - R2;
    return Math.sqrt(a * a + b * b) - r;
  };
}

/**
 * Ditorus (a circle swept twice):
 * √((√((√(x²+y²) − R1)² + z²) − R2)² + w²) − r, the set within r of the
 * torus of major radius R1 and minor radius R2 sitting in w = 0. Needs
 * r < R2 and R2 + r < R1. 4-volume 2πR1 · 2πR2 · π r² = 4π³ R1 R2 r².
 */
export function ditorus(R1: number, R2: number, r: number): Sdf4 {
  assertPositive('ditorus R1', R1);
  assertPositive('ditorus R2', R2);
  assertPositive('ditorus r', r);
  return (p) => {
    const a = Math.sqrt(p[0] * p[0] + p[1] * p[1]) - R1;
    const b = Math.sqrt(a * a + p[2] * p[2]) - R2;
    return Math.sqrt(b * b + p[3] * p[3]) - r;
  };
}

// ---- Operations (§9.3) ----------------------------------------------------

/** Union: min(f, g, ...). Exact outside only where the nearest surfaces are the parts' own. */
export function union(f: Sdf4, g: Sdf4, ...rest: Sdf4[]): Sdf4 {
  const fs = [f, g, ...rest];
  return (p) => {
    let v = fs[0](p);
    for (let i = 1; i < fs.length; i++) {
      const u = fs[i](p);
      if (u < v) v = u;
    }
    return v;
  };
}

/** Intersection: max(f, g, ...). */
export function intersection(f: Sdf4, g: Sdf4, ...rest: Sdf4[]): Sdf4 {
  const fs = [f, g, ...rest];
  return (p) => {
    let v = fs[0](p);
    for (let i = 1; i < fs.length; i++) {
      const u = fs[i](p);
      if (u > v) v = u;
    }
    return v;
  };
}

/** Difference f \ g: max(f, −g). */
export const difference = (f: Sdf4, g: Sdf4): Sdf4 => (p) => Math.max(f(p), -g(p));

/**
 * The polynomial smooth minimum of two values:
 * smin_k(a, b) = min(a, b) − h² / (4k), h = max(k − |a − b|, 0). It is
 * 1-Lipschitz (its partial derivatives in a and b are non-negative and sum
 * to 1) and lies below min(a, b) by at most k/4. §9.3
 */
export function smoothMin(a: number, b: number, k: number): number {
  const h = k - Math.abs(a - b);
  return h > 0 ? Math.min(a, b) - (h * h) / (4 * k) : Math.min(a, b);
}

/**
 * Smooth union smin_k(f, g, ...): the polynomial smooth minimum folded from
 * the left, ((f ⊕ g) ⊕ h) ⊕ ..., with blend width k > 0. A bound, not a
 * distance. The solid it bounds contains the plain union; by how much it can
 * overshoot is smoothUnionMargin(k, n).
 */
export function smoothUnion(k: number, f: Sdf4, g: Sdf4, ...rest: Sdf4[]): Sdf4 {
  assertPositive('smoothUnion k', k);
  const fs = [f, g, ...rest];
  return (p) => {
    let v = fs[0](p);
    for (let i = 1; i < fs.length; i++) v = smoothMin(v, fs[i](p), k);
    return v;
  };
}

/**
 * How far below min(f_1..f_n) the left-folded smooth union of n fields can
 * lie: D_n with D_1 = 0 and D_{j+1} = D_j + (k − D_j)² / (4k).
 *
 * Proof sketch. Let m_j = min_{i≤j} f_i, S_j the fold and D_j = m_j − S_j.
 * S_{j+1} = min(S_j, f_{j+1}) − (k − |S_j − f_{j+1}|)₊² / (4k). If f_{j+1} < S_j
 * the drop is at most k/4. Otherwise with x = f_{j+1} − S_j ≥ 0 the drop
 * relative to the running minimum is D_j + r(x) (x ≥ D_j) or x + r(x)
 * (x < D_j), r(x) = (k − x)₊² / (4k), and both are at most D_j + r(D_j)
 * because r decreases and x + r(x) increases. Hence D_{j+1} ≤ max(k/4,
 * D_j + r(D_j)) = D_j + r(D_j). So the smooth-union solid lies inside the
 * union of the parts dilated by D_n, which is how scene bounds are derived
 * for blended figures. D_2 = k/4, D_6 ≈ 0.60 k, and D_n < k for every n.
 */
export function smoothUnionMargin(k: number, n: number): number {
  assertPositive('smoothUnionMargin k', k);
  let d = 0;
  for (let j = 1; j < n; j++) d += ((k - d) * (k - d)) / (4 * k);
  return d;
}

/** Translation: f(p − t), the shape moved by t. */
export function translate(f: Sdf4, t: Vec4): Sdf4 {
  const [t0, t1, t2, t3] = t;
  return (p) => f([p[0] - t0, p[1] - t1, p[2] - t2, p[3] - t3]);
}

/**
 * Rotation: f(Mᵀp) for a rotation M, so the shape is turned by M (the point
 * M q is in the rotated solid iff q is in the original). (Mᵀp)_c = Σ_r M[r][c] p_r.
 */
export function rotate(f: Sdf4, m: Mat4): Sdf4 {
  if (m.length !== 16) throw new RangeError('rotate: matrix must have 16 entries');
  const [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33] = m;
  return (p) => {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    const w = p[3];
    return f([
      m00 * x + m10 * y + m20 * z + m30 * w,
      m01 * x + m11 * y + m21 * z + m31 * w,
      m02 * x + m12 * y + m22 * z + m32 * w,
      m03 * x + m13 * y + m23 * z + m33 * w,
    ]);
  };
}

/** Uniform scale by s > 0: s · f(p / s). The shape grows by s about the origin; distances scale by s. */
export function scale(f: Sdf4, s: number): Sdf4 {
  assertPositive('scale factor', s);
  const inv = 1 / s;
  return (p) => s * f([p[0] * inv, p[1] * inv, p[2] * inv, p[3] * inv]);
}

// ---- Scene helpers --------------------------------------------------------

/** The scene translated by t: radius grows by |t|, the w range shifts by t_w. */
export function translateScene(scene: SdfScene, t: Vec4): SdfScene {
  return {
    f: translate(scene.f, t),
    radius: scene.radius + length4(t),
    wRange: [scene.wRange[0] + t[3], scene.wRange[1] + t[3]],
  };
}

/**
 * The scene turned by the rotation M. The radius is unchanged (|Mp| = |p|);
 * the rotated w extent is only known to lie in [−radius, radius].
 */
export function rotateScene(scene: SdfScene, m: Mat4): SdfScene {
  return { f: rotate(scene.f, m), radius: scene.radius, wRange: [-scene.radius, scene.radius] };
}

/** The scene scaled uniformly by s > 0 about the origin. */
export function scaleScene(scene: SdfScene, s: number): SdfScene {
  return {
    f: scale(scene.f, s),
    radius: scene.radius * s,
    wRange: [scene.wRange[0] * s, scene.wRange[1] * s],
  };
}
