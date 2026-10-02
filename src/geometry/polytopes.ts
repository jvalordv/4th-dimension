import type { Edge, Polytope4, Shape4, Tet, Vec3, Vec4 } from '../math/types';
import { centroid4, dist4, dot4, length4, normalize4, rejectFromUnit4, scale4, sub4 } from '../math/vec';
import { convexHull3 } from './hull3';
import { TetShape } from './shape';
import { coneTetrahedralize, orientTetsOutward } from './tets';

/**
 * The six regular convex 4-polytopes of MATH.md §8, built facet-first (§8.3)
 * from the catalogue coordinates, unscaled.
 */
export type PolytopeName = 'cell5' | 'tesseract' | 'cell16' | 'cell24' | 'cell120' | 'cell600';

export const POLYTOPE_NAMES: readonly PolytopeName[] = ['cell5', 'tesseract', 'cell16', 'cell24', 'cell120', 'cell600'];

export interface PolytopeInfo {
  readonly label: string;
  readonly cellName: string;
  readonly counts: { readonly V: number; readonly E: number; readonly F: number; readonly C: number };
  /** Edge length of the §8 coordinates. */
  readonly edgeLength: number;
  /** 4-volume from the §8 table, or null where MATH.md gives no closed form. */
  readonly hypervolume: number | null;
}

/** φ = (1 + √5)/2. §8.2 */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Catalogue values from MATH.md §8 (table, §8.1, §8.2).
 *
 * Edge lengths: 5-cell a = 2√2 (§8.1). Tesseract: adjacent vertices of
 * (±1,±1,±1,±1) differ in one coordinate by 2. 16-cell: |e_i − e_j| = √2.
 * 24-cell: |(1,1,0,0) − (1,0,1,0)| = √2. 600-cell: a = 1/φ (§8.2).
 *
 * 120-cell (derived; §8.2 states no closed form): two adjacent vertices are
 * the normalised centroids ν1/|ν1|, ν2/|ν2| of 600-cell tets {p,q,r,s} and
 * {p,q,r,t} sharing a face, so ν1 − ν2 = (s − t)/4. In the vertex figure of p,
 * an icosahedron of edge a = 1/φ, s and t are the apexes of the two triangles
 * on edge qr, at distance φ·a = 1 (long side of the golden rectangle), so
 * |ν1 − ν2| = 1/4. A tet of edge a has circumradius a√6/4, and its vertices
 * lie on the unit sphere, so |ν|² = 1 − 3a²/8 = 1 − 3/(8φ²) = (7 + 3√5)/16.
 * Edge = |ν1 − ν2| / |ν| = 1/√(7 + 3√5) = 1/(√2 φ²) ≈ 0.2701.
 *
 * Hypervolumes: 5-cell √5/96 · a⁴ with a = 2√2; tesseract 16; 16-cell 2/3;
 * 24-cell 8; 600- and 120-cell not asserted as closed forms (§8.2).
 */
export const POLYTOPE_INFO: Readonly<Record<PolytopeName, PolytopeInfo>> = {
  cell5: {
    label: '5-cell',
    cellName: 'tetrahedron',
    counts: { V: 5, E: 10, F: 10, C: 5 },
    edgeLength: 2 * Math.SQRT2,
    hypervolume: (Math.sqrt(5) / 96) * (2 * Math.SQRT2) ** 4,
  },
  tesseract: {
    label: 'Tesseract',
    cellName: 'cube',
    counts: { V: 16, E: 32, F: 24, C: 8 },
    edgeLength: 2,
    hypervolume: 16,
  },
  cell16: {
    label: '16-cell',
    cellName: 'tetrahedron',
    counts: { V: 8, E: 24, F: 32, C: 16 },
    edgeLength: Math.SQRT2,
    hypervolume: 2 / 3,
  },
  cell24: {
    label: '24-cell',
    cellName: 'octahedron',
    counts: { V: 24, E: 96, F: 96, C: 24 },
    edgeLength: Math.SQRT2,
    hypervolume: 8,
  },
  cell120: {
    label: '120-cell',
    cellName: 'dodecahedron',
    counts: { V: 600, E: 1200, F: 720, C: 120 },
    edgeLength: 1 / (Math.SQRT2 * PHI * PHI),
    hypervolume: null,
  },
  cell600: {
    label: '600-cell',
    cellName: 'tetrahedron',
    counts: { V: 120, E: 720, F: 1200, C: 600 },
    edgeLength: 1 / PHI,
    hypervolume: null,
  },
};

// ---- vertex sets (MATH.md §8) ---------------------------------------------

/** §8.1 */
function cell5Vertices(): Vec4[] {
  const s = 1 / Math.sqrt(5);
  return [
    [1, 1, 1, -s],
    [1, -1, -1, -s],
    [-1, 1, -1, -s],
    [-1, -1, 1, -s],
    [0, 0, 0, 4 * s],
  ];
}

