/**
 * Stand-in tesseract so the viewer runs end to end before the polytope
 * module is integrated. The tet complex copies test/core/tesseract-fixture.ts
 * (8 cubic cells coned from their centroids, 96 tets); the wire is the
 * polytope's own 16 vertices, 32 edges and 24 square faces (MATH.md §8).
 */
import type { Shape4, Tet, Vec4, WireMesh4 } from '../math/types';
import { coneTetrahedralize, orientTetsOutward } from '../geometry/tets';
import { TetShape } from '../geometry/shape';

/** Vertex index of (±1, ±1, ±1, ±1): bit k of the index is the sign of axis k. */
const vertexIndex = (c: readonly number[]): number =>
  (c[0] > 0 ? 1 : 0) | (c[1] > 0 ? 2 : 0) | (c[2] > 0 ? 4 : 0) | (c[3] > 0 ? 8 : 0);

/**
 * The square face with axes `fixed` pinned to signs and the two `free` axes
 * cycling through (−,−), (+,−), (+,+), (−,+): a 4-cycle of vertex indices
 * whose consecutive vertices differ in exactly one coordinate.
 */
function squareFace(fixed: ReadonlyArray<readonly [number, number]>, free: readonly [number, number]): number[] {
  const corners: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return corners.map(([s0, s1]) => {
    const c = [0, 0, 0, 0];
    for (const [ax, sg] of fixed) c[ax] = sg;
    c[free[0]] = s0;
    c[free[1]] = s1;
    return vertexIndex(c);
  });
}

export interface TesseractData {
  /** 16 polytope vertices followed by the 8 cell centroids used as cone apices. */
  positions: Vec4[];
  tets: Tet[];
  wire: WireMesh4;
}

/** Build [-1, 1]^4 as positions, outward tets and wire structure. */
export function tesseractData(): TesseractData {
  const positions: Vec4[] = [];
  for (let i = 0; i < 16; i++) {
    positions.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  }
  const vertices = positions.slice();

  // Edges: pairs of vertices differing in exactly one bit (one coordinate).
  const edges: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < 4; k++) {
      const j = i ^ (1 << k);
      if (i < j) edges.push([i, j]);
    }
  }

  // Faces: choose the two fixed axes (6 pairs) and their signs (4): 24 squares.
  const faces: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const free = [0, 1, 2, 3].filter((ax) => ax !== a && ax !== b) as [number, number];
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) faces.push(squareFace([[a, sa], [b, sb]], free));
    }
  }

  // Tets: cone each of the 8 cells from its centroid over its 6 square faces.
  let tets: Tet[] = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const sign of [-1, 1]) {
      const others = [0, 1, 2, 3].filter((ax) => ax !== axis);
      const cellFaces: number[][] = [];
      for (const ax2 of others) {
        const free = others.filter((ax) => ax !== ax2) as [number, number];
        for (const sg2 of [-1, 1]) cellFaces.push(squareFace([[axis, sign], [ax2, sg2]], free));
      }
      const centroid: Vec4 = [0, 0, 0, 0];
      centroid[axis] = sign;
      tets = tets.concat(coneTetrahedralize(positions, cellFaces, centroid).tets);
    }
  }
  return {
    positions,
    tets: orientTetsOutward(positions, tets, [0, 0, 0, 0]),
    wire: { positions: vertices, edges, faces },
  };
}

/** The placeholder tesseract as a Shape4 (radius 2, w ∈ [−1, 1]). */
export function placeholderTesseract(): Shape4 {
  const { positions, tets, wire } = tesseractData();
  return new TetShape('Tesseract', 'polytope', { positions, tets }, wire);
}
