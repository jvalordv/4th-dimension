/**
 * Flatland mathematics (MATH.md §11): everything of §2–§4 one dimension
 * down. A 3D solid is the higher-dimensional object, Flatland is the plane
 * z = 0, and the three rotation planes are XY (the only turn a Flatlander
 * has) and XZ, YZ (the two that turn the object partly out of the plane,
 * the analogues of XW, YW, ZW).
 *
 * Matrices are row-major `Mat3`, m[r*3 + c], acting on column vectors as in
 * §1. Vector arithmetic comes from src/math/vec.
 */
import type { Vec3 } from '../math/types';
import { add3, cross3, dot3, length3, scale3, sub3 } from '../math/vec';
import type { Vec2 } from '../geometry/section';

export type { Vec2 };

/** Real 3×3 matrix, row-major, m[r*3 + c], acting linearly on Vec3. §11 */
export type Mat3 = number[];

/** The three coordinate planes of R^3, in the composition order of §2.2. */
export type FlatPlane = 'XY' | 'XZ' | 'YZ';

/** One angle per rotation plane. */
export type FlatAngles = Record<FlatPlane, number>;

export const FLAT_PLANES: readonly FlatPlane[] = ['XY', 'XZ', 'YZ'];

/** Planes that turn the object partly out of Flatland (the analogue of `isHyperPlane`). */
export const isOutOfPlane = (p: FlatPlane): boolean => p !== 'XY';

const PLANE_AXES: Readonly<Record<FlatPlane, readonly [number, number]>> = {
  XY: [0, 1],
  XZ: [0, 2],
  YZ: [1, 2],
};

export const zeroFlatAngles = (): FlatAngles => ({ XY: 0, XZ: 0, YZ: 0 });

export const identity3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Matrix product A B (apply B first). */
export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/**
 * Rotation by θ in a coordinate plane: the identity except, for the axis pair
 * (i, j), i < j, R[i][i] = R[j][j] = cos θ, R[i][j] = −sin θ, R[j][i] = sin θ.
 * Positive θ turns e_i toward e_j, so XZ(θ) e_x = cos θ e_x + sin θ e_z
 * (the right-handed rotation about −y, §2.1). §11
 */
export function rotation3(plane: FlatPlane, theta: number): Mat3 {
  const [i, j] = PLANE_AXES[plane];
  const m = identity3();
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  m[i * 3 + i] = c;
  m[i * 3 + j] = -s;
  m[j * 3 + i] = s;
  m[j * 3 + j] = c;
  return m;
}

/**
 * M = R_YZ(θ_YZ) · R_XZ(θ_XZ) · R_XY(θ_XY): XY is applied first, then XZ,
 * then YZ, the §2.2 order restricted to the planes that exist in R^3. §11
 */
export function compositeRotation3(angles: FlatAngles): Mat3 {
  let m = identity3();
  for (const plane of FLAT_PLANES) {
    const theta = angles[plane];
    if (theta !== 0) m = mul3(rotation3(plane, theta), m);
  }
  return m;
}

/** (M p)_r = Σ_c m[r*3 + c] p_c. */
export const apply3 = (m: Mat3, p: Vec3): Vec3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

// ---- Projection to the plane ------------------------------------------------

/** R^3 → R^2 projection of Flatland. §11 */
export type Projection2 =
  | { readonly kind: 'orthographic' }
  | { readonly kind: 'perspective'; readonly distance: number };

/**
 * Smallest d − z used as a divisor. Same clamp as projectPerspective
 * (src/math/projection.ts, §3.2): a point at or beyond the eye is pushed far
 * away instead of inverted.
 */
export const MIN_DENOMINATOR = 1e-3;

/**
 * Orthographic (x, y, z) ↦ (x, y); perspective from an eye at (0, 0, d) onto
 * z = 0: (x, y) · d / (d − z), valid for z < d. The cube [−1, 1]^3 from d = 3
 * is the square-inside-a-square: scales 3/2 at z = +1 and 3/4 at z = −1. §11
 */
export function project2(p: Vec3, proj: Projection2, minDenom = MIN_DENOMINATOR): Vec2 {
  if (proj.kind === 'orthographic') return [p[0], p[1]];
  const d = proj.distance;
  if (!(d > 0)) throw new Error('project2: distance must be positive');
  const s = d / Math.max(d - p[2], minDenom);
  return [p[0] * s, p[1] * s];
}

