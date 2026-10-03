/**
 * The solids of Flatland mode (MATH.md §11): closed, outward-oriented 3D
 * triangle meshes (§9), each a list of parts drawn and sliced together.
 * Every shape is centred at the origin. The mesh of a part is its boundary,
 * the Flatland counterpart of the tet complex of §5.
 */
import type { FlatShapeId } from '../explain';
import type { Vec3 } from '../math/types';
import { box, cylinder, icosphere, mesh3Bounds, torus, type Mesh3, type Triangle } from '../geometry/mesh3';
import { humanParts } from '../geometry/figures';

export interface FlatShapeEntry {
  label: string;
  /** One sentence shown under the title. */
  description: string;
  /** Build fresh meshes (the app caches them). */
  create: () => Mesh3[];
  /** Suggested perspective eye distance d; default max(3, 2.5 R). The cube uses the textbook d = 3 of §11. */
  eyeDistance?: number;
}

/**
 * Regular tetrahedron on four alternate corners of the cube [−1, 1]^3:
 * (1,1,1), (1,−1,−1), (−1,1,−1), (−1,−1,1). Every pair differs in exactly
 * two coordinates, so each edge has length √(2² + 2²) = 2√2. The cube minus
 * the four corner pyramids (each (1/6)·2·2·2 = 4/3) leaves volume 8 − 16/3
 * = 8/3. Faces are listed outward (counter-clockwise seen from outside):
 * the face opposite vertex k has outward normal along −v_k.
 */
export function tetrahedron(): Mesh3 {
  const positions: Vec3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const triangles: Triangle[] = [[1, 3, 2], [0, 2, 3], [0, 3, 1], [0, 1, 2]];
  return { positions, triangles };
}

/**
 * Regular octahedron with vertices ±e_i: eight faces, one per sign pattern,
 * each a triangle (±e_x, ±e_y, ±e_z) of volume 1/6 of the unit cube corner
 * it cuts, so the volume is 8 · (1/6) = 4/3 and the edge is √2. Vertices
 * 0..5 are +x, −x, +y, −y, +z, −z; faces are listed outward.
 */
export function octahedron(): Mesh3 {
  const positions: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const triangles: Triangle[] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  return { positions, triangles };
}

export const FLAT_SHAPES: Record<FlatShapeId, FlatShapeEntry> = {
  cube: {
    label: 'Cube',
    description: 'Six square faces. Seen head-on from d = 3 its shadow is a square inside a square; sliced parallel to Flatland it is a square.',
    create: () => [box(2, 2, 2)],
    eyeDistance: 3,
  },
  tetrahedron: {
    label: 'Tetrahedron',
    description: 'Four triangular faces. Depending on how the plane meets it, a slice is a triangle or a quadrilateral, shrinking to a point at a corner.',
    create: () => [tetrahedron()],
  },
  octahedron: {
    label: 'Octahedron',
    description: 'Eight triangular faces, two pyramids base to base. Pushed along z its slice is a square that swells to the middle and shrinks to a point.',
    create: () => [octahedron()],
  },
  ball: {
    label: 'Ball',
    description: 'A sphere. Pushed through Flatland it appears as a dot, swells into a disc and shrinks away: a slice at offset c is a disc of area π(1 − c²).',
    create: () => [icosphere(1, 3)],
  },
  torus: {
    label: 'Torus',
    description: 'A doughnut lying flat in Flatland. Sliced flat it is a ring; turned on its side, the ring splits into two separate discs.',
    create: () => [torus(1, 0.4, 48, 24)],
  },
  cylinder: {
    label: 'Cylinder',
    description: 'A can standing along z. Pushed straight through it is a disc that appears and vanishes all at once; tilted, its slice is an ellipse clipped by two straight cuts.',
    create: () => [cylinder(1, 2, 48)],
  },
  human: {
    label: 'Human',
    description: 'A figure standing along y, facing the viewer. Sliced layer by layer, like a scan, the flat creatures meet cross-sections of head, torso, arms and legs, merging where parts overlap.',
    create: () => humanParts(),
  },
};

/** Origin-centred bounding radius and z extent of a shape's parts, in its own frame (the colour range of the slice view). */
export function flatShapeBounds(meshes: readonly Mesh3[]): { radius: number; zRange: [number, number] } {
  let radius = 0;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const mesh of meshes) {
    const b = mesh3Bounds(mesh);
    radius = Math.max(radius, b.radius);
    zmin = Math.min(zmin, b.min[2]);
    zmax = Math.max(zmax, b.max[2]);
  }
  if (!(zmin <= zmax)) { zmin = 0; zmax = 0; }
  return { radius, zRange: [zmin, zmax] };
}
