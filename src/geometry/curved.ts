import type { Hyperplane, Shape4, ShapeKind, Tet, TetComplex, TriMesh3, Vec3, Vec4, WireMesh4 } from '../math/types';
import { add4, dot4, normalize4, scale4, sub4 } from '../math/vec';
import { orientTetsOutward } from './tets';
import { TetShape } from './shape';
import { emptyMesh } from './trimesh';

/**
 * Curved solids: the 4-ball (MATH.md §8.5), the duocylinder and Clifford
 * torus (§8.6), and the Hopf fibration of S^3 (§3.3, drawn as a wire only).
 * Every tet complex built here is closed and outward oriented about the
 * origin (§5.1, §5.2); orientation is normalised with orientTetsOutward,
 * which is valid because all these solids are star-shaped about the origin.
 */

const ORIGIN: Vec4 = [0, 0, 0, 0];
const TWO_PI = 2 * Math.PI;

// ---- 4-ball: subdivided 16-cell ------------------------------------------

/**
 * The 16 boundary tets of the 16-cell with vertices ±R e_i (MATH.md §8, §8.3):
 * one tet per sign vector (s_0, s_1, s_2, s_3) with vertices s_i R e_i. These
 * are exactly the 4-cliques of the edge graph containing no antipodal pair,
 * since every pair of non-antipodal vertices is joined by an edge. Vertex
 * index of +R e_i is 2i and of −R e_i is 2i + 1. Orientation is not
 * normalised here.
 */
function cell16Tets(radius: number): { positions: Vec4[]; tets: Tet[] } {
  const positions: Vec4[] = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const sign of [1, -1]) {
      const p: Vec4 = [0, 0, 0, 0];
      p[axis] = sign * radius;
      positions.push(p);
    }
  }
  const tets: Tet[] = [];
  for (let s = 0; s < 16; s++) {
    tets.push([s & 1, 2 + ((s >> 1) & 1), 4 + ((s >> 2) & 1), 6 + ((s >> 3) & 1)]);
  }
  return { positions, tets };
}

/** Edge keys for the midpoint map; supports up to 2^26 vertices. */
const EDGE_KEY_BASE = 2 ** 26;
/** Relative tolerance under which two octahedron diagonals count as equal. */
const DIAGONAL_TIE = 1e-9;

const dist4Squared = (a: Vec4, b: Vec4): number => {
  const d = sub4(a, b);
  return dot4(d, d);
};

/** Lexicographic order on sorted index pairs. */
function indexPairLess(a: { p: number; q: number }, b: { p: number; q: number }): boolean {
  const aLo = Math.min(a.p, a.q), aHi = Math.max(a.p, a.q);
  const bLo = Math.min(b.p, b.q), bHi = Math.max(b.p, b.q);
  return aLo < bLo || (aLo === bLo && aHi < bHi);
}

/**
 * One midpoint-subdivision step of a tet complex whose vertices lie on the
 * sphere of radius R about the origin (MATH.md §8.5). Each tet (a,b,c,d) is
 * split into 8: four corner tets (a, m_ab, m_ac, m_ad) etc., plus the inner
 * octahedron on the six edge midpoints, split into four tets around one of
 * its three diagonals (m_ab,m_cd), (m_ac,m_bd), (m_ad,m_bc). The diagonal
 * lies in the interior of the parent tet, so each parent face is split into
 * the same four triangles whichever diagonal is chosen and neighbouring tets
 * always agree on their shared face; the choice only affects element shape.
 * The shortest diagonal is taken (ties, e.g. the regular octahedra of the
 * first step, broken by the lexicographically smallest sorted index pair):
 * this keeps the tets well shaped under repeated refinement, so that the
 * distance from the origin to every tet's hyperplane tends to R, whereas an
 * index-only rule produces slivers whose circumradius does not shrink. The
 * rule is a deterministic function of the vertex data, so the result is
 * reproducible. Midpoints are shared through an edge-keyed map and appended
 * to `positions` (which is mutated), projected onto the sphere, so a closed
 * input yields a closed output. Orientation is not normalised here.
 */
