import type { Vec3, Vec4 } from './types';

// ---- R^3 ------------------------------------------------------------------

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize3(a: Vec3): Vec3 {
  const l = length3(a);
  if (l === 0) throw new Error('normalize3: zero vector');
  return scale3(a, 1 / l);
}
/** det of the 3×3 matrix with rows a, b, c. */
export const det3 = (a: Vec3, b: Vec3, c: Vec3): number => dot3(a, cross3(b, c));

// ---- R^4 ------------------------------------------------------------------

export const vec4 = (x: number, y: number, z: number, w: number): Vec4 => [x, y, z, w];
export const add4 = (a: Vec4, b: Vec4): Vec4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const sub4 = (a: Vec4, b: Vec4): Vec4 => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const scale4 = (a: Vec4, s: number): Vec4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
export const dot4 = (a: Vec4, b: Vec4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const length4 = (a: Vec4): number => Math.hypot(a[0], a[1], a[2], a[3]);
export const dist4 = (a: Vec4, b: Vec4): number => length4(sub4(a, b));
export const lerp4 = (a: Vec4, b: Vec4, t: number): Vec4 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];
export function normalize4(a: Vec4): Vec4 {
  const l = length4(a);
  if (l === 0) throw new Error('normalize4: zero vector');
  return scale4(a, 1 / l);
}
export const approxEqual4 = (a: Vec4, b: Vec4, tol = 1e-9): boolean =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol &&
  Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol;

/** Drop the component of a along unit vector n. */
export const rejectFromUnit4 = (a: Vec4, n: Vec4): Vec4 => sub4(a, scale4(n, dot4(a, n)));

/**
 * The 4D cross product (MATH.md §5.1): cross4(u, v, w)_i = det[e_i; u; v; w].
 * Orthogonal to u, v, w; (cross4, u, v, w) is positively oriented.
 */
export function cross4(u: Vec4, v: Vec4, w: Vec4): Vec4 {
  // Expand det[e_i; u; v; w] along the first row: (-1)^i times the 3×3 minor
  // of [u; v; w] with column i deleted.
  const m = (c0: number, c1: number, c2: number): number =>
    u[c0] * (v[c1] * w[c2] - v[c2] * w[c1]) -
    u[c1] * (v[c0] * w[c2] - v[c2] * w[c0]) +
    u[c2] * (v[c0] * w[c1] - v[c1] * w[c0]);
  return [m(1, 2, 3), -m(0, 2, 3), m(0, 1, 3), -m(0, 1, 2)];
}

/** det of the 4×4 matrix with rows a, b, c, d. Equals a · cross4(b, c, d). */
export const det4 = (a: Vec4, b: Vec4, c: Vec4, d: Vec4): number => dot4(a, cross4(b, c, d));

export const centroid4 = (pts: readonly Vec4[]): Vec4 => {
  const c: Vec4 = [0, 0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3] += p[3]; }
  return scale4(c, 1 / pts.length);
};
