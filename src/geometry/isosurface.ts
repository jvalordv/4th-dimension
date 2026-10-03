/**
 * Isosurface extraction (MATH.md §9.3): marching tetrahedra on a 3D grid for
 * the direct slice, and marching pentatopes on a 4D grid for the extracted
 * tet complex. Both split every grid cell by the Kuhn/Freudenthal rule,
 * classify corners with zero counted positive (§6), place crossing points by
 * linear interpolation and share them by grid-edge key, so the output is
 * watertight by construction (no position welding is needed).
 *
 * Conventions shared by both extractors:
 *
 *  - Sign: g ≥ 0 is positive ("outside"), g < 0 negative. Zero is positive,
 *    the symbolic perturbation of §6: every grid vertex has exactly one
 *    class, so the output is closed even when the surface passes exactly
 *    through grid vertices.
 *  - Orientation: every triangle (tet) is oriented so its normal
 *    (cross4 of its edges) points toward the positive corners. The tables
 *    below are derived once, at module load, from a reference simplex with
 *    exact (dyadic) coordinates; orientation is then a pure function of the
 *    sign pattern and the simplex's vertex order, never of floating-point
 *    geometry, so even zero-area output is consistently oriented.
 *  - Crossing points: the edge (a, b) with g_a ≥ 0 > g_b crosses at
 *    a + t (b − a), t = g_a / (g_a − g_b) ∈ [0, 1). If g_a = 0 the crossing
 *    is the grid vertex a itself and is keyed by the vertex, so all edges
 *    through that vertex share one output vertex instead of leaving several
 *    coincident copies. A crossing within CROSSING_SNAP = 2% of an edge end is
 *    moved onto that end (snapNearZeros): the surface moves by 2% of a cell
 *    at most, and the rounding noise of a surface through grid vertices
 *    becomes exact zeros. Simplices that collapse (two corners with the same output
 *    vertex) are dropped; this keeps the output closed and consistently
 *    oriented (dropping the degenerate triangle (a, a, b) removes an edge
 *    a→b and b→a that its neighbours then share directly).
 */
import type { Tet, TetComplex, TriMesh3, Vec3, Vec4 } from '../math/types';
import { cross4 } from '../math/vec';
import type { Sdf4 } from './sdf';
import { emptyMesh } from './trimesh';

// ---- Shared helpers --------------------------------------------------------