/** (±1, ±1, ±1, ±1). §8 */
function tesseractVertices(): Vec4[] {
  const out: Vec4[] = [];
  for (let i = 0; i < 16; i++) {
    out.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  }
  return out;
}

/** ±e_i. §8 */
function cell16Vertices(): Vec4[] {
  const out: Vec4[] = [];
  for (let i = 0; i < 4; i++) {
    for (const s of [1, -1]) {
      const v: Vec4 = [0, 0, 0, 0];
      v[i] = s;
      out.push(v);
    }
  }
  return out;
}

/** Permutations of (±1, ±1, 0, 0). §8 */
function cell24Vertices(): Vec4[] {
  const out: Vec4[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (const si of [1, -1]) {
        for (const sj of [1, -1]) {
          const v: Vec4 = [0, 0, 0, 0];
          v[i] = si;
          v[j] = sj;
          out.push(v);
        }
      }
    }
  }
  return out;
}

/** All permutations of [0,1,2,3] with the given parity (0 even, 1 odd). */
function permutations4(parity: 0 | 1): number[][] {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      let inversions = 0;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) if (prefix[a] > prefix[b]) inversions++;
      if (inversions % 2 === parity) out.push(prefix);
      return;
    }
    rest.forEach((x, k) => rec([...prefix, x], rest.filter((_, m) => m !== k)));
  };
  rec([], [0, 1, 2, 3]);
  return out;
}

/**
 * 120 vertices on the unit 3-sphere: 8 permutations of (±1,0,0,0), 16 of
 * (±1/2,±1/2,±1/2,±1/2), 96 even permutations of (±φ/2, ±1/2, ±1/(2φ), 0). §8.2
 */
function cell600Vertices(): Vec4[] {
  const out: Vec4[] = cell16Vertices();
  for (let i = 0; i < 16; i++) {
    out.push([i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5, i & 8 ? 0.5 : -0.5]);
  }
  const magnitudes = [PHI / 2, 1 / 2, 1 / (2 * PHI)];
  for (const perm of permutations4(0)) {
    for (let s = 0; s < 8; s++) {
      const v: Vec4 = [0, 0, 0, 0];
      for (let k = 0; k < 3; k++) v[perm[k]] = (s & (1 << k) ? 1 : -1) * magnitudes[k];
      out.push(v);
    }
  }
  return out;
}

// ---- facet normals (MATH.md §8.3) ----------------------------------------

const axisNormals = (): Vec4[] => cell16Vertices();
const diagonalNormals = (): Vec4[] => tesseractVertices();

/**
 * Centroids of the 600 tetrahedral cells of the 600-cell: the 4-cliques of
 * the graph joining vertices at distance 1/φ. §8.2
 */
function cell600CellCentroids(vertices: readonly Vec4[]): Vec4[] {
  const n = vertices.length;
  const a = 1 / PHI;
  const adjacent = new Uint8Array(n * n);
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(dist4(vertices[i], vertices[j]) - a) < 1e-9) {
        adjacent[i * n + j] = adjacent[j * n + i] = 1;
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }
  const centroids: Vec4[] = [];
  for (let i = 0; i < n; i++) {
    const nb = neighbours[i];
    for (const j of nb) {
      if (j <= i) continue;
      for (const k of nb) {
        if (k <= j || !adjacent[j * n + k]) continue;
        for (const l of nb) {
          if (l <= k || !adjacent[j * n + l] || !adjacent[k * n + l]) continue;
          centroids.push(centroid4([vertices[i], vertices[j], vertices[k], vertices[l]]));
        }
      }
    }
  }
  return centroids;
}

let cell600Cache: { vertices: Vec4[]; cellCentroids: Vec4[] } | null = null;
function cell600Data(): { vertices: Vec4[]; cellCentroids: Vec4[] } {
  if (!cell600Cache) {
    const vertices = cell600Vertices();
    cell600Cache = { vertices, cellCentroids: cell600CellCentroids(vertices) };
  }
  return cell600Cache;
}

// ---- facet-first construction (MATH.md §8.3) ------------------------------

/**
 * Indices of the vertices maximising ν · v, within a tolerance relative to
 * the largest |ν · v|. Sorted ascending.
 */
function facetVertices(vertices: readonly Vec4[], nu: Vec4, relTol = 1e-9): number[] {
  let max = -Infinity;
  let scale = 0;
  const dots = vertices.map((v) => {
    const d = dot4(nu, v);
    max = Math.max(max, d);
    scale = Math.max(scale, Math.abs(d));
    return d;
  });
  const tol = relTol * scale;
  const out: number[] = [];
  dots.forEach((d, i) => { if (d >= max - tol) out.push(i); });
  return out;
}

/**
 * Orthonormal basis of the 3-flat through the given vertices, by modified
 * Gram-Schmidt on differences from the first vertex.
 */
