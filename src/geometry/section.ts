/**
 * Planar sections of closed triangle meshes (MATH.md §9.1): the slice of an
 * extruded solid's cap is the section of the 3D solid S by a plane. The
 * section is found by intersecting every triangle with the plane, chaining
 * the segments into closed loops by shared mesh edge (never by coordinate
 * matching), classifying loops as outer or hole by nesting parity, and
 * triangulating each outer loop with its holes by ear clipping (earcut).
 */
import earcut from 'earcut';
import type { Vec3 } from '../math/types';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from '../math/vec';
import type { Mesh3, Triangle } from './mesh3';

/** A point of the plane in its own 2D chart. */
export type Vec2 = [number, number];

export interface PlanarSection {
  /**
   * Closed polylines lying in the plane (the first point is not repeated at
   * the end). For an outward-oriented mesh each loop runs counter-clockwise
   * about the plane normal when it bounds material (outer) and clockwise when
   * it bounds a hole, so its signed area about the normal has the sign of
   * its contribution to the section area.
   */
  loops: Vec3[][];
}

/** Sorted-pair key of an undirected mesh edge. */
const edgeKey = (i: number, j: number): string => (i < j ? `${i},${j}` : `${j},${i}`);

/**
 * Section of `mesh` by the plane { q : m · q = k }. `m` need not be unit:
 * the plane is kept and (m, k) are rescaled so that m becomes unit and the
 * per-vertex value s = m · q − k is a true signed distance. The loops are
 * those of planarSectionFromDistances for these s.
 */
export function planarSection(mesh: Mesh3, normal: Vec3, k: number): PlanarSection {
  const len = length3(normal);
  if (len === 0) throw new Error('planarSection: zero normal');
  const n = scale3(normal, 1 / len);
  const offset = k / len;
  const s = new Float64Array(mesh.positions.length);
  for (let i = 0; i < s.length; i++) s[i] = dot3(n, mesh.positions[i]) - offset;
  return planarSectionFromDistances(mesh, s);
}

/**
 * Section of `mesh` by a plane given through the signed distances `s` of the
 * mesh vertices from it (any positive multiple of the true distances: only
 * the signs and the ratios along each edge are used). The caller chooses the
 * arithmetic, so when the plane is the trace of a 4D hyperplane on a cap of
 * an extruded solid, the cap can be cut with the hyperplane's own 4D signed
 * distances and its classification is bit-identical to the lateral slicer's
 * (MATH.md §6, §9.1; ExtrudedSolid.capSlice).
 *
 * Vertices with s ≥ 0 are positive, exactly the symbolic perturbation of the
 * 4D slicer (MATH.md §6): every vertex falls in one class, so the section at
 * a plane through mesh vertices is still a set of closed loops (the limit
 * from the negative side, possibly with zero-length steps, which are
 * removed). A triangle with vertices in both classes has exactly one "lone"
 * vertex and yields one segment whose endpoints lie on the two edges at the
 * lone vertex; endpoints are identified by edge key, so chaining is purely
 * combinatorial. With the triangle's cyclic order (lone, u, v):
 *
 * - lone positive: the segment runs from edge (lone,u) to edge (lone,v);
 * - lone negative: from edge (lone,v) to edge (lone,u).
 *
 * That direction is m × N_t (N_t the triangle's outward normal), which keeps
 * material on the left when looking down the normal: outer loops come out
 * counter-clockwise about m, holes clockwise. For a consistently oriented
 * closed mesh every crossing edge is the start of exactly one segment and
 * the end of exactly one, so the segments form disjoint directed cycles.
 * Open chains (from a mesh that is not closed) are discarded, as are loops
 * with fewer than three distinct points.
 */
