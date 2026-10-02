import type { Tet, Vec4 } from '../../src/math/types';
import { coneTetrahedralize, orientTetsOutward } from '../../src/geometry/tets';

/**
 * Hand-built tesseract [-1,1]^4 as a tet complex: 8 cubic cells, each coned
 * from its centroid over 6 square faces (2 fan tets per square) = 96 tets.
 * Independent of src/geometry/polytopes so it can test the slicer alone.
 */
export function tesseractFixture(): { positions: Vec4[]; tets: Tet[] } {
  const positions: Vec4[] = [];
  for (let i = 0; i < 16; i++) {
    positions.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  }
  // Square face of the cube {coord axis = sign}: fix a second axis too, cycle the other two.
  const cycle = (fixed: Array<[number, number]>, free: [number, number]): number[] => {
    const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return corners.map(([s0, s1]) => {
      const c: number[] = [0, 0, 0, 0];
      for (const [ax, sg] of fixed) c[ax] = sg;
      c[free[0]] = s0;
      c[free[1]] = s1;
      return positions.findIndex((p) => p.every((v, k) => v === c[k]));
    });
  };
  let tets: Tet[] = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const sign of [-1, 1]) {
      const others = [0, 1, 2, 3].filter((a) => a !== axis);
      const faces: number[][] = [];
      for (const ax2 of others) {
        const free = others.filter((a) => a !== ax2) as [number, number];
        for (const sg2 of [-1, 1]) faces.push(cycle([[axis, sign], [ax2, sg2]], free));
      }
      const centroid: Vec4 = [0, 0, 0, 0];
      centroid[axis] = sign;
      tets = tets.concat(coneTetrahedralize(positions, faces, centroid).tets);
    }
  }
  return { positions, tets: orientTetsOutward(positions, tets, [0, 0, 0, 0]) };
}
