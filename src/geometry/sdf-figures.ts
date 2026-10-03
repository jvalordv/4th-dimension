/**
 * The smooth forms of the catalogue: the torus-like primitives of the
 * MATH.md §9.3 table and a blended creature, each as an SdfShape. Every
 * factory builds a fresh shape; the viewer caches them.
 *
 * The bounds of each scene are the exact extents of the solid, derived from
 * the field (a point of the solid satisfies the inequality that defines it):
 *
 *  - spheritorus / torisphere (R, r): |p| ≤ R + r (maximise s² + w² over the
 *    disc (s − R)² + w² ≤ r²), |w| ≤ r;
 *  - tiger (R1, R2, r): |p| ≤ √(R1² + R2²) + r (the farthest point of the
 *    disc of radius r about (R1, R2) in the (ρ1, ρ2) quarter-plane),
 *    |w| ≤ |(z, w)| ≤ R2 + r;
 *  - ditorus (R1, R2, r): |p| ≤ R1 + R2 + r, |w| ≤ r.
 */
import type { Shape4, Vec4 } from '../math/types';
import type { ShapeGroup } from '../app/registry';
import { SHAPE_IDS } from '../app/registry';
import {
  capsule, ditorus, sdfScene, smoothUnion, smoothUnionMargin, spheritorus, tiger, torisphere,
} from './sdf';
import type { Sdf4, SdfScene } from './sdf';
import { SdfShape } from './sdf-shape';
import type { SdfShapeOptions } from './sdf-shape';

function assertFigure(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(message);
}

// ---- Torus-like primitives ---------------------------------------------------

/**
 * Spheritorus (R, r) = (0.7, 0.3) by default: the set within r of the
 * 2-sphere of radius R. Its slice at w = 0 is the thick spherical shell
 * R − r ≤ |q| ≤ R + r, which thins to the sphere of radius R as |w| → r.
 */
export function spheritorusShape(R = 0.7, r = 0.3, opts: SdfShapeOptions = {}): SdfShape {
  assertFigure(R > 0 && r > 0 && r < R, `spheritorus needs 0 < r < R, got R = ${R}, r = ${r}`);
  return new SdfShape('Spheritorus', sdfScene(spheritorus(R, r), R + r, [-r, r]), { sliceResolution: 40, wireResolution: 10, ...opts });
}

/**
 * Torisphere (R, r) = (0.7, 0.3) by default: the set within r of a circle of
 * radius R, a 3-ball swept around a circle. Its slice at w = c is a solid
 * torus of major radius R and minor radius √(r² − c²).
 */
export function torisphereShape(R = 0.7, r = 0.3, opts: SdfShapeOptions = {}): SdfShape {
  assertFigure(R > 0 && r > 0 && r < R, `torisphere needs 0 < r < R, got R = ${R}, r = ${r}`);
  return new SdfShape('Torisphere', sdfScene(torisphere(R, r), R + r, [-r, r]), { sliceResolution: 40, wireResolution: 12, ...opts });
}

/**
 * Tiger (R1, R2, r) = (0.6, 0.6, 0.25) by default: the set within r of the
 * flat Clifford-type torus (ρ1, ρ2) = (R1, R2). Its slice at w = 0 is two
 * solid tori (one at z = +R2, one at z = −R2) that merge as |w| grows.
 */
export function tigerShape(R1 = 0.6, R2 = 0.6, r = 0.25, opts: SdfShapeOptions = {}): SdfShape {
  assertFigure(R1 > 0 && R2 > 0 && r > 0 && r < Math.min(R1, R2), `tiger needs 0 < r < min(R1, R2), got R1 = ${R1}, R2 = ${R2}, r = ${r}`);
  return new SdfShape(
    'Tiger',
    sdfScene(tiger(R1, R2, r), Math.hypot(R1, R2) + r, [-(R2 + r), R2 + r]),
    { sliceResolution: 48, wireResolution: 10, ...opts },
  );
}

/**
 * Ditorus (R1, R2, r) = (0.6, 0.25, 0.1) by default: the set within r of a
 * torus (major R1, minor R2) lying in w = 0, a circle swept twice. Needs
 * r < R2 (the normal discs of the torus do not overlap) and R2 + r < R1 (the
 * torus does not reach the axis). Its slice at w = 0 is a thick-walled
 * hollow torus; the tube is thin, so it is sampled on a finer slice grid.
 */
export function ditorusShape(R1 = 0.6, R2 = 0.25, r = 0.1, opts: SdfShapeOptions = {}): SdfShape {
  assertFigure(r > 0 && r < R2 && R2 + r < R1, `ditorus needs 0 < r < R2 and R2 + r < R1, got R1 = ${R1}, R2 = ${R2}, r = ${r}`);
  return new SdfShape('Ditorus', sdfScene(ditorus(R1, R2, r), R1 + R2 + r, [-r, r]), { sliceResolution: 64, wireResolution: 16, ...opts });
}

// ---- The creature ------------------------------------------------------------

/** A capsule part of the creature (a ball is the degenerate capsule a = b). */
export interface CreaturePart {
  readonly label: string;
  readonly a: Vec4;
  readonly b: Vec4;
  readonly r: number;
}

/** Blend width of the smooth union of the creature's parts. */
export const CREATURE_BLEND = 0.15;