export function planarSectionFromDistances(mesh: Mesh3, s: ArrayLike<number>): PlanarSection {
  const { positions } = mesh;
  if (s.length !== positions.length) {
    throw new Error(`planarSectionFromDistances: ${s.length} distances for ${positions.length} vertices`);
  }
  let scale = 1;
  for (const p of positions) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));

  // Crossing point of each crossing edge, computed once per edge so the two
  // triangles sharing the edge see bit-identical coordinates. A vertex on
  // the plane is returned as itself, so segments that collapse onto such a
  // vertex have exactly coincident endpoints.
  const points = new Map<string, Vec3>();
  const crossing = (i: number, j: number): string => {
    const key = edgeKey(i, j);
    if (!points.has(key)) {
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      let p: Vec3;
      if (s[lo] === 0) p = [...positions[lo]];
      else if (s[hi] === 0) p = [...positions[hi]];
      else {
        const t = s[lo] / (s[lo] - s[hi]); // MATH.md §6: t ∈ [0, 1]
        p = add3(positions[lo], scale3(sub3(positions[hi], positions[lo]), t));
      }
      points.set(key, p);
    }
    return key;
  };

  const next = new Map<string, string>();
  for (const [a, b, c] of mesh.triangles) {
    const pa = s[a] >= 0;
    const pb = s[b] >= 0;
    const pc = s[c] >= 0;
    const positives = (pa ? 1 : 0) + (pb ? 1 : 0) + (pc ? 1 : 0);
    if (positives === 0 || positives === 3) continue;
    const lonePositive = positives === 1;
    // Cyclic order starting at the lone vertex.
    let lone: number;
    let u: number;
    let v: number;
    if (pa === lonePositive) { lone = a; u = b; v = c; }
    else if (pb === lonePositive) { lone = b; u = c; v = a; }
    else { lone = c; u = a; v = b; }
    const onU = crossing(lone, u);
    const onV = crossing(lone, v);
    if (lonePositive) next.set(onU, onV);
    else next.set(onV, onU);
  }

  const tol = 1e-12 * scale;
  const same = (p: Vec3, q: Vec3): boolean => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;

  const visited = new Set<string>();
  const loops: Vec3[][] = [];
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const chain: Vec3[] = [];
    let cur: string | undefined = start;
    let closed = false;
    while (cur !== undefined) {
      if (visited.has(cur)) { closed = cur === start; break; }
      visited.add(cur);
      chain.push(points.get(cur) as Vec3);
      cur = next.get(cur);
    }
    if (!closed) continue;
    // Drop zero-length steps (consecutive coincident points, cyclically).
    const loop: Vec3[] = [];
    for (const p of chain) if (loop.length === 0 || !same(loop[loop.length - 1], p)) loop.push(p);
    while (loop.length > 1 && same(loop[0], loop[loop.length - 1])) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  return { loops };
}

// ---- Plane charts and 2D helpers -------------------------------------------

/**
 * Orthonormal basis (u, v) of the plane with normal n such that u × v = n,
 * so counter-clockwise in (u, v) coordinates is counter-clockwise about n.
 * u is the coordinate axis least aligned with n, made orthogonal to it.
 */
export function planeBasis(normal: Vec3): [Vec3, Vec3] {
  const n = normalize3(normal);
  const axis = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]) < Math.abs(n[best]) ? k : best), 0);
  const seed: Vec3 = [0, 0, 0];
  seed[axis] = 1;
  const u = normalize3(sub3(seed, scale3(n, dot3(seed, n))));
  const v = cross3(n, u);
  return [u, v];
}

/** Project a planar loop onto the chart (q · u, q · v). */
export const projectLoop = (loop: readonly Vec3[], basis: readonly [Vec3, Vec3]): Vec2[] =>
  loop.map((q) => [dot3(q, basis[0]), dot3(q, basis[1])]);

/** Shoelace signed area: positive for counter-clockwise loops. */
export function signedArea2(loop: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Vector area ½ Σ q_i × q_{i+1} of a closed polyline in R^3: for a planar
 * loop its length is the enclosed area and its direction the normal about
 * which the loop runs counter-clockwise (independent of the origin).
 */
export function loopVectorArea(loop: readonly Vec3[]): Vec3 {
  let a: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) a = add3(a, cross3(loop[i], loop[(i + 1) % loop.length]));
  return scale3(a, 0.5);
}

