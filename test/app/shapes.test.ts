import { describe, expect, it } from 'vitest';
import { SHAPE_ENTRIES } from '../../src/app/shapes';
import { getShape, listShapes, SHAPE_IDS } from '../../src/app/registry';
import type { ShapeGroup } from '../../src/app/registry';
import { defaultShapeId } from '../../src/app/state';
import { POLYTOPE_INFO, POLYTOPE_NAMES } from '../../src/geometry/polytopes';
import { analyseSlice } from '../../src/geometry/trimesh';
import { hyperplane, hyperplaneW } from '../../src/math/hyperplane';
import { normalize4 } from '../../src/math/vec';
import type { Shape4 } from '../../src/math/types';

/** Shapes are built once per file; the viewer caches the same way. */
const built = new Map<string, Shape4>();
const shapeOf = (id: string): Shape4 => {
  let s = built.get(id);
  if (!s) {
    const entry = getShape(id);
    if (!entry) throw new Error(`not registered: ${id}`);
    s = entry.create();
    built.set(id, s);
  }
  return s;
};

const EXPECTED_GROUPS: Readonly<Record<string, ShapeGroup>> = {
  cell5: 'Regular polytopes', tesseract: 'Regular polytopes', cell16: 'Regular polytopes',
  cell24: 'Regular polytopes', cell120: 'Regular polytopes', cell600: 'Regular polytopes',
  hypersphere: 'Curved solids', duocylinder: 'Curved solids', hopf: 'Curved solids',
  spherinder: 'Lifted 3D objects', cubinder: 'Lifted 3D objects',
  'torus-prism': 'Lifted 3D objects', 'knot-prism': 'Lifted 3D objects',
  mug: 'Figures', human: 'Figures',
};

