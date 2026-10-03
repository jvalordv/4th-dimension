/**
 * The drawable form of a Flatland solid: the vertices, faces and edges of its
 * boundary meshes (MATH.md §5.3 one dimension down) concatenated into one
 * indexed structure, with each undirected edge knowing its two faces.
 *
 * Which edges the projection view draws: an edge of the cube, the tetrahedron
 * or a cylinder's rim is a *crease* (its two faces meet at a dihedral angle
 * above FEATURE_DEGREES) and is always drawn; the triangulation's own edges
 * (a cube's face diagonals, the facets of a ball) are not part of the
 * solid's structure and are drawn only where they form the *silhouette*, the
 * outline of the shadow, which depends on the view and is found per frame
 * (src/flat/view).
 */
import type { Vec3 } from '../math/types';
import { cross3, dot3, length3, sub3 } from '../math/vec';
import { mesh3Bounds, type Mesh3, type Triangle } from '../geometry/mesh3';

/** Dihedral angle (between outward face normals, degrees) above which an edge is a crease. */
export const FEATURE_DEGREES = 35;

export interface FlatEdge {
  /** Vertex indices, a < b. */
  readonly a: number;
  readonly b: number;
  /** The face traversing a → b and the face traversing b → a (−1 for a boundary edge). */
  readonly f1: number;
  readonly f2: number;
  /** Crease (or boundary): drawn in every view. */
  readonly crease: boolean;
}

export interface FlatModel {
  readonly meshes: readonly Mesh3[];
  readonly vertices: readonly Vec3[];
  /** Triangles over `vertices`, counter-clockwise seen from outside. */
  readonly faces: readonly Triangle[];
  readonly edges: readonly FlatEdge[];
  /** Vertices of crease edges, drawn as dots when there are few of them. */
  readonly corners: readonly number[];
  /** Origin-centred bounding radius R. */
  readonly radius: number;
  /** [min, max] of z over the solid in its own frame: the slice-view colour range. */
  readonly zRange: readonly [number, number];
}

/** Corner dots are drawn only for solids with at most this many corners. */
export const MAX_CORNER_DOTS = 32;

export function buildModel(meshes: readonly Mesh3[], featureDegrees = FEATURE_DEGREES): FlatModel {
  const vertices: Vec3[] = [];
  const faces: Triangle[] = [];
  const edges: FlatEdge[] = [];
  const cosLimit = Math.cos((featureDegrees * Math.PI) / 180);
  let radius = 0;
  let zmin = Infinity;
  let zmax = -Infinity;

  for (const mesh of meshes) {
    const base = vertices.length;
    const faceBase = faces.length;
    for (const p of mesh.positions) vertices.push([p[0], p[1], p[2]]);
    for (const [a, b, c] of mesh.triangles) faces.push([a + base, b + base, c + base]);
    const b = mesh3Bounds(mesh);
    radius = Math.max(radius, b.radius);
    zmin = Math.min(zmin, b.min[2]);
    zmax = Math.max(zmax, b.max[2]);

    // Directed edge → face; an undirected edge's two faces traverse it in opposite directions.
    const n = mesh.positions.length;
    const owner = new Map<number, number>();
    mesh.triangles.forEach(([x, y, z], t) => {
      owner.set(x * n + y, faceBase + t);
      owner.set(y * n + z, faceBase + t);
      owner.set(z * n + x, faceBase + t);
    });
    const normal = (f: number): Vec3 | null => {
      const [i, j, k] = faces[f];
      const c = cross3(sub3(vertices[j], vertices[i]), sub3(vertices[k], vertices[i]));
      const l = length3(c);
      return l > 0 ? [c[0] / l, c[1] / l, c[2] / l] : null;
    };
    for (const [key, f] of owner) {
      const x = Math.floor(key / n);
      const y = key % n;
      const reverse = owner.get(y * n + x);
      // Each undirected edge once: from its a → b traversal, or alone when only b → a exists.
      if (x > y && reverse !== undefined) continue;
      const [lo, hi, f1, f2] = x < y ? [x, y, f, reverse ?? -1] : [y, x, -1, f];
      let crease = f1 < 0 || f2 < 0;
      if (!crease) {
        const n1 = normal(f1);
        const n2 = normal(f2);
        crease = n1 !== null && n2 !== null && dot3(n1, n2) < cosLimit;
      }
      edges.push({ a: lo + base, b: hi + base, f1, f2, crease });
    }
  }
  const corners = new Set<number>();
  for (const e of edges) if (e.crease) { corners.add(e.a); corners.add(e.b); }
  if (!(zmin <= zmax)) { zmin = 0; zmax = 0; }
  return { meshes, vertices, faces, edges, corners: [...corners].sort((p, q) => p - q), radius, zRange: [zmin, zmax] };
}
