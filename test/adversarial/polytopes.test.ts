/**
 * Adversarial tests for src/geometry/polytopes.ts (and the hull/tet/slice
 * utilities it relies on). Every expectation is derived from docs/MATH.md or
 * from standard polytope geometry in the comment next to it; nothing here is
 * read back from the implementation.
 *
 * Random directions and rotations come from a seeded PRNG so failures
 * reproduce exactly.
 */
import { describe, expect, it } from 'vitest';
import type { Mat4, Polytope4, Tet, TriMesh3, Vec3, Vec4 } from '../../src/math/types';
import { hyperplane, hyperplaneFromRotation, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { apply4, transpose4 } from '../../src/math/mat4';
import { centroid4, det4, dist4, dot4, length4, normalize4, scale4, sub4 } from '../../src/math/vec';
import {
  PHI,
  POLYTOPE_INFO,
  POLYTOPE_NAMES,
  polytopeShape,
  regularPolytope,
  type PolytopeName,
} from '../../src/geometry/polytopes';
import { hypervolumeByCones, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice, dropDegenerateTriangles, signedVolume, triangleCount, weldVertices } from '../../src/geometry/trimesh';
import { TetShape, sliceVolumeIntegral } from '../../src/geometry/shape';
import { convexHull3 } from '../../src/geometry/hull3';
import { cross3, det3, dot3, length3, sub3 } from '../../src/math/vec';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** mulberry32: small, well-distributed, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u1 = 1 - rand(); // in (0, 1]: avoids log 0
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Uniform random unit vector in R^4 (normalised Gaussian). */
function randomUnit4(rand: () => number): Vec4 {
  return normalize4([gaussian(rand), gaussian(rand), gaussian(rand), gaussian(rand)]);
}

/**
 * Haar-random rotation of R^4: Gram-Schmidt on four Gaussian vectors gives a
 * random orthogonal matrix; flipping the last column makes det = +1. Stored
 * row-major with the orthonormal vectors as COLUMNS (MATH.md §1).
 */
function randomRotation(rand: () => number): Mat4 {
  const cols: Vec4[] = [];
  while (cols.length < 4) {
    let v: Vec4 = [gaussian(rand), gaussian(rand), gaussian(rand), gaussian(rand)];
    for (const u of cols) v = sub4(v, scale4(u, dot4(v, u)));
    const l = length4(v);
    if (l < 1e-3) continue;
    cols.push(scale4(v, 1 / l));
  }
  // det of the matrix with rows u_k equals det of the matrix with columns u_k.
  if (det4(cols[0], cols[1], cols[2], cols[3]) < 0) cols[3] = scale4(cols[3], -1);
  const m: Mat4 = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = cols[c][r];
  return m;
}

// ---------------------------------------------------------------------------
// Expected values (derived, not read from the code)
// ---------------------------------------------------------------------------

const SQRT5 = Math.sqrt(5);
/**
 * Inradius shared by the unit-circumradius 600-cell and 120-cell. For a
 * regular tet of edge a = 1/φ inscribed in S^3, the centroid c has
 * |c|² = 1 − 3a²/8 = 1 − 3/(8φ²) = (7 + 3√5)/16 (MATH.md §8.2 comment of
 * polytopes.ts derives the same; here recomputed from a² = 1/φ² = 2 − φ:
 * 1 − 3(2 − φ)/8 = (2 + 3φ)/8 = (7 + 3√5)/16). The 120-cell's cells are the
 * 20 normalised centroids ĉ around a 600-cell vertex v, with v·ĉ = |c|²/|c| =
 * |c| since c·(v − c) = 0 for the circumcentre c of a tet inscribed in S^3.
 */
const R_IN_600 = Math.sqrt((7 + 3 * SQRT5) / 16);
const A_600 = 1 / PHI;
/** 120-cell edge: (3 − √5)/(2√2) = 1/(√2 φ²), the standard edge/circumradius ratio. */
const A_120 = (3 - SQRT5) / (2 * Math.SQRT2);
/** Spectrum keys are distances in edge units, printed with toFixed(9). */
const ONE = (1).toFixed(9);

interface Expected {
  V: number; E: number; F: number; C: number;
  faceSize: number; facesPerCell: number; cellVertices: number; cellEdges: number;
  edgesPerVertex: number; facesPerVertex: number; cellsPerVertex: number;
  facesPerEdge: number; cellsPerEdge: number;
  edge: number; circumradius: number; inradius: number;
  cellCircumradius: number; faceCircumradius: number;
  /** Cone tets: Σ_cells Σ_faces (faceSize − 2). */
  tets: number;
  hypervolume: number;
  centrallySymmetric: boolean;
  /** Vertex figure: multiset of distances among the neighbours of a vertex, in units of the edge. */
  vertexFigureSpectrum: Record<string, number>;
}

const EXPECTED: Record<PolytopeName, Expected> = {
  // Regular simplex: every pair of vertices adjacent. Circumradius 4/√5 (§8.1),
  // inradius R/4 = 1/√5 (the base cell sits at w = −1/√5). Cells: regular tets
  // of edge a = 2√2, circumradius a√6/4 = √3. Faces: triangles, circumradius a/√3.
  // 4-volume √5/96 · a⁴ = 64√5/96 = 2√5/3 (§8). Vertex figure: tetrahedron of edge a.
  cell5: {
    V: 5, E: 10, F: 10, C: 5,
    faceSize: 3, facesPerCell: 4, cellVertices: 4, cellEdges: 6,
    edgesPerVertex: 4, facesPerVertex: 6, cellsPerVertex: 4, facesPerEdge: 3, cellsPerEdge: 3,
    edge: 2 * Math.SQRT2, circumradius: 4 / SQRT5, inradius: 1 / SQRT5,
    cellCircumradius: Math.sqrt(3), faceCircumradius: (2 * Math.SQRT2) / Math.sqrt(3),
    tets: 5 * 4 * 1, hypervolume: (2 * SQRT5) / 3, centrallySymmetric: false,
    vertexFigureSpectrum: { [ONE]: 6 },
  },
  // [-1,1]^4: edge 2, circumradius 2, inradius 1. Cubes of edge 2 (circumradius √3),
  // squares (circumradius √2). Volume 2⁴ = 16. Vertex figure: tetrahedron with
  // edge 2√2 = a√2 (neighbours of (1,1,1,1) differ in two coordinates).
  tesseract: {
    V: 16, E: 32, F: 24, C: 8,
    faceSize: 4, facesPerCell: 6, cellVertices: 8, cellEdges: 12,
    edgesPerVertex: 4, facesPerVertex: 6, cellsPerVertex: 4, facesPerEdge: 3, cellsPerEdge: 3,
    edge: 2, circumradius: 2, inradius: 1,
    cellCircumradius: Math.sqrt(3), faceCircumradius: Math.SQRT2,
    tets: 8 * 6 * 2, hypervolume: 16, centrallySymmetric: true,
    vertexFigureSpectrum: { [Math.SQRT2.toFixed(9)]: 6 },
  },
  // Cross-polytope ±e_i: edge √2, circumradius 1, cell hyperplanes Σ±p_i = 1 at
  // distance 1/2. Tets of edge √2 (circumradius √3/2), triangles (√2/√3).
  // Volume 2⁴/4! = 2/3. Vertex figure of e_1: ±e_2, ±e_3, ±e_4, an octahedron of
  // edge √2 = a: 12 pairs at a, 3 antipodal pairs at 2 = a√2.
  cell16: {
    V: 8, E: 24, F: 32, C: 16,
    faceSize: 3, facesPerCell: 4, cellVertices: 4, cellEdges: 6,
    edgesPerVertex: 6, facesPerVertex: 12, cellsPerVertex: 8, facesPerEdge: 4, cellsPerEdge: 4,
    edge: Math.SQRT2, circumradius: 1, inradius: 0.5,
    cellCircumradius: Math.sqrt(3) / 2, faceCircumradius: Math.SQRT2 / Math.sqrt(3),
    tets: 16 * 4 * 1, hypervolume: 2 / 3, centrallySymmetric: true,
    vertexFigureSpectrum: { [ONE]: 12, [Math.SQRT2.toFixed(9)]: 3 },
  },
  // Perms of (±1,±1,0,0) = [-1,1]^4 ∩ {Σ|p_i| ≤ 2}: edge √2, circumradius √2,
  // facet hyperplanes x_i = 1 and Σ±p_i = 2, both at distance 1. Octahedra of
  // edge √2 (circumradius 1). Volume 16 · P(Irwin–Hall_4 ≤ 2) = 16/2 = 8.
  // Vertex figure of (1,1,0,0): (1,0,±1,0),(1,0,0,±1),(0,1,±1,0),(0,1,0,±1), a
  // cube of edge √2 = a: 12 pairs at a, 12 at a√2, 4 at a√3.
  cell24: {
    V: 24, E: 96, F: 96, C: 24,
    faceSize: 3, facesPerCell: 8, cellVertices: 6, cellEdges: 12,
    edgesPerVertex: 8, facesPerVertex: 12, cellsPerVertex: 6, facesPerEdge: 3, cellsPerEdge: 3,
    edge: Math.SQRT2, circumradius: Math.SQRT2, inradius: 1,
    cellCircumradius: 1, faceCircumradius: Math.SQRT2 / Math.sqrt(3),
    tets: 24 * 8 * 1, hypervolume: 8, centrallySymmetric: true,
    vertexFigureSpectrum: { [ONE]: 12, [Math.SQRT2.toFixed(9)]: 12, [Math.sqrt(3).toFixed(9)]: 4 },
  },
  // Unit circumradius, edge 1/φ (§8.2). Tets of edge a (circumradius a√6/4).
  // Volume = 600 cones = 600 · r_in · (a³/(6√2)) / 4 = 25 r_in a³/√2, which
  // equals the closed form (25/4)(2+√5)a⁴ = 25/(4φ) (since 2+√5 = φ³).
  // Vertex figure: icosahedron of edge a: 30 pairs at a, 30 at φa (diagonals),
  // 6 antipodal pairs at 2R_ico = (a/2)√(10+2√5).
  cell600: {
    V: 120, E: 720, F: 1200, C: 600,
    faceSize: 3, facesPerCell: 4, cellVertices: 4, cellEdges: 6,
    edgesPerVertex: 12, facesPerVertex: 30, cellsPerVertex: 20, facesPerEdge: 5, cellsPerEdge: 5,
    edge: A_600, circumradius: 1, inradius: R_IN_600,
    cellCircumradius: (A_600 * Math.sqrt(6)) / 4, faceCircumradius: A_600 / Math.sqrt(3),
    tets: 600 * 4 * 1, hypervolume: 25 / (4 * PHI), centrallySymmetric: true,
    vertexFigureSpectrum: { [ONE]: 30, [PHI.toFixed(9)]: 30, [(Math.sqrt(10 + 2 * SQRT5) / 2).toFixed(9)]: 6 },
  },
  // Unit circumradius dual of the 600-cell. Dodecahedra of edge a (circumradius
  // a√3φ/2 = √(1 − r_in²)), pentagons (circumradius a/(2 sin 36°)).
  // Volume = 120 cones = 120 · r_in · ((15+7√5)/4 · a³) / 4 = closed form
  // (15/4)(105+47√5) a⁴ ≈ 4.19263. Vertex figure: tetrahedron; neighbours sharing
  // a pentagon subtend 108° at the vertex, so their distance is 2a sin 54° = φa.
  cell120: {
    V: 600, E: 1200, F: 720, C: 120,
    faceSize: 5, facesPerCell: 12, cellVertices: 20, cellEdges: 30,
    edgesPerVertex: 4, facesPerVertex: 6, cellsPerVertex: 4, facesPerEdge: 3, cellsPerEdge: 3,
    edge: A_120, circumradius: 1, inradius: R_IN_600,
    cellCircumradius: (A_120 * Math.sqrt(3) * PHI) / 2, faceCircumradius: A_120 / (2 * Math.sin(Math.PI / 5)),
    tets: 120 * 12 * 3, hypervolume: (15 / 4) * (105 + 47 * SQRT5) * A_120 ** 4, centrallySymmetric: true,
    vertexFigureSpectrum: { [PHI.toFixed(9)]: 6 },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trueVertices = (p: Polytope4): Vec4[] => p.positions.slice(0, p.vertexCount);

function cellVertexSet(p: Polytope4, ci: number): number[] {
  const s = new Set<number>();
  for (const fi of p.cells[ci]) for (const v of p.faces[fi]) s.add(v);
  return [...s].sort((a, b) => a - b);
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

function cellEdgeSet(p: Polytope4, ci: number): Set<string> {
  const s = new Set<string>();
  for (const fi of p.cells[ci]) {
    const f = p.faces[fi];
    for (let k = 0; k < f.length; k++) s.add(edgeKey(f[k], f[(k + 1) % f.length]));
  }
  return s;
}

const relClose = (actual: number, expected: number, rel: number): boolean =>
  Math.abs(actual - expected) <= rel * Math.max(Math.abs(expected), 1e-300);

/** Vertices actually referenced after weld + degenerate-triangle removal. */
function cleanMesh(m: TriMesh3): TriMesh3 {
  return dropDegenerateTriangles(weldVertices(m, 1e-6));
}

function usedPoints(m: TriMesh3): Vec3[] {
  const used = new Set<number>();
  for (let i = 0; i < m.indices.length; i++) used.add(m.indices[i]);
  return [...used].sort((a, b) => a - b).map((i) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]);
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Every point of `a` has exactly one partner in `b` within tol, and vice versa. */
function samePointSet(a: readonly Vec3[], b: readonly Vec3[], tol: number): boolean {
  if (a.length !== b.length) return false;
  const matched = new Uint8Array(b.length);
  for (const p of a) {
    let found = -1;
    for (let j = 0; j < b.length; j++) {
      if (dist3(p, b[j]) <= tol) {
        if (found >= 0 || matched[j]) return false;
        found = j;
      }
    }
    if (found < 0) return false;
    matched[found] = 1;
  }
  return true;
}


// ---- slice-polyhedron helpers --------------------------------------------
//
// Marching tetrahedra emit a vertex wherever the hyperplane crosses ANY tet
// edge, including the cone edges to cell centroids and the fan diagonals of
// polygonal faces, so a welded slice has more vertices than the section
// polyhedron has corners (the extras lie on its faces and edges). The
// geometric statements of MATH.md §8.4 are therefore checked by lifting the
// chart points back to R^4 (unchart) and testing them against the polytope's
// supporting half-spaces: every point must lie ON the polytope's boundary and
// in the hyperplane, and the points lying on ≥ 3 facet planes (the ones on
// polytope edges or vertices, i.e. the section's corners) must be exactly the
// expected corner set.

interface Plane4 { nu: Vec4; d: number }

const tesseractPlanes = (): Plane4[] => {
  const out: Plane4[] = [];
  for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const nu: Vec4 = [0, 0, 0, 0]; nu[i] = s; out.push({ nu, d: 1 }); }
  return out;
};
const diagonalPlanes = (d: number): Plane4[] => {
  const out: Plane4[] = [];
  for (let i = 0; i < 16; i++) out.push({ nu: [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1], d });
  return out;
};
/** 16-cell {Σ|p_i| ≤ 1}: facets (±1,±1,±1,±1)·p = 1 (§8.3). */
const cell16Planes = (): Plane4[] => diagonalPlanes(1);
/** 24-cell = [-1,1]^4 ∩ {Σ|p_i| ≤ 2}: facets ±e_i·p = 1 and (±1,±1,±1,±1)·p = 2 (§8.3). */
const cell24Planes = (): Plane4[] => [...tesseractPlanes(), ...diagonalPlanes(2)];
/** 5-cell: facets −v_k·p = 4/5 (v_i·v_j = −R²/4 = −4/5 for a regular simplex, §8.3). */
const cell5Planes = (): Plane4[] => trueVertices(regularPolytope('cell5')).map((v) => ({ nu: scale4(v, -1), d: 4 / 5 }));

/** Welded, cleaned slice vertices lifted back to R^4. */
function liftedPoints(m: TriMesh3, h: ReturnType<typeof hyperplane>): Vec4[] {
  return usedPoints(cleanMesh(m)).map((q) => unchart(h, q));
}

function sameSet4(a: readonly Vec4[], b: readonly Vec4[], tol: number): boolean {
  if (a.length !== b.length) return false;
  const matched = new Uint8Array(b.length);
  for (const p of a) {
    let found = -1;
    for (let j = 0; j < b.length; j++) {
      if (dist4(p, b[j]) <= tol) {
        if (found >= 0 || matched[j]) return false;
        found = j;
      }
    }
    if (found < 0) return false;
    matched[found] = 1;
  }
  return true;
}

/**
 * Assert the slice `raw` by `h` is the section polyhedron with the given
 * corners: every lifted vertex is in h and on the polytope boundary (max over
 * facets of nu·p − d is 0 within tol), and the vertices on ≥ 3 facet planes are
 * exactly `corners`. tol 1e-5 covers Float32 slice coordinates of size ≤ 2.
 */
function expectSection(raw: TriMesh3, h: ReturnType<typeof hyperplane>, planes: Plane4[], corners: Vec4[], tol = 1e-5): void {
  const pts = liftedPoints(raw, h);
  expect(pts.length).toBeGreaterThanOrEqual(corners.length);
  const found: Vec4[] = [];
  for (const p of pts) {
    expect(Math.abs(dot4(h.normal, p) - h.offset)).toBeLessThan(tol);
    let gap = -Infinity;
    let onPlanes = 0;
    for (const { nu, d } of planes) {
      const g = dot4(nu, p) - d;
      gap = Math.max(gap, g);
      if (Math.abs(g) <= tol) onPlanes++;
    }
    expect(Math.abs(gap)).toBeLessThan(tol); // on the boundary, neither inside nor outside
    if (onPlanes >= 3) found.push(p);
  }
  expect(found.length).toBe(corners.length);
  expect(sameSet4(found, corners, tol)).toBe(true);
}

/** Irwin–Hall density of the sum of four U(0,1) variables. */
function irwinHall4(t: number): number {
  if (t <= 0 || t >= 4) return 0;
  const binom = [1, 4, 6, 4, 1];
  let s = 0;
  for (let k = 0; k <= Math.floor(t); k++) s += (k % 2 ? -1 : 1) * binom[k] * (t - k) ** 3;
  return s / 6;
}

/**
 * Slice 3-volume of the tesseract [-1,1]^4 by n = (1,1,1,1)/2 at offset c.
 * With q_i = (p_i + 1)/2 ∈ [0,1], the hyperplane n·p = c is Σq_i = c + 2.
 * By the coarea formula the (d−1)-volume of {Σq = t} in the unit cube is
 * √d · f_d(t) with f_d the Irwin–Hall density; scaling by 2 multiplies
 * 3-volumes by 8: A(c) = 8 · 2 · f_4(c + 2) = 16 f_4(c + 2). Check: A(0) =
 * 16 · f_4(2) = 16 · 2/3 = 32/3, the octahedron of §8.4; ∫A dc = 16.
 */
const tesseractDiagonalSlice = (c: number): number => 16 * irwinHall4(c + 2);

/**
 * 24-cell = [-1,1]^4 ∩ {Σ|p_i| ≤ 2} (facet normals of §8.3). Slice at w = c:
 * {|x|,|y|,|z| ≤ 1, |x|+|y|+|z| ≤ 2 − |c|} = 8 · F_3(2 − |c|) where F_3 is the
 * Irwin–Hall CDF for three U(0,1); for 1 ≤ T ≤ 2, F_3(T) = (T³ − 3(T−1)³)/6.
 * A(0) = 20/3 (cuboctahedron), A(±1) = 4/3 (octahedral cell), ∫A = 8.
 */
const cell24SliceW = (c: number): number => {
  const u = Math.abs(c);
  if (u >= 1) return 0;
  return (4 / 3) * ((2 - u) ** 3 - 3 * (1 - u) ** 3);
};

/** 16-cell {Σ|p_i| ≤ 1} at w = c: octahedron {|x|+|y|+|z| ≤ 1 − |c|}, volume (4/3)(1 − |c|)³. */
const cell16SliceW = (c: number): number => (Math.abs(c) >= 1 ? 0 : (4 / 3) * (1 - Math.abs(c)) ** 3);

/**
 * 5-cell at w = c (§8.1 coordinates): a tetrahedron similar to the base cell
 * (edge 2√2, volume (2√2)³/(6√2) = 8/3) scaled by (4/√5 − c)/√5 (apex at
 * w = 4/√5, base at w = −1/√5, height √5).
 */
const cell5SliceW = (c: number): number => {
  if (c <= -1 / SQRT5 || c >= 4 / SQRT5) return 0;
  return (8 / 3) * ((4 / SQRT5 - c) / SQRT5) ** 3;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adversarial: polytope catalogue (MATH.md §8)', () => {
  for (const name of POLYTOPE_NAMES) {
    const X = EXPECTED[name];

    it(`${name}: V, E, F, C counts, Euler V − E + F − C = 0, and POLYTOPE_INFO agrees`, () => {
      const p = regularPolytope(name);
      const V = p.vertexCount;
      const E = p.edges.length;
      const F = p.faces.length;
      const C = p.cells.length;
      expect([V, E, F, C]).toEqual([X.V, X.E, X.F, X.C]);
      expect(V - E + F - C).toBe(0);
      // The tet complex appends exactly one centroid per cell (§5.3 / Polytope4 doc).
      expect(p.positions.length).toBe(X.V + X.C);
      expect(p.name).toBe(name);
      expect(POLYTOPE_INFO[name].counts).toEqual({ V: X.V, E: X.E, F: X.F, C: X.C });
      // POLYTOPE_INFO.edgeLength must match the derived edge to 1e-12 relative.
      expect(relClose(POLYTOPE_INFO[name].edgeLength, X.edge, 1e-12)).toBe(true);
      if (POLYTOPE_INFO[name].hypervolume !== null) {
        expect(relClose(POLYTOPE_INFO[name].hypervolume as number, X.hypervolume, 1e-12)).toBe(true);
      }
    });

    it(`${name}: all vertices on the circumsphere, no edge/face refers to a centroid`, () => {
      const p = regularPolytope(name);
      for (const v of trueVertices(p)) expect(relClose(length4(v), X.circumradius, 1e-12)).toBe(true);
      for (const [a, b] of p.edges) {
        expect(a).not.toBe(b);
        expect(Math.max(a, b)).toBeLessThan(p.vertexCount);
      }
      for (const f of p.faces) for (const v of f) expect(v).toBeLessThan(p.vertexCount);
      // Extra positions are exactly the cell centroids (one per cell, same order).
      p.cells.forEach((_, ci) => {
        const g = centroid4(cellVertexSet(p, ci).map((i) => p.positions[i]));
        expect(dist4(g, p.positions[p.vertexCount + ci])).toBeLessThan(1e-12);
      });
    });

    it(`${name}: edges all have length a and are exactly the nearest-neighbour pairs`, () => {
      const p = regularPolytope(name);
      const verts = trueVertices(p);
      for (const [a, b] of p.edges) {
        // Vertices are exact rationals/surds of magnitude ~1; 1e-12 relative is
        // ~100 ulps, generous for Gram–Schmidt-free coordinates.
        expect(relClose(dist4(verts[a], verts[b]), X.edge, 1e-12)).toBe(true);
      }
      // In a regular polytope the edges are precisely the pairs at minimum distance.
      const keys = new Set(p.edges.map(([a, b]) => edgeKey(a, b)));
      expect(keys.size).toBe(p.edges.length); // no duplicate edges
      let minPairs = 0;
      let minDist = Infinity;
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) minDist = Math.min(minDist, dist4(verts[i], verts[j]));
      }
      expect(relClose(minDist, X.edge, 1e-12)).toBe(true);
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          const isMin = Math.abs(dist4(verts[i], verts[j]) - X.edge) < 1e-9;
          if (isMin) minPairs++;
          expect(keys.has(edgeKey(i, j))).toBe(isMin);
        }
      }
      expect(minPairs).toBe(X.E);
    });

    it(`${name}: every cell is a regular ${POLYTOPE_INFO[name].cellName} (face count, face size, cell Euler, circumradius)`, () => {
      const p = regularPolytope(name);
      expect(p.cells.length).toBe(X.C);
      p.cells.forEach((cell, ci) => {
        expect(cell.length).toBe(X.facesPerCell);
        expect(new Set(cell).size).toBe(cell.length); // no repeated face in a cell
        for (const fi of cell) expect(p.faces[fi].length).toBe(X.faceSize);
        const vs = cellVertexSet(p, ci);
        const es = cellEdgeSet(p, ci);
        expect(vs.length).toBe(X.cellVertices);
        expect(es.size).toBe(X.cellEdges);
        expect(vs.length - es.size + cell.length).toBe(2); // polyhedron Euler
        const g = centroid4(vs.map((i) => p.positions[i]));
        for (const i of vs) expect(relClose(dist4(p.positions[i], g), X.cellCircumradius, 1e-9)).toBe(true);
      });
    });

    it(`${name}: cells are genuine facets at the inradius (centroid direction is a supporting normal)`, () => {
      const p = regularPolytope(name);
      const verts = trueVertices(p);
      p.cells.forEach((_, ci) => {
        const vs = new Set(cellVertexSet(p, ci));
        const g = centroid4([...vs].map((i) => verts[i]));
        // Regular polytope: the cell centroid is the foot of the perpendicular.
        expect(relClose(length4(g), X.inradius, 1e-9)).toBe(true);
        const nu = normalize4(g);
        for (let i = 0; i < verts.length; i++) {
          const d = dot4(nu, verts[i]);
          if (vs.has(i)) expect(Math.abs(d - X.inradius)).toBeLessThan(1e-9);
          else expect(d).toBeLessThan(X.inradius - 1e-6); // strictly below the facet plane
        }
      });
    });

    it(`${name}: every face lies in exactly two cells; incidence counts per vertex and per edge`, () => {
      const p = regularPolytope(name);
      const faceUse = new Array<number>(p.faces.length).fill(0);
      const cellsPerVertex = new Array<number>(p.vertexCount).fill(0);
      const cellsPerEdge = new Map<string, number>();
      p.cells.forEach((cell, ci) => {
        for (const fi of cell) faceUse[fi]++;
        for (const v of cellVertexSet(p, ci)) cellsPerVertex[v]++;
        for (const e of cellEdgeSet(p, ci)) cellsPerEdge.set(e, (cellsPerEdge.get(e) ?? 0) + 1);
      });
      expect(faceUse.every((n) => n === 2)).toBe(true);
      expect(cellsPerVertex.every((n) => n === X.cellsPerVertex)).toBe(true);
      expect(cellsPerEdge.size).toBe(X.E);
      expect([...cellsPerEdge.values()].every((n) => n === X.cellsPerEdge)).toBe(true);

      const facesPerVertex = new Array<number>(p.vertexCount).fill(0);
      const facesPerEdge = new Map<string, number>();
      for (const f of p.faces) {
        expect(new Set(f).size).toBe(f.length); // a face cycle never repeats a vertex
        for (let k = 0; k < f.length; k++) {
          facesPerVertex[f[k]]++;
          const e = edgeKey(f[k], f[(k + 1) % f.length]);
          facesPerEdge.set(e, (facesPerEdge.get(e) ?? 0) + 1);
        }
      }
      expect(facesPerVertex.every((n) => n === X.facesPerVertex)).toBe(true);
      expect(facesPerEdge.size).toBe(X.E);
      expect([...facesPerEdge.values()].every((n) => n === X.facesPerEdge)).toBe(true);
    });

    it(`${name}: every face is a planar, convex, regular ${X.faceSize}-gon traversed in cyclic order`, () => {
      const p = regularPolytope(name);
      for (const f of p.faces) {
        const pts = f.map((i) => p.positions[i]);
        // Consecutive cycle vertices must be edge-adjacent (tests orderCycle).
        for (let k = 0; k < f.length; k++) {
          expect(relClose(dist4(pts[k], pts[(k + 1) % f.length]), X.edge, 1e-9)).toBe(true);
        }
        // Planarity: rank of the difference vectors is 2 (residual ≤ 1e-9 on O(1) coordinates).
        const p0 = pts[0];
        const u = normalize4(sub4(pts[1], p0));
        let v = sub4(pts[2], p0);
        v = sub4(v, scale4(u, dot4(v, u)));
        v = normalize4(v);
        const g = centroid4(pts);
        const q: [number, number][] = pts.map((pt) => {
          const d = sub4(pt, p0);
          const res = sub4(sub4(d, scale4(u, dot4(d, u))), scale4(v, dot4(d, v)));
          expect(length4(res)).toBeLessThan(1e-9);
          const dg = sub4(pt, g);
          return [dot4(dg, u), dot4(dg, v)];
        });
        // Regularity: equidistant from the face centroid.
        for (const pt of pts) expect(relClose(dist4(pt, g), X.faceCircumradius, 1e-9)).toBe(true);
        // Convexity and simplicity: all turns have one sign and sum to ±2π.
        let total = 0;
        let sign = 0;
        for (let k = 0; k < q.length; k++) {
          const a = q[k];
          const b = q[(k + 1) % q.length];
          const c = q[(k + 2) % q.length];
          const d1 = [b[0] - a[0], b[1] - a[1]];
          const d2 = [c[0] - b[0], c[1] - b[1]];
          const cross = d1[0] * d2[1] - d1[1] * d2[0];
          const dotp = d1[0] * d2[0] + d1[1] * d2[1];
          expect(Math.abs(cross)).toBeGreaterThan(1e-9);
          const s = Math.sign(cross);
          if (sign === 0) sign = s;
          expect(s).toBe(sign);
          total += Math.atan2(cross, dotp);
        }
        expect(Math.abs(Math.abs(total) - 2 * Math.PI)).toBeLessThan(1e-9);
      }
    });

    it(`${name}: vertex figure has ${X.edgesPerVertex} edges per vertex and the right neighbour distance spectrum`, () => {
      const p = regularPolytope(name);
      const verts = trueVertices(p);
      const nb: number[][] = Array.from({ length: p.vertexCount }, () => []);
      for (const [a, b] of p.edges) { nb[a].push(b); nb[b].push(a); }
      for (let i = 0; i < p.vertexCount; i++) {
        expect(nb[i].length).toBe(X.edgesPerVertex);
        expect(new Set(nb[i]).size).toBe(X.edgesPerVertex);
        const spectrum: Record<string, number> = {};
        for (let s = 0; s < nb[i].length; s++) {
          for (let t = s + 1; t < nb[i].length; t++) {
            const key = (dist4(verts[nb[i][s]], verts[nb[i][t]]) / X.edge).toFixed(9);
            spectrum[key] = (spectrum[key] ?? 0) + 1;
          }
        }
        expect(spectrum).toEqual(X.vertexFigureSpectrum);
      }
    });

    it(`${name}: tet complex is valid (§5.2), has ${X.tets} cone tets, all outward (§5.1)`, () => {
      const p = regularPolytope(name);
      const report = validateTetComplex(p.positions, p.tets);
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.boundaryFaces).toBe(0);
      expect(report.nonManifoldFaces).toBe(0);
      expect(report.inconsistentFaces).toBe(0);
      expect(report.degenerateTets).toBe(0);
      expect(p.tets.length).toBe(X.tets);
      // Every tet outward with the origin as interior point: N · (a − o) > 0.
      for (const t of p.tets) {
        const N = tetNormal(p.positions, t);
        expect(dot4(N, p.positions[t[0]])).toBeGreaterThan(1e-9);
      }
      // Signed and unsigned cone sums agree (orientation consistent with §7).
      expect(relClose(signedHypervolume(p.positions, p.tets), hypervolumeByCones(p.positions, p.tets), 1e-12)).toBe(true);
    });

    it(`${name}: hypervolume by cones equals the derived value (${X.hypervolume.toFixed(6)})`, () => {
      const p = regularPolytope(name);
      const v = hypervolumeByCones(p.positions, p.tets);
      // Rational or surd arithmetic on a few thousand terms: 1e-12 relative.
      expect(relClose(v, X.hypervolume, 1e-12)).toBe(true);
      // §8.2: strictly between inscribed and circumscribed 4-balls, π²r⁴/2.
      expect(v).toBeGreaterThan((Math.PI ** 2 / 2) * X.inradius ** 4);
      expect(v).toBeLessThan((Math.PI ** 2 / 2) * X.circumradius ** 4);
    });

    it(`${name}: polytopeShape wire omits centroids; radius and wRange match`, () => {
      const shape = polytopeShape(name);
      const wire = shape.wire();
      expect(wire).not.toBeNull();
      expect(wire!.positions.length).toBe(X.V);
      expect(wire!.edges.length).toBe(X.E);
      expect(wire!.faces.length).toBe(X.F);
      expect(relClose(shape.radius(), X.circumradius, 1e-12)).toBe(true);
      // wRange = support function in ±e_w. For the 5-cell: [−1/√5, 4/√5].
      // For the 120-cell e_w is a facet normal (a 600-cell vertex), so the
      // extreme w is the inradius, attained by the 20 vertices of that cell.
      const [wmin, wmax] = shape.wRange();
      const expectedW: [number, number] =
        name === 'cell5' ? [-1 / SQRT5, 4 / SQRT5]
          : name === 'cell120' ? [-R_IN_600, R_IN_600]
            : name === 'tesseract' ? [-1, 1]
              : [-1, 1];
      expect(Math.abs(wmin - expectedW[0])).toBeLessThan(1e-12);
      expect(Math.abs(wmax - expectedW[1])).toBeLessThan(1e-12);
    });
  }

  it('600-cell vertex set is exactly §8.2: 8 axis, 16 half, 96 EVEN permutations of (±φ/2, ±1/2, ±1/(2φ), 0)', () => {
    const verts = trueVertices(regularPolytope('cell600'));
    const mags = [PHI / 2, 1 / 2, 1 / (2 * PHI), 0];
    let axis = 0;
    let half = 0;
    let evenPerm = 0;
    const seen = new Set<string>();
    for (const v of verts) {
      seen.add(v.map((x) => x.toFixed(9)).join(','));
      const abs = v.map(Math.abs);
      if (abs.filter((x) => Math.abs(x - 1) < 1e-12).length === 1 && abs.filter((x) => x < 1e-12).length === 3) { axis++; continue; }
      if (abs.every((x) => Math.abs(x - 0.5) < 1e-12)) { half++; continue; }
      // k(i) = which base slot the magnitude at coordinate i came from; σ⁻¹ = k, same parity as σ.
      const k = abs.map((x) => mags.findIndex((m) => Math.abs(m - x) < 1e-12));
      expect(k.includes(-1)).toBe(false);
      expect(new Set(k).size).toBe(4);
      let inversions = 0;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) if (k[a] > k[b]) inversions++;
      expect(inversions % 2).toBe(0);
      evenPerm++;
    }
    expect(seen.size).toBe(120);
    expect([axis, half, evenPerm]).toEqual([8, 16, 96]);
  });

  it('tesseract, 16-cell, 24-cell, 5-cell vertex sets are exactly the §8 lists', () => {
    const asSet = (vs: Vec4[]): Set<string> => new Set(vs.map((v) => v.map((x) => (Math.abs(x) < 1e-12 ? 0 : x).toFixed(9)).join(',')));
    const tess: Vec4[] = [];
    for (let i = 0; i < 16; i++) tess.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
    expect(asSet(trueVertices(regularPolytope('tesseract')))).toEqual(asSet(tess));
    const c16: Vec4[] = [];
    for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const v: Vec4 = [0, 0, 0, 0]; v[i] = s; c16.push(v); }
    expect(asSet(trueVertices(regularPolytope('cell16')))).toEqual(asSet(c16));
    const c24: Vec4[] = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const si of [1, -1]) for (const sj of [1, -1]) {
      const v: Vec4 = [0, 0, 0, 0]; v[i] = si; v[j] = sj; c24.push(v);
    }
    expect(asSet(trueVertices(regularPolytope('cell24')))).toEqual(asSet(c24));
    const s = 1 / SQRT5;
    const c5: Vec4[] = [[1, 1, 1, -s], [1, -1, -1, -s], [-1, 1, -1, -s], [-1, -1, 1, -s], [0, 0, 0, 4 * s]];
    expect(asSet(trueVertices(regularPolytope('cell5')))).toEqual(asSet(c5));
    // §8.1: centroid at the origin, every pair at distance 2√2.
    expect(length4(centroid4(c5))).toBeLessThan(1e-12);
  });

  it('duality: 120-cell vertices are unit and are the normalised 600-cell cell centroids; 120-cell cell centres are 600-cell vertices', () => {
    const c600 = regularPolytope('cell600');
    const c120 = regularPolytope('cell120');
    const v120 = trueVertices(c120);
    const v600 = trueVertices(c600);
    for (const v of v120) expect(Math.abs(length4(v) - 1)).toBeLessThan(1e-12);

    const key = (v: Vec4): string => v.map((x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(8)).join(',');
    const set120 = new Set(v120.map(key));
    expect(set120.size).toBe(600);
    // Each 600-cell cell is a 4-clique of edges (§8.2) and its normalised centroid is a 120-cell vertex.
    c600.cells.forEach((_, ci) => {
      const vs = cellVertexSet(c600, ci);
      expect(vs.length).toBe(4);
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        expect(relClose(dist4(v600[vs[a]], v600[vs[b]]), A_600, 1e-12)).toBe(true);
      }
      expect(set120.has(key(normalize4(centroid4(vs.map((i) => v600[i])))))).toBe(true);
    });
    // Each 120-cell cell: 20 vertices whose centroid direction is a 600-cell vertex.
    const set600 = new Set(v600.map(key));
    c120.cells.forEach((_, ci) => {
      const vs = cellVertexSet(c120, ci);
      expect(vs.length).toBe(20);
      expect(set600.has(key(normalize4(centroid4(vs.map((i) => v120[i])))))).toBe(true);
    });
  });

  it('regularPolytope is memoised and polytopeShape reuses the same complex', () => {
    const a = regularPolytope('cell24');
    expect(regularPolytope('cell24')).toBe(a);
    const s = polytopeShape('cell24') as TetShape;
    expect(s.complex.tets).toBe(a.tets);
    expect(s.kind).toBe('polytope');
  });
});

