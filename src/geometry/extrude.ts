/**
 * Extrusion of a 3D solid into 4D (MATH.md §9.1): the prism P = S × [−h, h]
 * over a closed, outward-oriented triangle mesh M bounding S ⊂ R^3. This is
 * the lifting that turns a square into a cube and a cube into a tesseract;
 * extrude(cube) is the tesseract exactly.
 *
 * Boundary of P (§9.1):
 * - lateral part M × [−h, h]: one triangular prism per triangle of M, split
 *   into three tets, outward oriented analytically from M's orientation;
 * - caps S × {−h} and S × {+h}: solid copies of S. They are not
 *   tetrahedralised. A cap's slice is the planar section of S by the plane
 *   where the cap meets the hyperplane, lifted and charted.
 */
import type { Edge, Hyperplane, Shape4, Tet, TetComplex, TriMesh3, Vec3, Vec4, WireMesh4 } from '../math/types';
import { chart, signedDistance } from '../math/hyperplane';
import { cross3, dot3, dot4, length3, scale3, sub3 } from '../math/vec';
import type { Mesh3, Triangle } from './mesh3';
import { mesh3Bounds, mesh3Edges } from './mesh3';
import { planarSectionFromDistances, planeBasis, triangulateSection } from './section';
import { sliceTets } from './slice';
import { tetNormal } from './tets';
import { mergeMeshes } from './trimesh';

/**
 * Below this length of n_xyz the hyperplane counts as w = c: the caps are
 * parallel to it, their charted outward normal is zero and they are skipped
 * (MATH.md §6: the lateral tets then give the limit-from-below result).
 */
const PARALLEL_TOL = 1e-12;

/**
 * Relative resolution of the Float32 slice output (2^-24 ≈ 6e-8, rounded
 * up): points closer than this fraction of the section's extent, or closer
 * than it to a chord, are indistinguishable once emitted.
 */
const RESOLUTION = 1e-7;

/**
 * Three tets filling the prism over triangle `tri`, whose bottom vertices
 * are the triangle's indices and top vertices those plus `offset`.
 *
 * Diagonal rule: the quad over mesh edge (i, j) with i < j is split along
 * the diagonal from i at the bottom to j at the top. It depends only on the
 * edge, so the two prisms sharing that quad split it the same way and the
 * lateral complex is a valid tet complex (MATH.md §5.2) except for its two
 * open ends. With the triangle's indices sorted a < b < c the split is
 * (a0 b0 c0 c1), (a0 b0 c1 b1), (a0 b1 c1 a1): its lateral faces are
 * (b0 c0 c1), (b0 c1 b1) over edge bc, (a0 c0 c1), (a0 c1 a1) over ac and
 * (a0 b0 b1), (a0 b1 a1) over ab, each pair split along the rule's diagonal.
 * Orientation is not fixed here (the sort loses the triangle's winding).
 */
function prismTets(tri: Triangle, offset: number): Tet[] {
  const sorted = [tri[0], tri[1], tri[2]].sort((x, y) => x - y);
  const a0 = sorted[0];
  const b0 = sorted[1];
  const c0 = sorted[2];
  const a1 = a0 + offset;
  const b1 = b0 + offset;
  const c1 = c0 + offset;
  return [[a0, b0, c0, c1], [a0, b0, c1, b1], [a0, b1, c1, a1]];
}

/**
 * The lateral boundary M × [−h, h] as an outward-oriented tet complex.
 * Positions are (v, −h) for every mesh vertex v, then (v, +h). Every tet of
 * the prism over a triangle lies in the hyperplane spanned by the triangle's
 * plane and the w axis, so its 4D normal is ±(n_tri, 0) with n_tri the
 * triangle's 3D normal; outward is (n_tri, 0) because M is outward oriented
 * (MATH.md §5.1, §9.1). Tets whose cross4 normal has a negative dot product
 * with it get two vertices swapped. Degenerate (zero-area) triangles give
 * zero-volume tets with zero normal, which are kept as they are.
 */