export function subdivideSphericalTets(positions: Vec4[], tets: readonly Tet[], radius: number): Tet[] {
  if (positions.length >= EDGE_KEY_BASE) throw new Error('subdivideSphericalTets: too many vertices');
  const midpoints = new Map<number, number>();
  const midpoint = (i: number, j: number): number => {
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const key = lo * EDGE_KEY_BASE + hi;
    const found = midpoints.get(key);
    if (found !== undefined) return found;
    const idx = positions.length;
    positions.push(scale4(normalize4(add4(positions[lo], positions[hi])), radius));
    midpoints.set(key, idx);
    return idx;
  };

  const out: Tet[] = [];
  for (const [a, b, c, d] of tets) {
    const ab = midpoint(a, b);
    const ac = midpoint(a, c);
    const ad = midpoint(a, d);
    const bc = midpoint(b, c);
    const bd = midpoint(b, d);
    const cd = midpoint(c, d);
    out.push([a, ab, ac, ad], [b, ab, bc, bd], [c, ac, bc, cd], [d, ad, bd, cd]);

    // Each diagonal with its equator in cyclic order (consecutive midpoints
    // share a parent vertex, so consecutive pairs are octahedron edges).
    const diagonals: Array<{ p: number; q: number; ring: [number, number, number, number] }> = [
      { p: ab, q: cd, ring: [ac, ad, bd, bc] },
      { p: ac, q: bd, ring: [ab, ad, cd, bc] },
      { p: ad, q: bc, ring: [ab, ac, cd, bd] },
    ];
    let best = diagonals[0];
    let bestLen2 = dist4Squared(positions[best.p], positions[best.q]);
    for (let k = 1; k < 3; k++) {
      const cand = diagonals[k];
      const len2 = dist4Squared(positions[cand.p], positions[cand.q]);
      if (len2 < bestLen2 * (1 - DIAGONAL_TIE)) {
        best = cand;
        bestLen2 = len2;
      } else if (len2 <= bestLen2 * (1 + DIAGONAL_TIE) && indexPairLess(cand, best)) {
        best = cand;
        bestLen2 = Math.min(bestLen2, len2);
      }
    }
    const { p, q, ring } = best;
    for (let k = 0; k < 4; k++) out.push([p, q, ring[k], ring[(k + 1) % 4]]);
  }
  return out;
}

/**
 * Tet complex of the boundary S^3 of the 4-ball of radius R: the 16-cell's 16
 * tets subdivided `level` times (16·8^level tets), outward oriented. MATH.md
 * §8.5. Level 0 is the 16-cell itself (hypervolume 2/3 at R = 1, §8).
 *
 * Accuracy (measured, tests assert it): the complex is inscribed, so its
 * hypervolume is below π²R⁴/2 by 86.5 %, 53.9 %, 19.1 %, 5.31 %, 1.36 % at
 * levels 0..4, shrinking about 4× per level (second order in the edge
 * length). The deficit sits mostly in the flat tets around the 16-cell's 8
 * original vertices, whose hyperplanes are only 0.975R from the origin at
 * level 3 (0.9936R at level 4); slices near the poles are correspondingly
 * short (at c = 0.9R, 16 % along e_w at level 3). Level 3, the viewer's
 * choice, is therefore a ~5 % approximation; level 4 costs 8× the tets.
 * Seeding from the 600-cell instead (also allowed by §8.5) does not change
 * the trade-off: its 600 tets are 21.7 % short, 4800 are 6.7 % and 38 400
 * are 1.75 %, the same curve at equal tet count, so the 16-cell seed is kept.
 */
export function hypersphereComplex(radius = 1, level = 3): TetComplex {
  if (!(radius > 0)) throw new Error('hypersphereComplex: radius must be positive');
  if (!Number.isInteger(level) || level < 0) throw new Error('hypersphereComplex: level must be a non-negative integer');
  const { positions, tets: base } = cell16Tets(radius);
  let tets = base;
  for (let l = 0; l < level; l++) tets = subdivideSphericalTets(positions, tets, radius);
  return { positions, tets: orientTetsOutward(positions, tets, ORIGIN) };
}

/**
 * The 4-ball of radius R as a shape (MATH.md §8.5). No wire: a smooth sphere
 * has no edges to draw; the Hopf fibration (hopfShape) is the companion
 * figure for the projection view.
 */
export function hypersphere(radius = 1, level = 3): TetShape {
  return new TetShape('Hypersphere', 'curved', hypersphereComplex(radius, level), null);
}

// ---- Hopf fibration --------------------------------------------------------

