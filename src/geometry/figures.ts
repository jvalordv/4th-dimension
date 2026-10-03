/**
 * The lifted 3D objects and figures of the catalogue: extrusions
 * (MATH.md §9.1) of the mesh3 generators, singly or assembled into
 * compounds. Every factory builds a fresh shape; the viewer caches them.
 *
 * Orientation convention: the mesh3 generators have their symmetry axis
 * along z; figures that "stand" are rotated so that axis is +y (the
 * renderer's up direction) before extrusion along w.
 */
import type { Shape4, Vec3 } from '../math/types';
import type { ShapeGroup } from '../app/registry';
import { SHAPE_IDS } from '../app/registry';
import type { Mesh3 } from './mesh3';
import { box, capsule, cylinder, icosphere, scaleMesh3, torus, torusKnot, transformMesh3, translateMesh3, uvSphere } from './mesh3';
import { extrude } from './extrude';
import type { ExtrudedSolid } from './extrude';
import { compound } from './compound';
import type { CompoundShape } from './compound';
import { spin } from './spin';
import type { SpunSolid } from './spin';

// ---- Single extrusions -----------------------------------------------------

/** Ball × interval: icosphere(1, 3) (1280 triangles) extruded by h = 1. */
export const spherinder = (): ExtrudedSolid => extrude(icosphere(1, 3), 1, 'Spherinder');

/** Cylinder × interval: cylinder(1, 2, 48) extruded by h = 1 (a 48-gon prism × square). */
export const cubinder = (): ExtrudedSolid => extrude(cylinder(1, 2, 48), 1, 'Cubinder');

/** Solid torus × interval: torus(1, 0.4, 48, 24) extruded by h = 0.6. */
export const torusPrism = (): ExtrudedSolid => extrude(torus(1, 0.4, 48, 24), 0.6, 'Torus prism');

/**
 * Knotted solid torus × interval: the (2, 3) torus-knot tube of radius 0.25
 * about the knot on the carrier torus of major radius 0.8 (minor 0.4),
 * extruded by h = 0.5. The tube radius is below the knot's minimum radius of
 * curvature (≈ 0.57) and half its minimum strand separation (≈ 0.33), so the
 * tube does not self-intersect.
 */
export const knotPrism = (): ExtrudedSolid => extrude(torusKnot(0.8, 0.25, 2, 3, 128, 16), 0.5, 'Knot prism');

// ---- Helpers for assembled figures ----------------------------------------

/**
 * Rotate a mesh so its z axis becomes +y: (x, y, z) ↦ (x, z, −y), the
 * rotation about x by −90°. It has determinant +1, so the winding stays
 * outward and no flip is needed.
 */
const standAlongY = (mesh: Mesh3): Mesh3 => transformMesh3(mesh, (p) => [p[0], p[2], -p[1]]);

// ---- Mug ------------------------------------------------------------------

/**
 * A mug: a cylindrical body standing along +y (radius 0.5, height 1.2) and
 * a torus handle (major 0.32, minor 0.08) in the xy-plane at x = 0.78, so
 * the handle's inner rim (x = 0.38) sits inside the body wall (x = 0.5).
 * Both parts are extruded by h = 0.5 along w. The parts overlap and the
 * compound renders both surfaces where they do (no union is computed); the
 * body is solid, not hollowed.
 */
export function mug(h = 0.5): CompoundShape {
  const body = standAlongY(cylinder(0.5, 1.2, 48));
  const handle = translateMesh3(torus(0.32, 0.08, 32, 12), [0.78, 0, 0]);
  return compound('Mug', [
    extrude(body, h, 'Mug body'),
    extrude(handle, h, 'Mug handle'),
  ]);
}

// ---- Human figure ----------------------------------------------------------

/** Head height in world units: the figure is 7.5 heads = 2 units tall. */
const HEAD = 2 / 7.5;

/** World y of a height measured in heads above the ground, with the figure centred on the origin. */
const atHeads = (yHeads: number): number => (yHeads - 3.75) * HEAD;

/**
 * Scale a mesh built in head units to world units and move its centre to
 * (x, y, z) given in heads (y measured from the ground).
 */
const place = (mesh: Mesh3, x: number, yHeads: number, z: number): Mesh3 =>
  translateMesh3(scaleMesh3(mesh, HEAD), [x * HEAD, atHeads(yHeads), z * HEAD]);

/**
 * The 16 named parts of the humanoid as 3D meshes, in display order, each in
 * the figure's own frame (about 7.5 heads = 2 units tall between y = −1 and
 * y = +1, standing along +y, facing +z). Dimensions below are in heads; limbs
 * are capsules (axis rotated to y), the head and hands are uvSpheres (the
 * head's pole is its crown, so the height is exact), the pelvis and feet are
 * boxes. Parts overlap at the joints.
 */
