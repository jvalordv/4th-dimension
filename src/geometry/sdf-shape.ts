/**
 * Shapes defined by a signed distance field (MATH.md §9.3). An SdfShape is
 * the implicit counterpart of TetShape: slicing evaluates the field directly
 * on the hyperplane and extracts the zero set by marching tetrahedra, so
 * every slice is as accurate as the grid and no 4D mesh is ever built unless
 * the projection view asks for one (wire), or a caller extracts the complex
 * explicitly (sdfToTetShape).
 */
import type { Edge, Hyperplane, Shape4, Tet, TetComplex, TriMesh3, Vec3, Vec4, WireMesh4 } from '../math/types';
import { marchingPentatopes, marchingTets3 } from './isosurface';
import type { SdfScene } from './sdf';
import { TetShape } from './shape';
import { emptyMesh } from './trimesh';

/** Resolutions (cells per axis of the extraction grid) of an SdfShape. */
export interface SdfShapeOptions {
  /** Slice grid: (n+1)³ field evaluations per slice. Default 40. */
  sliceResolution?: number;
  /** Wire grid: (n+1)⁴ evaluations, once. Default 14. */
  wireResolution?: number;
}

const DEFAULT_SLICE_RESOLUTION = 40;
const DEFAULT_WIRE_RESOLUTION = 14;