/**
 * A point of the unit S^3 ⊂ C^2 = R^4 over the unit vector `base` ∈ S^2 under
 * the Hopf map h(z1, z2) = (2 Re(z1 z̄2), 2 Im(z1 z̄2), |z1|² − |z2|²), with
 * R^4 coordinates (Re z1, Im z1, Re z2, Im z2). Choosing z1 real and
 * non-negative gives z1 = √((1 + b_z)/2) and z2 = (b_x − i b_y)/(2 z1): then
 * 2 z1 z̄2 = b_x + i b_y and |z1|² − |z2|² = (1 + b_z)/2 − (1 − b_z)/2 = b_z.
 * At the south pole (b_z = −1, z1 = 0) the fibre is {z1 = 0} and (0, 1) is
 * taken. MATH.md §3.3
 */
export function hopfLift(base: Vec3): Vec4 {
  const [bx, by, bz] = base;
  if (1 + bz < 1e-12) return [0, 0, 1, 0];
  const z1 = Math.sqrt((1 + bz) / 2);
  return [z1, 0, bx / (2 * z1), -by / (2 * z1)];
}

/**
 * The Hopf fibre through hopfLift(base) sampled at `points` equally spaced
 * parameters: (e^{it} z1, e^{it} z2), t = 2πk/points. Every point has |p| = 1
 * because multiplication by e^{it} preserves |z1|² + |z2|². MATH.md §3.3
 */
export function hopfFiber(base: Vec3, points: number): Vec4[] {
  const [x, y, z, w] = hopfLift(base);
  const out: Vec4[] = [];
  for (let k = 0; k < points; k++) {
    const t = (TWO_PI * k) / points;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([x * c - y * s, x * s + y * c, z * c - w * s, z * s + w * c]);
  }
  return out;
}

/**
 * `count` base points spread over S^2 on latitude rings: about √(count/2)
 * rings at colatitudes η_j = π (j + ½)/rings, each holding a share of the
 * points proportional to its circumference sin η_j (largest-remainder
 * rounding, at least one per ring), staggered in azimuth between rings.
 * Each ring of base points gives a torus of Hopf fibres in S^3.
 */
export function hopfBasePoints(count: number): Vec3[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('hopfBasePoints: count must be a positive integer');
  const rings = Math.max(1, Math.round(Math.sqrt(count / 2)));
  const eta = Array.from({ length: rings }, (_, j) => (Math.PI * (j + 0.5)) / rings);
  const weights = eta.map(Math.sin);
  const total = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (count * w) / total);
  const counts = exact.map(Math.floor);
  let remainder = count - counts.reduce((s, c) => s + c, 0);
  const byFraction = exact.map((e, j) => ({ j, frac: e - Math.floor(e) })).sort((p, q) => q.frac - p.frac);
  for (let k = 0; remainder > 0; k = (k + 1) % rings, remainder--) counts[byFraction[k].j]++;
  for (let j = 0; j < rings; j++) {
    if (counts[j] === 0) {
      counts[j] = 1;
      counts[counts.indexOf(Math.max(...counts))]--;
    }
  }
  const out: Vec3[] = [];
  for (let j = 0; j < rings; j++) {
    const sinEta = Math.sin(eta[j]);
    const cosEta = Math.cos(eta[j]);
    for (let k = 0; k < counts[j]; k++) {
      const xi = (TWO_PI * (k + 0.5 * j)) / counts[j];
      out.push([sinEta * Math.cos(xi), sinEta * Math.sin(xi), cosEta]);
    }
  }
  return out;
}

/**
 * Wire of `fiberCount` Hopf fibres on the unit S^3, each a closed polyline
 * of `pointsPerFiber` vertices; edges only, no faces. MATH.md §3.3
 */
export function hopfFibration(fiberCount = 24, pointsPerFiber = 64): WireMesh4 {
  if (!Number.isInteger(pointsPerFiber) || pointsPerFiber < 3) {
    throw new Error('hopfFibration: pointsPerFiber must be an integer ≥ 3');
  }
  const positions: Vec4[] = [];
  const edges: [number, number][] = [];
  for (const base of hopfBasePoints(fiberCount)) {
    const start = positions.length;
    positions.push(...hopfFiber(base, pointsPerFiber));
    for (let k = 0; k < pointsPerFiber; k++) edges.push([start + k, start + ((k + 1) % pointsPerFiber)]);
  }
  return { positions, edges, faces: [] };
}

/** A Shape4 that is only a wire: it has no solid, so every slice is empty. */
class WireShape implements Shape4 {
  constructor(
    public readonly name: string,
    public readonly kind: ShapeKind,
    private readonly wireMesh: WireMesh4,
    private readonly r: number,
    private readonly wr: [number, number],
  ) {}