/**
 * The creature's parts, in the order they are blended (a left fold of
 * smooth minima, §9.3), as capsules (balls have a = b):
 *
 *  - body: a ball of radius 0.42 at the origin;
 *  - head: a ball of radius 0.27 at (0, 0.6, 0, 0), above the body in +y;
 *  - two arms of radius 0.12 lying in the w = 0 hyperplane, reaching out to
 *    ±x and slightly forward in z: every slice near w = 0 shows them as
 *    arms and they vanish once |w| passes their thickness;
 *  - two legs reaching into the fourth dimension, deliberately unequal so
 *    that the two sides of w = 0 differ: the +w leg (radius 0.12) runs from
 *    (0.12, −0.25, 0.08, 0.12) to (0.2, −0.66, 0.1, 0.62), forward in z; the
 *    −w leg (radius 0.13, shorter) from (−0.14, −0.25, −0.08, −0.12) to
 *    (−0.34, −0.58, −0.28, −0.5), backward in z and out toward −x. Near
 *    w = 0 only the roots of the legs touch the body; at w ≈ ±0.4 the body
 *    has shrunk to a small ball and a leg appears as an elongated blob below
 *    it (the +w leg's axis is only 0.76 along w, so its slice is stretched).
 *
 * So as the creature passes through our space the arms and head vanish, the
 * body shrinks, a leg appears, and from the other side of w = 0 a different
 * leg appears elsewhere: the slices at +w and −w are different shapes.
 */
export const CREATURE_PARTS: readonly CreaturePart[] = [
  { label: 'body', a: [0, 0, 0, 0], b: [0, 0, 0, 0], r: 0.42 },
  { label: 'head', a: [0, 0.6, 0, 0], b: [0, 0.6, 0, 0], r: 0.27 },
  { label: 'arm +x', a: [0.22, 0.1, 0, 0], b: [0.72, 0.28, 0.12, 0], r: 0.12 },
  { label: 'arm -x', a: [-0.22, 0.1, 0, 0], b: [-0.72, 0.28, 0.12, 0], r: 0.12 },
  { label: 'leg +w', a: [0.12, -0.25, 0.08, 0.12], b: [0.2, -0.66, 0.1, 0.62], r: 0.12 },
  { label: 'leg -w', a: [-0.14, -0.25, -0.08, -0.12], b: [-0.34, -0.58, -0.28, -0.5], r: 0.13 },
];

/**
 * The creature's scene: the smooth union of CREATURE_PARTS with blend width
 * CREATURE_BLEND, and bounds derived from the parts. Each part is an exact
 * signed distance, so the plain union lies inside the parts' own extents
 * (|c| + r for a ball, max endpoint norm + r for a capsule), and by
 * smoothUnionMargin the blended solid lies within D_n = 0.60 k of the plain
 * union (n = 6 parts); the radius and w range add that margin.
 */
export function creatureScene(parts: readonly CreaturePart[] = CREATURE_PARTS, k = CREATURE_BLEND): SdfScene {
  assertFigure(parts.length >= 2, 'creature needs at least two parts');
  const fields: Sdf4[] = parts.map((p) => capsule(p.a, p.b, p.r));
  const margin = smoothUnionMargin(k, parts.length);
  let radius = 0;
  let wMax = 0;
  for (const p of parts) {
    radius = Math.max(radius, Math.hypot(...p.a) + p.r, Math.hypot(...p.b) + p.r);
    wMax = Math.max(wMax, Math.abs(p.a[3]) + p.r, Math.abs(p.b[3]) + p.r);
  }
  const [first, second, ...rest] = fields;
  return sdfScene(smoothUnion(k, first, second, ...rest), radius + margin, [-(wMax + margin), wMax + margin]);
}

/**
 * The creature: a blended figure (smooth union of a body ball, a head ball,
 * two arms and two legs reaching into ±w; see CREATURE_PARTS). Slice
 * resolution 40 keeps a slice under 40 ms so the offset slider stays live.
 */
export function creatureShape(opts: SdfShapeOptions = {}): SdfShape {
  return new SdfShape('Creature', creatureScene(), { sliceResolution: 40, wireResolution: 16, ...opts });
}

// ---- Catalogue entries -----------------------------------------------------------

export interface SdfShapeEntry {
  id: string;
  label: string;
  group: Extract<ShapeGroup, 'Smooth forms (SDF)'>;
  /** One sentence shown under the picker. */
  description: string;
  create: () => Shape4;
}

/** The smooth forms, in display order, ready for registerShape. */
export const SDF_SHAPES: readonly SdfShapeEntry[] = [
  {
    id: SHAPE_IDS.sdfSpheritorus,
    label: 'Spheritorus',
    group: 'Smooth forms (SDF)',
    description: 'The set within 0.3 of a sphere of radius 0.7: its middle slice is a thick spherical shell that thins to a bare sphere and vanishes as the slice moves out in w.',
    create: () => spheritorusShape(),
  },
  {
    id: SHAPE_IDS.sdfTorisphere,
    label: 'Torisphere',
    group: 'Smooth forms (SDF)',
    description: 'A ball swept around a circle: every slice is a solid torus whose tube shrinks from radius 0.3 to nothing as the slice moves out in w.',
    create: () => torisphereShape(),
  },
  {
    id: SHAPE_IDS.sdfTiger,
    label: 'Tiger',
    group: 'Smooth forms (SDF)',
    description: 'A tube around the flat Clifford torus: the middle slice is two solid tori, which fuse into one as the slice moves out in w.',
    create: () => tigerShape(),
  },
  {
    id: SHAPE_IDS.sdfDitorus,
    label: 'Ditorus',
    group: 'Smooth forms (SDF)',
    description: 'A circle swept twice: the middle slice is a thin-walled hollow torus, and moving out in w the wall thins until the slice vanishes.',
    create: () => ditorusShape(),
  },
  {
    id: SHAPE_IDS.sdfCreature,
    label: 'Creature',
    group: 'Smooth forms (SDF)',
    description: 'A blended figure with a body, head and four limbs, two of which reach into the fourth dimension: its slices change shape as it passes through.',
    create: () => creatureShape(),
  },
];