function assertResolution(what: string, n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${what} must be a positive integer, got ${n}`);
}

/**
 * The distinct edges of a tet complex, each as a sorted index pair, in first
 * seen order. Deduplicated by the key a·N + b (exact below 2^53 since N is
 * a vertex count).
 */
export function tetEdges(vertexCount: number, tets: readonly Tet[]): Edge[] {
  const seen = new Set<number>();
  const edges: Edge[] = [];
  for (const t of tets) {
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = Math.min(t[i], t[j]);
        const b = Math.max(t[i], t[j]);
        const key = a * vertexCount + b;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}

/** The projection-view structure of an extracted complex: its vertices and deduplicated tet edges, no faces. */
export const complexWire = (c: TetComplex): WireMesh4 => ({
  positions: c.positions,
  edges: tetEdges(c.positions.length, c.tets),
  faces: [],
});

/**
 * The interval [lo, hi] of n·p over the region the scene's bounds allow,
 * B = { p : |p| ≤ R, w ∈ [w0, w1] }, for a unit normal n = (n_xyz, n_w). A
 * hyperplane n·p = c outside (lo, hi) misses the interior of the solid, so
 * its slice is empty. Writing a = |n_xyz|, b = n_w and sup_B = max over w ∈
 * [w0, w1] of φ(w) = a √(R² − w²) + b w (the best point of the ball at
 * height w is along n_xyz), φ is concave with its unconstrained maximum
 * at w = bR (value R, since a² + b² = 1), so the maximum over the allowed
 * heights is at bR clamped to [max(w0, −R), min(w1, R)]. The minimum is
 * −sup_B(−n), and −n has the same a and −b.
 */
function supportInterval(scene: SdfScene, n: Vec4): [number, number] {
  const R = scene.radius;
  const wl = Math.max(scene.wRange[0], -R);
  const wh = Math.min(scene.wRange[1], R);
  const a = Math.hypot(n[0], n[1], n[2]);
  const best = (b: number): number => {
    const w = Math.min(Math.max(b * R, wl), wh);
    return a * Math.sqrt(Math.max(R * R - w * w, 0)) + b * w;
  };
  return [-best(-n[3]), best(n[3])];
}

/**
 * A Shape4 backed by an SdfScene. `slice(h)` samples
 * g(q) = f(c n + q_1 u_1 + q_2 u_2 + q_3 u_3) on [−R, R]³ (R = scene.radius,
 * the chart is an isometry, so the slice lies in that cube) and extracts its
 * zero set with marchingTets3; the output is in the chart coordinates of h,
 * outward oriented, and carries the 4D w of each vertex in sourceW (§10).
 * `wire()` extracts the complex once by marching pentatopes over [−R, R]⁴.
 */
export class SdfShape implements Shape4 {
  readonly kind = 'sdf' as const;
  private readonly sliceResolution: number;
  private readonly wireResolution: number;
  private wireCache: WireMesh4 | undefined;

  constructor(
    public readonly name: string,
    public readonly scene: SdfScene,
    opts: SdfShapeOptions = {},
  ) {
    this.sliceResolution = opts.sliceResolution ?? DEFAULT_SLICE_RESOLUTION;
    this.wireResolution = opts.wireResolution ?? DEFAULT_WIRE_RESOLUTION;
    assertResolution('sliceResolution', this.sliceResolution);
    assertResolution('wireResolution', this.wireResolution);
    if (!(scene.radius > 0) || !Number.isFinite(scene.radius)) throw new RangeError('SdfShape: scene radius must be positive and finite');
  }

  /** Vertices and deduplicated tet edges of the extracted complex (computed on first use). */
  wire(): WireMesh4 {
    if (!this.wireCache) {
      const R = this.scene.radius;
      this.wireCache = complexWire(marchingPentatopes(this.scene.f, [-R, -R, -R, -R], [R, R, R, R], this.wireResolution));
    }
    return this.wireCache;
  }

  slice(h: Hyperplane): TriMesh3 {
    const { f, radius: R } = this.scene;
    // The solid lies in the ball of radius R and the slab w ∈ wRange (true bounds, see SdfScene),
    // so a hyperplane n·p = c with c outside the support interval of that region touches the
    // solid in at most a boundary point, which the zero-is-positive rule of §6 leaves out:
    // the slice is empty and the (n+1)³ field evaluations can be skipped. This is what makes
    // sweeping the offset across a thin figure (the ditorus has |w| ≤ 0.1) cheap.
    const [lo, hi] = supportInterval(this.scene, h.normal);
    if (h.offset >= hi || h.offset <= lo) return emptyMesh();
    const [n0, n1, n2, n3] = h.normal;
    const [u, v, w] = h.basis;
    // unchart(h, q) = c n + q_1 u_1 + q_2 u_2 + q_3 u_3, written out so that each
    // grid vertex allocates one Vec4 (the field's argument) and nothing else.
    const o0 = h.offset * n0;
    const o1 = h.offset * n1;
    const o2 = h.offset * n2;
    const o3 = h.offset * n3;
    return marchingTets3(
      (q: Vec3) => f([
        o0 + q[0] * u[0] + q[1] * v[0] + q[2] * w[0],
        o1 + q[0] * u[1] + q[1] * v[1] + q[2] * w[1],
        o2 + q[0] * u[2] + q[1] * v[2] + q[2] * w[2],
        o3 + q[0] * u[3] + q[1] * v[3] + q[2] * w[3],
      ]),
      [-R, -R, -R],
      [R, R, R],
      this.sliceResolution,
      (q: Vec3) => o3 + q[0] * u[3] + q[1] * v[3] + q[2] * w[3],
    );
  }

  radius(): number { return this.scene.radius; }
  wRange(): [number, number] { return [this.scene.wRange[0], this.scene.wRange[1]]; }
}

/**
 * The scene's boundary as an explicit tet complex (marching pentatopes over
 * [−R, R]⁴ at `resolution` cells per axis), wrapped as a TetShape of kind
 * 'sdf' with the complex's edges as its wire. Its slices are those of the
 * piecewise-linear boundary (MATH.md §6) rather than the direct slices of
 * SdfShape, and agree with them to within both discretisations.
 */
export function sdfToTetShape(name: string, scene: SdfScene, resolution: number): TetShape {
  assertResolution('resolution', resolution);
  const R = scene.radius;
  const complex = marchingPentatopes(scene.f, [-R, -R, -R, -R] as Vec4, [R, R, R, R] as Vec4, resolution);
  return new TetShape(name, 'sdf', complex, complexWire(complex));
}