/** Parity (0 even, 1 odd) of a permutation of 0..n-1. */
function permutationParity(perm: readonly number[]): number {
  let inversions = 0;
  for (let i = 0; i < perm.length; i++) for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) inversions++;
  return inversions & 1;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) { out.push(prefix); return; }
    for (let i = 0; i < rest.length; i++) rec([...prefix, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/** Cells per axis from a scalar or per-axis resolution; each must be a positive integer. */
function cellCounts(resolution: number | readonly number[], n: number): number[] {
  const res = typeof resolution === 'number' ? new Array<number>(n).fill(resolution) : [...resolution];
  if (res.length !== n) throw new RangeError(`resolution must be a number or ${n} numbers`);
  for (const r of res) {
    if (!Number.isInteger(r) || r < 1) throw new RangeError(`resolution must be positive integers, got ${r}`);
  }
  return res;
}

/** Vertex coordinates min + i h along one axis, with the last exactly `max`. */
function axisCoordinates(lo: number, hi: number, n: number): Float64Array {
  if (!(hi > lo)) throw new RangeError(`grid bounds must satisfy min < max, got [${lo}, ${hi}]`);
  const h = (hi - lo) / n;
  const out = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) out[i] = lo + i * h;
  out[n] = hi;
  return out;
}

/**
 * Fraction of an edge under which a crossing is moved onto the nearer grid
 * vertex: a crossing at t < CROSSING_SNAP (or t > 1 − CROSSING_SNAP) of an
 * edge becomes that vertex itself. The surface moves by at most 2% of an
 * edge, 4% of the crossings are affected, with either sign, so the volume
 * changes by far less than the interpolation error floor (the measured
 * hypervolume errors of the 4-ball agree to 5 digits with and without the
 * snap). In return no output vertex is closer than about 0.01 of a cell to
 * another, no tet is thinner than about (0.02 h)³ (so the default tolerance
 * of validateTetComplex accepts the output at every resolution tried), and
 * the transitive position weld of analyseSlice cannot merge distinct vertices.
 */
export const CROSSING_SNAP = 2e-2;
const SNAP = CROSSING_SNAP;

/**
 * Snap grid values that are zero up to rounding, or that would put a
 * crossing within SNAP of an edge end, to exactly 0.
 *
 * Where the surface passes through grid vertices (a ball whose radius is a
 * multiple of the spacing, a box with grid-aligned faces) the sampled value
 * is ±1e-16 noise, whose sign would otherwise be arbitrary and which would
 * produce crossings a rounding error apart (zero-volume sliver tets). Where
 * it passes merely close to a vertex, the same happens at a larger scale:
 * crossings a few 1e-7 apart, slivers, and vertices closer together than a
 * position weld tolerance (the transitive 1e-6 weld of analyseSlice would
 * merge them and break the topology).
 *
 * A vertex v is snapped when |g_v| < SNAP · |g_n| for some neighbour n (along
 * any Freudenthal edge) of opposite sign, i.e. when the crossing on the edge
 * vn would lie within SNAP of v. Snapping changes only the value at v to 0,
 * a single consistent perturbation of the sampled field (zero counts as
 * positive), so every guarantee below holds for the perturbed values. The
 * decision uses the original values of the neighbours, not the snapped ones.
 * Only vertices with |g_v| ≤ SNAP · max|g| can qualify, so the neighbour scan
 * touches the few vertices next to the surface within SNAP of it.
 *
 * `dims` are the vertex counts per axis (length 3 or 4), x fastest.
 */
function snapNearZeros(vals: Float64Array, dims: readonly number[]): void {
  let top = 0;
  for (let i = 0; i < vals.length; i++) {
    const a = Math.abs(vals[i]);
    if (a > top && a < Infinity) top = a;
  }
  const limit = SNAP * top;
  const d = dims.length;
  const stride = new Array<number>(d);
  stride[0] = 1;
  for (let k = 1; k < d; k++) stride[k] = stride[k - 1] * dims[k - 1];
  const delta: number[] = [];
  const bitsList: number[] = [];
  for (let mask = 1; mask < 1 << d; mask++) {
    let step = 0;
    for (let k = 0; k < d; k++) if ((mask >> k) & 1) step += stride[k];
    delta.push(step);
    bitsList.push(mask);
  }
  const snap: number[] = [];
  const coord = new Array<number>(d);
  for (let v = 0; v < vals.length; v++) {
    const gv = vals[v];
    if (!(Math.abs(gv) <= limit) || gv === 0) continue;
    let rest = v;
    for (let k = 0; k < d; k++) { coord[k] = rest % dims[k]; rest = (rest - coord[k]) / dims[k]; }
    const positive = gv >= 0;
    let m = 0;
    for (let q = 0; q < delta.length; q++) {
      const mask = bitsList[q];
      let fwd = true;
      let bwd = true;
      for (let k = 0; k < d; k++) {
        if (!((mask >> k) & 1)) continue;
        if (coord[k] + 1 >= dims[k]) fwd = false;
        if (coord[k] - 1 < 0) bwd = false;
      }
      if (fwd) { const gn = vals[v + delta[q]]; if ((gn >= 0) !== positive) m = Math.max(m, Math.abs(gn)); }
      if (bwd) { const gn = vals[v - delta[q]]; if ((gn >= 0) !== positive) m = Math.max(m, Math.abs(gn)); }
    }
    if (Math.abs(gv) < SNAP * m) snap.push(v);
  }
  for (const v of snap) vals[v] = 0;
}

/** Growable typed buffers for the output. */
class Float32Builder {
  data: Float32Array;
  length = 0;
  constructor(capacity: number) { this.data = new Float32Array(capacity); }
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) this.grow();
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  push(a: number): void {
    if (this.length + 1 > this.data.length) this.grow();
    this.data[this.length++] = a;
  }
  private grow(): void {
    const next = new Float32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }
  finish(): Float32Array { return this.data.slice(0, this.length); }
}

class Uint32Builder {
  data: Uint32Array;
  length = 0;
  constructor(capacity: number) { this.data = new Uint32Array(capacity); }
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  finish(): Uint32Array { return this.data.slice(0, this.length); }
}

// ---- 3D tables: Kuhn split of the cube into six tets ------------------------

