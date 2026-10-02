import type { Vec3, Vec4 } from './types';

export type Projection =
  | { readonly kind: 'orthographic' }
  | { readonly kind: 'perspective'; readonly distance: number }
  | { readonly kind: 'stereographic' };

/** Drop w. MATH.md §3.1 */
export const projectOrthographic = (p: Vec4): Vec3 => [p[0], p[1], p[2]];

/**
 * Perspective from an eye at (0,0,0,d) onto w = 0: (x,y,z)·d/(d−w). Valid for
 * w < d; the denominator is clamped below at minDenom so points at or beyond
 * the eye are pushed far away rather than inverted. MATH.md §3.2
 */
export function projectPerspective(p: Vec4, d: number, minDenom = 1e-3): Vec3 {
  if (!(d > 0)) throw new Error('projectPerspective: distance must be positive');
  const denom = Math.max(d - p[3], minDenom);
  const s = d / denom;
  return [p[0] * s, p[1] * s, p[2] * s];
}

/**
 * Stereographic projection of S^3 from the pole (0,0,0,1) onto w = 0:
 * (x,y,z)/(1−w). The input is normalised to the unit sphere first. The pole
 * itself has no image (it is the point at infinity), so the polar cap
 * 1 − w < minDenom is clamped to the latitude w_c = 1 − minDenom: a point in
 * the cap is sent along its own xyz direction (e_z for the exact pole, whose
 * xyz part is zero) to the radius √((1+w_c)/(1−w_c)) = √((2−minDenom)/minDenom)
 * that a sphere point at that latitude maps to. The image is therefore
 * continuous at the cap boundary and never nearer the origin than that radius
 * inside it; in particular the exact pole, a vertex of the 16-cell and the
 * 600-cell, is drawn ≈1.4·10³ units away rather than at the centre.
 * MATH.md §3.3
 */
export function projectStereographic(p: Vec4, minDenom = 1e-6): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2], p[3]);
  if (l === 0) throw new Error('projectStereographic: zero vector');
  const w = p[3] / l;
  const denom = 1 - w;
  if (denom < minDenom) {
    const r = Math.sqrt((2 - minDenom) / minDenom);
    const lxyz = Math.hypot(p[0], p[1], p[2]);
    if (lxyz === 0) return [0, 0, r];
    return [(p[0] / lxyz) * r, (p[1] / lxyz) * r, (p[2] / lxyz) * r];
  }
  return [p[0] / l / denom, p[1] / l / denom, p[2] / l / denom];
}

export function project(p: Vec4, proj: Projection): Vec3 {
  switch (proj.kind) {
    case 'orthographic': return projectOrthographic(p);
    case 'perspective': return projectPerspective(p, proj.distance);
    case 'stereographic': return projectStereographic(p);
  }
}