export function lateralComplex(mesh: Mesh3, halfHeight: number): TetComplex {
  const V = mesh.positions.length;
  const positions: Vec4[] = new Array<Vec4>(2 * V);
  mesh.positions.forEach((p, i) => {
    positions[i] = [p[0], p[1], p[2], -halfHeight];
    positions[i + V] = [p[0], p[1], p[2], halfHeight];
  });
  const tets: Tet[] = [];
  for (const tri of mesh.triangles) {
    const pa = mesh.positions[tri[0]];
    const n3 = cross3(sub3(mesh.positions[tri[1]], pa), sub3(mesh.positions[tri[2]], pa));
    const outward: Vec4 = [n3[0], n3[1], n3[2], 0];
    for (const t of prismTets(tri, V)) {
      tets.push(dot4(tetNormal(positions, t), outward) < 0 ? [t[0], t[2], t[1], t[3]] : t);
    }
  }
  return { positions, tets };
}

// ---- Cap triangulation -----------------------------------------------------

/** Sorted-pair key of an undirected edge. */
const edgeKey = (i: number, j: number): string => (i < j ? `${i},${j}` : `${j},${i}`);

/**
 * Distance of loop[j] from the line through loop[i] and loop[k] (doubled
 * triangle area over the base), or the distance to loop[i] when i and k
 * coincide.
 */
function deviation(loop: readonly Vec3[], i: number, j: number, k: number): number {
  const base = sub3(loop[k], loop[i]);
  const leg = sub3(loop[j], loop[i]);
  const baseLength = length3(base);
  return baseLength > 0 ? length3(cross3(leg, base)) / baseLength : length3(leg);
}

/**
 * Indices of the corners of a closed loop: the points that are not (nearly)
 * collinear with their neighbours, in loop order. A planar section keeps a
 * point wherever the plane crosses an interior edge of a flat, triangulated
 * face (a cube face, a cylinder cap, and the quad diagonals of a surface of
 * revolution cut by z = const), and those points lie on a straight chord
 * through the face up to rounding. Earcut must not see them: it drops
 * exactly collinear points and emits zero-area slivers, whose orientation is
 * numerically meaningless, for nearly collinear ones.
 *
 * The walk starts at the sharpest corner and keeps a point when its distance
 * from the chord (last kept point, next point) exceeds `tol`, so a straight
 * run of any length collapses to its two ends while a finely sampled curve
 * keeps enough points to stay within `tol` of the chords. Returns [] when
 * the loop has no corner at all (a degenerate loop of zero area).
 */
export function loopCorners(loop: readonly Vec3[], tol: number): number[] {
  const n = loop.length;
  let start = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const d = deviation(loop, (i + n - 1) % n, i, (i + 1) % n);
    if (d > best) { best = d; start = i; }
  }
  if (best <= tol) return [];
  const kept = [start];
  for (let s = 1; s < n; s++) {
    const i = (start + s) % n;
    const next = (start + s + 1) % n;
    if (deviation(loop, kept[kept.length - 1], i, next) > tol) kept.push(i);
  }
  return kept;
}

/**
 * Make a triangulation of `loops` conform to them: every loop edge becomes
 * an edge of the triangulation. `tri.positions` must be the concatenation of
 * the loops' points; `tri.triangles` may reference only some of them (the
 * corners). Every unreferenced run b_1..b_k between referenced neighbours a
 * and c lies along the polygon edge (a, c), which belongs to exactly one
 * triangle (a, c, x); that triangle is replaced by the fan (a, b_1, x),
 * (b_1, b_2, x), ..., (b_k, c, x). The pieces keep the parent's cyclic order,
 * hence its orientation, and together cover exactly the parent plus (or
 * minus) the thin region between the chord and the run, so the result is a
 * triangulation of the full polygon whatever side of the chord the run
 * bulges to. Runs whose spanning edge is missing (an incomplete earcut
 * output) are left alone.
 */