/** Unordered pairs of the four tet labels, in the order used by every 3D table. */
const PAIRS3: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const pairIndex3 = (i: number, j: number): number => PAIRS3.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));

/**
 * Cube corner ids are x + 2y + 4z. The Kuhn tets are the chains
 * 0 → e_σ1 → e_σ1 + e_σ2 → 7 over the six permutations σ of the axes; each
 * has volume 1/6 with orientation sign = parity of σ (the determinant of
 * (e_σ1, e_σ2, e_σ3)), so odd chains swap their last two corners to become
 * positively oriented. Layout: TET3_CORNERS[4t..4t+3] are the corner ids by
 * label, in positive orientation.
 */
const TET3_CORNERS = (() => {
  const out = new Int8Array(6 * 4);
  permutations(3).forEach((s, t) => {
    const c1 = 1 << s[0];
    const c2 = c1 | (1 << s[1]);
    const chain = [0, c1, c2, 7];
    if (permutationParity(s)) { chain[2] = 7; chain[3] = c2; }
    for (let q = 0; q < 4; q++) out[4 * t + q] = chain[q];
  });
  return out;
})();

/**
 * Per tet and per label pair e: the lower corner A (bits ⊂ those of B, since
 * the corners form a chain) and upper corner B of the cube edge, the same
 * for every cube; `slot` = A xor B ∈ 1..7 names the edge type at A.
 */
const EDGE3_A = new Int8Array(6 * 6);
const EDGE3_B = new Int8Array(6 * 6);
for (let t = 0; t < 6; t++) {
  PAIRS3.forEach(([i, j], e) => {
    const ci = TET3_CORNERS[4 * t + i];
    const cj = TET3_CORNERS[4 * t + j];
    const iLower = (ci & cj) === ci;
    EDGE3_A[6 * t + e] = iLower ? ci : cj;
    EDGE3_B[6 * t + e] = iLower ? cj : ci;
  });
}

/**
 * TRI3[mask]: the output triangles, as flat triples of tet-edge labels, for
 * the tet whose label i is positive iff bit i of mask is set (masks 1..14).
 * Cases per §6: one positive or one negative corner, one triangle on the
 * three edges at that corner; two and two, the quad ac, ad, bd, bc cut into
 * the triangles (ac, ad, bd) and (ac, bd, bc). Each triangle is oriented on
 * the reference tet (0,0,0), e_x, e_y, e_z (positive orientation) so that its
 * normal points toward the positive corners' centroid.
 */
