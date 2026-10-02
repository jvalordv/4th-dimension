import type { TriMesh3, Vec3 } from '../math/types';
import { cross3, dot3, length3, sub3 } from '../math/vec';

export const emptyMesh = (): TriMesh3 => ({
  positions: new Float32Array(0),
  indices: new Uint32Array(0),
  sourceW: new Float32Array(0),
});

export const triangleCount = (m: TriMesh3): number => m.indices.length / 3;

export function vertexAt(m: TriMesh3, i: number): Vec3 {
  return [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
}

/** Concatenate meshes (no welding). */
export function mergeMeshes(meshes: readonly TriMesh3[]): TriMesh3 {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(nv);
  const sourceW = new Float32Array(nv / 3);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo * 3);
    sourceW.set(m.sourceW, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, indices, sourceW };
}

/** Signed volume by the divergence theorem: Σ v0·(v1×v2)/6. Positive for outward CCW. */
export function signedVolume(m: TriMesh3): number {
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = vertexAt(m, m.indices[t]);
    const b = vertexAt(m, m.indices[t + 1]);
    const c = vertexAt(m, m.indices[t + 2]);
    v += dot3(a, cross3(b, c));
  }
  return v / 6;
}

export function surfaceArea(m: TriMesh3): number {
  let s = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = vertexAt(m, m.indices[t]);
    const b = vertexAt(m, m.indices[t + 1]);
    const c = vertexAt(m, m.indices[t + 2]);
    s += length3(cross3(sub3(b, a), sub3(c, a))) / 2;
  }
  return s;
}

/**
 * Weld vertices: each vertex is merged into the first earlier representative
 * within `tol` of it (searched over the 27 neighbouring grid cells, so points
 * straddling a cell boundary still merge). By default the merge is greedy,
 * not transitive: in a chain 0, 0.9·tol, 1.8·tol the last point stays
 * separate. What is guaranteed is that every vertex lies within tol of its
 * representative, so clusters have diameter ≤ 2·tol and points farther than
 * 2·tol apart are never merged. Coincident slice vertices differ only by
 * float32 rounding, far below tol, so this suffices for cleaning slices.
 *
 * With `transitive` the weld is the union-find closure of "within tol":
 * every chain merges, cluster diameter is unbounded in principle. Use it for
 * diagnostics (closedness checks), where a crack between two copies of one
 * point matters more than cluster size.
 */
export function weldVertices(m: TriMesh3, tol = 1e-6, transitive = false): TriMesh3 {
  if (transitive) return weldTransitive(m, tol);
  const buckets = new Map<string, number[]>();
  const remap = new Uint32Array(m.positions.length / 3);
  const positions: number[] = [];
  const sourceW: number[] = [];
  const inv = 1 / tol;
  const tol2 = tol * tol;
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[3 * i];
    const y = m.positions[3 * i + 1];
    const z = m.positions[3 * i + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const j of list) {
            const ex = positions[3 * j] - x;
            const ey = positions[3 * j + 1] - y;
            const ez = positions[3 * j + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) { found = j; break search; }
          }
        }
      }
    }
    if (found < 0) {
      found = positions.length / 3;
      positions.push(x, y, z);
      sourceW.push(m.sourceW[i] ?? 0);
      const key = `${cx},${cy},${cz}`;
      const list = buckets.get(key);
      if (list) list.push(found); else buckets.set(key, [found]);
    }
    remap[i] = found;
  }
  const indices = new Uint32Array(m.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[m.indices[i]];
  return { positions: Float32Array.from(positions), indices, sourceW: Float32Array.from(sourceW) };
}

