import type { Hyperplane, Mat4, Vec3, Vec4 } from './types';
import { add4, det4, dot4, length4, normalize4, rejectFromUnit4, scale4, sub4 } from './vec';

const E: readonly Vec4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

/**
 * Orthonormal basis of normal^⊥ with det(columns u1,u2,u3,n) = +1, equal to
 * (e_x, e_y, e_z) when normal = e_w and continuous near it. MATH.md §4
 */
export function chartBasis(normal: Vec4): [Vec4, Vec4, Vec4] {
  const n = normalize4(normal);
  // Seed order: x, y, z first (so the default hyperplane gets the identity
  // chart), then w as a fallback when one of them is nearly parallel to n.
  const seeds: Vec4[] = [E[0], E[1], E[2], E[3]];
  const basis: Vec4[] = [];
  for (const seed of seeds) {
    if (basis.length === 3) break;
    let v = rejectFromUnit4(seed, n);
    for (const u of basis) v = rejectFromUnit4(v, u);
    const l = length4(v);
    if (l < 1e-6) continue;
    // Second Gram-Schmidt pass ("twice is enough"): the first rejection leaves
    // an absolute residue ~1e-16 along n and the earlier u's, which normalising
    // by l would amplify to ~1e-16/l (up to 1e-10 for a seed nearly parallel
    // to n). Rejecting once more brings the residue back to ~1e-16.
    v = rejectFromUnit4(v, n);
    for (const u of basis) v = rejectFromUnit4(v, u);
    basis.push(scale4(v, 1 / length4(v)));
  }
  if (basis.length !== 3) throw new Error('chartBasis: failed to build basis');
  // det of the matrix with columns (u1, u2, u3, n) equals det with rows
  // (u1, u2, u3, n) (transpose), so det4 on rows is fine.
  if (det4(basis[0], basis[1], basis[2], n) < 0) basis[2] = scale4(basis[2], -1);
  return [basis[0], basis[1], basis[2]];
}

/** Hyperplane { p : n·p = offset } with the canonical chart basis. */
export function hyperplane(normal: Vec4, offset: number): Hyperplane {
  const n = normalize4(normal);
  return { normal: n, offset, basis: chartBasis(n) };
}

/**
 * The hyperplane that, applied to an unrotated shape, yields exactly the
 * slice of the rotated shape (rotation M) by w = offset in the shape's own
 * x, y, z chart: normal = Mᵀe_w, basis = (Mᵀe_x, Mᵀe_y, Mᵀe_z). Rows of M
 * are Mᵀ's columns, so these are M's rows. MATH.md §4
 */
export function hyperplaneFromRotation(m: Mat4, offset: number): Hyperplane {
  // (Mᵀ e_k) = k-th row of M = k-th column of Mᵀ.
  const rows: Vec4[] = [0, 1, 2, 3].map((k) => [m[k * 4], m[k * 4 + 1], m[k * 4 + 2], m[k * 4 + 3]]);
  return { normal: rows[3], offset, basis: [rows[0], rows[1], rows[2]] };
}

/** The default slicing hyperplane w = offset. */
export const hyperplaneW = (offset: number): Hyperplane => ({
  normal: E[3],
  offset,
  basis: [E[0], E[1], E[2]],
});

export const signedDistance = (h: Hyperplane, p: Vec4): number => dot4(h.normal, p) - h.offset;

/** Chart coordinates of a point (assumed to lie in h, but defined for any p). */
export const chart = (h: Hyperplane, p: Vec4): Vec3 => [
  dot4(h.basis[0], p),
  dot4(h.basis[1], p),
  dot4(h.basis[2], p),
];

/** Inverse of chart: the point of h with the given chart coordinates. */
export function unchart(h: Hyperplane, q: Vec3): Vec4 {
  let p = scale4(h.normal, h.offset);
  p = add4(p, scale4(h.basis[0], q[0]));
  p = add4(p, scale4(h.basis[1], q[1]));
  p = add4(p, scale4(h.basis[2], q[2]));
  return p;
}

/** Point of h nearest to p. */
export const projectOntoHyperplane = (h: Hyperplane, p: Vec4): Vec4 =>
  sub4(p, scale4(h.normal, signedDistance(h, p)));