  wire(): WireMesh4 | null { return this.wireMesh; }
  slice(_h: Hyperplane): TriMesh3 { return emptyMesh(); }
  radius(): number { return this.r; }
  wRange(): [number, number] { return this.wr; }
}

/**
 * The Hopf fibration as a shape for the projection view (kind 'curved'): wire
 * = hopfFibration(fiberCount, pointsPerFiber), no solid (slices are empty),
 * radius 1 and w ∈ [−1, 1] since the fibres fill the unit S^3. MATH.md §3.3
 */
export function hopfShape(fiberCount = 24, pointsPerFiber = 64): Shape4 {
  return new WireShape('Hopf fibration', 'curved', hopfFibration(fiberCount, pointsPerFiber), 1, [-1, 1]);
}

// ---- Clifford torus and duocylinder --------------------------------------

/**
 * cos(2πi/n) and sin(2πi/n) for i = 0..n−1, the vertices of the regular n-gon,
 * built so that every coincidence forced by the symmetries the n-gon shares
 * with the coordinate axes holds bit-exactly: the values at multiples of π/2
 * are the exact 0 and ±1 (not sin π = 1.2e-16, cos 3π/2 = −1.8e-16), cos and
 * sin at π/4 are both Math.SQRT1_2, and values related by the reflections
 * θ ↦ −θ (every n), θ ↦ π − θ (even n), the quarter turns and θ ↦ π/2 − θ
 * (4 | n) are the same number up to sign or a cos/sin swap. Each value is
 * Math.cos/Math.sin of one representative angle in the fundamental domain
 * [0, π/4] (4 | n), [0, π/2] (even n) or [0, π] (odd n), mapped back; it is
 * at least as accurate as the directly rounded value (the representative
 * angle is the smaller one) and differs from it by the rounding of the larger
 * angle, measured ≤ 1.3e-15 for n ≤ 64.
 *
 * Exactness matters for slicing (MATH.md §6). The symbolic perturbation
 * s ≥ 0 classifies vertices lying exactly in H alike, and a complex edge in H
 * is then an edge of the slice. Two vertices that should both have, say,
 * y = 0 but carry rounding noise of opposite signs fall in different classes,
 * the slicer "crosses" the edge between them at a noise-determined interior
 * point, and that point is a slice vertex on one side of the edge only: the
 * zero-area triangle bridging the T-junction is discarded by the §6 cleaning
 * and a hole remains. The hyperplanes spanned by two coordinate axes contain
 * such edges of the Clifford torus grid and of the duocylinder's discs, and
 * for r1 = r2 whole diagonal curves of the grid (cos α_i = −cos β_j); with
 * this table all of them get s = 0 exactly. Coincidences that are algebraic
 * rather than symmetric (cos π/3 = 1/2, cancellations of four terms in
 * (1,1,1,1)·p) are not addressed here.
 */
function circleTable(n: number): { cos: number[]; sin: number[] } {
  const cos: number[] = [];
  const sin: number[] = [];
  for (let i = 0; i < n; i++) {
    // Reduce i to the fundamental domain, recording the symmetry that maps
    // the representative r back to i.
    let r = i;
    let quarterTurns = 0; // θ ↦ θ + quarterTurns·π/2, applied last
    let swap = false; // θ ↦ π/2 − θ
    let flipSin = false; // θ ↦ −θ
    let flipCos = false; // θ ↦ π − θ
    if (n % 4 === 0) {
      const q = n / 4;
      quarterTurns = Math.floor(i / q);
      r = i - quarterTurns * q;
      if (2 * r > q) { r = q - r; swap = true; }
    } else {
      if (2 * r > n) { r = n - r; flipSin = true; }
      if (n % 2 === 0 && 4 * r > n) { r = n / 2 - r; flipCos = true; }
    }
    let c: number;
    let s: number;
    if (r === 0) { c = 1; s = 0; }
    else if (8 * r === n) { c = Math.SQRT1_2; s = Math.SQRT1_2; }
    else { const theta = (TWO_PI * r) / n; c = Math.cos(theta); s = Math.sin(theta); }
    if (swap) [c, s] = [s, c];
    if (flipSin) s = -s;
    if (flipCos) c = -c;
    for (let k = 0; k < quarterTurns; k++) [c, s] = [-s, c];
    cos.push(c + 0); // + 0 turns a −0 from the negations into +0
    sin.push(s + 0);
  }
  return { cos, sin };
}

