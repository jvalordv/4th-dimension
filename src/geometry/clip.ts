/**
 * Clipping a 3D solid by a plane (MATH.md §9.4): clip(S, m, k) = S ∩ { q :
 * m · q ≥ k } for the closed, outward-oriented triangle mesh M bounding S.
 * This is what makes a solid that crosses z = 0 spinnable (§9.2): the spin
 * lifting clips to z ≥ 0 first.
 *
 * Triangles are classified by the sign of s = m̂ · v − k̂ at their vertices
 * (m̂ = m/|m|, k̂ = k/|m|, so s is a true signed distance), zero counting as
 * positive exactly as in §6. Equivalently the solid is cut at k − ε: a plane
 * through vertices therefore always gives a closed result, at the price of
 * flat doubled polygons or an empty mesh at the supporting offsets of §6.
 * Mixed triangles are cut exactly, the crossing point of an edge being
 * created once per sorted edge key so that the triangles on both sides of the
 * edge share it, and the cut is closed by the planar section of S by the
 * plane (section.ts, §9.1) triangulated with normal −m.
 */
import type { Vec3 } from '../math/types';
import { add3, dot3, length3, scale3, sub3 } from '../math/vec';
import type { Mesh3, Triangle } from './mesh3';
import { loopCorners, conformTriangulationToLoops } from './extrude';
import { planarSectionFromDistances, triangulateSection } from './section';

/**
 * A vertex whose distance from the plane is at most this fraction of the
 * mesh's extent is taken to lie on the plane (s = 0, hence positive). Without
 * this a plane passing within rounding of a vertex (z = 1e-17 after a
 * rotation, say) would cut the edges at that vertex into clusters of points
 * 1e-17 apart, which no triangulation can orient reliably. 1e-9 is far above
 * Float64 rounding (≈ 1e-16) and far below any feature of a real mesh, and it
 * is the same threshold spin.ts uses to decide that a vertex is below z = 0.
 */
export const CLIP_SNAP = 1e-9;

/**
 * Corner tolerance for the cap triangulation, relative to the section's
 * extent: a loop point within this distance of the chord between its
 * neighbours is not given to earcut, which would emit zero-area slivers of
 * undefined orientation for it, and is put back by conformTriangulationToLoops
 * afterwards. It equals CLIP_SNAP so that no cluster of cut points that the
 * snapping lets through can collapse into a loop without corners.
 */
const CAP_CORNER_TOL = CLIP_SNAP;

const empty = (): Mesh3 => ({ positions: [], triangles: [] });

const copyMesh = (mesh: Mesh3): Mesh3 => ({
  positions: mesh.positions.map((p): Vec3 => [p[0], p[1], p[2]]),
  triangles: mesh.triangles.map((t): Triangle => [t[0], t[1], t[2]]),
});

/** Exact coordinate key: the shortest round-trip decimal of each Float64. */
const pointKey = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;

/**
 * Part of the solid bounded by `mesh` on the side { q : normal · q ≥ k } of
 * the plane, as a closed, consistently oriented mesh (MATH.md §9.4). `normal`
 * need not be unit; the plane and the kept side are unchanged by rescaling
 * (normal, k).
 *
 * - Every vertex on the kept side: the mesh is returned unchanged (a copy).
 * - Every vertex strictly on the removed side: the empty mesh.
 * - Otherwise: triangles with three kept vertices are copied; a triangle with
 *   one kept vertex gives one triangle and one with two gives a quad, split
 *   along its shorter diagonal, all with the parent's winding; triangles
 *   that collapse onto the plane (a repeated vertex) are dropped; the cap is
 *   the section of the solid by the plane, oriented with normal −normal.
 *   Vertices of the result are the kept vertices that are still used, in
 *   their original order, followed by the cut points in order of creation.
 *
 * At a plane through vertices the result is the limit from the removed side
 * (MATH.md §6): the part of a face lying in the plane is kept when the solid
 * is on the kept side of it, so clipping a box by z ≥ 1 (its top face)
 * returns the doubled top square, closed with volume 0, and a plane touching
 * a ball in a single vertex returns the empty mesh. Vertices within
 * CLIP_SNAP·(extent of the mesh) of the plane are treated as on it.
 *
 * Cost O(T + L²) for T triangles and loops of L points (the nesting test of
 * section.ts is quadratic in the loop length).
 */