export function conformTriangulationToLoops(tri: Mesh3, loops: readonly (readonly Vec3[])[]): Triangle[] {
  const referenced = new Uint8Array(tri.positions.length);
  for (const t of tri.triangles) { referenced[t[0]] = 1; referenced[t[1]] = 1; referenced[t[2]] = 1; }
  if (referenced.every((r) => r === 1)) return tri.triangles;

  const triangles: Array<Triangle | null> = tri.triangles.slice();
  const edgeTri = new Map<string, number>();
  const register = (ti: number): void => {
    const t = triangles[ti];
    if (!t) return;
    edgeTri.set(edgeKey(t[0], t[1]), ti);
    edgeTri.set(edgeKey(t[1], t[2]), ti);
    edgeTri.set(edgeKey(t[2], t[0]), ti);
  };
  for (let ti = 0; ti < triangles.length; ti++) register(ti);

  let offset = 0;
  for (const loop of loops) {
    const n = loop.length;
    const idx = (j: number): number => offset + (j % n);
    let start = -1;
    for (let j = 0; j < n; j++) if (referenced[idx(j)]) { start = j; break; }
    if (start >= 0) {
      for (let j = start; j < start + n; j++) {
        const a = idx(j);
        if (!referenced[a]) continue;
        const dropped: number[] = [];
        let k = j + 1;
        while (!referenced[idx(k)]) { dropped.push(idx(k)); k++; }
        if (dropped.length === 0) continue;
        const c = idx(k);
        const ti = edgeTri.get(edgeKey(a, c));
        const t = ti === undefined ? null : triangles[ti];
        if (ti === undefined || !t) continue;
        const x = t[0] !== a && t[0] !== c ? t[0] : t[1] !== a && t[1] !== c ? t[1] : t[2];
        const forward = t[(t.indexOf(a) + 1) % 3] === c; // cyclic order a → c → x
        triangles[ti] = null;
        const chain = [a, ...dropped, c];
        for (let i = 0; i + 1 < chain.length; i++) {
          triangles.push(forward ? [chain[i], chain[i + 1], x] : [chain[i + 1], chain[i], x]);
          register(triangles.length - 1);
        }
      }
    }
    offset += n;
  }
  return triangles.filter((t): t is Triangle => t !== null);
}

/**
 * Remove points closer than `tol` to the previously kept point (cyclically,
 * so the last kept point is also checked against the first). planarSection
 * only removes exactly coincident steps; a plane passing within rounding of
 * a mesh vertex leaves clusters of distinct points that the Float32 slice
 * output cannot tell apart and that welding merges anyway. Collapsing them
 * first keeps the triangulation free of near-zero triangles, so that every
 * piece made by conformTriangulationToLoops has a well defined orientation.
 */
export function dedupeLoop(loop: readonly Vec3[], tol: number): Vec3[] {
  const out: Vec3[] = [];
  const tol2 = tol * tol;
  const near = (p: Vec3, q: Vec3): boolean => {
    const d = sub3(p, q);
    return dot3(d, d) <= tol2;
  };
  for (const q of loop) {
    if (out.length === 0 || !near(out[out.length - 1], q)) out.push([q[0], q[1], q[2]]);
  }
  while (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

/**
 * Triangulate the planar region bounded by `loops` so that every loop point
 * is a vertex and every loop edge a triangle edge, with every triangle's
 * normal along `orientation` × normal (MATH.md §9.1). Points the Float32
 * output could not distinguish (closer than 1e-7 of the loops' extent) are
 * merged first; earcut (triangulateSection) then runs on the loops' corners
 * only, points farther than that same 1e-7 of the extent from the chord
 * between their neighbours, and the skipped points are put back by
 * conformTriangulationToLoops. The returned positions are the (merged)
 * loops' points in order; loops left with fewer than three points or no
 * corner are dropped.
 */
export function triangulateLoopsConforming(
  loops: readonly (readonly Vec3[])[],
  normal: Vec3,
  orientation: 1 | -1,
): Mesh3 {
  let scale = 0;
  for (const loop of loops) for (const q of loop) scale = Math.max(scale, Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2]));
  const tol = RESOLUTION * scale;
  const clean = loops.map((loop) => dedupeLoop(loop, tol)).filter((loop) => loop.length >= 3);
  const positions: Vec3[] = [];
  for (const loop of clean) for (const q of loop) positions.push(q);
  const cornerLoops: Vec3[][] = [];
  const fullIndex: number[] = [];
  let offset = 0;
  for (const loop of clean) {
    const kept = loopCorners(loop, tol);
    if (kept.length >= 3) {
      cornerLoops.push(kept.map((j) => loop[j]));
      for (const j of kept) fullIndex.push(offset + j);
    }
    offset += loop.length;
  }
  if (cornerLoops.length === 0) return { positions, triangles: [] };
  const tri = triangulateSection(cornerLoops, normal, orientation);
  const mapped: Triangle[] = tri.triangles.map(([a, b, c]) => [fullIndex[a], fullIndex[b], fullIndex[c]]);
  return { positions, triangles: conformTriangulationToLoops({ positions, triangles: mapped }, clean) };
}