/**
 * The Clifford torus { x²+y² = r1², z²+w² = r2² } as an n × m quad grid:
 * vertex (i, j) at index i·m + j is (r1 cos α_i, r1 sin α_i, r2 cos β_j,
 * r2 sin β_j) with α_i = 2πi/n, β_j = 2πj/m (circleTable, so the coordinates
 * at multiples of π/2 are exact); edges along both parameter directions and
 * one quad face per grid cell. With r1 = r2 = 1/√2 it lies on the unit S^3
 * and its stereographic image is a round torus. MATH.md §8.6
 */
export function cliffordTorus(r1 = Math.SQRT1_2, r2 = Math.SQRT1_2, n = 48, m = 48): WireMesh4 {
  if (!Number.isInteger(n) || n < 3 || !Number.isInteger(m) || m < 3) {
    throw new Error('cliffordTorus: n and m must be integers ≥ 3');
  }
  const a = circleTable(n);
  const b = circleTable(m);
  const positions: Vec4[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      positions.push([r1 * a.cos[i], r1 * a.sin[i], r2 * b.cos[j], r2 * b.sin[j]]);
    }
  }
  const at = (i: number, j: number): number => ((i + n) % n) * m + ((j + m) % m);
  const edges: [number, number][] = [];
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      edges.push([at(i, j), at(i + 1, j)], [at(i, j), at(i, j + 1)]);
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return { positions, edges, faces };
}

/**
 * Triangulation of a disk with `rings` concentric rings of `n` vertices each
 * plus a centre, in abstract disk indices: centre = 0, ring k ∈ [1, rings]
 * vertex j = 1 + (k − 1) n + j. A fan around the centre, then two triangles
 * per quad between consecutive rings (diagonal (k, j)–(k+1, j+1)). The outer
 * ring k = rings is the disk boundary.
 */
function diskTriangles(n: number, rings: number): Array<[number, number, number]> {
  const d = (k: number, j: number): number => 1 + (k - 1) * n + (j % n);
  const tris: Array<[number, number, number]> = [];
  for (let j = 0; j < n; j++) tris.push([0, d(1, j), d(1, j + 1)]);
  for (let k = 1; k < rings; k++) {
    for (let j = 0; j < n; j++) {
      tris.push([d(k, j), d(k, j + 1), d(k + 1, j + 1)], [d(k, j), d(k + 1, j + 1), d(k + 1, j)]);
    }
  }
  return tris;
}

/**
 * Split the prism with bottom triangle b and top triangle t (b[k] below t[k])
 * into three tets, using global vertex indices only. Rule: the diagonal of
 * every quad side face is the one through the quad's smallest vertex index.
 * This depends only on the quad's vertex set, so two prisms sharing a quad
 * (within one solid torus, or across the Clifford torus between the two) are
 * split compatibly, and it is always realisable: the prism's smallest vertex
 * v (made b0 by swapping bottom/top and rotating columns) is the minimum of
 * both quads containing it, so those take diagonals through v and the prism
 * is v coned over the opposite triangle plus v coned over the remaining quad,
 * which is split by its own diagonal. Orientation is not normalised here.
 */
function splitPrism(b: [number, number, number], t: [number, number, number], out: Tet[]): void {
  let minPos = 0;
  let minOnTop = false;
  let minVal = Infinity;
  for (let k = 0; k < 3; k++) {
    if (b[k] < minVal) { minVal = b[k]; minPos = k; minOnTop = false; }
    if (t[k] < minVal) { minVal = t[k]; minPos = k; minOnTop = true; }
  }
  const bot = minOnTop ? t : b;
  const top = minOnTop ? b : t;
  const b0 = bot[minPos], b1 = bot[(minPos + 1) % 3], b2 = bot[(minPos + 2) % 3];
  const t0 = top[minPos], t1 = top[(minPos + 1) % 3], t2 = top[(minPos + 2) % 3];
  out.push([b0, t0, t1, t2]);
  // Pyramid with apex b0 over the quad (b1, b2, t2, t1).
  const q = Math.min(b1, b2, t1, t2);
  if (q === b1 || q === t2) out.push([b0, b1, b2, t2], [b0, b1, t2, t1]);
  else out.push([b0, b1, b2, t1], [b0, b2, t2, t1]);
}