describe('adversarial: slicing the polytopes (MATH.md §6, §7, §8.4)', () => {
  it('slice integral along two seeded random directions equals the cone hypervolume for every polytope', () => {
    const rand = mulberry32(0xC0FFEE);
    for (const name of POLYTOPE_NAMES) {
      const p = regularPolytope(name);
      const shape = polytopeShape(name);
      const vol = hypervolumeByCones(p.positions, p.tets);
      for (let k = 0; k < 2; k++) {
        const n = randomUnit4(rand);
        const integral = sliceVolumeIntegral(shape, n, 200);
        // A(c) is a C² piecewise cubic with compact support inside [−R, R], so
        // the h²/24 (f'(R) − f'(−R)) midpoint term vanishes and the error is
        // O(h³) from the ≤ V kinks where the third derivative jumps. Measured
        // (seed 0xC0FFEE): ≤ 3e-6 relative at 200 steps, shrinking ~8× per
        // doubling, as the O(h³) bound predicts. Float32 slice vertices add
        // ~1e-6 relative noise per sample that averages out. 1e-5 relative
        // leaves a 3× margin while any dropped or doubly counted tet
        // (≥ 1/4320 ≈ 2e-4 of the volume) is caught.
        expect(relClose(integral, vol, 1e-5)).toBe(true);
      }
    }
  });

  it('random slices are closed, consistently oriented spheres with positive volume (§6 consequences)', () => {
    const rand = mulberry32(12345);
    for (const name of POLYTOPE_NAMES) {
      const shape = polytopeShape(name);
      const X = EXPECTED[name];
      for (let k = 0; k < 3; k++) {
        const n = randomUnit4(rand);
        // Offsets strictly inside the inradius so the slice is non-empty.
        const c = (rand() * 2 - 1) * X.inradius * 0.95;
        const r = analyseSlice(shape.slice(hyperplane(n, c)));
        expect(r.closed).toBe(true);
        expect(r.consistent).toBe(true);
        expect(r.euler).toBe(2);
        expect(r.volume).toBeGreaterThan(0);
        expect(r.triangles).toBeGreaterThan(0);
      }
    }
  });

  it('central symmetry: A(c) = A(−c) along random directions for all but the 5-cell; the 5-cell breaks it', () => {
    const rand = mulberry32(777);
    for (const name of POLYTOPE_NAMES) {
      if (!EXPECTED[name].centrallySymmetric) continue;
      const shape = polytopeShape(name);
      for (let k = 0; k < 3; k++) {
        const n = randomUnit4(rand);
        const c = rand() * EXPECTED[name].inradius * 0.9;
        const a = signedVolume(shape.slice(hyperplane(n, c)));
        const b = signedVolume(shape.slice(hyperplane(n, -c)));
        expect(a).toBeGreaterThan(0);
        // Both are computed from Float32 vertices (relative 6e-8 each); the
        // divergence sum of positive terms bounds the error by ~1e-6 relative.
        expect(relClose(a, b, 1e-5)).toBe(true);
      }
      // The c = 0 section is itself a centrally symmetric polyhedron: its
      // support function h(u) = max_q u·q (over the slice vertices, all of
      // which lie on the section's boundary) satisfies h(u) = h(−u). The raw
      // vertex set is NOT symmetric (fan diagonals break the symmetry), so
      // the support function is the right invariant.
      const n = randomUnit4(rand);
      const pts = usedPoints(cleanMesh(shape.slice(hyperplane(n, 0))));
      expect(pts.length).toBeGreaterThan(0);
      for (let k = 0; k < 10; k++) {
        const u: Vec3 = [gaussian(rand), gaussian(rand), gaussian(rand)];
        let hp = -Infinity;
        let hm = -Infinity;
        for (const q of pts) {
          const d = u[0] * q[0] + u[1] * q[1] + u[2] * q[2];
          hp = Math.max(hp, d);
          hm = Math.max(hm, -d);
        }
        expect(Math.abs(hp - hm)).toBeLessThan(1e-5 * Math.hypot(...u));
      }
    }
    // Negative control: 5-cell along e_w, A(−0.2) = (8/3)((4/√5+0.2)/√5)³ > A(0.2).
    const s5 = polytopeShape('cell5');
    const plus = signedVolume(s5.slice(hyperplaneW(0.2)));
    const minus = signedVolume(s5.slice(hyperplaneW(-0.2)));
    expect(relClose(plus, cell5SliceW(0.2), 1e-5)).toBe(true);
    expect(relClose(minus, cell5SliceW(-0.2), 1e-5)).toBe(true);
    expect(minus).toBeGreaterThan(plus * 1.5);
  });

  it('slices beyond the circumradius are empty, on both sides', () => {
    const rand = mulberry32(2024);
    for (const name of POLYTOPE_NAMES) {
      const shape = polytopeShape(name);
      const R = shape.radius();
      for (let k = 0; k < 2; k++) {
        const n = randomUnit4(rand);
        expect(triangleCount(shape.slice(hyperplane(n, R + 1e-6)))).toBe(0);
        expect(triangleCount(shape.slice(hyperplane(n, -R - 1e-6)))).toBe(0);
        expect(triangleCount(shape.slice(hyperplane(n, 10 * R)))).toBe(0);
      }
    }
  });

  it('limit-from-below convention at a cell hyperplane: full cell on one side, empty on the other (§6)', () => {
    // Tesseract along e_w: cube of volume 8 at w = +1, empty at w = −1.
    const tess = polytopeShape('tesseract');
    expect(relClose(analyseSlice(tess.slice(hyperplaneW(1))).volume, 8, 1e-5)).toBe(true);
    expect(triangleCount(tess.slice(hyperplaneW(-1)))).toBe(0);
    // 16-cell along a facet normal (1,1,1,1)/2: the cell {e_1..e_4} at c = 1/2 is a
    // regular tet of edge √2, volume (√2)³/(6√2) = 1/3; empty at c = −1/2.
    const c16 = polytopeShape('cell16');
    const nDiag: Vec4 = [0.5, 0.5, 0.5, 0.5];
    const r16 = analyseSlice(c16.slice(hyperplane(nDiag, 0.5)));
    expect(relClose(r16.volume, 1 / 3, 1e-5)).toBe(true);
    expect(r16.closed && r16.consistent).toBe(true);
    expect(usedPoints(cleanMesh(c16.slice(hyperplane(nDiag, 0.5)))).length).toBe(4);
    expect(triangleCount(c16.slice(hyperplane(nDiag, -0.5)))).toBe(0);
    // 24-cell along e_w: octahedral cell (edge √2, volume 4/3) at w = 1, empty at −1.
    const c24 = polytopeShape('cell24');
    expect(relClose(analyseSlice(c24.slice(hyperplaneW(1))).volume, 4 / 3, 1e-5)).toBe(true);
    expect(triangleCount(c24.slice(hyperplaneW(-1)))).toBe(0);
    // 5-cell along e_w: the base cell is at w = −1/√5; the limit from below is
    // EMPTY there, and just above it is the whole base tet (volume 8/3 minus
    // the cubic shrink (1 − ε/√5)³ ≈ 1 − 1.3e-4 for ε = 1e-4).
    const c5 = polytopeShape('cell5');
    expect(triangleCount(c5.slice(hyperplaneW(-1 / SQRT5)))).toBe(0);
    expect(relClose(analyseSlice(c5.slice(hyperplaneW(-1 / SQRT5 + 1e-4))).volume, 8 / 3, 1e-3)).toBe(true);
    // At the apex w = 4/√5 the slice degenerates to a point: nothing survives cleaning.
    expect(analyseSlice(c5.slice(hyperplaneW(4 / SQRT5))).triangles).toBe(0);
    // 120-cell along e_w (a facet normal): the top cell is the dodecahedron of
    // volume (15+7√5)/4 · a³ with 20 vertices. Its vertices' w is irrational,
    // so "exactly at the cell" is only meaningful at the computed coordinate
    // wmax (= r_in to 1 ulp): there the limit-from-below rule gives the full
    // cell; 1e-9 below gives the cell (shrunk by (1 − 1e-9/r)³, invisible at
    // 1e-5); 1e-9 above gives nothing. Mirror statements at −r_in.
    const c120 = polytopeShape('cell120');
    const [wmin120, wmax120] = c120.wRange();
    expect(Math.abs(wmax120 - R_IN_600)).toBeLessThan(1e-12);
    const dodVol = ((15 + 7 * SQRT5) / 4) * A_120 ** 3;
    for (const c of [wmax120, wmax120 - 1e-9, wmin120 + 1e-9]) {
      const raw = c120.slice(hyperplaneW(c));
      const dod = analyseSlice(raw);
      expect(relClose(dod.volume, dodVol, 1e-5)).toBe(true);
      expect(dod.closed && dod.consistent).toBe(true);
      expect(dod.euler).toBe(2);
      // All 20 cell vertices (w = ±wmax) appear among the slice vertices.
      const cellVerts = trueVertices(regularPolytope('cell120')).filter((v) => Math.abs(Math.abs(v[3]) - wmax120) < 1e-12 && Math.sign(v[3]) === Math.sign(c));
      expect(cellVerts.length).toBe(20);
      const pts = usedPoints(cleanMesh(raw));
      for (const v of cellVerts) expect(pts.some((q) => dist3(q, [v[0], v[1], v[2]]) < 1e-5)).toBe(true);
    }
    expect(triangleCount(c120.slice(hyperplaneW(wmax120 + 1e-9)))).toBe(0);
    expect(triangleCount(c120.slice(hyperplaneW(wmin120)))).toBe(0);
    expect(triangleCount(c120.slice(hyperplaneW(wmin120 - 1e-9)))).toBe(0);
    // 600-cell along the normal of its first cell: a tet of edge 1/φ, volume
    // a³/(6√2), just inside the cell hyperplane on each side; nothing beyond.
    const p600 = regularPolytope('cell600');
    const nu = normalize4(centroid4(cellVertexSet(p600, 0).map((i) => p600.positions[i])));
    const c600 = polytopeShape('cell600');
    for (const c of [R_IN_600 - 1e-9, -R_IN_600 + 1e-9]) {
      const tet = analyseSlice(c600.slice(hyperplane(nu, c)));
      expect(relClose(tet.volume, A_600 ** 3 / (6 * Math.SQRT2), 1e-5)).toBe(true);
      expect(tet.closed && tet.consistent).toBe(true);
      expect(tet.euler).toBe(2);
      expect(tet.triangles).toBe(4);
    }
    expect(triangleCount(c600.slice(hyperplane(nu, R_IN_600 + 1e-9)))).toBe(0);
    expect(triangleCount(c600.slice(hyperplane(nu, -R_IN_600 - 1e-9)))).toBe(0);
  });

  describe('tesseract slices of §8.4', () => {
    const tess = polytopeShape('tesseract');

    it('n = e_w, |c| < 1: a cube of side 2 with its own x, y, z coordinates (volume 8)', () => {
      for (const c of [-0.999, -0.5, 0, 0.3, 0.999]) {
        const raw = tess.slice(hyperplaneW(c));
        const r = analyseSlice(raw);
        expect(relClose(r.volume, 8, 1e-5)).toBe(true);
        expect(r.closed && r.consistent).toBe(true);
        expect(r.euler).toBe(2);
        // Corners (±1, ±1, ±1, c); the chart for e_w is the identity on xyz (§4).
        const corners: Vec4[] = [];
        for (let i = 0; i < 8; i++) corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, c]);
        expectSection(raw, hyperplaneW(c), tesseractPlanes(), corners);
        const pts = usedPoints(cleanMesh(raw));
        for (const q of corners) expect(pts.some((p) => dist3(p, [q[0], q[1], q[2]]) < 1e-5)).toBe(true);
        // §10: sourceW is the w of the 4D source point, here exactly c.
        for (let i = 0; i < raw.sourceW.length; i++) expect(Math.abs(raw.sourceW[i] - c)).toBeLessThan(1e-5);
      }
    });

    it('n = (1,1,1,1)/2, c = 0: regular octahedron on the six permutations of (1,1,−1,−1), volume 32/3', () => {
      const h = hyperplane([1, 1, 1, 1], 0);
      const raw = tess.slice(h);
      const r = analyseSlice(raw);
      expect(relClose(r.volume, 32 / 3, 1e-5)).toBe(true);
      expect(r.closed && r.consistent).toBe(true);
      expect(r.euler).toBe(2);
      // Lift the chart points back to R^4: the corners are the spec's six vertices.
      const expected: Vec4[] = [[1, 1, -1, -1], [1, -1, 1, -1], [1, -1, -1, 1], [-1, 1, 1, -1], [-1, 1, -1, 1], [-1, -1, 1, 1]];
      expectSection(raw, h, tesseractPlanes(), expected);
      // Circumradius 2, edge 2√2 (12 pairs), antipodal 4 (3 pairs) — of the corners.
      for (const q of expected) expect(Math.abs(length4(q) - 2)).toBeLessThan(1e-12);
      let edges = 0;
      let anti = 0;
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
        const d = dist4(expected[i], expected[j]);
        if (Math.abs(d - 2 * Math.SQRT2) < 1e-12) edges++;
        else if (Math.abs(d - 4) < 1e-12) anti++;
      }
      expect([edges, anti]).toEqual([12, 3]);
      // The chart is an isometry, so corner distances survive in R^3 too.
      const pts = usedPoints(cleanMesh(raw));
      const chartCorners = pts.filter((q) => Math.abs(Math.hypot(...q) - 2) < 1e-5);
      expect(chartCorners.length).toBe(6);
    });

    it('n = (1,1,1,1)/2: A(c) = 16 f_4(c + 2) (Irwin–Hall), point at c = ±2, tetrahedron, truncated tetrahedron, octahedron', () => {
      const n: Vec4 = [1, 1, 1, 1];
      // c = ±2: a single vertex; nothing survives cleaning, volume 0.
      for (const c of [2, -2]) {
        const r = analyseSlice(tess.slice(hyperplane(n, c)));
        expect(r.triangles).toBe(0);
        expect(Math.abs(r.volume)).toBeLessThan(1e-12);
      }
      // Tetrahedron region |c| ∈ (1, 2): 4 vertices; at c = −1.5 the tet has
      // vertices (−1,−1,−1,−1) + e_i, edge √2, volume 1/3.
      const hTet = hyperplane(n, -1.5);
      const tet = tess.slice(hTet);
      const tetCorners: Vec4[] = [[0, -1, -1, -1], [-1, 0, -1, -1], [-1, -1, 0, -1], [-1, -1, -1, 0]];
      expectSection(tet, hTet, tesseractPlanes(), tetCorners);
      expect(relClose(analyseSlice(tet).volume, 1 / 3, 1e-5)).toBe(true);
      expect(relClose(tesseractDiagonalSlice(-1.5), 1 / 3, 1e-12)).toBe(true);
      // Truncated tetrahedron region |c| ∈ (0, 1): 12 corners; at c = ±0.5 the
      // volume is 8·(1.5³/3 − 4·0.5³/3) = 23/3. Corners at Σp = −1 (c = −0.5)
      // have one coordinate 0 and the others a permutation of (−1, −1, 1):
      // 4 · 3 = 12; at c = +0.5 the signs flip.
      for (const c of [-0.5, 0.5]) {
        const h = hyperplane(n, c);
        const raw = tess.slice(h);
        const r = analyseSlice(raw);
        const corners: Vec4[] = [];
        for (let zero = 0; zero < 4; zero++) {
          for (let odd = 0; odd < 4; odd++) {
            if (odd === zero) continue;
            const v: Vec4 = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) if (i !== zero) v[i] = i === odd ? -Math.sign(c) : Math.sign(c);
            corners.push(v);
          }
        }
        expect(corners.length).toBe(12);
        expectSection(raw, h, tesseractPlanes(), corners);
        expect(relClose(r.volume, 23 / 3, 1e-5)).toBe(true);
        expect(r.closed && r.consistent).toBe(true);
        expect(r.euler).toBe(2);
      }
      // c = +0.5 passes exactly through the four cell centroids (1,0,0,0)… that
      // are internal tet vertices; the symbolic perturbation must keep it watertight.
      // Full profile against the Irwin–Hall formula.
      for (const c of [-1.9, -1.2, -0.8, -0.3, 0, 0.3, 0.8, 1.2, 1.9]) {
        const v = signedVolume(tess.slice(hyperplane(n, c)));
        expect(relClose(v, tesseractDiagonalSlice(c), 1e-5)).toBe(true);
      }
    });

    it('n = (1,1,0,0)/√2, c = 0: square prism of volume 8√2 with 8 vertices', () => {
      const h = hyperplane([1, 1, 0, 0], 0);
      const raw = tess.slice(h);
      const r = analyseSlice(raw);
      expect(relClose(r.volume, 8 * Math.SQRT2, 1e-5)).toBe(true);
      expect(r.closed && r.consistent).toBe(true);
      expect(r.euler).toBe(2);
      // Corners: x = −y = ±1, z, w = ±1.
      const corners: Vec4[] = [];
      for (const x of [1, -1]) for (const z of [1, -1]) for (const w of [1, -1]) corners.push([x, -x, z, w]);
      expectSection(raw, h, tesseractPlanes(), corners);
    });

    it('integral of slice volume is 16 along e_w, the diagonal, (1,1,0,0) and a seeded random direction', () => {
      // Along e_w A(c) is a step (8 on |c| < 1): the midpoint rule with 200 steps
      // over [−2, 2] has h = 0.02 and the jumps at ±1 fall exactly between
      // midpoints (−2 + (i+0.5)·0.02 never equals ±1), so the sum is exact: 16.
      expect(relClose(sliceVolumeIntegral(tess, [0, 0, 0, 1], 200), 16, 1e-9)).toBe(true);
      // Generic-looking directions: C² profile, O(h³) error (see above).
      expect(relClose(sliceVolumeIntegral(tess, [1, 1, 1, 1], 200), 16, 2e-5)).toBe(true);
      // (1,1,0,0)/√2: A(c) = 4·(2√2 − 2|c|·√2…) is piecewise linear in c and
      // continuous, so midpoint is exact on linear pieces; only the two kinks
      // at ±√2 contribute, each O(h²·slope). 1e-4 is ample.
      expect(relClose(sliceVolumeIntegral(tess, [1, 1, 0, 0], 200), 16, 1e-4)).toBe(true);
      const rand = mulberry32(99);
      expect(relClose(sliceVolumeIntegral(tess, randomUnit4(rand), 200), 16, 2e-5)).toBe(true);
    });
  });

  it('16-cell sliced by w = 0 is the octahedron ±e_1, ±e_2, ±e_3 (volume 4/3) and A(c) = (4/3)(1 − |c|)³', () => {
    const shape = polytopeShape('cell16');
    const raw = shape.slice(hyperplaneW(0));
    const r = analyseSlice(raw);
    expect(relClose(r.volume, 4 / 3, 1e-5)).toBe(true);
    expect(r.closed && r.consistent).toBe(true);
    expect(r.euler).toBe(2);
    const expected: Vec4[] = [[1, 0, 0, 0], [-1, 0, 0, 0], [0, 1, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, -1, 0]];
    expectSection(raw, hyperplaneW(0), cell16Planes(), expected);
    // Here no cone edge crosses w = 0 (every centroid (±¼,±¼,±¼,±¼) shares the
    // sign of w with the only non-coplanar vertex ±e_4 of its cell), so the
    // welded mesh is exactly the octahedron: 6 vertices, 8 triangles.
    expect(r.triangles).toBe(8);
    const pts = usedPoints(cleanMesh(raw));
    expect(samePointSet(pts, expected.map((v) => [v[0], v[1], v[2]] as Vec3), 1e-5)).toBe(true);
    for (const c of [-0.75, -0.3, 0.1, 0.5, 0.9]) {
      expect(relClose(signedVolume(shape.slice(hyperplaneW(c))), cell16SliceW(c), 1e-5)).toBe(true);
    }
    // w = ±1 are single vertices: nothing after cleaning.
    expect(analyseSlice(shape.slice(hyperplaneW(1))).triangles).toBe(0);
    expect(analyseSlice(shape.slice(hyperplaneW(-1))).triangles).toBe(0);
  });

  it('24-cell sliced by w = 0 is the cuboctahedron on the 12 permutations of (±1,±1,0), volume 20/3; A(c) = (4/3)[(2−|c|)³ − 3(1−|c|)³]', () => {
    const shape = polytopeShape('cell24');
    const raw = shape.slice(hyperplaneW(0));
    const r = analyseSlice(raw);
    // Cuboctahedron of edge a = √2: (5/3)√2 a³ = (5/3)√2 · 2√2 = 20/3; equivalently the
    // cube [-1,1]³ (8) minus eight unit corner tets (8 · 1/6).
    expect(relClose(r.volume, 20 / 3, 1e-5)).toBe(true);
    expect(r.closed && r.consistent).toBe(true);
    expect(r.euler).toBe(2);
    const expected: Vec4[] = [];
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) for (const si of [1, -1]) for (const sj of [1, -1]) {
      const v: Vec4 = [0, 0, 0, 0]; v[i] = si; v[j] = sj; expected.push(v);
    }
    expect(expected.length).toBe(12);
    expectSection(raw, hyperplaneW(0), cell24Planes(), expected);
    // Besides the 12 corners the slice vertices may only be the six cell
    // centroids ±e_1, ±e_2, ±e_3 that lie in w = 0 (centres of the square faces).
    const pts = usedPoints(cleanMesh(raw));
    const allowed: Vec3[] = [...expected.map((v) => [v[0], v[1], v[2]] as Vec3), [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const q of pts) expect(allowed.some((a) => dist3(a, q) < 1e-5)).toBe(true);
    // Cuboctahedron: 24 edges of length √2 among the 12 corners.
    let edges = 0;
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(dist4(expected[i], expected[j]) - Math.SQRT2) < 1e-12) edges++;
    expect(edges).toBe(24);
    for (const c of [-0.9, -0.5, -0.25, 0.25, 0.5, 0.9]) {
      expect(relClose(signedVolume(shape.slice(hyperplaneW(c))), cell24SliceW(c), 1e-5)).toBe(true);
    }
  });

  it('5-cell sliced by w = c is a shrinking tetrahedron: A(c) = (8/3)((4/√5 − c)/√5)³, A(0) = 512/375', () => {
    const shape = polytopeShape('cell5');
    const verts = trueVertices(regularPolytope('cell5'));
    const apex = verts[4];
    for (const c of [-0.4, -0.2, 0, 0.5, 1, 1.5]) {
      const raw = shape.slice(hyperplaneW(c));
      const r = analyseSlice(raw);
      expect(relClose(r.volume, cell5SliceW(c), 1e-5)).toBe(true);
      expect(r.closed && r.consistent).toBe(true);
      expect(r.euler).toBe(2);
      // Only the four apex edges cross w = c (the base lies in w = −1/√5):
      // corners apex + t (v_k − apex), t = (4/√5 − c)/√5.
      const t = (4 / SQRT5 - c) / SQRT5;
      const corners = verts.slice(0, 4).map((v) => [
        apex[0] + t * (v[0] - apex[0]), apex[1] + t * (v[1] - apex[1]), apex[2] + t * (v[2] - apex[2]), apex[3] + t * (v[3] - apex[3]),
      ] as Vec4);
      expectSection(raw, hyperplaneW(c), cell5Planes(), corners);
    }
    expect(relClose(cell5SliceW(0), 512 / 375, 1e-12)).toBe(true);
  });

  it('slice vertices carry the w of their 4D source point (§10) for a tilted hyperplane', () => {
    const rand = mulberry32(4242);
    for (const name of ['tesseract', 'cell24', 'cell600'] as PolytopeName[]) {
      const shape = polytopeShape(name);
      const h = hyperplane(randomUnit4(rand), 0.2);
      const m = shape.slice(h);
      for (let i = 0; i < m.sourceW.length; i++) {
        const q: Vec3 = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
        expect(Math.abs(unchart(h, q)[3] - m.sourceW[i])).toBeLessThan(1e-5);
      }
    }
  });
});

