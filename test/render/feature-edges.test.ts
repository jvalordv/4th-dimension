import { describe, expect, it } from 'vitest';
import { BoxGeometry, EdgesGeometry, SphereGeometry } from 'three';
import { FEATURE_EDGE_DEGREES, featureEdges } from '../../src/render/feature-edges';
import { buildSliceGeometry } from '../../src/render/slice-mesh';
import { wColorScale } from '../../src/app/colors';
import { placeholderTesseract } from '../../src/app/placeholder-tesseract';
import { hyperplaneFromRotation, hyperplaneW } from '../../src/math/hyperplane';
import { compositeRotation } from '../../src/math/rotation';

/** Canonical key of a segment: sorted endpoints rounded to 1e-4 (the welding precision). */
function segmentKeys(arr: ArrayLike<number>): string[] {
  const keys: string[] = [];
  const pt = (o: number): string => [arr[o], arr[o + 1], arr[o + 2]].map((v) => (Math.round(v * 1e4) / 1e4).toFixed(4)).join(',');
  for (let i = 0; i + 5 < arr.length; i += 6) {
    const a = pt(i);
    const b = pt(i + 3);
    keys.push(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys.sort();
}

const totalLength = (arr: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i + 5 < arr.length; i += 6) s += Math.hypot(arr[i] - arr[i + 3], arr[i + 1] - arr[i + 4], arr[i + 2] - arr[i + 5]);
  return s;
};

describe('featureEdges', () => {
  it('a lone triangle has three boundary edges; a flat quad only its outline', () => {
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(featureEdges(tri).length).toBe(3 * 6);
    // Two coplanar triangles sharing the diagonal (0,0)-(1,1): 4 outline edges, no diagonal.
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    const e = featureEdges(quad);
    expect(e.length).toBe(4 * 6);
    expect(totalLength(e)).toBeCloseTo(4, 10);
  });
  it('a fold of 90° is drawn, a fold of 10° is not (threshold 20°)', () => {
    // Shared edge (0,0,0)-(1,0,0), traversed in opposite directions by the two
    // triangles (consistent orientation, as the slicer guarantees, §6); the
    // second triangle is folded up by the given angle about it, so the face
    // normals (0,0,−1) and (0, sin a, −cos a) have dot product cos a.
    const fold = (deg: number): Float32Array => {
      const a = (deg * Math.PI) / 180;
      return new Float32Array([
        0, 0, 0, 1, 0, 0, 0, -1, 0,
        1, 0, 0, 0, 0, 0, 0, Math.cos(a), Math.sin(a),
      ]);
    };
    expect(featureEdges(fold(90)).length).toBe(5 * 6);
    expect(featureEdges(fold(10)).length).toBe(4 * 6);
    expect(featureEdges(fold(25)).length).toBe(5 * 6);
  });
  it('ignores zero-area triangles and zero-length edges', () => {
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // real
      1, 0, 0, 1, 0, 0, 1, 0, 0, // a point
      0, 0, 0, 1, 0, 0, 1, 0, 0, // a segment, repeated vertex
    ]);
    expect(featureEdges(soup).length).toBe(3 * 6);
  });
  it('agrees with Three EdgesGeometry on a box (12 edges) and a cube slice of the tesseract (§8.4)', () => {
    const box = new BoxGeometry(2, 2, 2).toNonIndexed();
    const mine = featureEdges(box.getAttribute('position').array, FEATURE_EDGE_DEGREES);
    const ref = new EdgesGeometry(box, FEATURE_EDGE_DEGREES).getAttribute('position').array;
    expect(segmentKeys(mine)).toEqual(segmentKeys(ref));
    expect(mine.length).toBe(12 * 6);
    expect(totalLength(mine)).toBeCloseTo(24, 5);

    const shape = placeholderTesseract();
    const geom = buildSliceGeometry(shape.slice(hyperplaneW(0.3)), wColorScale(shape.wRange()));
    const sliceMine = featureEdges(geom.getAttribute('position').array, FEATURE_EDGE_DEGREES);
    const sliceRef = new EdgesGeometry(geom, FEATURE_EDGE_DEGREES).getAttribute('position').array;
    expect(segmentKeys(sliceMine)).toEqual(segmentKeys(sliceRef));
    // 12 edges of side 2, possibly split at slice vertices: total length 24.
    expect(Math.abs(totalLength(sliceMine) - 24)).toBeLessThan(1e-3);
  });
  it('a smooth closed surface has no feature edges (UV sphere, 11.25° between faces)', () => {
    const sphere = new SphereGeometry(1, 32, 16).toNonIndexed();
    expect(featureEdges(sphere.getAttribute('position').array).length).toBe(0);
  });
  it('a rotated tesseract slice is closed: no boundary edges, all drawn edges are convex folds', () => {
    // At a generic rotation the slice is a convex polyhedron (§8.4), so every
    // feature edge joins two faces, and the tesseract's cube faces meet at 90°
    // or at the dihedral angles of a 4D cut; nothing should be a boundary.
    const shape = placeholderTesseract();
    const m = compositeRotation({ XY: 0.4, XZ: -0.3, XW: 0.9, YZ: 0.2, YW: -0.7, ZW: 0.5 });
    const geom = buildSliceGeometry(shape.slice(hyperplaneFromRotation(m, 0.35)), wColorScale(shape.wRange()));
    const withBoundary = featureEdges(geom.getAttribute('position').array, FEATURE_EDGE_DEGREES);
    // With an impossible threshold (> 180°) only boundary edges would remain: there must be none.
    const boundaryOnly = featureEdges(geom.getAttribute('position').array, 181);
    expect(boundaryOnly.length).toBe(0);
    expect(withBoundary.length).toBeGreaterThan(0);
  });
});
