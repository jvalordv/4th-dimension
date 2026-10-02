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
 * (x,y,z)/(1−w). The input is normalised to the unit sphere first; points at
 * the pole are clamped. MATH.md §3.3
 */
export function projectStereographic(p: Vec4, minDenom = 1e-6): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2], p[3]);
  if (l === 0) throw new Error('projectStereographic: zero vector');
  const w = p[3] / l;
  const denom = Math.max(1 - w, minDenom);
  return [p[0] / l / denom, p[1] / l / denom, p[2] / l / denom];
}

export function project(p: Vec4, proj: Projection): Vec3 {
  switch (proj.kind) {
    case 'orthographic': return projectOrthographic(p);
    case 'perspective': return projectPerspective(p, proj.distance);
    case 'stereographic': return projectStereographic(p);
  }
}