function humanPartList(): Array<[string, Mesh3]> {
  const parts: Array<[string, Mesh3]> = [];
  const add = (name: string, mesh: Mesh3): void => { parts.push([name, mesh]); };
  const mirrored = (name: string, mesh: Mesh3, x: number, y: number, z: number): void => {
    add(`Left ${name}`, place(mesh, -x, y, z));
    add(`Right ${name}`, place(mesh, x, y, z));
  };

  // Head: sphere of radius 0.5 centred at 7.0, crown at 7.5.
  add('Head', place(standAlongY(uvSphere(0.5, 16, 8)), 0, 7.0, 0));
  // Neck: 6.1 .. 6.5.
  add('Neck', place(standAlongY(cylinder(0.17, 0.4, 12)), 0, 6.3, 0));
  // Torso: capsule of radius 0.5, straight part 1.4 (total 2.4), 4.0 .. 6.4,
  // widened to 1.25 across the shoulders and flattened to 0.7 front to back.
  add('Torso', place(scaleMesh3(standAlongY(capsule(0.5, 1.4, 16, 4)), [1.25, 1, 0.7]), 0, 5.2, 0));
  // Pelvis: 3.55 .. 4.25.
  add('Pelvis', place(box(1.2, 0.7, 0.7), 0, 3.9, 0));
  // Upper legs: radius 0.24, straight 1.3 (total 1.78), 2.06 .. 3.84.
  mirrored('upper leg', standAlongY(capsule(0.24, 1.3, 12, 3)), 0.32, 2.95, 0);
  // Lower legs: radius 0.19, straight 1.35 (total 1.73), 0.305 .. 2.035.
  mirrored('lower leg', standAlongY(capsule(0.19, 1.35, 12, 3)), 0.32, 1.17, 0);
  // Feet: boxes 0.4 wide, 0.3 high, 0.9 long, soles on the ground (0 .. 0.3), toes toward +z.
  mirrored('foot', box(0.4, 0.3, 0.9), 0.32, 0.15, 0.2);
  // Upper arms: radius 0.17, straight 1.1 (total 1.44), 4.83 .. 6.27.
  mirrored('upper arm', standAlongY(capsule(0.17, 1.1, 12, 3)), 0.85, 5.55, 0);
  // Lower arms: radius 0.15, straight 1.05 (total 1.35), 3.625 .. 4.975.
  mirrored('lower arm', standAlongY(capsule(0.15, 1.05, 12, 3)), 0.9, 4.3, 0);
  // Hands: spheres of radius 0.2 centred at 3.45.
  mirrored('hand', standAlongY(uvSphere(0.2, 12, 6)), 0.92, 3.45, 0);
  return parts;
}

/**
 * The 3D meshes of the humanoid's 16 parts (see humanPartList), the input of
 * both human() (extruded, MATH.md §9.1) and spunHuman() (spun, §9.2). Fresh
 * meshes on every call.
 */
export function humanParts(): Mesh3[] {
  return humanPartList().map(([, mesh]) => mesh);
}

/**
 * Human figure of about 7.5 heads, total height exactly 2 (crown at y = +1,
 * soles at y = −1), standing along +y and facing +z, assembled from 16
 * extruded primitives (humanParts), each extruded by the same half-height h
 * along w. Parts overlap at the joints and are rendered superimposed.
 */
export function human(h = 0.5): CompoundShape {
  return compound('Human', humanPartList().map(([name, mesh]) => extrude(mesh, h, name)));
}

// ---- Spun figures (MATH.md §9.2) -------------------------------------------

/** Ball of radius 0.4 centred at height 1.1: icosphere(0.4, 3) spun in 48 steps, a torisphere (S¹ × B³, boundary S² × S¹; MATH.md §9.3). */
export const spunBall = (): SpunSolid =>
  spin(translateMesh3(icosphere(0.4, 3), [0, 0, 1.1]), 48, 'Spun ball');

/**
 * Half-ball {|p| ≤ 1, z ≥ 0}: icosphere(1, 3) clipped to z ≥ 0 (§9.4) and spun
 * in 48 steps, the polyhedral 4-ball. Its slices at w = c are balls of radius
 * √(1 − c²) (§8.5, §9.2), the twins at c = 0 being the two halves of one ball.
 */
export const spunHalfBall = (): SpunSolid => spin(icosphere(1, 3), 48, 'Spun half-ball');

/** Cube of side 1 centred at height 1.2 (z ∈ [0.7, 1.7]) spun in 48 steps: a ring with square cross-section. */
export const spunCube = (): SpunSolid =>
  spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), 48, 'Spun cube');

/**
 * The humanoid of human() with every part spun instead of extruded: the
 * figure is translated along +z (its facing direction, the spin's radial
 * coordinate) until its lowest point is at z = 0.25, so that no part
 * touches or crosses z = 0, and each of its 16 parts is spun in 36 steps.
 * The parts overlap and are superimposed, as in human().
 */
