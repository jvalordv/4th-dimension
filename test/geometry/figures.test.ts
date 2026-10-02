import { describe, expect, it } from 'vitest';
import { cubinder, human, knotPrism, LIFTED_SHAPES, mug, spherinder, torusPrism } from '../../src/geometry/figures';
import { ExtrudedSolid } from '../../src/geometry/extrude';
import { CompoundShape } from '../../src/geometry/compound';
import { icosphere, mesh3Bounds, mesh3Volume, torus, torusKnot } from '../../src/geometry/mesh3';
import { hyperplane, hyperplaneW } from '../../src/math/hyperplane';
import { analyseSlice } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { planarSection, sectionArea } from '../../src/geometry/section';
import { SHAPE_IDS } from '../../src/app/registry';
import { dot4, normalize4 } from '../../src/math/vec';
import type { Shape4, Vec4 } from '../../src/math/types';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);
const relErr = (a: number, b: number): number => Math.abs(a / b - 1);

/** Area of the regular n-gon inscribed in the unit circle, over π. */
const polygonRatio = (n: number): number => (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);

/** Centre of a part's bounding box, lifted to w = 0: a point every part's slices can be aimed at. */
function partCentre(part: ExtrudedSolid): Vec4 {
  const { min, max } = mesh3Bounds(part.mesh);
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, 0];
}

const asExtruded = (s: Shape4): ExtrudedSolid => {
  expect(s).toBeInstanceOf(ExtrudedSolid);
  return s as ExtrudedSolid;
};

/** Slice each part along seeded random directions through its centre; every slice must be closed and consistent. */
function expectPartsSliceClosed(figure: CompoundShape, seed: number, directions: number): void {
  const r = rng(seed);
  for (let k = 0; k < directions; k++) {
    const n = randUnit4(r);
    for (const part of figure.parts) {
      const p = asExtruded(part);
      const a = analyseSlice(p.slice(hyperplane(n, dot4(n, partCentre(p)))));
      expect(a.triangles).toBeGreaterThan(0);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.volume).toBeGreaterThan(0);
    }
  }
}

describe('LIFTED_SHAPES catalogue', () => {
  it('lists the six lifted shapes with the canonical ids and working factories', () => {
    expect(LIFTED_SHAPES.map((e) => e.id)).toEqual([
      SHAPE_IDS.spherinder, SHAPE_IDS.cubinder, SHAPE_IDS.torusPrism, SHAPE_IDS.knotPrism, SHAPE_IDS.mug, SHAPE_IDS.human,
    ]);
    expect(LIFTED_SHAPES.map((e) => e.id)).toEqual(['spherinder', 'cubinder', 'torus-prism', 'knot-prism', 'mug', 'human']);
    for (const entry of LIFTED_SHAPES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(['Lifted 3D objects', 'Figures']).toContain(entry.group);
      const shape = entry.create();
      expect(shape.kind).toBe(entry.group === 'Figures' ? 'compound' : 'lifted');
      expect(shape.radius()).toBeGreaterThan(0);
      const [lo, hi] = shape.wRange();
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(0);
      expect(shape.wire()).not.toBeNull();
    }
  });
});

