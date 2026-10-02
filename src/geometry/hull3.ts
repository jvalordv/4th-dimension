import type { Vec3 } from '../math/types';
import { cross3, dot3, length3, scale3, sub3 } from '../math/vec';

/**
 * Convex hull of a small point set in R^3 as polygon faces. MATH.md §8.3:
 * "within a cell, faces are the facets of the cell's own 3D convex hull".
 */
export interface Hull3 {
  /**
   * One polygon per facet, as a cycle of indices into the input points,
   * counter-clockwise when seen from outside (so cross(v1−v0, v2−v0) points
   * outward).
   */
  readonly faces: number[][];
  /** Unit outward normal of each face, parallel to faces[k]. */
  readonly normals: Vec3[];
}

/**
 * Brute-force convex hull by supporting-plane enumeration, intended for the
 * vertex set of a single polytope cell (at most 20 points, §8).
 *
 * Every vertex triple spans a candidate plane; it is a facet plane iff all
 * points lie on its inner side within tolerance. Coplanar triples are merged
 * by keying each facet on the set of points lying in its plane, so a cube
 * yields 6 quads rather than 12 triangles. Each facet's points are then
 * ordered by angle around the facet centroid in a right-handed frame
 * (u, v, n) with u × v = n, which is counter-clockwise seen from the tip of
 * the outward normal n.
 *
 * Preconditions: at least four points, not all coplanar, and every point a
 * vertex of the hull (true for the regular cells of §8). A point strictly
 * inside the hull is detected and rejected; a point inside a facet polygon
 * is not and would corrupt that facet's cycle.
 *
 * `relTol` is relative to the largest distance of a point from the centroid.
 */
export function convexHull3(points: readonly Vec3[], relTol = 1e-9): Hull3 {
  const n = points.length;
  if (n < 4) throw new Error(`convexHull3: need at least 4 points, got ${n}`);

  const c: Vec3 = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const centroid = scale3(c, 1 / n);

  let scale = 0;
  for (const p of points) scale = Math.max(scale, length3(sub3(p, centroid)));
  if (scale === 0) throw new Error('convexHull3: all points coincide');
  const tol = relTol * scale;
  // |cross| of two edge vectors is twice a triangle area, hence scale².
  const areaTol = relTol * scale * scale;

  const seen = new Set<string>();
  const faces: number[][] = [];
  const normals: Vec3[] = [];
  const covered = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        let normal = cross3(sub3(points[j], a), sub3(points[k], a));
        const len = length3(normal);
        if (len <= areaTol) continue; // collinear triple
        normal = scale3(normal, 1 / len);
        // Outward: away from the centroid, which is interior to the hull.
        if (dot3(normal, sub3(a, centroid)) < 0) normal = scale3(normal, -1);

        const onPlane: number[] = [];
        let supporting = true;
        for (let m = 0; m < n; m++) {
          const d = dot3(normal, sub3(points[m], a));
          if (d > tol) { supporting = false; break; }
          if (d >= -tol) onPlane.push(m);
        }
        if (!supporting) continue;

        const key = onPlane.join(','); // ascending, since m increases
        if (seen.has(key)) continue;
        seen.add(key);
        for (const m of onPlane) covered[m] = 1;
        faces.push(orderCycle(points, onPlane, normal));
        normals.push(normal);
      }
    }
  }

  if (faces.length < 4) throw new Error('convexHull3: points are coplanar');
  for (let m = 0; m < n; m++) {
    if (!covered[m]) throw new Error(`convexHull3: point ${m} lies strictly inside the hull`);
  }
  return { faces, normals };
}

/**
 * Order the coplanar points `idx` counter-clockwise about their centroid as
 * seen from the tip of the unit normal: with u ⊥ n and v = n × u we have
 * u × v = n, so increasing atan2(v·d, u·d) is counter-clockwise from outside.
 */
function orderCycle(points: readonly Vec3[], idx: readonly number[], normal: Vec3): number[] {
  const fc: Vec3 = [0, 0, 0];
  for (const m of idx) { fc[0] += points[m][0]; fc[1] += points[m][1]; fc[2] += points[m][2]; }
  const center = scale3(fc, 1 / idx.length);

  let u = sub3(points[idx[0]], center);
  u = sub3(u, scale3(normal, dot3(u, normal)));
  const ul = length3(u);
  if (ul === 0) throw new Error('convexHull3: facet vertex coincides with facet centroid');
  u = scale3(u, 1 / ul);
  const v = cross3(normal, u);

  const angle = new Map<number, number>();
  for (const m of idx) {
    const d = sub3(points[m], center);
    angle.set(m, Math.atan2(dot3(d, v), dot3(d, u)));
  }
  return [...idx].sort((p, q) => (angle.get(p) as number) - (angle.get(q) as number));
}