/**
 * Uniform scale at which the plane z = c is drawn: d / (d − c) under
 * perspective (same clamp as project2), 1 under orthographic. The overlay
 * view scales the slice by this so that it sits inside the projected object
 * where it belongs. §11, §3.2
 */
export function sliceScale2(proj: Projection2, c: number, minDenom = MIN_DENOMINATOR): number {
  if (proj.kind === 'orthographic') return 1;
  return proj.distance / Math.max(proj.distance - c, minDenom);
}

// ---- Planes and their charts ------------------------------------------------

/**
 * The plane { q : normal · q = offset } with an orthonormal chart basis
 * (u_1, u_2) of normal^⊥ such that det(u_1, u_2, normal) = +1, equivalently
 * u_1 × u_2 = normal, so counter-clockwise in the chart is counter-clockwise
 * about the normal. §11 (§4 one dimension down)
 */
export interface Plane {
  readonly normal: Vec3;
  readonly offset: number;
  basis: [Vec3, Vec3];
}

const E_X: Vec3 = [1, 0, 0];
const E_Y: Vec3 = [0, 1, 0];

/** Reject the component of a along the unit vector n. */
const rejectFromUnit3 = (a: Vec3, n: Vec3): Vec3 => sub3(a, scale3(n, dot3(a, n)));

/**
 * Chart of the plane { m · q = k } for |m| = 1 after normalising `normal`:
 * u_1 is e_x with its component along m removed (e_y when m is within 1e-6 of
 * ±e_x, where that vanishes), normalised, and u_2 = m × u_1. Then
 * u_1 × u_2 = u_1 × (m × u_1) = m (u_1 · u_1) − u_1 (u_1 · m) = m, which is
 * det(u_1, u_2, m) = +1. For m = e_z this is exactly (e_x, e_y), and u_1
 * depends continuously on m near e_z (it is only discontinuous at ±e_x, as
 * any chart of a sphere's tangent planes must be somewhere). §11
 */
export function planeChart(normal: Vec3, offset: number): Plane {
  const len = length3(normal);
  if (len === 0) throw new Error('planeChart: zero normal');
  const n = scale3(normal, 1 / len);
  let seed = E_X;
  let v = rejectFromUnit3(seed, n);
  if (length3(v) < 1e-6) {
    seed = E_Y;
    v = rejectFromUnit3(seed, n);
  }
  // Second pass ("twice is enough", as in chartBasis): removes the ~1e-16
  // residue along n that normalising a short vector would amplify.
  v = rejectFromUnit3(v, n);
  const u1 = scale3(v, 1 / length3(v));
  const u2 = cross3(n, u1);
  return { normal: n, offset: offset / len, basis: [u1, u2] };
}

/**
 * The plane that, applied to an unrotated shape, yields exactly the slice of
 * the rotated shape (rotation M) by z = offset in its own screen x, y chart:
 * normal = Mᵀ e_z = the third row of M, basis = (Mᵀ e_x, Mᵀ e_y) = the first
 * two rows. M is orthogonal with det +1, so row_0 × row_1 = row_2 and the
 * chart has det +1. §4 one dimension down
 */
export function planeFromRotation(m: Mat3, offset: number): Plane {
  const row = (r: number): Vec3 => [m[r * 3], m[r * 3 + 1], m[r * 3 + 2]];
  return { normal: row(2), offset, basis: [row(0), row(1)] };
}

/** Chart coordinates (u_1 · p, u_2 · p) of a point (defined for any p, meant for p in the plane). */
export const chart2 = (plane: Plane, p: Vec3): Vec2 => [dot3(plane.basis[0], p), dot3(plane.basis[1], p)];

/** The point of the plane with the given chart coordinates: offset · normal + q_0 u_1 + q_1 u_2. */
export function unchart2(plane: Plane, q: Vec2): Vec3 {
  let p = scale3(plane.normal, plane.offset);
  p = add3(p, scale3(plane.basis[0], q[0]));
  p = add3(p, scale3(plane.basis[1], q[1]));
  return p;
}