/**
 * Tet complex of the boundary of the duocylinder { x²+y² ≤ r1², z²+w² ≤ r2² }
 * (MATH.md §8.6). Both circles are discretised with `segments` = n steps, so
 * the solid is exactly P1 × P2, the product of the regular n-gons of radii
 * r1 (xy) and r2 (zw); its boundary is the two solid tori
 *   A = ∂P1 × P2 (circle α × disk in zw) and B = P1 × ∂P2,
 * glued along the Clifford torus grid ∂P1 × ∂P2 of n² vertices, which come
 * first in `positions` and coincide with cliffordTorus(r1, r2, n, n). Each
 * disk is a centre plus `rings` concentric rings (diskTriangles); each disk
 * triangle times each circle segment is a prism split by splitPrism, whose
 * quad rule makes A and B agree on the shared torus, so the union is closed.
 * Hypervolume is exactly area(P1)·area(P2) = π² r1² r2² ((n/2π) sin(2π/n))².
 */
export function duocylinderComplex(r1 = Math.SQRT1_2, r2 = Math.SQRT1_2, segments = 48, rings = 6): TetComplex {
  if (!(r1 > 0) || !(r2 > 0)) throw new Error('duocylinderComplex: radii must be positive');
  if (!Number.isInteger(segments) || segments < 3) throw new Error('duocylinderComplex: segments must be an integer ≥ 3');
  if (!Number.isInteger(rings) || rings < 1) throw new Error('duocylinderComplex: rings must be an integer ≥ 1');
  const n = segments;
  // Same table as cliffordTorus, so interior ring vertices share the exact
  // zeros of the torus grid and axis-parallel edges lie exactly in the
  // coordinate hyperplanes that contain them (see circleTable).
  const { cos: cosA, sin: sinA } = circleTable(n);

  const positions: Vec4[] = cliffordTorus(r1, r2, n, n).positions;
  const perDisk = 1 + (rings - 1) * n; // interior disk vertices per circle step
  // Interior of A: for each α_i, the centre and inner rings of the zw-disk.
  const aBase = positions.length;
  for (let i = 0; i < n; i++) {
    positions.push([r1 * cosA[i], r1 * sinA[i], 0, 0]);
    for (let k = 1; k < rings; k++) {
      const rho = (r2 * k) / rings;
      for (let j = 0; j < n; j++) positions.push([r1 * cosA[i], r1 * sinA[i], rho * cosA[j], rho * sinA[j]]);
    }
  }
  // Interior of B: for each β_j, the centre and inner rings of the xy-disk.
  const bBase = positions.length;
  for (let j = 0; j < n; j++) {
    positions.push([0, 0, r2 * cosA[j], r2 * sinA[j]]);
    for (let k = 1; k < rings; k++) {
      const rho = (r1 * k) / rings;
      for (let i = 0; i < n; i++) positions.push([rho * cosA[i], rho * sinA[i], r2 * cosA[j], r2 * sinA[j]]);
    }
  }

  // Global index of abstract disk vertex d at circle step s. Outer-ring
  // vertices are the shared torus grid: for A the disk angle is β (second
  // grid index), for B it is α (first grid index).
  const outer = 1 + (rings - 1) * n;
  const globalA = (i: number, d: number): number => (d >= outer ? i * n + (d - outer) : aBase + i * perDisk + d);
  const globalB = (j: number, d: number): number => (d >= outer ? (d - outer) * n + j : bBase + j * perDisk + d);

  const tris = diskTriangles(n, rings);
  const tets: Tet[] = [];
  for (let s = 0; s < n; s++) {
    const s2 = (s + 1) % n;
    for (const [u, v, w] of tris) {
      splitPrism([globalA(s, u), globalA(s, v), globalA(s, w)], [globalA(s2, u), globalA(s2, v), globalA(s2, w)], tets);
    }
  }
  for (let s = 0; s < n; s++) {
    const s2 = (s + 1) % n;
    for (const [u, v, w] of tris) {
      splitPrism([globalB(s, u), globalB(s, v), globalB(s, w)], [globalB(s2, u), globalB(s2, v), globalB(s2, w)], tets);
    }
  }
  return { positions, tets: orientTetsOutward(positions, tets, ORIGIN) };
}

/**
 * The duocylinder as a shape (MATH.md §8.6), with the Clifford torus quad
 * grid (same `segments` in both angles) as its wire.
 */
export function duocylinder(r1 = Math.SQRT1_2, r2 = Math.SQRT1_2, segments = 48, rings = 6): TetShape {
  const complex = duocylinderComplex(r1, r2, segments, rings);
  return new TetShape('Duocylinder', 'curved', complex, cliffordTorus(r1, r2, segments, segments));
}