export function clipMesh3(mesh: Mesh3, normal: Vec3, k: number): Mesh3 {
  const len = length3(normal);
  if (!(len > 0)) throw new Error('clipMesh3: zero normal');
  const m = scale3(normal, 1 / len);
  const offset = k / len;

  const P = mesh.positions;
  const nv = P.length;
  const s = new Float64Array(nv);
  let extent = Math.abs(offset);
  for (let i = 0; i < nv; i++) {
    s[i] = dot3(m, P[i]) - offset;
    extent = Math.max(extent, Math.abs(P[i][0]), Math.abs(P[i][1]), Math.abs(P[i][2]));
  }
  const snap = CLIP_SNAP * extent;
  let positives = 0;
  for (let i = 0; i < nv; i++) {
    if (Math.abs(s[i]) <= snap) s[i] = 0;
    if (s[i] >= 0) positives++;
  }
  if (positives === nv) return copyMesh(mesh);
  if (positives === 0) return empty();

  // ---- Side: kept triangles and cut pieces --------------------------------
  const positions: Vec3[] = [];
  const kept = new Int32Array(nv).fill(-1); // input vertex → output index
  const vertex = (i: number): number => {
    if (kept[i] < 0) {
      kept[i] = positions.length;
      positions.push([P[i][0], P[i][1], P[i][2]]);
    }
    return kept[i];
  };
  /** Output vertices that lie on the plane, by exact coordinates: where the cap finds them. */
  const onPlane = new Map<string, number>();
  const cuts = new Map<string, number>(); // sorted edge key → output index
  /**
   * Crossing of the edge (i, j) whose endpoints are in different classes.
   * Created once per edge. Same arithmetic as planarSectionFromDistances
   * (lower index first, MATH.md §6's t = s_lo / (s_lo − s_hi)), so that the
   * cap's loop points are bit-identical to these vertices. An endpoint with
   * s = 0 is the crossing itself (t = 0 or 1): the vertex, not a copy.
   */
  const cross = (i: number, j: number): number => {
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const key = `${lo},${hi}`;
    const found = cuts.get(key);
    if (found !== undefined) return found;
    let idx: number;
    if (s[lo] === 0) idx = vertex(lo);
    else if (s[hi] === 0) idx = vertex(hi);
    else {
      const t = s[lo] / (s[lo] - s[hi]);
      idx = positions.length;
      positions.push(add3(P[lo], scale3(sub3(P[hi], P[lo]), t)));
    }
    cuts.set(key, idx);
    onPlane.set(pointKey(positions[idx]), idx);
    return idx;
  };

  const triangles: Triangle[] = [];
  const push = (a: number, b: number, c: number): void => {
    if (a !== b && b !== c && c !== a) triangles.push([a, b, c]);
  };
  const dist2 = (a: number, b: number): number => {
    const d = sub3(positions[a], positions[b]);
    return dot3(d, d);
  };

  for (const [a, b, c] of mesh.triangles) {
    const pa = s[a] >= 0;
    const pb = s[b] >= 0;
    const pc = s[c] >= 0;
    const count = (pa ? 1 : 0) + (pb ? 1 : 0) + (pc ? 1 : 0);
    if (count === 0) continue;
    if (count === 3) { push(vertex(a), vertex(b), vertex(c)); continue; }
    // Cyclic order (lone, u, v) starting at the vertex alone in its class.
    const loneIsPositive = count === 1;
    let lone: number;
    let u: number;
    let v: number;
    if (pa === loneIsPositive) { lone = a; u = b; v = c; }
    else if (pb === loneIsPositive) { lone = b; u = c; v = a; }
    else { lone = c; u = a; v = b; }
    const onU = cross(lone, u);
    const onV = cross(lone, v);
    if (loneIsPositive) {
      push(vertex(lone), onU, onV);
    } else {
      // Kept polygon in cyclic order: onU, u, v, onV (u and v are both kept).
      const iu = vertex(u);
      const iv = vertex(v);
      if (dist2(onU, iv) <= dist2(iu, onV)) {
        push(onU, iu, iv);
        push(onU, iv, onV);
      } else {
        push(onU, iu, onV);
        push(iu, iv, onV);
      }
    }
  }

  // ---- Cap: the planar section, triangulated with normal −m ---------------
  const { loops } = planarSectionFromDistances(mesh, s);
  if (loops.length > 0) {
    let extentLoops = 0;
    for (const loop of loops) for (const q of loop) extentLoops = Math.max(extentLoops, Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2]));
    const tol = CAP_CORNER_TOL * extentLoops;
    // As triangulateLoopsConforming (extrude.ts), without its Float32-sized
    // merging of nearby points: every loop point is a vertex of the side
    // mesh, so the cap must use every one of them.
    const flat: Vec3[] = [];
    const cornerLoops: Vec3[][] = [];
    const fullIndex: number[] = [];
    for (const loop of loops) {
      const offsetInFlat = flat.length;
      for (const q of loop) flat.push(q);
      const corners = loopCorners(loop, tol);
      if (corners.length >= 3) {
        cornerLoops.push(corners.map((j) => loop[j]));
        for (const j of corners) fullIndex.push(offsetInFlat + j);
      }
    }
    if (cornerLoops.length > 0) {
      const tri = triangulateSection(cornerLoops, m, -1);
      const mapped: Triangle[] = tri.triangles.map(([a, b, c]) => [fullIndex[a], fullIndex[b], fullIndex[c]]);
      const cap = conformTriangulationToLoops({ positions: flat, triangles: mapped }, loops);
      const outIndex = flat.map((q) => {
        const found = onPlane.get(pointKey(q));
        if (found !== undefined) return found;
        // Cannot happen (both sides evaluate the same expression); keep the
        // cap watertight in shape if it ever does rather than losing it.
        positions.push([q[0], q[1], q[2]]);
        return positions.length - 1;
      });
      for (const [a, b, c] of cap) push(outIndex[a], outIndex[b], outIndex[c]);
    }
  }

  return compact({ positions, triangles });
}

/** Drop vertices no triangle uses, keeping the order of the rest. */
function compact(mesh: Mesh3): Mesh3 {
  const used = new Uint8Array(mesh.positions.length);
  for (const [a, b, c] of mesh.triangles) { used[a] = 1; used[b] = 1; used[c] = 1; }
  const remap = new Int32Array(used.length).fill(-1);
  const positions: Vec3[] = [];
  used.forEach((u, i) => {
    if (u) { remap[i] = positions.length; positions.push(mesh.positions[i]); }
  });
  return {
    positions,
    triangles: mesh.triangles.map(([a, b, c]): Triangle => [remap[a], remap[b], remap[c]]),
  };
}
