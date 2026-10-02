import { describe, expect, it } from 'vitest';
import { FEATURE_EDGE_DEGREES, SliceRenderable, buildSliceGeometry, sliceScale } from '../../src/render/slice-mesh';
import { featureEdges } from '../../src/render/feature-edges';
import { gradient, wColorScale } from '../../src/app/colors';
import { placeholderTesseract } from '../../src/app/placeholder-tesseract';
import { emptyMesh } from '../../src/geometry/trimesh';
import { hyperplaneFromRotation, hyperplaneW } from '../../src/math/hyperplane';
import { compositeRotation } from '../../src/math/rotation';
import type { TriMesh3 } from '../../src/math/types';

describe('sliceScale (MATH.md §3)', () => {
  it('perspective: d / (d − c); for d = 3 the w = ±1 hyperplanes scale by 3/2 and 3/4 (§3.2)', () => {
    expect(sliceScale({ kind: 'perspective', distance: 3 }, 1)).toBeCloseTo(1.5, 12);
    expect(sliceScale({ kind: 'perspective', distance: 3 }, -1)).toBeCloseTo(0.75, 12);
    expect(sliceScale({ kind: 'perspective', distance: 3 }, 0)).toBe(1);
    // Denominator clamped at 1e-3 like projectPerspective when c reaches the eye.
    expect(sliceScale({ kind: 'perspective', distance: 3 }, 3)).toBeCloseTo(3000, 9);
  });
  it('orthographic: 1 (§3.1); stereographic: 1 / (1 − c) (§3.3)', () => {
    expect(sliceScale({ kind: 'orthographic' }, 0.9)).toBe(1);
    expect(sliceScale({ kind: 'stereographic' }, 0)).toBe(1);
    expect(sliceScale({ kind: 'stereographic' }, 0.5)).toBeCloseTo(2, 12);
  });
});

/** Per-triangle checks on a non-indexed geometry built by buildSliceGeometry. */
function forEachTriangle(
  geom: ReturnType<typeof buildSliceGeometry>,
  fn: (a: number[], b: number[], c: number[], n: number[], k: number) => void,
): number {
  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const tris = pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const v = (i: number): number[] => [pos.getX(3 * t + i), pos.getY(3 * t + i), pos.getZ(3 * t + i)];
    fn(v(0), v(1), v(2), [nrm.getX(3 * t), nrm.getY(3 * t), nrm.getZ(3 * t)], t);
  }
  return tris;
}