function flatBasis(vertices: readonly Vec4[], idx: readonly number[]): [Vec4, Vec4, Vec4] {
  const p0 = vertices[idx[0]];
  let scale = 0;
  for (const i of idx) scale = Math.max(scale, length4(sub4(vertices[i], p0)));
  const basis: Vec4[] = [];
  for (let k = 1; k < idx.length && basis.length < 3; k++) {
    let d = sub4(vertices[idx[k]], p0);
    for (const u of basis) d = rejectFromUnit4(d, u);
    const l = length4(d);
    if (l <= 1e-9 * scale) continue;
    basis.push(scale4(d, 1 / l));
  }
  if (basis.length !== 3) throw new Error(`cell with ${idx.length} vertices is not 3-dimensional`);
  return [basis[0], basis[1], basis[2]];
}

/**
 * Faces of one cell as cycles of polytope vertex indices: map the cell's
 * vertices isometrically to R^3, take the convex hull, lift back. §8.3
 */
function cellFaces(vertices: readonly Vec4[], idx: readonly number[]): number[][] {
  const p0 = vertices[idx[0]];
  const [u1, u2, u3] = flatBasis(vertices, idx);
  const local: Vec3[] = idx.map((i) => {
    const d = sub4(vertices[i], p0);
    return [dot4(u1, d), dot4(u2, d), dot4(u3, d)];
  });
  return convexHull3(local).faces.map((f) => f.map((k) => idx[k]));
}

const ORIGIN: Vec4 = [0, 0, 0, 0];

/**
 * Assemble a Polytope4 from vertices and facet normals: cells are facets
 * (§8.3), faces the union of cell faces deduplicated by vertex set, edges the
 * union of face edges. The tet complex cones every cell from its centroid
 * (appended after the true vertices) over its faces, outward oriented with
 * the origin as interior point (§5.1).
 */
function buildFromFacets(name: string, vertices: readonly Vec4[], normals: readonly Vec4[]): Polytope4 {
  const faceIndex = new Map<string, number>();
  const faces: number[][] = [];
  const cells: number[][] = [];
  const cellVertexSets: number[][] = [];

  for (const nu of normals) {
    const idx = facetVertices(vertices, nu);
    const cell: number[] = [];
    for (const f of cellFaces(vertices, idx)) {
      const key = [...f].sort((a, b) => a - b).join(',');
      let fi = faceIndex.get(key);
      if (fi === undefined) {
        fi = faces.length;
        faces.push(f);
        faceIndex.set(key, fi);
      }
      cell.push(fi);
    }
    cells.push(cell);
    cellVertexSets.push(idx);
  }

  const edgeKeys = new Set<string>();
  const edges: Edge[] = [];
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k];
      const b = f[(k + 1) % f.length];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo},${hi}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([lo, hi]);
    }
  }

  const positions: Vec4[] = vertices.map((v) => [v[0], v[1], v[2], v[3]]);
  let tets: Tet[] = [];
  cells.forEach((cell, ci) => {
    // Use the shared global face cycles so both cells on a face fan it the same way.
    const polygons = cell.map((fi) => faces[fi]);
    const apex = centroid4(cellVertexSets[ci].map((i) => vertices[i]));
    tets = tets.concat(coneTetrahedralize(positions, polygons, apex).tets);
  });
  tets = orientTetsOutward(positions, tets, ORIGIN);

  return { name, positions, tets, edges, faces, cells, vertexCount: vertices.length };
}

function construct(name: PolytopeName): Polytope4 {
  switch (name) {
    case 'cell5': {
      const v = cell5Vertices();
      return buildFromFacets(name, v, v.map((p) => scale4(p, -1)));
    }
    case 'tesseract':
      return buildFromFacets(name, tesseractVertices(), axisNormals());
    case 'cell16':
      return buildFromFacets(name, cell16Vertices(), diagonalNormals());
    case 'cell24':
      return buildFromFacets(name, cell24Vertices(), [...axisNormals(), ...diagonalNormals()]);
    case 'cell600': {
      const { vertices, cellCentroids } = cell600Data();
      return buildFromFacets(name, vertices, cellCentroids);
    }
    case 'cell120': {
      // Dual of the 600-cell: vertices at the normalised cell centroids,
      // facet normals at the 600-cell's vertices. §8.2, §8.3
      const { vertices, cellCentroids } = cell600Data();
      return buildFromFacets(name, cellCentroids.map((c) => normalize4(c)), vertices);
    }
  }
}

const cache = new Map<PolytopeName, Polytope4>();

/** The named regular polytope (memoised; the 120-cell takes the longest). */
export function regularPolytope(name: PolytopeName): Polytope4 {
  let p = cache.get(name);
  if (!p) {
    p = construct(name);
    cache.set(name, p);
  }
  return p;
}

/**
 * The polytope as a viewer shape: slices through its tet complex, draws the
 * true vertices, edges and faces (the appended cell centroids are omitted
 * from the wire).
 */
export function polytopeShape(name: PolytopeName): Shape4 {
  const p = regularPolytope(name);
  return new TetShape(
    name,
    'polytope',
    { positions: p.positions, tets: p.tets },
    { positions: p.positions.slice(0, p.vertexCount), edges: p.edges, faces: p.faces },
  );
}