/** Even–odd (ray casting) point-in-polygon test; points on the boundary are not guaranteed either way. */
export function pointInPolygon2(p: Vec2, loop: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface LoopGroup {
  /** Index of the outer loop. */
  outer: number;
  /** Indices of the holes directly inside it. */
  holes: number[];
  /** Nesting depth of the outer loop (0 for the outermost, 2 for an island in a hole, ...). */
  depth: number;
}

/** Distance from `p` to the closed polyline `loop` (to its nearest edge). */
function distanceToLoop2(p: Vec2, loop: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, ay] = loop[j];
    const dx = loop[i][0] - ax;
    const dy = loop[i][1] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}

/**
 * Whether `inner` lies inside `outer`, decided at the first vertex of `inner`
 * farther than `tol` from outer's boundary, where the parity test is
 * reliable (pointInPolygon2 says nothing about points on the boundary, and
 * two loops can share a vertex where the section pinches). False when every
 * vertex of `inner` lies on outer's boundary.
 */
function loopInside(inner: readonly Vec2[], outer: readonly Vec2[], tol: number): boolean {
  for (const p of inner) if (distanceToLoop2(p, outer) > tol) return pointInPolygon2(p, outer);
  return false;
}

/** Whether two loops consist of the same points up to `tol` (as sets, with equal counts). */
function coincidentLoops(a: readonly Vec2[], b: readonly Vec2[], tol: number): boolean {
  if (a.length !== b.length) return false;
  const box = (loop: readonly Vec2[]): number[] => loop.reduce(
    (acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const ba = box(a);
  const bb = box(b);
  if (ba.some((v, k) => Math.abs(v - bb[k]) > tol)) return false;
  const near = (p: Vec2, loop: readonly Vec2[]): boolean =>
    loop.some((q) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol);
  return a.every((p) => near(p, b)) && b.every((q) => near(q, a));
}

/**
 * Classify loops by nesting depth, the number of other loops containing the
 * loop (MATH.md §9.1 "nesting parity"): even depth is an outer loop, odd a
 * hole. Each hole is attached to the innermost (deepest) outer loop
 * containing it. A hole with no containing outer loop (only possible for
 * intersecting input) is promoted to an outer loop of its own.
 *
 * A pair of coincident loops bounds a region of zero area and is left out of
 * every group: a plane tangent to a ring of mesh vertices (the torus at
 * z = r) sections the solid, in the limit from below of MATH.md §6, in an
 * infinitely thin annulus, and planarSection returns both of its boundary
 * loops as the ring polygon, one wound each way. Nesting cannot tell which
 * is the hole, and the region between them is empty, so neither is used.
 * Coincidence is tested to 1e-9 of the loops' extent, which also covers
 * loops a plane within rounding of such a ring produces.
 */
export function groupLoops(loops: readonly (readonly Vec2[])[]): LoopGroup[] {
  let scale = 1;
  for (const loop of loops) for (const [x, y] of loop) scale = Math.max(scale, Math.abs(x), Math.abs(y));
  const tol = 1e-9 * scale;
  const dropped = new Uint8Array(loops.length);
  for (let i = 0; i < loops.length; i++) {
    if (dropped[i]) continue;
    for (let j = i + 1; j < loops.length; j++) {
      if (!dropped[j] && coincidentLoops(loops[i], loops[j], tol)) { dropped[i] = 1; dropped[j] = 1; break; }
    }
  }
  const depth = loops.map((loop, i) => {
    if (dropped[i]) return -1;
    let d = 0;
    for (let j = 0; j < loops.length; j++) if (j !== i && !dropped[j] && loopInside(loop, loops[j], tol)) d++;
    return d;
  });
  const groups: LoopGroup[] = [];
  depth.forEach((d, i) => {
    if (d >= 0 && d % 2 === 0) groups.push({ outer: i, holes: [], depth: d });
  });
  depth.forEach((d, i) => {
    if (d < 0 || d % 2 === 0) return;
    let best: LoopGroup | undefined;
    for (const g of groups) {
      if (g.depth < d && loopInside(loops[i], loops[g.outer], tol) && (!best || g.depth > best.depth)) best = g;
    }
    if (best) best.holes.push(i);
    else groups.push({ outer: i, holes: [], depth: d });
  });
  return groups;
}

// ---- Triangulation and area ------------------------------------------------

/**
 * Triangulate the region bounded by `loops` (as returned by planarSection):
 * project onto the plane chart, group outer loops with their holes, run
 * earcut on each group, and orient every triangle so that its normal
 * (v1 − v0) × (v2 − v0) points along `orientation` × normal. Zero-area
 * triangles, which cannot be oriented, are dropped. The result shares the
 * loops' points (`positions` is their concatenation) and is an open,
 * oriented triangle mesh of the cross-section. MATH.md §9.1
 */
export function triangulateSection(
  loops: readonly (readonly Vec3[])[],
  normal: Vec3,
  orientation: 1 | -1,
): Mesh3 {
  const n = normalize3(normal);
  const basis = planeBasis(n);
  const loops2 = loops.map((loop) => projectLoop(loop, basis));
  const offsets: number[] = [];
  const positions: Vec3[] = [];
  for (const loop of loops) {
    offsets.push(positions.length);
    for (const q of loop) positions.push([q[0], q[1], q[2]]);
  }
  const target = scale3(n, orientation);
  const triangles: Triangle[] = [];
  for (const group of groupLoops(loops2)) {
    const data: number[] = [];
    const holeStarts: number[] = [];
    const localToGlobal: number[] = [];
    const append = (li: number): void => {
      loops2[li].forEach(([x, y], j) => {
        data.push(x, y);
        localToGlobal.push(offsets[li] + j);
      });
    };
    append(group.outer);
    for (const h of group.holes) {
      holeStarts.push(localToGlobal.length);
      append(h);
    }
    const tris = earcut(data, holeStarts.length ? holeStarts : undefined, 2);
    for (let t = 0; t < tris.length; t += 3) {
      const a = localToGlobal[tris[t]];
      const b = localToGlobal[tris[t + 1]];
      const c = localToGlobal[tris[t + 2]];
      const side = dot3(cross3(sub3(positions[b], positions[a]), sub3(positions[c], positions[a])), target);
      if (side > 0) triangles.push([a, b, c]);
      else if (side < 0) triangles.push([a, c, b]);
    }
  }
  return { positions, triangles };
}

/**
 * Area of the region bounded by `loops`: for each nesting group the outer
 * loop's area minus its holes' areas, each taken as an absolute value so the
 * result does not depend on how the loops are wound. The plane normal is
 * taken from `normal` when given, otherwise from the vector area of the
 * largest loop (all loops are coplanar).
 */
export function sectionArea(loops: readonly (readonly Vec3[])[], normal?: Vec3): number {
  if (loops.length === 0) return 0;
  let n: Vec3;
  if (normal) {
    n = normalize3(normal);
  } else {
    let best: Vec3 = [0, 0, 0];
    let bestLen = 0;
    for (const loop of loops) {
      const a = loopVectorArea(loop);
      const l = length3(a);
      if (l > bestLen) { best = a; bestLen = l; }
    }
    if (bestLen === 0) return 0;
    n = scale3(best, 1 / bestLen);
  }
  const basis = planeBasis(n);
  const loops2 = loops.map((loop) => projectLoop(loop, basis));
  let area = 0;
  for (const group of groupLoops(loops2)) {
    let a = Math.abs(signedArea2(loops2[group.outer]));
    for (const h of group.holes) a -= Math.abs(signedArea2(loops2[h]));
    area += a;
  }
  return area;
}