/** The prism S × [−h, h] over the solid S bounded by `mesh`. MATH.md §9.1 */
export class ExtrudedSolid implements Shape4 {
  readonly kind = 'lifted' as const;
  /** Lateral boundary tets (the caps are not tetrahedralised). */
  readonly complex: TetComplex;
  private readonly r: number;
  private wireCache: WireMesh4 | null = null;

  constructor(
    public readonly name: string,
    public readonly mesh: Mesh3,
    public readonly halfHeight: number,
  ) {
    if (!(halfHeight > 0) || !Number.isFinite(halfHeight)) {
      throw new Error(`extrude: halfHeight must be a positive number, got ${halfHeight}`);
    }
    this.complex = lateralComplex(mesh, halfHeight);
    // Every vertex is (v, ±h): |p|² = |v|² + h², maximised by the farthest v.
    this.r = Math.hypot(mesh3Bounds(mesh).radius, halfHeight);
  }

  /**
   * Projection structure (MATH.md §9.1): the mesh's edges at both levels plus
   * one vertical edge per vertex; the mesh's triangles at both levels plus
   * one quad per mesh edge. Triangulation diagonals of M are mesh edges, so
   * they appear here too (an extruded box has 44 edges and 42 faces, not the
   * tesseract's 32 and 24; see test/geometry/extrude.test.ts).
   */
  wire(): WireMesh4 {
    if (this.wireCache) return this.wireCache;
    const V = this.mesh.positions.length;
    const edges: Edge[] = [];
    const faces: number[][] = [];
    for (const [i, j] of mesh3Edges(this.mesh)) {
      edges.push([i, j], [i + V, j + V]);
      faces.push([i, j, j + V, i + V]);
    }
    for (let i = 0; i < V; i++) edges.push([i, i + V]);
    for (const [a, b, c] of this.mesh.triangles) {
      faces.push([a, b, c], [a + V, b + V, c + V]);
    }
    this.wireCache = { positions: this.complex.positions, edges, faces };
    return this.wireCache;
  }

  /**
   * Slice by h (MATH.md §9.1): marching tetrahedra over the lateral tets
   * (§6) merged with the planar sections of the two caps. Vertices are not
   * shared between the parts; the lateral boundary and the cap loops pass
   * through the same crossing points of the mesh edges at w = ±h (the cap
   * is cut with the lateral slicer's own vertex classification, see
   * capSlice), so the merged mesh is closed after welding. The hyperplane
   * is used exactly as given: §6's symbolic perturbation (s ≥ 0 counts as
   * positive) is what makes a hyperplane through cap-level vertices
   * watertight, and no literal offset shift is needed. (An earlier version
   * lowered the offset by 2ε when a vertex lay within ε of h; in the cap
   * plane that shift is divided by |n_xyz| and misplaces the clipping plane
   * of a nearly parallel hyperplane by a visible amount.)
   */
  slice(h: Hyperplane): TriMesh3 {
    const lateral = sliceTets(this.complex.positions, this.complex.tets, h);
    const parts: TriMesh3[] = [lateral];
    for (const w0 of [-this.halfHeight, this.halfHeight]) {
      const cap = this.capSlice(h, w0);
      if (cap) parts.push(cap);
    }
    return parts.length === 1 ? lateral : mergeMeshes(parts);
  }