describe('spherinder, cubinder, torus prism, knot prism', () => {
  it('spherinder = icosphere(1, 3) × [−1, 1]: its w-slice is the icosphere, radius √2', () => {
    const s = spherinder();
    expect(s.name).toBe('Spherinder');
    expect(s.halfHeight).toBe(1);
    expect(s.complex.tets.length).toBe(3 * 20 * 64);
    expect(s.radius()).toBeCloseTo(Math.SQRT2, 12);
    expect(s.wRange()).toEqual([-1, 1]);
    // At w = c the lateral tets reproduce the mesh exactly (no caps, §6), so the
    // volume is mesh3Volume; Float32 output limits agreement to ~1e-7.
    const a = analyseSlice(s.slice(hyperplaneW(0)));
    expect(a.closed).toBe(true);
    expect(a.euler).toBe(2);
    expect(relErr(a.volume, mesh3Volume(icosphere(1, 3)))).toBeLessThan(1e-6);
  });

  it('cubinder = cylinder(1, 2, 48) × [−1, 1]: w-slice volume 2π·ratio(48), x-slices are rectangle prisms', () => {
    const c = cubinder();
    expect(c.name).toBe('Cubinder');
    expect(c.radius()).toBeCloseTo(Math.hypot(Math.SQRT2, 1), 12); // rim vertex (1, 0, ±1) and w = ±1
    // Cylinder volume = polygon area × height = π r² h · (n/2π) sin(2π/n) (mesh3 doc).
    const w = analyseSlice(c.slice(hyperplaneW(0.5)));
    expect(w.closed).toBe(true);
    expect(w.euler).toBe(2);
    expect(relErr(w.volume, Math.PI * 1 * 2 * polygonRatio(48))).toBeLessThan(1e-6);
    // x = 0 passes through the rim vertices at φ = 90°, 270° (48 is divisible
    // by 4, so they sit at y = ±1 exactly) and both cap centres: the section
    // is the 2 × 2 rectangle, area 4, and the slice its prism of volume 4 · 2h = 8.
    const x0 = analyseSlice(c.slice(hyperplane([1, 0, 0, 0], 0)));
    expect(x0.closed).toBe(true);
    expect(x0.consistent).toBe(true);
    expect(x0.euler).toBe(2);
    expect(x0.volume).toBeCloseTo(8, 5);
    // A generic offset: prism over the chord section, volume = area × 2h.
    const { loops } = planarSection(c.mesh, [1, 0, 0], 0.37);
    const x1 = analyseSlice(c.slice(hyperplane([1, 0, 0, 0], 0.37)));
    expect(x1.closed).toBe(true);
    expect(x1.euler).toBe(2);
    expect(relErr(x1.volume, sectionArea(loops) * 2)).toBeLessThan(1e-5);
  });

  it('torus prism = torus(1, 0.4, 48, 24) × [−0.6, 0.6]: w-slice is the solid torus, χ = 0', () => {
    const t = torusPrism();
    expect(t.halfHeight).toBe(0.6);
    expect(t.wRange()).toEqual([-0.6, 0.6]);
    expect(t.radius()).toBeCloseTo(Math.hypot(1.4, 0.6), 12);
    const a = analyseSlice(t.slice(hyperplaneW(0.1)));
    expect(a.closed).toBe(true);
    expect(a.euler).toBe(0);
    expect(relErr(a.volume, mesh3Volume(torus(1, 0.4, 48, 24)))).toBeLessThan(1e-6);
  });

  it('knot prism = torusKnot(0.8, 0.25, 2, 3, 128, 16) × [−0.5, 0.5]: slices are knotted solid tori', () => {
    const k = knotPrism();
    expect(k.halfHeight).toBe(0.5);
    expect(k.complex.tets.length).toBe(3 * 2 * 128 * 16);
    const knot = torusKnot(0.8, 0.25, 2, 3, 128, 16);
    const a = analyseSlice(k.slice(hyperplaneW(0)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(0);
    expect(relErr(a.volume, mesh3Volume(knot))).toBeLessThan(1e-6);
    // A gently tilted hyperplane whose slab holds the whole knot: the knot
    // reaches radius 1.5 · 0.8 + 0.25 = 1.45 from the origin, so with
    // n ∝ (0.1, 0.05, 0.1, 1) and c = 0, |n_xyz · q| ≤ 0.15 · 1.45 < 0.5 = h · n_w
    // and the slice is the whole knot sheared (factor 1/|n̂_w| = √1.0225), χ = 0.
    const n: Vec4 = [0.1, 0.05, 0.1, 1];
    const b = analyseSlice(k.slice(hyperplane(n, 0)));
    expect(b.closed).toBe(true);
    expect(b.consistent).toBe(true);
    expect(b.euler).toBe(0);
    expect(relErr(b.volume, mesh3Volume(knot) * Math.sqrt(1.0225))).toBeLessThan(1e-5);
  });
});

describe('mug', () => {
  const m = mug();

  it('is a compound of an extruded cylinder body and an extruded torus handle, placed like a mug', () => {
    expect(m).toBeInstanceOf(CompoundShape);
    expect(m.kind).toBe('compound');
    expect(m.parts.length).toBe(2);
    const [body, handle] = m.parts.map(asExtruded);
    expect(body.name).toBe('Mug body');
    expect(handle.name).toBe('Mug handle');
    // Body: radius 0.5, height 1.2 along y; handle: major 0.32, minor 0.08 at x = 0.78.
    const bb = mesh3Bounds(body.mesh);
    expect(bb.min[1]).toBeCloseTo(-0.6, 12);
    expect(bb.max[1]).toBeCloseTo(0.6, 12);
    expect(bb.max[0]).toBeCloseTo(0.5, 12);
    const hb = mesh3Bounds(handle.mesh);
    expect(hb.min[0]).toBeCloseTo(0.78 - 0.4, 12); // inner rim inside the body wall (x = 0.5)
    expect(hb.max[0]).toBeCloseTo(0.78 + 0.4, 12);
    expect(hb.max[2]).toBeCloseTo(0.08, 12);
    expect(m.wRange()).toEqual([-0.5, 0.5]);
    expect(m.radius()).toBeCloseTo(Math.hypot(1.18, 0.5), 12);
    // The w-slice is the mug itself: two closed components (sphere + torus,
    // χ = 2 + 0), each with its own exact volume; the parts overlap and are
    // not merged, so the volumes simply add.
    const a = analyseSlice(m.slice(hyperplaneW(0)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(2);
    const bodyVolume = Math.PI * 0.25 * 1.2 * polygonRatio(48);
    const handleVolume = 2 * Math.PI ** 2 * 0.32 * 0.08 ** 2 * polygonRatio(32) * polygonRatio(12);
    expect(relErr(mesh3Volume(body.mesh), bodyVolume)).toBeLessThan(1e-12);
    expect(relErr(mesh3Volume(handle.mesh), handleVolume)).toBeLessThan(1e-12);
    expect(relErr(a.volume, bodyVolume + handleVolume)).toBeLessThan(1e-6);
  });

  it('every part slices closed along two seeded random directions', () => {
    expectPartsSliceClosed(m, 31, 2);
  });
});

describe('human', () => {
  const figure = human();

  it('is 16 extruded primitives, 2 units tall between y = −1 and y = +1, standing along +y, mirror symmetric', () => {
    expect(figure).toBeInstanceOf(CompoundShape);
    expect(figure.parts.length).toBe(16);
    const parts = figure.parts.map(asExtruded);
    for (const p of parts) expect(p.halfHeight).toBe(0.5);
    expect(figure.wRange()).toEqual([-0.5, 0.5]);
    const w = figure.wire();
    expect(w).not.toBeNull();
    if (!w) return;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 0;
    let maxZ = 0;
    for (const p of w.positions) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      maxX = Math.max(maxX, Math.abs(p[0]));
      maxZ = Math.max(maxZ, Math.abs(p[2]));
    }
    // Crown of the head (a uvSphere pole) at 7.5 heads = +1, soles at 0 heads = −1.
    expect(maxY).toBeCloseTo(1, 9);
    expect(minY).toBeCloseTo(-1, 9);
    expect(maxY - minY).toBeCloseTo(2, 9);
    // Narrow and shallow compared with its height.
    expect(maxX).toBeLessThan(0.4);
    expect(maxZ).toBeLessThan(0.3);
    // Left/right pairs are mirror images in x.
    const byName = new Map(parts.map((p) => [p.name, p]));
    const lefts = parts.filter((p) => p.name.startsWith('Left '));
    expect(lefts.length).toBe(6);
    for (const left of lefts) {
      const right = byName.get(left.name.replace('Left ', 'Right '));
      expect(right).toBeDefined();
      if (!right) continue;
      const lb = mesh3Bounds(left.mesh);
      const rb = mesh3Bounds(right.mesh);
      expect(lb.min[0]).toBeCloseTo(-rb.max[0], 12);
      expect(lb.max[0]).toBeCloseTo(-rb.min[0], 12);
      expect(lb.min[1]).toBeCloseTo(rb.min[1], 12);
      expect(lb.max[2]).toBeCloseTo(rb.max[2], 12);
    }
    // The head sits on top and the feet at the bottom.
    const head = byName.get('Head');
    const foot = byName.get('Left foot');
    expect(head && mesh3Bounds(head.mesh).max[1]).toBeCloseTo(1, 9);
    expect(foot && mesh3Bounds(foot.mesh).min[1]).toBeCloseTo(-1, 9);
    // The extrusion half-height is a parameter.
    expect(human(0.3).parts.map(asExtruded).every((p) => p.halfHeight === 0.3)).toBe(true);
  });

  it('every part slices closed along two seeded random directions', () => {
    expectPartsSliceClosed(figure, 17, 2);
  });

  it('each part\'s slice integral is its mesh volume × 2h (§7, §9.1)', () => {
    // 200 midpoint steps over [−R, R]; the parts are small relative to R
    // (R ≈ 1 for off-centre parts), so dc is still ~1% of a limb's radius and
    // the smooth A(c) integrates well within the 1% bound.
    const n: Vec4 = normalize4([0.3, 0.2, -0.1, 0.9]);
    for (const part of figure.parts.map(asExtruded)) {
      expect(relErr(sliceVolumeIntegral(part, n), mesh3Volume(part.mesh) * 2 * part.halfHeight)).toBeLessThan(0.01);
    }
  });
});
