/**
 * Shared types for the 4D geometry library. See docs/MATH.md for the
 * definitions these encode; section numbers in comments refer to it.
 */

/** A point or vector in R^3. */
export type Vec3 = [number, number, number];

/** A point or vector in R^4, ordered (x, y, z, w). §1 */
export type Vec4 = [number, number, number, number];

/** Real 4×4 matrix, row-major, m[r*4 + c], acting linearly on Vec4. §1 */
export type Mat4 = number[];

/** Axis index: x=0, y=1, z=2, w=3. */
export type Axis = 0 | 1 | 2 | 3;

/** The six coordinate planes of R^4, in canonical order. §2.1 */
export type RotationPlane = 'XY' | 'XZ' | 'XW' | 'YZ' | 'YW' | 'ZW';

/** One angle per rotation plane; composed per §2.2. */
export type RotationAngles = Record<RotationPlane, number>;

/**
 * Hyperplane { p : normal · p = offset } with an orthonormal chart basis of
 * normal^⊥ such that columns (basis[0], basis[1], basis[2], normal) have
 * determinant +1. §4
 */
export interface Hyperplane {
  readonly normal: Vec4;
  readonly offset: number;
  readonly basis: readonly [Vec4, Vec4, Vec4];
}

/** Undirected edge as a pair of vertex indices. */
export type Edge = [number, number];

/** Tetrahedron as four vertex indices, outward oriented per §5.1. */
export type Tet = [number, number, number, number];

/** Tetrahedral boundary complex of a 4D solid. §5 */
export interface TetComplex {
  readonly positions: Vec4[];
  readonly tets: Tet[];
}

/** Combinatorial structure drawn in the projection view. §5.3 */
export interface WireMesh4 {
  readonly positions: Vec4[];
  readonly edges: Edge[];
  /** Each face is a cycle of vertex indices (polygon). */
  readonly faces: number[][];
}

/** A convex 4-polytope with full face lattice and a tet complex. §5.3 */
export interface Polytope4 extends TetComplex, WireMesh4 {
  readonly name: string;
  /** Each cell is a list of face indices. */
  readonly cells: number[][];
  /**
   * Tet complex positions may include extra vertices (cell centroids) beyond
   * the polytope's own; `positions` is the full array and `vertexCount` the
   * number of true polytope vertices (the first `vertexCount` entries).
   */
  readonly vertexCount: number;
}

/**
 * Triangle mesh in R^3 produced by slicing. Triangles are counter-clockwise
 * seen from outside (outward oriented). §6
 */
export interface TriMesh3 {
  /** xyz per vertex. */
  readonly positions: Float32Array;
  /** Three indices per triangle. */
  readonly indices: Uint32Array;
  /**
   * Per vertex: the w coordinate, in the shape's own (unrotated) frame, of
   * the 4D point this slice vertex came from. Drives colour. §10
   */
  readonly sourceW: Float32Array;
}

export type ShapeKind = 'polytope' | 'curved' | 'lifted' | 'compound' | 'sdf';

/**
 * Anything the viewer can show. All methods work in the shape's own
 * coordinates; rotation is expressed through the hyperplane (see
 * hyperplaneFromRotation) or applied to wire vertices by the renderer.
 */
export interface Shape4 {
  readonly name: string;
  readonly kind: ShapeKind;
  /** Structure for the projection view, or null if the shape has none (SDFs). */
  wire(): WireMesh4 | null;
  /** Slice by h; result in h's chart coordinates. §6 */
  slice(h: Hyperplane): TriMesh3;
  /** Radius of an origin-centred ball containing the shape. */
  radius(): number;
  /** [min, max] of w over the shape, in its own frame. §10 */
  wRange(): [number, number];
}