describe('buildSliceGeometry (MATH.md §6, §8.4, §10)', () => {
  const shape = placeholderTesseract();
  const scale = wColorScale(shape.wRange()); // [−1, 1]

  it('expands to a non-indexed geometry with outward unit face normals (cube at w = 0.3)', () => {
    const tri = shape.slice(hyperplaneW(0.3));
    const geom = buildSliceGeometry(tri, scale);
    expect(geom.getIndex()).toBeNull();
    expect(geom.getAttribute('position').count).toBe(tri.indices.length);
    expect(geom.getAttribute('color').count).toBe(tri.indices.length);
    const count = forEachTriangle(geom, (a, b, c, n) => {
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
      // The slice is the cube [−1, 1]^3 (§8.4), which contains the origin: an
      // outward normal at any boundary point p has n · p > 0. Use the centroid.
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeGreaterThan(0.5);
      // Every face normal of a cube is ±e_i.
      expect(Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]))).toBeCloseTo(1, 5);
      // All vertices lie on the cube surface: max |coord| = 1.
      for (const p of [a, b, c]) expect(Math.max(...p.map(Math.abs))).toBeCloseTo(1, 5);
    });
    expect(count).toBe(tri.indices.length / 3);
    expect(count).toBeGreaterThan(0);
  });
  it('colours every vertex by its source w: all 0.3 for the unrotated slice at w = 0.3', () => {
    const tri = shape.slice(hyperplaneW(0.3));
    for (let i = 0; i < tri.sourceW.length; i++) expect(tri.sourceW[i]).toBeCloseTo(0.3, 6);
    const geom = buildSliceGeometry(tri, scale);
    // t = 1/2 + 0.3 / 2 = 0.65 over [−1, 1].
    const want = gradient(0.65);
    const col = geom.getAttribute('color');
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i)).toBeCloseTo(want.r, 5);
      expect(col.getY(i)).toBeCloseTo(want.g, 5);
      expect(col.getZ(i)).toBeCloseTo(want.b, 5);
    }
  });
  it('feature edges of the cube slice total length 24 (12 edges of side 2) and lie on cube edges', () => {
    const geom = buildSliceGeometry(shape.slice(hyperplaneW(0.3)), scale);
    const lines = featureEdges(geom.getAttribute('position').array, FEATURE_EDGE_DEGREES);
    expect(lines.length % 6).toBe(0);
    let total = 0;
    for (let i = 0; i < lines.length; i += 6) {
      const a = [lines[i], lines[i + 1], lines[i + 2]];
      const b = [lines[i + 3], lines[i + 4], lines[i + 5]];
      total += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      // A cube edge: both endpoints have two coordinates at ±1 and the segment is axis-aligned.
      const diff = [0, 1, 2].filter((k) => Math.abs(a[k] - b[k]) > 1e-4);
      expect(diff).toHaveLength(1);
      for (const k of [0, 1, 2]) {
        if (k === diff[0]) continue;
        expect(Math.abs(a[k])).toBeCloseTo(1, 3);
        expect(Math.abs(b[k])).toBeCloseTo(1, 3);
      }
    }
    // Vertices are welded at 1e-4, so compare to 1e-3.
    expect(Math.abs(total - 24)).toBeLessThan(1e-3);
  });
  it('a rotated slice still has outward normals about the chart origin', () => {
    // The chart origin is the point c·n of 4-space (§4); with |c| = 0.35 < 1
    // (the tesseract's inradius) it is inside the solid, hence inside the
    // convex slice, so n · p > 0 for every outward face normal.
    const m = compositeRotation({ XY: 0.4, XZ: -0.3, XW: 0.9, YZ: 0.2, YW: -0.7, ZW: 0.5 });
    const tri = shape.slice(hyperplaneFromRotation(m, 0.35));
    const geom = buildSliceGeometry(tri, scale);
    let checked = 0;
    forEachTriangle(geom, (a, b, c, n) => {
      const area2 = Math.hypot(
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      );
      if (area2 < 1e-6) return; // zero-area triangles carry no orientation
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeGreaterThan(0);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    // Source w values come from the unrotated shape and stay within its w range.
    for (let i = 0; i < tri.sourceW.length; i++) {
      expect(tri.sourceW[i]).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(tri.sourceW[i]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('SliceRenderable', () => {
  it('shows a mesh with feature edges, hides when empty, and disposes', () => {
    const shape = placeholderTesseract();
    const scale = wColorScale(shape.wRange());
    const r = new SliceRenderable();
    expect(r.mesh.visible).toBe(false);
    r.setMesh(shape.slice(hyperplaneW(0)), scale);
    expect(r.mesh.visible).toBe(true);
    expect(r.edges.visible).toBe(true);
    expect(r.triangleCount).toBeGreaterThan(0);
    expect(r.edges.geometry.getAttribute('position').count).toBeGreaterThan(0);
    const empty: TriMesh3 = emptyMesh();
    r.setMesh(empty, scale);
    expect(r.mesh.visible).toBe(false);
    expect(r.triangleCount).toBe(0);
    // Slice at w = −1 is empty for the tesseract (§6: limit from below).
    r.setMesh(shape.slice(hyperplaneW(-1)), scale);
    expect(r.mesh.visible).toBe(false);
    expect(() => r.dispose()).not.toThrow();
  });
});