  /**
   * Slice of the cap S × {w0}. With n = (n_xyz, n_w) and offset c, a point
   * (q, w0) lies in h iff n_xyz · q = c − n_w w0: a plane in R^3. The cap
   * is sectioned with the 4D signed distances s = n · (q, w0) − c of its
   * vertices, the very numbers sliceTets computes for the same lateral
   * vertices (signedDistance on the same positions), so a vertex on h up to
   * rounding is positive for both or negative for both and the cap loops
   * meet the lateral boundary edge for edge (MATH.md §6). Recomputing s from
   * the normalised 3D normal and a rescaled offset would not guarantee this.
   * The cap's 4D outward normal is sign(w0) e_w; projected into h and
   * charted it is capDir = chart(h, sign(w0) e_w) (chart already drops the
   * n component since the basis is ⊥ n). Its length is |n_xyz|, so it
   * vanishes exactly when the caps are parallel to h, and then nothing is
   * emitted.
   *
   * Orientation: L(d) = chart(h, (d, 0)) is linear, and for d ⊥ n_xyz the
   * vector (d, 0) is ⊥ n, so L is an isometry from the section plane onto
   * the 2-plane of h containing the lifted cap. For the plane basis (u, v)
   * with u × v = n̂_xyz, every triangle of triangulateSection(·, +1) has
   * normal λ n̂_xyz (λ > 0) and lifts to one with normal λ (L u × L v), so the
   * sign of (L u × L v) · capDir decides whether +1 or −1 orientation makes
   * the lifted triangles face capDir, i.e. outward (MATH.md §6, §9.1).
   */
  private capSlice(h: Hyperplane, w0: number): TriMesh3 | null {
    const n = h.normal;
    const nxyz: Vec3 = [n[0], n[1], n[2]];
    const len = length3(nxyz);
    if (len <= PARALLEL_TOL) return null;
    const sign = w0 < 0 ? -1 : 1;
    const capDir = chart(h, [0, 0, 0, sign]);
    if (dot3(capDir, capDir) <= PARALLEL_TOL * PARALLEL_TOL) return null;

    const m = scale3(nxyz, 1 / len);
    const V = this.mesh.positions.length;
    const base = w0 < 0 ? 0 : V; // lateralComplex: (v, −h) first, then (v, +h)
    const s = new Float64Array(V);
    for (let i = 0; i < V; i++) s[i] = signedDistance(h, this.complex.positions[base + i]);
    const { loops } = planarSectionFromDistances(this.mesh, s);
    if (loops.length === 0) return null;

    const lift = (q: Vec3, w: number): Vec3 => chart(h, [q[0], q[1], q[2], w]);
    const [u, v] = planeBasis(m);
    const side = dot3(cross3(lift(u, 0), lift(v, 0)), capDir);
    const tri = triangulateLoopsConforming(loops, m, side >= 0 ? 1 : -1);
    if (tri.triangles.length === 0) return null;

    const positions = new Float32Array(tri.positions.length * 3);
    tri.positions.forEach((q, i) => positions.set(lift(q, w0), 3 * i));
    const indices = new Uint32Array(tri.triangles.length * 3);
    tri.triangles.forEach(([a, b, c], i) => { indices[3 * i] = a; indices[3 * i + 1] = b; indices[3 * i + 2] = c; });
    const sourceW = new Float32Array(tri.positions.length).fill(w0);
    return { positions, indices, sourceW };
  }

  /** √(r₃² + h²) with r₃ the mesh's radius about the origin. */
  radius(): number { return this.r; }

  wRange(): [number, number] { return [-this.halfHeight, this.halfHeight]; }
}

/** Build the prism S × [−halfHeight, halfHeight] over the solid bounded by `mesh`. MATH.md §9.1 */
export function extrude(mesh: Mesh3, halfHeight: number, name: string): ExtrudedSolid {
  return new ExtrudedSolid(name, mesh, halfHeight);
}

/** Same as extrude, typed as the generic Shape4 interface. */
export function extrudeShape(mesh: Mesh3, halfHeight: number, name: string): Shape4 {
  return extrude(mesh, halfHeight, name);
}
