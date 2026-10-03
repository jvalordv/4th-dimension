/**
 * Slices of closed 3D meshes by planes (MATH.md §11, one dimension down from
 * §6 and §9.1). The slice of a closed mesh is the planar section of
 * src/geometry/section: segments chained by shared mesh edge into closed
 * loops, outer loops counter-clockwise about the plane normal and holes
 * clockwise. Charted into the plane's 2D basis (u_1 × u_2 = normal) that is
 * counter-clockwise and clockwise in the chart, and the region is
 * triangulated by earcut with holes.
 */
import type { Vec3 } from '../math/types';
import { cross3, dot3, length3, sub3 } from '../math/vec';
import type { Mesh3 } from '../geometry/mesh3';
import { planarSection, sectionArea, triangulateSection } from '../geometry/section';
import { chart2, type Plane, type Vec2 } from './math';

/** Triangulated cross-section in the plane's chart. */
export interface FlatTriangles {
  positions: Vec2[];
  /** Three indices per triangle, counter-clockwise in the chart. */
  indices: number[];
}

export interface FlatSlice {
  /** Section loops in the chart: outer loops counter-clockwise, holes clockwise. */
  loops: Vec2[][];
  triangles: FlatTriangles;
  /**
   * z of the source 3D point (the object's own z, before any rotation) for
   * each entry of `triangles.positions`. Colour encodes this, as w in §10. §11
   */
  sourceZ: number[];
  /** Area of the region: outer loops minus their holes. */
  area: number;
}

/** The loops of a slice before triangulation. */
export interface FlatSection {
  /** Loops as 3D points of the mesh, in the plane. */
  loops3: Vec3[][];
  /** The same loops in the plane's chart. */
  loops: Vec2[][];
  area: number;
}

/**
 * Drop vertices that lie on the straight segment between their neighbours
 * (within `tol`), cyclically. A section through a mesh that triangulates
 * each flat face by a diagonal crosses that diagonal at a point on the
 * straight cut across the face; such points carry no shape (the loop and
 * the colour, which is affine in the plane, are unchanged) and would make a
 * hexagon read as a dodecagon. A genuine corner, a spike (reversal) or a
 * vertex farther than `tol` from the line is kept. Loops left with fewer
 * than three points are dropped by the caller.
 */
export function removeCollinear(loop: readonly Vec3[], tol: number): Vec3[] {
  const n = loop.length;
  if (n <= 3) return loop.map((p): Vec3 => [p[0], p[1], p[2]]);
  const prev = Array.from({ length: n }, (_, i) => (i + n - 1) % n);
  const next = Array.from({ length: n }, (_, i) => (i + 1) % n);
  const alive = new Array<boolean>(n).fill(true);
  let count = n;
  const queue: number[] = Array.from({ length: n }, (_, i) => i);
  while (queue.length > 0 && count > 3) {
    const i = queue.pop() as number;
    if (!alive[i]) continue;
    const a = loop[prev[i]];
    const b = loop[i];
    const c = loop[next[i]];
    const ac = sub3(c, a);
    const lac = length3(ac);
    // b strictly between a and c (not a reversal), and |ac × ab| / |ac| ≤ tol.
    if (lac > 0 && dot3(sub3(b, a), sub3(c, b)) > 0 && length3(cross3(ac, sub3(b, a))) <= tol * lac) {
      alive[i] = false;
      count--;
      next[prev[i]] = next[i];
      prev[next[i]] = prev[i];
      queue.push(prev[i], next[i]);
    }
  }
  const out: Vec3[] = [];
  const first = alive.indexOf(true);
  let i = first;
  do {
    out.push([loop[i][0], loop[i][1], loop[i][2]]);
    i = next[i];
  } while (i !== first);
  return out;
}

/** Section of one mesh by the plane, without triangulating. */
export function sliceSection(mesh: Mesh3, plane: Plane): FlatSection {
  const { loops } = planarSection(mesh, plane.normal, plane.offset);
  let scale = 1;
  for (const p of mesh.positions) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const tol = 1e-9 * scale;
  const loops3 = loops.map((l) => removeCollinear(l, tol)).filter((l) => l.length >= 3);
  return {
    loops3,
    loops: loops3.map((l) => l.map((q) => chart2(plane, q))),
    area: sectionArea(loops3, plane.normal),
  };
}

/** Slice of one closed mesh by the plane, charted and triangulated. §11 */
export function sliceMesh3(mesh: Mesh3, plane: Plane): FlatSlice {
  return sliceMeshes3([mesh], plane);
}

/**
 * Slice of several closed meshes drawn together (a compound such as the
 * Flatland human): loops and triangles concatenated, area the sum of the
 * parts' areas (an overlap of two parts counts once for each, as the 4D
 * compound superimposes its parts' slices, no union computed).
 */
export function sliceMeshes3(meshes: readonly Mesh3[], plane: Plane): FlatSlice {
  const loops: Vec2[][] = [];
  const positions: Vec2[] = [];
  const indices: number[] = [];
  const sourceZ: number[] = [];
  let area = 0;
  for (const mesh of meshes) {
    const section = sliceSection(mesh, plane);
    loops.push(...section.loops);
    area += section.area;
    // orientation 1: triangle normals along +normal, i.e. counter-clockwise in the chart.
    const tri = triangulateSection(section.loops3, plane.normal, 1);
    const offset = positions.length;
    for (const q of tri.positions) {
      positions.push(chart2(plane, q));
      sourceZ.push(q[2]);
    }
    for (const [a, b, c] of tri.triangles) indices.push(a + offset, b + offset, c + offset);
  }
  return { loops, triangles: { positions, indices }, sourceZ, area };
}