describe('shape registry wiring (src/app/shapes)', () => {
  it('registers exactly the canonical SHAPE_IDS, each once, in catalogue order', () => {
    const ids = listShapes().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.values(SHAPE_IDS).sort());
    expect(ids).toEqual(SHAPE_ENTRIES.map((e) => e.id));
    expect(ids.length).toBe(15);
  });

  it('labels, groups and one-sentence descriptions', () => {
    for (const name of POLYTOPE_NAMES) expect(getShape(name)?.label).toBe(POLYTOPE_INFO[name].label);
    expect(getShape(SHAPE_IDS.hypersphere)?.label).toBe('Hypersphere');
    expect(getShape(SHAPE_IDS.duocylinder)?.label).toBe('Duocylinder');
    expect(getShape(SHAPE_IDS.hopf)?.label).toBe('Hopf fibration');
    for (const e of listShapes()) {
      expect(e.group).toBe(EXPECTED_GROUPS[e.id]);
      expect(e.description.trim()).toMatch(/\.$/);
      // No sentence boundary (terminator, space, capital) inside the text.
      expect(e.description).not.toMatch(/[.!?]\s+[A-Z]/);
    }
  });

  it('polytope descriptions carry the §8 counts', () => {
    for (const name of POLYTOPE_NAMES) {
      const { V, E, F, C } = POLYTOPE_INFO[name].counts;
      const d = getShape(name)?.description ?? '';
      expect(d).toContain(`${V} vertices`);
      expect(d).toContain(`${E} edges`);
      expect(d).toContain(`${F} `);
      expect(d).toContain(`${C} `);
    }
  });

  it('the tesseract is the default shape with the textbook eye distance d = 3 (MATH.md §3.2)', () => {
    expect(defaultShapeId()).toBe(SHAPE_IDS.tesseract);
    expect(getShape(SHAPE_IDS.tesseract)?.projectionDistance).toBe(3);
    for (const e of listShapes()) if (e.id !== SHAPE_IDS.tesseract) expect(e.projectionDistance).toBeUndefined();
  });

  it('radii follow the spec coordinates', () => {
    // §8: |(1,1,1,1)| = 2; §8.1: 5-cell circumradius 4/√5; §8: 16-cell ±e_i;
    // §8: 24-cell |(1,1,0,0)| = √2; §8.2: 600-/120-cell on the unit 3-sphere;
    // §8.5: 4-ball of radius 1; §8.6 with r₁ = r₂ = 1: Clifford torus points
    // (cos α, sin α, cos β, sin β) have norm √2; §3.3: Hopf fibres on unit S³;
    // §9.1: extrusion vertices (v, ±h), so spherinder √(1² + 1²) and cubinder
    // (rim radius 1, z = ±1, w = ±1) √3.
    const expected: Array<[string, number]> = [
      [SHAPE_IDS.tesseract, 2], [SHAPE_IDS.cell5, 4 / Math.sqrt(5)], [SHAPE_IDS.cell16, 1],
      [SHAPE_IDS.cell24, Math.SQRT2], [SHAPE_IDS.cell120, 1], [SHAPE_IDS.cell600, 1],
      [SHAPE_IDS.hypersphere, 1], [SHAPE_IDS.duocylinder, Math.SQRT2], [SHAPE_IDS.hopf, 1],
      [SHAPE_IDS.spherinder, Math.SQRT2], [SHAPE_IDS.cubinder, Math.sqrt(3)],
    ];
    for (const [id, r] of expected) expect(shapeOf(id).radius(), id).toBeCloseTo(r, 12);
  });

  it('kinds and wires per group: polytopes carry the §8 V/E/F, the ball has no wire, the fibration is wire-only', () => {
    for (const name of POLYTOPE_NAMES) {
      const s = shapeOf(name);
      expect(s.kind).toBe('polytope');
      const w = s.wire();
      const { V, E, F } = POLYTOPE_INFO[name].counts;
      expect(w?.positions.length).toBe(V);
      expect(w?.edges.length).toBe(E);
      expect(w?.faces.length).toBe(F);
    }
    expect(shapeOf(SHAPE_IDS.hypersphere).kind).toBe('curved');
    expect(shapeOf(SHAPE_IDS.hypersphere).wire()).toBeNull();
    const hopf = shapeOf(SHAPE_IDS.hopf).wire();
    // 24 fibres × 64 points, one closed polyline per fibre, no faces.
    expect(hopf?.positions.length).toBe(24 * 64);
    expect(hopf?.edges.length).toBe(24 * 64);
    expect(hopf?.faces.length).toBe(0);
    const duo = shapeOf(SHAPE_IDS.duocylinder).wire();
    // Clifford torus as a 48 × 48 grid: n·m vertices, 2nm edges, nm quads.
    expect(duo?.positions.length).toBe(48 * 48);
    expect(duo?.edges.length).toBe(2 * 48 * 48);
    expect(duo?.faces.length).toBe(48 * 48);
    for (const e of listShapes()) {
      if (e.group === 'Lifted 3D objects') expect(shapeOf(e.id).kind).toBe('lifted');
      if (e.group === 'Figures') expect(shapeOf(e.id).kind).toBe('compound');
      if (e.group !== 'Regular polytopes' && e.id !== SHAPE_IDS.hypersphere) expect(shapeOf(e.id).wire()).not.toBeNull();
    }
  });

  it('every solid slices to a closed, consistently oriented mesh of positive volume; the fibration is empty', () => {
    const tilted = (s: Shape4) => hyperplane(normalize4([0.3, -0.2, 0.5, 1]), 0.1 * s.radius());
    for (const e of listShapes()) {
      const s = shapeOf(e.id);
      if (e.id === SHAPE_IDS.hopf) {
        expect(s.slice(hyperplaneW(0)).indices.length).toBe(0);
        continue;
      }
      for (const h of [hyperplaneW(0), tilted(s)]) {
        const a = analyseSlice(s.slice(h));
        expect(a.closed, `${e.id} closed`).toBe(true);
        expect(a.consistent, `${e.id} consistent`).toBe(true);
        expect(a.volume, `${e.id} volume`).toBeGreaterThan(0);
      }
    }
  });

  it('spec anchors through the registry: tesseract w = 0.3 → 8 (§8.4), duocylinder w = 0 → 48-gon prism (§8.6), ball slice inside the unit ball (§8.5)', () => {
    // §8.4: n = e_w, |c| < 1: a cube of side 2, volume 8. 5 decimals: Float32
    // slice positions carry ~1e-7 relative error on coordinates of size 1.
    expect(analyseSlice(shapeOf(SHAPE_IDS.tesseract).slice(hyperplaneW(0.3))).volume).toBeCloseTo(8, 5);
    // §8.6 at w = c = 0 with r₁ = r₂ = 1: cylinder of radius 1 and height
    // 2√(1 − 0) = 2. The model is the product of regular 48-gons; the 48-gon
    // in zw has vertices at β = 0 and π (48 divisible by 4), so its chord at
    // w = 0 is exactly 2, and area(P1) = (n/2) sin(2π/n) r₁² = 24 sin(π/24).
    const area48 = 24 * Math.sin(Math.PI / 24);
    const duo = analyseSlice(shapeOf(SHAPE_IDS.duocylinder).slice(hyperplaneW(0)));
    expect(duo.euler).toBe(2);
    expect(duo.volume).toBeCloseTo(2 * area48, 5);
    // §8.5: the level-3 mesh is inscribed in S³, so its slice at c = 0 lies
    // inside the unit ball: volume ≤ 4π/3, and above 0 (checked generally above).
    const ball = analyseSlice(shapeOf(SHAPE_IDS.hypersphere).slice(hyperplaneW(0)));
    expect(ball.euler).toBe(2);
    expect(ball.volume).toBeLessThan((4 / 3) * Math.PI);
    expect(ball.volume).toBeGreaterThan(0.9 * (4 / 3) * Math.PI);
  });
});