function weldTransitive(m: TriMesh3, tol: number): TriMesh3 {
  const n = m.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const inv = 1 / tol;
  const tol2 = tol * tol;
  const buckets = new Map<string, number[]>();
  const cell = (i: number): [number, number, number] => [
    Math.floor(m.positions[3 * i] * inv), Math.floor(m.positions[3 * i + 1] * inv), Math.floor(m.positions[3 * i + 2] * inv),
  ];
  for (let i = 0; i < n; i++) {
    const key = cell(i).join(',');
    const list = buckets.get(key);
    if (list) list.push(i); else buckets.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz] = cell(i);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const j of list) {
        if (j <= i) continue;
        const ex = m.positions[3 * i] - m.positions[3 * j];
        const ey = m.positions[3 * i + 1] - m.positions[3 * j + 1];
        const ez = m.positions[3 * i + 2] - m.positions[3 * j + 2];
        if (ex * ex + ey * ey + ez * ez <= tol2) {
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  }
  // Representative = smallest index of each cluster; keep its coordinates.
  const remap = new Uint32Array(n);
  const newIndex = new Int32Array(n).fill(-1);
  const positions: number[] = [];
  const sourceW: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (newIndex[r] < 0) {
      newIndex[r] = positions.length / 3;
      positions.push(m.positions[3 * r], m.positions[3 * r + 1], m.positions[3 * r + 2]);
      sourceW.push(m.sourceW[r] ?? 0);
    }
    remap[i] = newIndex[r];
  }
  const indices = new Uint32Array(m.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[m.indices[i]];
  return { positions: Float32Array.from(positions), indices, sourceW: Float32Array.from(sourceW) };
}

/** Remove triangles with repeated vertex indices or area below `areaTol`. */
export function dropDegenerateTriangles(m: TriMesh3, areaTol = 1e-12): TriMesh3 {
  const kept: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = m.indices[t];
    const j = m.indices[t + 1];
    const k = m.indices[t + 2];
    if (i === j || j === k || i === k) continue;
    const a = vertexAt(m, i);
    const area2 = length3(cross3(sub3(vertexAt(m, j), a), sub3(vertexAt(m, k), a)));
    if (area2 / 2 <= areaTol) continue;
    kept.push(i, j, k);
  }
  return { positions: m.positions, indices: Uint32Array.from(kept), sourceW: m.sourceW };
}

export interface ManifoldReport {
  closed: boolean;
  consistent: boolean;
  edgeCount: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  /** V − E + F over vertices actually referenced by triangles. */
  euler: number;
}

/**
 * Check that every edge is shared by exactly two triangles traversed in
 * opposite directions. Expects a welded mesh with degenerate triangles
 * removed. MATH.md §6
 */
export function checkClosedOriented(m: TriMesh3): ManifoldReport {
  const dir = new Map<string, number>();
  const used = new Set<number>();
  const add = (a: number, b: number): void => {
    const key = `${a},${b}`;
    dir.set(key, (dir.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = m.indices[t];
    const j = m.indices[t + 1];
    const k = m.indices[t + 2];
    used.add(i); used.add(j); used.add(k);
    add(i, j); add(j, k); add(k, i);
  }
  const undirected = new Set<string>();
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const [key, count] of dir) {
    const [a, b] = key.split(',').map(Number);
    const ukey = a < b ? `${a},${b}` : `${b},${a}`;
    if (undirected.has(ukey)) continue;
    undirected.add(ukey);
    const rev = dir.get(`${b},${a}`) ?? 0;
    const total = count + rev;
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (count !== 1 || rev !== 1) inconsistentEdges++;
  }
  const F = m.indices.length / 3;
  const E = undirected.size;
  const V = used.size;
  return {
    closed: boundaryEdges === 0 && nonManifoldEdges === 0,
    consistent: inconsistentEdges === 0,
    edgeCount: E,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    euler: V - E + F,
  };
}

/**
 * Transitively weld, drop index-collapsed and exactly zero-area triangles,
 * then check closedness and orientation. Convenience for tests. No absolute
 * area threshold is used: a nearly parallel hyperplane legitimately produces
 * slivers of area far below any fixed tolerance, and dropping them opens
 * cracks that are not there.
 */
export function analyseSlice(m: TriMesh3, tol = 1e-6): ManifoldReport & { volume: number; triangles: number } {
  const clean = dropDegenerateTriangles(weldVertices(m, tol, true), 0);
  return { ...checkClosedOriented(clean), volume: signedVolume(clean), triangles: triangleCount(clean) };
}