describe('adversarial: rotation invariance (MATH.md §2, §4, §7)', () => {
  const rand = mulberry32(31337);

  for (const name of POLYTOPE_NAMES) {
    it(`${name}: a random rotation preserves validity, hypervolume, slice integral and the §4 slice equivalence`, () => {
      const p = regularPolytope(name);
      const R = randomRotation(rand);
      // Sanity of the test's own rotation: orthonormal columns, det +1.
      const Rt = transpose4(R);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const ci: Vec4 = [R[i], R[4 + i], R[8 + i], R[12 + i]];
        const cj: Vec4 = [R[j], R[4 + j], R[8 + j], R[12 + j]];
        expect(Math.abs(dot4(ci, cj) - (i === j ? 1 : 0))).toBeLessThan(1e-12);
      }
      const rotated = p.positions.map((v) => apply4(R, v));
      const report = validateTetComplex(rotated, p.tets);
      expect(report.ok).toBe(true);
      expect(report.degenerateTets).toBe(0);
      expect(report.tetCount).toBe(p.tets.length);
      // det[R a; R b; R c; R d] = det R · det[a; b; c; d] = det[a; b; c; d]: exact up to rounding.
      const vol = hypervolumeByCones(p.positions, p.tets);
      expect(relClose(hypervolumeByCones(rotated, p.tets), vol, 1e-12)).toBe(true);
      expect(relClose(signedHypervolume(rotated, p.tets), vol, 1e-12)).toBe(true);

      const rotShape = new TetShape(name, 'polytope', { positions: rotated, tets: p.tets }, null);
      const shape = polytopeShape(name);
      expect(relClose(rotShape.radius(), shape.radius(), 1e-12)).toBe(true);
      const n = randomUnit4(rand);
      const nBack = apply4(Rt, n); // slicing R·P by n ≡ slicing P by Rᵀn
      const iRot = sliceVolumeIntegral(rotShape, n, 200);
      const iOrig = sliceVolumeIntegral(shape, nBack, 200);
      expect(relClose(iRot, vol, 2e-5)).toBe(true);
      // Same geometric slices, different chart and Float32 rounding: 1e-5.
      expect(relClose(iRot, iOrig, 1e-5)).toBe(true);

      // §4: slicing the rotated object with w = c equals slicing the unrotated
      // object with hyperplaneFromRotation(R, c), in the same chart coordinates.
      for (const c of [0, 0.37 * EXPECTED[name].inradius, -0.61 * EXPECTED[name].inradius]) {
        const a = rotShape.slice(hyperplaneW(c));
        const b = shape.slice(hyperplaneFromRotation(R, c));
        const ra = analyseSlice(a);
        const rb = analyseSlice(b);
        expect(ra.closed && ra.consistent && rb.closed && rb.consistent).toBe(true);
        expect(ra.volume).toBeGreaterThan(0);
        expect(relClose(ra.volume, rb.volume, 1e-5)).toBe(true);
        expect(samePointSet(usedPoints(cleanMesh(a)), usedPoints(cleanMesh(b)), 1e-5)).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Second wave: hull3 contract, §8.2 clique/duality exactness, vertex figures,
// and proof that the validators relied on above actually have teeth.
// ---------------------------------------------------------------------------

describe('adversarial: convexHull3 contract (hull3.ts, MATH.md §8.3)', () => {
  /**
   * Check the documented contract: one polygon per facet, CCW seen from
   * outside (cross(v1−v0, v2−v0) ∥ +normal), unit outward normals, every
   * input point used, each hull edge in exactly two facets, polyhedron
   * Euler characteristic 2, and the expected multiset of face sizes.
   */
  function checkHull(pts: Vec3[], faceSizes: Record<string, number>): ReturnType<typeof convexHull3> {
    const hull = convexHull3(pts);
    expect(hull.normals.length).toBe(hull.faces.length);
    const c: Vec3 = [0, 0, 0];
    for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; }
    const sizes: Record<string, number> = {};
    const used = new Set<number>();
    const edgeUse = new Map<string, number>();
    hull.faces.forEach((f, k) => {
      sizes[String(f.length)] = (sizes[String(f.length)] ?? 0) + 1;
      expect(new Set(f).size).toBe(f.length);
      const nrm = hull.normals[k];
      expect(Math.abs(length3(nrm) - 1)).toBeLessThan(1e-12);
      const fc: Vec3 = [0, 0, 0];
      for (const i of f) { fc[0] += pts[i][0] / f.length; fc[1] += pts[i][1] / f.length; fc[2] += pts[i][2] / f.length; }
      expect(dot3(nrm, sub3(fc, c))).toBeGreaterThan(1e-9); // outward
      for (let m = 0; m < pts.length; m++) {
        const d = dot3(nrm, sub3(pts[m], pts[f[0]]));
        if (f.includes(m)) expect(Math.abs(d)).toBeLessThan(1e-9); // on the facet plane
        else expect(d).toBeLessThan(-1e-9); // strictly inside
      }
      for (let k2 = 0; k2 < f.length; k2++) {
        const a = pts[f[k2]];
        const b = pts[f[(k2 + 1) % f.length]];
        const d = pts[f[(k2 + 2) % f.length]];
        // Every consecutive turn is a left turn about the outward normal (convex, CCW).
        expect(dot3(cross3(sub3(b, a), sub3(d, b)), nrm)).toBeGreaterThan(1e-9);
        used.add(f[k2]);
        const key = edgeKey(f[k2], f[(k2 + 1) % f.length]);
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
      }
      // The documented orientation statement, literally.
      const v0 = pts[f[0]];
      const n2 = cross3(sub3(pts[f[1]], v0), sub3(pts[f[2]], v0));
      expect(dot3(n2, nrm)).toBeGreaterThan(1e-9);
    });
    expect(sizes).toEqual(faceSizes);
    expect(used.size).toBe(pts.length);
    expect([...edgeUse.values()].every((n) => n === 2)).toBe(true);
    expect(pts.length - edgeUse.size + hull.faces.length).toBe(2);
    return hull;
  }

  const cube: Vec3[] = [];
  for (let i = 0; i < 8; i++) cube.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  const octahedron: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Standard dodecahedron: (±1,±1,±1) and cyclic permutations of (0, ±φ, ±1/φ).
  const dodecahedron: Vec3[] = [...cube];
  for (const s of [1, -1]) for (const t of [1, -1]) {
    dodecahedron.push([0, s * PHI, t / PHI], [t / PHI, 0, s * PHI], [s * PHI, t / PHI, 0]);
  }
  // Standard icosahedron: cyclic permutations of (0, ±1, ±φ).
  const icosahedron: Vec3[] = [];
  for (const s of [1, -1]) for (const t of [1, -1]) icosahedron.push([0, s, t * PHI], [t * PHI, 0, s], [s, t * PHI, 0]);
  const prism: Vec3[] = [];
  for (let k = 0; k < 3; k++) for (const z of [-1, 1]) prism.push([Math.cos((2 * Math.PI * k) / 3), Math.sin((2 * Math.PI * k) / 3), z]);
  const pyramid: Vec3[] = [[1, 1, 0], [-1, 1, 0], [-1, -1, 0], [1, -1, 0], [0, 0, 1.3]];

  it('cube → 6 quads with normals ±e_i; octahedron → 8 triangles', () => {
    const hull = checkHull(cube, { '4': 6 });
    const fmt = (n: Vec3): string => n.map((x) => (Math.abs(x) < 1e-12 ? 0 : x).toFixed(6)).join(',');
    const normalKeys = new Set(hull.normals.map(fmt));
    expect(normalKeys).toEqual(new Set(octahedron.map(fmt))); // ±e_i, the octahedron's vertices
    checkHull(octahedron, { '3': 8 });
  });

  it('dodecahedron → 12 pentagons; icosahedron → 20 triangles', () => {
    expect(dodecahedron.length).toBe(20);
    checkHull(dodecahedron, { '5': 12 });
    expect(icosahedron.length).toBe(12);
    checkHull(icosahedron, { '3': 20 });
  });

  it('non-regular inputs: triangular prism (2 triangles + 3 quads) and square pyramid (1 quad + 4 triangles)', () => {
    checkHull(prism, { '3': 2, '4': 3 });
    checkHull(pyramid, { '4': 1, '3': 4 });
  });

  it('is invariant under a random rotation, translation and scale (same facet vertex sets)', () => {
    const rand = mulberry32(555);
    const base = convexHull3(dodecahedron);
    const baseKeys = new Set(base.faces.map((f) => [...f].sort((a, b) => a - b).join(',')));
    for (let trial = 0; trial < 3; trial++) {
      // Random 3D rotation from Gram–Schmidt on Gaussian vectors.
      let u: Vec3 = [gaussian(rand), gaussian(rand), gaussian(rand)];
      u = [u[0] / length3(u), u[1] / length3(u), u[2] / length3(u)];
      let v: Vec3 = [gaussian(rand), gaussian(rand), gaussian(rand)];
      const vu = dot3(v, u);
      v = sub3(v, [u[0] * vu, u[1] * vu, u[2] * vu]);
      v = [v[0] / length3(v), v[1] / length3(v), v[2] / length3(v)];
      const w = cross3(u, v);
      const s = 0.1 + 5 * rand();
      const t: Vec3 = [gaussian(rand) * 10, gaussian(rand) * 10, gaussian(rand) * 10];
      const moved: Vec3[] = dodecahedron.map((p) => [
        s * (u[0] * p[0] + v[0] * p[1] + w[0] * p[2]) + t[0],
        s * (u[1] * p[0] + v[1] * p[1] + w[1] * p[2]) + t[1],
        s * (u[2] * p[0] + v[2] * p[1] + w[2] * p[2]) + t[2],
      ]);
      const hull = checkHull(moved, { '5': 12 });
      expect(new Set(hull.faces.map((f) => [...f].sort((a, b) => a - b).join(',')))).toEqual(baseKeys);
    }
  });

  it('rejects < 4 points, coplanar points, and a point strictly inside', () => {
    expect(() => convexHull3(cube.slice(0, 3))).toThrow();
    expect(() => convexHull3([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0.5, 0.5, 0]])).toThrow();
    expect(() => convexHull3([...cube, [0, 0, 0]])).toThrow();
  });

  it('the first cell of every polytope, mapped isometrically to R^3, hulls to the expected polyhedron', () => {
    for (const name of POLYTOPE_NAMES) {
      const p = regularPolytope(name);
      const X = EXPECTED[name];
      const idx = cellVertexSet(p, 0);
      const p0 = p.positions[idx[0]];
      // Gram–Schmidt basis of the cell's 3-flat.
      const basis: Vec4[] = [];
      for (let k = 1; k < idx.length && basis.length < 3; k++) {
        let d = sub4(p.positions[idx[k]], p0);
        for (const b of basis) d = sub4(d, scale4(b, dot4(d, b)));
        if (length4(d) > 1e-9) basis.push(scale4(d, 1 / length4(d)));
      }
      expect(basis.length).toBe(3);
      const local: Vec3[] = idx.map((i) => {
        const d = sub4(p.positions[i], p0);
        return [dot4(d, basis[0]), dot4(d, basis[1]), dot4(d, basis[2])];
      });
      checkHull(local, { [String(X.faceSize)]: X.facesPerCell });
    }
  });
});

describe('adversarial: §8.2 exactness for the 600-cell / 120-cell pair', () => {
  it('the 600-cell edge graph has exactly 600 4-cliques and the cells are exactly those', () => {
    const p = regularPolytope('cell600');
    const n = p.vertexCount;
    const adj = new Uint8Array(n * n);
    const nb: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of p.edges) { adj[a * n + b] = adj[b * n + a] = 1; nb[a].push(b); nb[b].push(a); }
    const cliques = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (const j of nb[i]) {
        if (j <= i) continue;
        for (const k of nb[i]) {
          if (k <= j || !adj[j * n + k]) continue;
          for (const l of nb[i]) {
            if (l <= k || !adj[j * n + l] || !adj[k * n + l]) continue;
            cliques.add([i, j, k, l].join(','));
          }
        }
      }
    }
    expect(cliques.size).toBe(600);
    const cellKeys = new Set(p.cells.map((_, ci) => cellVertexSet(p, ci).join(',')));
    expect(cellKeys.size).toBe(600);
    expect(cellKeys).toEqual(cliques);
  });

  it('each 120-cell cell is exactly the 20 normalised centroids of the 600-cell cells around one 600-cell vertex', () => {
    const c600 = regularPolytope('cell600');
    const c120 = regularPolytope('cell120');
    const v600 = trueVertices(c600);
    const v120 = trueVertices(c120);
    const key = (v: Vec4): string => v.map((x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(8)).join(',');
    // 120-cell cell indexed by the 600-cell vertex its centroid points at.
    const cellByDirection = new Map<string, Set<string>>();
    c120.cells.forEach((_, ci) => {
      const vs = cellVertexSet(c120, ci);
      const dir = normalize4(centroid4(vs.map((i) => v120[i])));
      cellByDirection.set(key(dir), new Set(vs.map((i) => key(v120[i]))));
    });
    expect(cellByDirection.size).toBe(120);
    // The 600-cell cells around each vertex.
    const around: Set<string>[] = Array.from({ length: v600.length }, () => new Set<string>());
    c600.cells.forEach((_, ci) => {
      const vs = cellVertexSet(c600, ci);
      const k = key(normalize4(centroid4(vs.map((i) => v600[i]))));
      for (const i of vs) around[i].add(k);
    });
    v600.forEach((v, i) => {
      expect(around[i].size).toBe(20);
      const cell = cellByDirection.get(key(v));
      expect(cell).toBeDefined();
      expect(cell).toEqual(around[i]);
    });
  });
});

describe('adversarial: vertex figures as sections (MATH.md §6, §8)', () => {
  /** Hull-based signed volume of a convex point set (independent of the slicer). */
  function hullVolume(pts: Vec3[]): number {
    const hull = convexHull3(pts);
    let v = 0;
    for (const f of hull.faces) for (let k = 1; k + 1 < f.length; k++) v += det3(pts[f[0]], pts[f[k]], pts[f[k + 1]]);
    return v / 6;
  }

  for (const name of POLYTOPE_NAMES) {
    const X = EXPECTED[name];
    it(`${name}: the section just below a vertex is its vertex figure with ${X.edgesPerVertex} corners on the edges; slicer volume = hull volume`, () => {
      const p = regularPolytope(name);
      const verts = trueVertices(p);
      const v = verts[0];
      const R = X.circumradius;
      const n = normalize4(v);
      const eps = 0.01 * R;
      const c = R - eps;
      const h = hyperplane(n, c);
      // Facet planes from the (independently verified) cells: nu = ĝ, d = inradius.
      const planes: Plane4[] = p.cells.map((_, ci) => ({
        nu: normalize4(centroid4(cellVertexSet(p, ci).map((i) => verts[i]))),
        d: X.inradius,
      }));
      // Neighbours u of v: the edge v→u meets n·p = c at t = (R − c)/(R − n·u).
      const corners: Vec4[] = [];
      for (const [a, b] of p.edges) {
        if (a !== 0 && b !== 0) continue;
        const u = verts[a === 0 ? b : a];
        const t = eps / (R - dot4(n, u));
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
        corners.push([v[0] + t * (u[0] - v[0]), v[1] + t * (u[1] - v[1]), v[2] + t * (u[2] - v[2]), v[3] + t * (u[3] - v[3])]);
      }
      expect(corners.length).toBe(X.edgesPerVertex);
      const raw = polytopeShape(name).slice(h);
      expectSection(raw, h, planes, corners);
      const r = analyseSlice(raw);
      expect(r.closed && r.consistent).toBe(true);
      expect(r.euler).toBe(2);
      // Independent volume: hull of the exact corners in chart coordinates.
      const chartCorners: Vec3[] = corners.map((q) => [dot4(h.basis[0], q), dot4(h.basis[1], q), dot4(h.basis[2], q)]);
      const expectedVol = hullVolume(chartCorners);
      expect(expectedVol).toBeGreaterThan(0);
      // Float32 coordinates of size ~R carry ~6e-8·R absolute error; the figure
      // has size ~0.01R so its shape is known to ~6e-6 relative and the volume
      // to ~2e-5. 1e-4 relative is a 5× margin.
      expect(relClose(r.volume, expectedVol, 1e-4)).toBe(true);
    });
  }
});

describe('adversarial: the validators relied on above have teeth', () => {
  it('validateTetComplex flags a flipped, a missing and a duplicated tet of the tesseract complex', () => {
    const p = regularPolytope('tesseract');
    const flipped: Tet[] = p.tets.map((t, i) => (i === 7 ? [t[0], t[2], t[1], t[3]] : [t[0], t[1], t[2], t[3]]));
    const rf = validateTetComplex(p.positions, flipped);
    expect(rf.ok).toBe(false);
    expect(rf.inconsistentFaces).toBe(4);
    const missing = p.tets.filter((_, i) => i !== 7);
    const rm = validateTetComplex(p.positions, missing);
    expect(rm.ok).toBe(false);
    expect(rm.boundaryFaces).toBe(4);
    const dup = [...p.tets, p.tets[7]];
    const rd = validateTetComplex(p.positions, dup);
    expect(rd.ok).toBe(false);
    expect(rd.nonManifoldFaces).toBe(4);
    // Unsigned cone sum is blind to orientation, the signed one is not.
    expect(relClose(hypervolumeByCones(p.positions, flipped), 16, 1e-12)).toBe(true);
    expect(signedHypervolume(p.positions, flipped)).toBeLessThan(16 - 1e-6);
  });

  it('analyseSlice flags a flipped triangle and a removed triangle in the 16-cell octahedron slice', () => {
    const raw = polytopeShape('cell16').slice(hyperplaneW(0));
    const idx = Array.from(raw.indices);
    [idx[1], idx[2]] = [idx[2], idx[1]];
    const flipped = analyseSlice({ positions: raw.positions, indices: Uint32Array.from(idx), sourceW: raw.sourceW });
    expect(flipped.consistent).toBe(false);
    expect(flipped.inconsistentEdges).toBe(3);
    const removed = analyseSlice({ positions: raw.positions, indices: raw.indices.slice(3), sourceW: raw.sourceW });
    expect(removed.closed).toBe(false);
    expect(removed.boundaryEdges).toBe(3);
  });

  it('POLYTOPE_INFO.cellName matches the polyhedron actually built; cell surfaces are manifold', () => {
    const byShape: Record<string, string> = { '4/3': 'tetrahedron', '6/4': 'cube', '8/3': 'octahedron', '12/5': 'dodecahedron' };
    for (const name of POLYTOPE_NAMES) {
      const X = EXPECTED[name];
      expect(POLYTOPE_INFO[name].cellName).toBe(byShape[`${X.facesPerCell}/${X.faceSize}`]);
      // Within every cell each cell edge lies in exactly two of the cell's faces.
      const p = regularPolytope(name);
      p.cells.forEach((cell) => {
        const use = new Map<string, number>();
        for (const fi of cell) {
          const f = p.faces[fi];
          for (let k = 0; k < f.length; k++) {
            const key = edgeKey(f[k], f[(k + 1) % f.length]);
            use.set(key, (use.get(key) ?? 0) + 1);
          }
        }
        expect([...use.values()].every((n) => n === 2)).toBe(true);
      });
    }
  });
});