const TRI3: Int8Array[] = (() => {
  const ref: number[][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const mid = (i: number, j: number): number[] => [0, 1, 2].map((k) => (ref[i][k] + ref[j][k]) / 2);
  const table: Int8Array[] = [new Int8Array(0)];
  for (let mask = 1; mask <= 15; mask++) {
    const pos = [0, 1, 2, 3].filter((i) => (mask >> i) & 1);
    const neg = [0, 1, 2, 3].filter((i) => !((mask >> i) & 1));
    if (pos.length === 0 || pos.length === 4) { table.push(new Int8Array(0)); continue; }
    const tris: Array<Array<[number, number]>> = [];
    if (pos.length === 1) tris.push(neg.map((q) => [pos[0], q] as [number, number]));
    else if (pos.length === 3) tris.push(pos.map((p) => [p, neg[0]] as [number, number]));
    else {
      const [a, b] = pos;
      const [c, d] = neg;
      tris.push([[a, c], [a, d], [b, d]], [[a, c], [b, d], [b, c]]);
    }
    const centroid = [0, 1, 2].map((k) => pos.reduce((s, i) => s + ref[i][k], 0) / pos.length);
    const flat: number[] = [];
    for (const tri of tris) {
      const m = tri.map(([i, j]) => mid(i, j));
      const u = [m[1][0] - m[0][0], m[1][1] - m[0][1], m[1][2] - m[0][2]];
      const v = [m[2][0] - m[0][0], m[2][1] - m[0][1], m[2][2] - m[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const toPos = [centroid[0] - m[0][0], centroid[1] - m[0][1], centroid[2] - m[0][2]];
      const s = n[0] * toPos[0] + n[1] * toPos[1] + n[2] * toPos[2];
      const labels = tri.map(([i, j]) => pairIndex3(i, j));
      flat.push(labels[0], s > 0 ? labels[1] : labels[2], s > 0 ? labels[2] : labels[1]);
    }
    table.push(Int8Array.from(flat));
  }
  return table;
})();

// ---- marchingTets3 -----------------------------------------------------------

/**
 * Marching tetrahedra on a regular grid (MATH.md §9.3). `g` is evaluated once
 * per grid vertex; `resolution` is the number of cells per axis (a number or
 * one per axis). Each cube is split into six Kuhn tets sharing the main
 * diagonal, so the diagonals of neighbouring cubes' shared faces agree.
 *
 * Returns the zero set of g as a triangle mesh whose normals point toward
 * the positive (g ≥ 0, outside) corners, with vertices shared by grid edge,
 * so a surface that stays inside the grid is closed and consistently
 * oriented as it is (checkClosedOriented without welding). `attribute`, when
 * given, is evaluated at each output vertex and stored in sourceW (§10);
 * otherwise sourceW is 0.
 *
 * Cost: one g evaluation per grid vertex, ((nx+1)(ny+1)(nz+1) of them), and
 * work per cube only where its corners disagree in sign.
 */
export function marchingTets3(
  g: (q: Vec3) => number,
  min: Vec3,
  max: Vec3,
  resolution: number | [number, number, number],
  attribute?: (q: Vec3) => number,
): TriMesh3 {
  const [nx, ny, nz] = cellCounts(resolution, 3);
  const xs = axisCoordinates(min[0], max[0], nx);
  const ys = axisCoordinates(min[1], max[1], ny);
  const zs = axisCoordinates(min[2], max[2], nz);
  const sx = nx + 1;
  const sxy = sx * (ny + 1);
  const nVerts = sxy * (nz + 1);

  const vals = new Float64Array(nVerts);
  let at = 0;
  for (let k = 0; k <= nz; k++) {
    const z = zs[k];
    for (let j = 0; j <= ny; j++) {
      const y = ys[j];
      for (let i = 0; i <= nx; i++) vals[at++] = g([xs[i], y, z]);
    }
  }
  snapNearZeros(vals, [sx, ny + 1, nz + 1]);

  // Output vertex id per (grid vertex, slot): slot 0 is the vertex itself,
  // slots 1..7 the edges leaving it in directions given by the slot's bits.
  const cache = new Int32Array(nVerts * 8).fill(-1);
  const off = new Int32Array(8);
  for (let c = 0; c < 8; c++) off[c] = (c & 1) + sx * ((c >> 1) & 1) + sxy * (c >> 2);

  const positions = new Float32Builder(3 * 1024);
  const sourceW = new Float32Builder(1024);
  const triangles = new Uint32Builder(3 * 2048);
  let vertexCount = 0;
  const corner = new Float64Array(8);
  let base = 0;
  let ci = 0;
  let cj = 0;
  let ck = 0;

  const emitVertex = (x: number, y: number, z: number): number => {
    positions.push3(x, y, z);
    sourceW.push(attribute ? attribute([x, y, z]) : 0);
    return vertexCount++;
  };

  /** Output vertex on label edge e of tet t of the current cube. */
  const crossing = (t: number, e: number): number => {
    const a = EDGE3_A[6 * t + e];
    const b = EDGE3_B[6 * t + e];
    const key = (base + off[a]) * 8 + (a ^ b);
    let id = cache[key];
    if (id >= 0) return id;
    const ga = corner[a];
    const gb = corner[b];
    const ia = ci + (a & 1);
    const ja = cj + ((a >> 1) & 1);
    const ka = ck + (a >> 2);
    const positive = ga >= 0 ? a : b;
    if ((ga >= 0 ? ga : gb) === 0) {
      // The surface passes exactly through the positive endpoint: key it by the vertex.
      const vkey = (base + off[positive]) * 8;
      id = cache[vkey];
      if (id < 0) {
        id = emitVertex(xs[ci + (positive & 1)], ys[cj + ((positive >> 1) & 1)], zs[ck + (positive >> 2)]);
        cache[vkey] = id;
      }
    } else {
      const s = ga / (ga - gb);
      const ib = ci + (b & 1);
      const jb = cj + ((b >> 1) & 1);
      const kb = ck + (b >> 2);
      id = emitVertex(
        xs[ia] + s * (xs[ib] - xs[ia]),
        ys[ja] + s * (ys[jb] - ys[ja]),
        zs[ka] + s * (zs[kb] - zs[ka]),
      );
    }
    cache[key] = id;
    return id;
  };

  for (ck = 0; ck < nz; ck++) {
    for (cj = 0; cj < ny; cj++) {
      for (ci = 0; ci < nx; ci++) {
        base = ci + sx * cj + sxy * ck;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[base + off[c]];
          corner[c] = v;
          if (v >= 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        for (let t = 0; t < 6; t++) {
          const tm = ((mask >> TET3_CORNERS[4 * t]) & 1) |
            (((mask >> TET3_CORNERS[4 * t + 1]) & 1) << 1) |
            (((mask >> TET3_CORNERS[4 * t + 2]) & 1) << 2) |
            (((mask >> TET3_CORNERS[4 * t + 3]) & 1) << 3);
          if (tm === 0 || tm === 15) continue;
          const tris = TRI3[tm];
          for (let q = 0; q < tris.length; q += 3) {
            const a = crossing(t, tris[q]);
            const b = crossing(t, tris[q + 1]);
            const c = crossing(t, tris[q + 2]);
            if (a !== b && b !== c && a !== c) triangles.push3(a, b, c);
          }
        }
      }
    }
  }

  if (vertexCount === 0 || triangles.length === 0) return emptyMesh();
  return { positions: positions.finish(), indices: triangles.finish(), sourceW: sourceW.finish() };
}

// ---- 4D tables: Freudenthal split of the hypercube into 24 pentatopes --------

/** Unordered pairs of the five pentatope labels, in the order used by every 4D table. */
const PAIRS4: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
const pairIndex4 = (i: number, j: number): number => PAIRS4.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));

/**
 * Hypercube corner ids are x + 2y + 4z + 8w. The 24 pentatopes are the chains
 * 0 → e_σ1 → ... → 15 over the permutations σ of the axes (§9.3). Their
 * orientation sign is the parity of σ; odd chains swap their last two
 * corners. PENTA_CORNERS[5p..5p+4] are the corner ids by label.
 */
const PENTA_CORNERS = (() => {
  const out = new Int8Array(24 * 5);
  permutations(4).forEach((s, p) => {
    const chain = [0];
    for (let q = 0; q < 3; q++) chain.push(chain[q] | (1 << s[q]));
    chain.push(15);
    if (permutationParity(s)) { const tmp = chain[3]; chain[3] = chain[4]; chain[4] = tmp; }
    for (let q = 0; q < 5; q++) out[5 * p + q] = chain[q];
  });
  return out;
})();

/** Lower and upper hypercube corner of each pentatope edge (see EDGE3_A). */
const EDGE4_A = new Int8Array(24 * 10);
const EDGE4_B = new Int8Array(24 * 10);
for (let p = 0; p < 24; p++) {
  PAIRS4.forEach(([i, j], e) => {
    const ci = PENTA_CORNERS[5 * p + i];
    const cj = PENTA_CORNERS[5 * p + j];
    const iLower = (ci & cj) === ci;
    EDGE4_A[10 * p + e] = iLower ? ci : cj;
    EDGE4_B[10 * p + e] = iLower ? cj : ci;
  });
}

type Pt4 = [number, number, number, number];

/**
 * Orientation tables on the reference pentatope 0, e_1, e_2, e_3, e_4 (positive
 * orientation, determinant +1). Edge crossings sit at the edge midpoints,
 * exact in floating point, so every sign below is exact. For a tuple of
 * crossing edges (m_a, m_b, m_c, m_d) the sign is that of
 * cross4(m_b − m_a, m_c − m_a, m_d − m_a) · (P − m_a), P the centroid of the
 * positive corners: +1 when the tuple, in this order, is oriented toward the
 * positives.
 *
 * For a general positively oriented pentatope the same sign holds: the
 * crossing points of the linear interpolant all lie in the hyperplane
 * {g = 0}, where the six prism points (or four tet points) keep their
 * combinatorial type for every crossing fraction in (0, 1), and the 4D
 * cross product transforms by the cofactor matrix, which preserves the
 * sign of its dot with a vector under an orientation-preserving affine map.
 */
const REF4: Pt4[] = [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const MID4: Pt4[] = PAIRS4.map(([i, j]) => [0, 1, 2, 3].map((k) => (REF4[i][k] + REF4[j][k]) / 2) as Pt4);

function orientationSign4(mask: number, a: number, b: number, c: number, d: number): number {
  const pos = [0, 1, 2, 3, 4].filter((i) => (mask >> i) & 1);
  const centroid = [0, 1, 2, 3].map((k) => pos.reduce((s, i) => s + REF4[i][k], 0) / pos.length);
  const ma = MID4[a];
  const sub = (p: Pt4): Vec4 => [p[0] - ma[0], p[1] - ma[1], p[2] - ma[2], p[3] - ma[3]];
  const n = cross4(sub(MID4[b]), sub(MID4[c]), sub(MID4[d]));
  const s = n[0] * (centroid[0] - ma[0]) + n[1] * (centroid[1] - ma[1]) + n[2] * (centroid[2] - ma[2]) + n[3] * (centroid[3] - ma[3]);
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

/**
 * Single-tet cases (one positive or one negative corner): SINGLE4[mask] holds
 * the four pentatope-edge labels of the tet, already ordered outward.
 * Prism cases (two or three positive corners): PRISM4[mask] holds the six
 * edge labels of the prism vertices, indexed L = 2i + s with i ∈ 0..2 the
 * position along the triangle and s ∈ 0..1 the end: for two positives
 * {a, b} and negatives {n_0, n_1, n_2}, L = 2i + s is the crossing of
 * (pos_s, n_i); for three positives and negatives {n_0, n_1} it is the
 * crossing of (p_i, n_s). The triangle ends are (L = 0, 2, 4) and (1, 3, 5)
 * (the §9.3 triangles (ac, ad, ae) and (bc, bd, be)). ORIENT4[mask] is the
 * sign table of ordered 4-tuples of prism vertices, index
 * ((a·6 + b)·6 + c)·6 + d.
 */
const SINGLE4: Int8Array[] = [];
const PRISM4: Int8Array[] = [];
const ORIENT4: Int8Array[] = [];
for (let mask = 0; mask < 32; mask++) {
  SINGLE4.push(new Int8Array(0));
  PRISM4.push(new Int8Array(0));
  ORIENT4.push(new Int8Array(0));
  const pos = [0, 1, 2, 3, 4].filter((i) => (mask >> i) & 1);
  const neg = [0, 1, 2, 3, 4].filter((i) => !((mask >> i) & 1));
  if (pos.length === 0 || pos.length === 5) continue;
  if (pos.length === 1 || pos.length === 4) {
    const labels = pos.length === 1
      ? neg.map((q) => pairIndex4(pos[0], q))
      : pos.map((p) => pairIndex4(p, neg[0]));
    const s = orientationSign4(mask, labels[0], labels[1], labels[2], labels[3]);
    SINGLE4[mask] = Int8Array.from(s > 0 ? labels : [labels[0], labels[2], labels[1], labels[3]]);
    continue;
  }
  const prism: number[] = [];
  if (pos.length === 2) {
    for (let i = 0; i < 3; i++) for (let s = 0; s < 2; s++) prism.push(pairIndex4(pos[s], neg[i]));
  } else {
    for (let i = 0; i < 3; i++) for (let s = 0; s < 2; s++) prism.push(pairIndex4(pos[i], neg[s]));
  }
  PRISM4[mask] = Int8Array.from(prism);
  const orient = new Int8Array(6 * 6 * 6 * 6);
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) for (let d = 0; d < 6; d++) {
    if (new Set([a, b, c, d]).size < 4) continue;
    orient[((a * 6 + b) * 6 + c) * 6 + d] = orientationSign4(mask, prism[a], prism[b], prism[c], prism[d]);
  }
  ORIENT4[mask] = orient;
}

// ---- marchingPentatopes --------------------------------------------------------

/** Largest edge-cache size (entries) before extraction refuses: 2^27 Int32 = 512 MB. */
const MAX_CACHE_ENTRIES = 2 ** 27;

/**
 * Marching pentatopes on a 4D grid: the zero set of f as a tet complex
 * (MATH.md §9.3). Each hypercube is split into the 24 Freudenthal
 * pentatopes (chains of corners over axis permutations), whose faces agree
 * with those of neighbouring hypercubes. Per pentatope, by the number of
 * positive corners:
 *
 *  - 0 or 5: nothing;
 *  - 1 or 4: one tet on the four crossing points;
 *  - 2 or 3: a triangular prism on six crossing points, split into three
 *    tets. The split is the pulling triangulation by the global order of
 *    output-vertex ids: cone the lowest prism vertex over the faces that do
 *    not contain it, cutting the remaining quad along its lowest vertex.
 *    Every quad is thus cut along the diagonal through its lowest vertex,
 *    which is a function of the quad's four vertices alone, so the two
 *    pentatopes that share a quad face make the same cut and the complex is
 *    closed. (A fixed local rule would not be: the two pentatopes see the
 *    quad's corners in different local orders.)
 *
 * Every tet is oriented so cross4 of its edges points toward the positive
 * (f ≥ 0, outside) corners; the result passes validateTetComplex, its signed
 * hypervolume converges to the volume of {f < 0}, and it feeds the same
 * slicer, hypervolume and wire machinery as every other shape.
 *
 * Crossings within CROSSING_SNAP of a grid vertex are moved onto it and the
 * tets that collapse are dropped, so the complex has no sliver tets thinner
 * than about (0.02 h)³ and validateTetComplex's default tolerance accepts it;
 * flat tets can still arise from grid-aligned structure (a box with faces on
 * grid planes), in which case pass `allowDegenerate: true` (§5.2).
 *
 * `resolution` is the number of cells per axis (a number or one per axis);
 * f is evaluated once per grid vertex, (n+1)^4 times. Memory is dominated by
 * a 16-slot edge cache per vertex (64 bytes), so practical resolutions are
 * up to about 40 (a 41^4 grid needs 180 MB); larger grids throw a RangeError.
 * The solid must stay inside [min, max] for the complex to be closed.
 */
export function marchingPentatopes(
  f: Sdf4,
  min: Vec4,
  max: Vec4,
  resolution: number | [number, number, number, number],
): TetComplex {
  const [nx, ny, nz, nw] = cellCounts(resolution, 4);
  const xs = axisCoordinates(min[0], max[0], nx);
  const ys = axisCoordinates(min[1], max[1], ny);
  const zs = axisCoordinates(min[2], max[2], nz);
  const ws = axisCoordinates(min[3], max[3], nw);
  const sx = nx + 1;
  const sxy = sx * (ny + 1);
  const sxyz = sxy * (nz + 1);
  const nVerts = sxyz * (nw + 1);
  if (nVerts * 16 > MAX_CACHE_ENTRIES) {
    throw new RangeError(`marchingPentatopes: ${nVerts} grid vertices exceed the supported grid size`);
  }

  const vals = new Float64Array(nVerts);
  let at = 0;
  for (let l = 0; l <= nw; l++) {
    const w = ws[l];
    for (let k = 0; k <= nz; k++) {
      const z = zs[k];
      for (let j = 0; j <= ny; j++) {
        const y = ys[j];
        for (let i = 0; i <= nx; i++) vals[at++] = f([xs[i], y, z, w]);
      }
    }
  }
  snapNearZeros(vals, [sx, ny + 1, nz + 1, nw + 1]);

  // Output vertex id per (grid vertex, slot): slot 0 the vertex, 1..15 the edge types.
  const cache = new Int32Array(nVerts * 16).fill(-1);
  const off = new Int32Array(16);
  for (let c = 0; c < 16; c++) off[c] = (c & 1) + sx * ((c >> 1) & 1) + sxy * ((c >> 2) & 1) + sxyz * (c >> 3);

  const positions: Vec4[] = [];
  const tets: Tet[] = [];
  const corner = new Float64Array(16);
  const ids = new Int32Array(6);
  let base = 0;
  let ci = 0;
  let cj = 0;
  let ck = 0;
  let cl = 0;

  const crossing = (p: number, e: number): number => {
    const a = EDGE4_A[10 * p + e];
    const b = EDGE4_B[10 * p + e];
    const key = (base + off[a]) * 16 + (a ^ b);
    let id = cache[key];
    if (id >= 0) return id;
    const ga = corner[a];
    const gb = corner[b];
    const positive = ga >= 0 ? a : b;
    if ((ga >= 0 ? ga : gb) === 0) {
      const vkey = (base + off[positive]) * 16;
      id = cache[vkey];
      if (id < 0) {
        id = positions.length;
        positions.push([
          xs[ci + (positive & 1)], ys[cj + ((positive >> 1) & 1)],
          zs[ck + ((positive >> 2) & 1)], ws[cl + (positive >> 3)],
        ]);
        cache[vkey] = id;
      }
    } else {
      const s = ga / (ga - gb);
      const xa = xs[ci + (a & 1)];
      const ya = ys[cj + ((a >> 1) & 1)];
      const za = zs[ck + ((a >> 2) & 1)];
      const wa = ws[cl + (a >> 3)];
      id = positions.length;
      positions.push([
        xa + s * (xs[ci + (b & 1)] - xa),
        ya + s * (ys[cj + ((b >> 1) & 1)] - ya),
        za + s * (zs[ck + ((b >> 2) & 1)] - za),
        wa + s * (ws[cl + (b >> 3)] - wa),
      ]);
    }
    cache[key] = id;
    return id;
  };

  const pushTet = (a: number, b: number, c: number, d: number, sign: number): void => {
    if (a === b || a === c || a === d || b === c || b === d || c === d) return;
    tets.push(sign > 0 ? [a, b, c, d] : [a, c, b, d]);
  };

  for (cl = 0; cl < nw; cl++) {
    for (ck = 0; ck < nz; ck++) {
      for (cj = 0; cj < ny; cj++) {
        for (ci = 0; ci < nx; ci++) {
          base = ci + sx * cj + sxy * ck + sxyz * cl;
          let mask = 0;
          for (let c = 0; c < 16; c++) {
            const v = vals[base + off[c]];
            corner[c] = v;
            if (v >= 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 0xffff) continue;
          for (let p = 0; p < 24; p++) {
            const pm = ((mask >> PENTA_CORNERS[5 * p]) & 1) |
              (((mask >> PENTA_CORNERS[5 * p + 1]) & 1) << 1) |
              (((mask >> PENTA_CORNERS[5 * p + 2]) & 1) << 2) |
              (((mask >> PENTA_CORNERS[5 * p + 3]) & 1) << 3) |
              (((mask >> PENTA_CORNERS[5 * p + 4]) & 1) << 4);
            if (pm === 0 || pm === 31) continue;
            const single = SINGLE4[pm];
            if (single.length) {
              pushTet(crossing(p, single[0]), crossing(p, single[1]), crossing(p, single[2]), crossing(p, single[3]), 1);
              continue;
            }
            const prism = PRISM4[pm];
            for (let L = 0; L < 6; L++) ids[L] = crossing(p, prism[L]);
            emitPrism(ids, ORIENT4[pm], pushTet);
          }
        }
      }
    }
  }

  return { positions, tets };
}

/**
 * Split the prism with vertices ids[L], L = 2i + s, into three tets by the
 * pulling triangulation of the id order: v = the lowest vertex; tet 1 cones v
 * over the triangle at the other end; the quad not containing v is cut along
 * its own lowest vertex and each half is coned from v. Ties (equal ids,
 * possible only for collapsed prisms whose tets are dropped anyway) resolve
 * to the first.
 */
function emitPrism(
  ids: Int32Array,
  orient: Int8Array,
  pushTet: (a: number, b: number, c: number, d: number, sign: number) => void,
): void {
  let v = 0;
  for (let L = 1; L < 6; L++) if (ids[L] < ids[v]) v = L;
  const i0 = v >> 1;
  const s0 = v & 1;
  const e = 1 - s0;
  // Tet 1: v with the triangle at the other end.
  pushTet(ids[v], ids[e], ids[2 + e], ids[4 + e], orient[((v * 6 + e) * 6 + 2 + e) * 6 + 4 + e]);
  // The quad opposite v, in cyclic order.
  const j = i0 === 0 ? 1 : 0;
  const k = i0 === 2 ? 1 : 2;
  const q = [2 * j + s0, 2 * k + s0, 2 * k + e, 2 * j + e];
  let m = 0;
  for (let n = 1; n < 4; n++) if (ids[q[n]] < ids[q[m]]) m = n;
  const q0 = q[m];
  const q1 = q[(m + 1) & 3];
  const q2 = q[(m + 2) & 3];
  const q3 = q[(m + 3) & 3];
  pushTet(ids[v], ids[q0], ids[q1], ids[q2], orient[((v * 6 + q0) * 6 + q1) * 6 + q2]);
  pushTet(ids[v], ids[q0], ids[q2], ids[q3], orient[((v * 6 + q0) * 6 + q2) * 6 + q3]);
}