export function spunHuman(): CompoundShape {
  const parts = humanPartList();
  let minZ = Infinity;
  for (const [, mesh] of parts) for (const p of mesh.positions) minZ = Math.min(minZ, p[2]);
  const lift = 0.25 - minZ;
  return compound('Spun human', parts.map(([name, mesh]) =>
    spin(translateMesh3(mesh, [0, 0, lift]), 36, `Spun ${name.toLowerCase()}`)));
}

// ---- Catalogue entries -----------------------------------------------------

export interface LiftedShapeEntry {
  /** Stable id, equal to the matching SHAPE_IDS value. */
  id: string;
  label: string;
  group: ShapeGroup;
  /** One sentence shown under the picker. */
  description: string;
  create: () => Shape4;
}

/** The lifted shapes and figures, in display order, ready for registerShape. */
export const LIFTED_SHAPES: readonly LiftedShapeEntry[] = [
  {
    id: SHAPE_IDS.spherinder,
    label: 'Spherinder',
    group: 'Lifted 3D objects',
    description: 'A ball extruded along w: every slice at fixed w is the same ball, and a tilted slice is a sheared ball clipped between two planes.',
    create: spherinder,
  },
  {
    id: SHAPE_IDS.cubinder,
    label: 'Cubinder',
    group: 'Lifted 3D objects',
    description: 'A cylinder extruded along w (disc × square): slices show the cylinder, or a sheared cylinder, or a rectangle × interval prism when the hyperplane contains the w axis.',
    create: cubinder,
  },
  {
    id: SHAPE_IDS.torusPrism,
    label: 'Torus prism',
    group: 'Lifted 3D objects',
    description: 'A solid torus extruded along w: its tilted slices are solid tori sliced by two parallel planes, and their cap sections are annuli with a hole.',
    create: torusPrism,
  },
  {
    id: SHAPE_IDS.knotPrism,
    label: 'Knot prism',
    group: 'Lifted 3D objects',
    description: 'A thickened trefoil (2,3) torus knot extruded along w: a knotted solid torus whose w-slices show the knot and whose tilted slices shear it.',
    create: knotPrism,
  },
  {
    id: SHAPE_IDS.mug,
    label: 'Mug',
    group: 'Figures',
    description: 'A cylinder body and a torus handle, each extruded along w, superimposed where they overlap: a 4D mug whose every w-slice is the familiar mug.',
    create: () => mug(),
  },
  {
    id: SHAPE_IDS.human,
    label: 'Human',
    group: 'Figures',
    description: 'A 7.5-heads figure assembled from 16 extruded primitives standing along y: slicing along a tilted hyperplane reveals a sheared slab of the body.',
    create: () => human(),
  },
];

/** A spun shape of the catalogue, ready for registerShape. */
export interface SpunShapeEntry {
  /** Stable id, equal to the matching SHAPE_IDS value. */
  id: string;
  label: string;
  group: 'Spun 3D objects';
  /** One sentence shown under the picker. */
  description: string;
  create: () => Shape4;
}

/** The spun 3D objects (MATH.md §9.2), in display order, ready for registerShape. */
export const SPUN_SHAPES: readonly SpunShapeEntry[] = [
  {
    id: SHAPE_IDS.spunBall,
    label: 'Spun ball',
    group: 'Spun 3D objects',
    description: 'A ball of radius 0.4 floating at height 1.1 above the plane z = 0, spun about that plane into a torisphere (a ball swept round a circle, boundary S² × S¹): its w = 0 slice is a pair of mirror-twin balls at z = ±1.1 that approach, merge at |w| = 0.7 and vanish beyond |w| = 1.5.',
    create: spunBall,
  },
  {
    id: SHAPE_IDS.spunHalfBall,
    label: 'Spun half-ball',
    group: 'Spun 3D objects',
    description: 'A half-ball {|p| ≤ 1, z ≥ 0} spun about its flat face is exactly the 4-ball: every slice is a ball of radius √(1 − w²), and at w = 0 its mirror twins are the two halves of one whole ball.',
    create: spunHalfBall,
  },
  {
    id: SHAPE_IDS.spunCube,
    label: 'Spun cube',
    group: 'Spun 3D objects',
    description: 'A unit cube centred at height 1.2 above z = 0, spun into a solid ring with square cross-section: its w = 0 slice is a pair of mirror-twin cubes at z = ±1.2 that merge at |w| = 0.7 and vanish beyond |w| = 1.7.',
    create: spunCube,
  },
  {
    id: SHAPE_IDS.spunHuman,
    label: 'Spun human',
    group: 'Spun 3D objects',
    description: 'The 16-part human figure shifted to z ≥ 0.25 and spun part by part about z = 0, so that the slice at w = 0 shows the figure together with its mirror twin reflected in z, the pair drawing together and vanishing as |w| grows.',
    create: spunHuman,
  },
];
