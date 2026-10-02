/**
 * Adversarial review of the renderer and app shell (src/render, src/app)
 * against docs/MATH.md §2.2, §3, §4, §10. Pure-function checks only: nothing
 * here imports three's WebGLRenderer or touches the DOM. Every expectation is
 * derived in its comment from the specification or an independent hand
 * computation, never read back from the implementation.
 */
import { describe, expect, it } from 'vitest';
import '../../src/app/shapes';
import { getShape, listShapes, SHAPE_IDS } from '../../src/app/registry';
import { createState, defaultProjectionDistance, VIEW_MODES, type AnimationPreset } from '../../src/app/state';
import { advanceAnimation, triangleWave, wrapAngle } from '../../src/app/animation';
import { GRADIENT_STOPS, gradient, symmetricWScale, wColorScale } from '../../src/app/colors';
import { writeProjectedWire } from '../../src/render/wire';
import { buildSliceGeometry, SliceRenderable, sliceScale } from '../../src/render/slice-mesh';
import { compositeRotation, ROTATION_PLANES } from '../../src/math/rotation';
import { hyperplaneFromRotation, hyperplaneW } from '../../src/math/hyperplane';
import { apply4, approxEqualMat4, determinant4, orthogonalityError } from '../../src/math/mat4';
import { project, projectPerspective } from '../../src/math/projection';
import type { Mat4, RotationAngles, Shape4, Vec3, Vec4 } from '../../src/math/types';
import { polytopeShape } from '../../src/geometry/polytopes';
import { TetShape } from '../../src/geometry/shape';
import { tesseractData } from '../../src/app/placeholder-tesseract';
import { getExplainer } from '../../src/explain/content';

// ---------------------------------------------------------------------------
// Helpers independent of the code under test
// ---------------------------------------------------------------------------

/** mulberry32 PRNG so failures reproduce exactly. */
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

const randomAngles = (r: () => number): RotationAngles => {
  const a = {} as RotationAngles;
  for (const p of ROTATION_PLANES) a[p] = (r() - 0.5) * 2 * Math.PI;
  return a;
};

/** Distance from point q to the segment [a, b] in R^3. */
function distanceToSegment(q: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const aq: Vec3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / l2));
  return Math.hypot(aq[0] - t * ab[0], aq[1] - t * ab[1], aq[2] - t * ab[2]);
}

/** The w-th component of Mᵀ(q, c): the pre-rotation w of the 4D point whose rotated image is (q, c). §4, §10 */
const sourceWOf = (m: Mat4, q: Vec3, c: number): number => m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15] * c;

// ---------------------------------------------------------------------------
// §4 / §10: the viewer's slicing hyperplane
// ---------------------------------------------------------------------------

describe('viewer slice: hyperplaneFromRotation(M, c) on the unrotated shape (MATH.md §4, §10)', () => {
  const data = tesseractData();
  const unrotated = new TetShape('t', 'polytope', { positions: data.positions, tets: data.tets }, null);
  const r = mulberry32(2024);

  it('equals, position for position, the slice of the explicitly rotated complex by w = c', () => {
    for (let trial = 0; trial < 12; trial++) {
      const angles = randomAngles(r);
      const m = compositeRotation(angles);
      expect(orthogonalityError(m)).toBeLessThan(1e-12);
      expect(determinant4(m)).toBeCloseTo(1, 12);
      const c = (r() - 0.5) * 2.4; // some slices are empty: still must agree
      const rotated = new TetShape('r', 'polytope', { positions: data.positions.map((p) => apply4(m, p)), tets: data.tets }, null);
      const a = unrotated.slice(hyperplaneFromRotation(m, c));
      const b = rotated.slice(hyperplaneW(c));
      // Same tets, same classification (s_k = n·p_k − c is the same number
      // either way), hence the same triangles in the same order.
      expect(a.indices.length).toBe(b.indices.length);
      for (let i = 0; i < a.positions.length; i++) expect(a.positions[i]).toBeCloseTo(b.positions[i], 5);
    }
  });

  it('carries the pre-rotation w as sourceW, which the rotated-complex route cannot (it would be c everywhere)', () => {
    let nonConstant = 0;
    for (let trial = 0; trial < 12; trial++) {
      const m = compositeRotation(randomAngles(r));
      const c = (r() - 0.5) * 1.6;
      const rotated = new TetShape('r', 'polytope', { positions: data.positions.map((p) => apply4(m, p)), tets: data.tets }, null);
      const a = unrotated.slice(hyperplaneFromRotation(m, c));
      const b = rotated.slice(hyperplaneW(c));
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < a.sourceW.length; v++) {
        const q: Vec3 = [a.positions[3 * v], a.positions[3 * v + 1], a.positions[3 * v + 2]];
        // Independent formula: the slice vertex is the 4D point (q, c) in the
        // rotated frame, so its source is Mᵀ(q, c) and sourceW = (Mᵀ(q, c))_w.
        expect(a.sourceW[v]).toBeCloseTo(sourceWOf(m, q, c), 4);
        // §10 range: material comes from inside the object, w ∈ [−1, 1].
        expect(Math.abs(a.sourceW[v])).toBeLessThanOrEqual(1 + 1e-5);
        // The naive route colours by the rotated w, which is just c.
        expect(b.sourceW[v]).toBeCloseTo(c, 5);
        lo = Math.min(lo, a.sourceW[v]);
        hi = Math.max(hi, a.sourceW[v]);
      }
      if (hi - lo > 0.1) nonConstant++;
    }
    expect(nonConstant).toBeGreaterThan(6);
  });

  it('with no rotation the chart is the identity: slicing at w = c shows the object’s own x, y, z (§4)', () => {
    const h = hyperplaneFromRotation(compositeRotation({ XY: 0, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: 0 }), 0.25);
    expect(h.normal).toEqual([0, 0, 0, 1]);
    expect(h.basis).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
    const tri = unrotated.slice(h);
    for (let i = 0; i < tri.positions.length; i++) expect(Math.abs(tri.positions[i])).toBeLessThanOrEqual(1 + 1e-6);
    for (let v = 0; v < tri.sourceW.length; v++) expect(tri.sourceW[v]).toBeCloseTo(0.25, 6);
  });
});

// ---------------------------------------------------------------------------
// §3: projection view and overlay alignment
// ---------------------------------------------------------------------------

describe('projection view: M applied before projection, colour from (Mp)_w (MATH.md §2.2, §3, §10)', () => {
  const shape = polytopeShape('tesseract');
  const wire = shape.wire()!;
  const n = wire.positions.length;
  const R = shape.radius();
  const r = mulberry32(7);

  it('positions are project(M p) and colours gradient(1/2 + (Mp)_w / (2R)) for random M, all three projections', () => {
    for (let trial = 0; trial < 6; trial++) {
      const angles = randomAngles(r);
      const m = compositeRotation(angles);
      for (const proj of [{ kind: 'orthographic' } as const, { kind: 'perspective', distance: 3 } as const, { kind: 'stereographic' } as const]) {
        const pos = new Float32Array(3 * n);
        const col = new Float32Array(3 * n);
        writeProjectedWire(wire, m, proj, symmetricWScale(R), pos, col);
        for (let i = 0; i < n; i++) {
          const p = apply4(m, wire.positions[i]);
          const q = project(p, proj);
          expect(pos[3 * i]).toBeCloseTo(q[0], 5);
          expect(pos[3 * i + 1]).toBeCloseTo(q[1], 5);
          expect(pos[3 * i + 2]).toBeCloseTo(q[2], 5);
          const want = gradient(0.5 + p[3] / (2 * R));
          expect(col[3 * i]).toBeCloseTo(want.r, 5);
          expect(col[3 * i + 1]).toBeCloseTo(want.g, 5);
          expect(col[3 * i + 2]).toBeCloseTo(want.b, 5);
          // Rotation before projection is observable: under perspective the
          // scale factor is d/(d − (Mp)_w), not d/(d − p_w).
          if (proj.kind === 'perspective') {
            const s = 3 / (3 - p[3]);
            expect(pos[3 * i]).toBeCloseTo(p[0] * s, 5);
          }
        }
      }
    }
  });

  it('rotation preserves |p| so (Mp)_w ∈ [−R, R]: the wire gradient covers every reachable w (§2.1, §10)', () => {
    for (let trial = 0; trial < 20; trial++) {
      const m = compositeRotation(randomAngles(r));
      for (const p of wire.positions) {
        const w = apply4(m, p)[3];
        expect(Math.abs(w)).toBeLessThanOrEqual(R + 1e-9);
      }
    }
  });
});

describe('overlay: slice scaled by d/(d − c) sits on the perspective wire (MATH.md §3.2, §4)', () => {
  const shape = polytopeShape('tesseract');
  const wire = shape.wire()!;
  const r = mulberry32(99);

  it('sliceScale is d/(d − c) for perspective and exactly 1 for orthographic', () => {
    expect(sliceScale({ kind: 'perspective', distance: 3 }, 1)).toBeCloseTo(1.5, 12);
    expect(sliceScale({ kind: 'perspective', distance: 3 }, -1)).toBeCloseTo(0.75, 12);
    expect(sliceScale({ kind: 'perspective', distance: 5 }, 2)).toBeCloseTo(5 / 3, 12);
    for (const c of [-2, -0.3, 0, 0.7, 2]) expect(sliceScale({ kind: 'orthographic' }, c)).toBe(1);
    // Same clamp as projectPerspective so the overlay and the wire agree at the eye.
    expect(sliceScale({ kind: 'perspective', distance: 3 }, 3)).toBe(projectPerspective([1, 0, 0, 3], 3)[0]);
  });

  it('every wire edge crossing w = c meets the slice at a slice vertex, and the scaled vertex lies on the projected edge', () => {
    const d = 3;
    let crossings = 0;
    for (let trial = 0; trial < 8; trial++) {
      const m = compositeRotation(randomAngles(r));
      const c = (r() - 0.5) * 1.8;
      const tri = shape.slice(hyperplaneFromRotation(m, c));
      const s = sliceScale({ kind: 'perspective', distance: d }, c);
      const rotated = wire.positions.map((p) => apply4(m, p));
      const projected = rotated.map((p) => projectPerspective(p, d));
      for (const [ia, ib] of wire.edges) {
        const a = rotated[ia];
        const b = rotated[ib];
        const sa = a[3] - c;
        const sb = b[3] - c;
        if (sa * sb >= 0) continue; // §6: a crossing needs opposite signs (ties are measure zero here)
        crossings++;
        const t = sa / (sa - sb);
        // The crossing point in the rotated frame has w = c; its chart coordinates are its x, y, z.
        const q: Vec3 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        // (i) It is a vertex of the slice mesh (the slice of a convex polytope has its vertices on crossing edges).
        let best = Infinity;
        for (let v = 0; v < tri.positions.length; v += 3) {
          best = Math.min(best, Math.hypot(tri.positions[v] - q[0], tri.positions[v + 1] - q[1], tri.positions[v + 2] - q[2]));
        }
        expect(best).toBeLessThan(1e-5);
        // (ii) Scaled by d/(d − c) it lies on the projected edge: a projective map sends segments to segments.
        const scaled: Vec3 = [q[0] * s, q[1] * s, q[2] * s];
        expect(distanceToSegment(scaled, projected[ia], projected[ib])).toBeLessThan(1e-9);
        // (iii) Under orthographic projection (scale 1) the same holds with the unscaled point.
        const oa: Vec3 = [a[0], a[1], a[2]];
        const ob: Vec3 = [b[0], b[1], b[2]];
        expect(distanceToSegment(q, oa, ob)).toBeLessThan(1e-9);
      }
    }
    expect(crossings).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// §3.3: the projection pole in the stereographic wire
// ---------------------------------------------------------------------------

describe('stereographic view: a vertex at the pole is drawn beyond the far plane, not at the centre (MATH.md §3.3)', () => {
  // §3.3 defines S only for w < 1; the pole (0, 0, 0, 1) has no image. At zero
  // rotation three catalogue polytopes have a vertex exactly there: the
  // 5-cell's apex (0, 0, 0, 4/√5) (§8.1), the 16-cell's e_w and the 600-cell's
  // e_w (§8, §8.2), with 4, 6 and 12 incident edges. Drawing the pole at the
  // origin (what a clamped denominator with a zero xyz part gives) would run
  // those edges to the centre of the figure. The convention required here is
  // that the pole's image lie outside any view the viewer can show: the camera
  // orbits at most 30 R from the origin with a far plane 200 R away
  // (Viewer.frameShape), so any point farther than 230 R from the origin is
  // clipped together with the part of each incident edge near it.
  const identity = compositeRotation({ XY: 0, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: 0 });
  const cases: Array<{ name: 'cell5' | 'cell16' | 'cell600'; degree: number }> = [
    { name: 'cell5', degree: 4 },
    { name: 'cell16', degree: 6 },
    { name: 'cell600', degree: 12 },
  ];

  /** |p| − w: the denominator of S after normalising p to the unit sphere, times |p|. */
  const imageOf = (p: Vec4): Vec3 => {
    const l = Math.hypot(p[0], p[1], p[2], p[3]);
    const d = l - p[3];
    return [p[0] / d, p[1] / d, p[2] / d];
  };

  it('5-cell, 16-cell, 600-cell at zero rotation: exactly one pole vertex, sent beyond 230 R; every other vertex at (x, y, z)/(|p| − w)', () => {
    for (const { name, degree } of cases) {
      const shape = polytopeShape(name);
      const wire = shape.wire()!;
      const n = wire.positions.length;
      const R = shape.radius();
      // Hand identification of the pole: xyz = 0 and w > 0.
      const poles: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = wire.positions[i];
        if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] > 0) poles.push(i);
      }
      expect(poles, name).toHaveLength(1);
      const pole = poles[0];
      expect(wire.edges.filter(([a, b]) => a === pole || b === pole), name).toHaveLength(degree);

      const pos = new Float32Array(3 * n);
      const col = new Float32Array(3 * n);
      writeProjectedWire(wire, identity, { kind: 'stereographic' }, symmetricWScale(R), pos, col);

      const radius = (i: number): number => Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      expect(Number.isFinite(radius(pole)), name).toBe(true);
      expect(radius(pole), `${name}: pole image radius`).toBeGreaterThan(230 * R);

      // Every other vertex is drawn by the formula of §3.3 (on the normalised
      // point), unaffected by the pole convention. The largest non-pole w is
      // φ/2 (the 600-cell's neighbours of e_w), whose image radius is
      // √((1 + w)/(1 − w)) = √(1.809…/0.190…) ≈ 3.08, so no other vertex is
      // anywhere near the far plane.
      for (let i = 0; i < n; i++) {
        if (i === pole) continue;
        const q = imageOf(wire.positions[i]);
        expect(pos[3 * i], `${name} v${i} x`).toBeCloseTo(q[0], 4);
        expect(pos[3 * i + 1], `${name} v${i} y`).toBeCloseTo(q[1], 4);
        expect(pos[3 * i + 2], `${name} v${i} z`).toBeCloseTo(q[2], 4);
        expect(radius(i), `${name} v${i}`).toBeLessThan(3.1);
      }
      // Hence each edge at the pole runs from inside the 3.1 ball to beyond
      // 230 R: it leaves the frustum instead of converging on the centre.
      for (const [a, b] of wire.edges) {
        if (a !== pole && b !== pole) continue;
        const other = a === pole ? b : a;
        const len = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
        expect(len, `${name} edge ${pole}-${other}`).toBeGreaterThan(230 * R - 3.1);
      }
      // Colour is untouched by the convention: the pole has w = R, the top of the gradient.
      const top = gradient(1);
      expect(col[3 * pole]).toBeCloseTo(top.r, 5);
      expect(col[3 * pole + 1]).toBeCloseTo(top.g, 5);
      expect(col[3 * pole + 2]).toBeCloseTo(top.b, 5);
    }
  });

  it('a generic XW rotation moves every vertex off the pole and the whole wire follows §3.3 exactly', () => {
    // (M p)_w = sin θ · x + cos θ · w (§2.1); for a vertex to reach the pole it
    // would have to be proportional to (sin θ, 0, 0, cos θ), which no
    // catalogue vertex is at θ = 0.7.
    const m = compositeRotation({ XY: 0, XZ: 0, XW: 0.7, YZ: 0, YW: 0, ZW: 0 });
    for (const { name } of cases) {
      const shape = polytopeShape(name);
      const wire = shape.wire()!;
      const n = wire.positions.length;
      const pos = new Float32Array(3 * n);
      const col = new Float32Array(3 * n);
      writeProjectedWire(wire, m, { kind: 'stereographic' }, symmetricWScale(shape.radius()), pos, col);
      for (let i = 0; i < n; i++) {
        const p = apply4(m, wire.positions[i]);
        expect(1 - p[3] / Math.hypot(p[0], p[1], p[2], p[3]), `${name} v${i} off the pole`).toBeGreaterThan(1e-3);
        const q = imageOf(p);
        for (let k = 0; k < 3; k++) expect(pos[3 * i + k], `${name} v${i}`).toBeCloseTo(q[k], 4);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Shape switch: no stale slice may survive into the next shape's frame
// ---------------------------------------------------------------------------

describe('shape switch clears the slice renderable (Viewer.setShape calls SliceRenderable.clear)', () => {
  // The viewer paces slice rebuilds by the last measured build cost, so a
  // slow previous shape could otherwise keep its mesh on screen for a few
  // frames after switching. setShape clears the renderable and the pacing
  // state immediately; this checks the clear itself (the viewer needs WebGL).
  it('clear() after a non-empty slice leaves nothing visible, zero triangles and empty geometries', () => {
    const shape = polytopeShape('tesseract');
    const r = new SliceRenderable();
    r.setMesh(shape.slice(hyperplaneW(0.2)), wColorScale(shape.wRange()));
    expect(r.triangleCount).toBeGreaterThan(0);
    expect(r.mesh.visible).toBe(true);
    r.clear();
    expect(r.triangleCount).toBe(0);
    expect(r.mesh.visible).toBe(false);
    expect(r.edges.visible).toBe(false);
    expect(r.mesh.geometry.getAttribute('position')).toBeUndefined();
    expect(r.edges.geometry.getAttribute('position')).toBeUndefined();
    // A later empty slice is the same state, and a non-empty one restores drawing.
    r.setMesh(shape.slice(hyperplaneW(-1)), wColorScale(shape.wRange()));
    expect(r.mesh.visible).toBe(false);
    const cube = shape.slice(hyperplaneW(0));
    r.setMesh(cube, wColorScale(shape.wRange()));
    expect(r.mesh.visible).toBe(true);
    expect(r.triangleCount).toBe(cube.indices.length / 3);
    expect(r.triangleCount).toBeGreaterThan(0);
    r.dispose();
  });
});

// ---------------------------------------------------------------------------
// §10: colour maps of the two views
// ---------------------------------------------------------------------------

describe('colour encoding (MATH.md §10)', () => {
  it('both views use one gradient with w = 0 at the midpoint stop and the extent at the ends', () => {
    const mid = GRADIENT_STOPS[(GRADIENT_STOPS.length - 1) / 2];
    for (const scale of [symmetricWScale(2), wColorScale([-1, 1]), wColorScale([-1 / Math.sqrt(5), 4 / Math.sqrt(5)])]) {
      expect(scale.t(0)).toBe(0.5);
      expect(scale.color(0)).toEqual(mid);
      expect(scale.t(scale.min)).toBeCloseTo(0, 12);
      expect(scale.t(scale.max)).toBeCloseTo(1, 12);
      expect(scale.color(scale.min)).toEqual(gradient(0));
      expect(scale.color(scale.max)).toEqual(gradient(1));
      // Monotone in w.
      let prev = -Infinity;
      for (let w = scale.min - 0.5; w <= scale.max + 0.5; w += 0.05) {
        expect(scale.t(w)).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = scale.t(w);
      }
    }
  });

  it('slice colours: the 5-cell sliced at w = 0 by XW rotation is coloured by pre-rotation w over [−1/√5, 4/√5] (§8.1)', () => {
    const shape = polytopeShape('cell5');
    const [wmin, wmax] = shape.wRange();
    expect(wmin).toBeCloseTo(-1 / Math.sqrt(5), 12);
    expect(wmax).toBeCloseTo(4 / Math.sqrt(5), 12);
    const m = compositeRotation({ XY: 0, XZ: 0, XW: Math.PI / 3, YZ: 0, YW: 0, ZW: 0 });
    const tri = shape.slice(hyperplaneFromRotation(m, 0));
    expect(tri.indices.length).toBeGreaterThan(0);
    const geom = buildSliceGeometry(tri, wColorScale(shape.wRange()));
    const col = geom.getAttribute('color');
    const pos = geom.getAttribute('position');
    expect(col.count).toBe(tri.indices.length);
    for (let k = 0; k < col.count; k++) {
      const v = tri.indices[k];
      const w = tri.sourceW[v];
      // Independent piecewise map: each side scaled by its own extent.
      const t = w < 0 ? 0.5 - 0.5 * Math.min(1, -w / -wmin) : 0.5 + 0.5 * Math.min(1, w / wmax);
      const want = gradient(t);
      expect(col.getX(k)).toBeCloseTo(want.r, 5);
      expect(col.getY(k)).toBeCloseTo(want.g, 5);
      expect(col.getZ(k)).toBeCloseTo(want.b, 5);
      // sourceW is the w-component of Mᵀ(q, 0) for the drawn vertex q.
      const q: Vec3 = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      expect(w).toBeCloseTo(sourceWOf(m, q, 0), 4);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.2: the eye must stay beyond every point, for every registered shape
// ---------------------------------------------------------------------------

describe('perspective eye distance vs shape radius, every registered shape (MATH.md §3.2)', () => {
  const built: Array<{ id: string; shape: Shape4; d: number }> = listShapes().map((e) => {
    const shape = e.create();
    return { id: e.id, shape, d: e.projectionDistance ?? defaultProjectionDistance(shape.radius()) };
  });

  it('d > R so d − w > 0 for every rotated vertex; the UI floor 1.05 R never exceeds the default', () => {
    for (const { id, shape, d } of built) {
      const R = shape.radius();
      expect(R, id).toBeGreaterThan(0);
      expect(d, id).toBeGreaterThan(R);
      expect(d, id).toBeGreaterThanOrEqual(Math.max(1.05 * R, 0.5));
      // Largest scale factor over the reachable w ∈ [−R, R] is finite.
      expect(d / (d - R), id).toBeLessThan(Infinity);
      // Overlay scale over the whole slider range [−R, R] stays finite and positive.
      for (const c of [-R, -R / 2, 0, R / 2, R]) {
        const s = sliceScale({ kind: 'perspective', distance: d }, c);
        expect(Number.isFinite(s) && s > 0, `${id} c=${c}`).toBe(true);
      }
    }
  });

  it('wire vertices really stay inside the radius ball (so the bound above is meaningful)', () => {
    for (const { id, shape } of built) {
      const w = shape.wire();
      if (!w) continue;
      const R = shape.radius();
      for (const p of w.positions) expect(Math.hypot(p[0], p[1], p[2], p[3]), id).toBeLessThanOrEqual(R + 1e-9);
      const [wmin, wmax] = shape.wRange();
      for (const p of w.positions) {
        expect(p[3], id).toBeGreaterThanOrEqual(wmin - 1e-9);
        expect(p[3], id).toBeLessThanOrEqual(wmax + 1e-9);
      }
    }
  });

  it('the tesseract keeps the textbook d = 3 (§3.2) and the default is max(3, 2.5 R)', () => {
    expect(getShape(SHAPE_IDS.tesseract)?.projectionDistance).toBe(3);
    expect(defaultProjectionDistance(2)).toBe(5);
    expect(defaultProjectionDistance(1)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Animation presets and wrap-around
// ---------------------------------------------------------------------------

describe('animation presets (build spec) and angle wrap-around', () => {
  const stateWith = (preset: AnimationPreset, speed: number) => {
    const s = createState('tesseract', 2);
    s.animation.preset = preset;
    s.animation.speed = speed;
    return s;
  };

  it('double-rotation: XY at ω, ZW at 0.7 ω; isoclinic: equal rates and every vector turns by the same angle (§2.3)', () => {
    const a = stateWith('double-rotation', 1.3);
    advanceAnimation(a, 0.25, 2);
    expect(a.angles.XY).toBeCloseTo(0.325, 12);
    expect(a.angles.ZW).toBeCloseTo(0.7 * 0.325, 12);
    const b = stateWith('isoclinic', 1.3);
    advanceAnimation(b, 0.25, 2);
    expect(b.angles.XY).toBeCloseTo(0.325, 12);
    expect(b.angles.ZW).toBeCloseTo(0.325, 12);
    const m = compositeRotation(b.angles);
    const r = mulberry32(3);
    for (let i = 0; i < 10; i++) {
      const v: Vec4 = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
      const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3];
      const mv = apply4(m, v);
      expect(v[0] * mv[0] + v[1] * mv[1] + v[2] * mv[2] + v[3] * mv[3]).toBeCloseTo(vv * Math.cos(0.325), 12);
    }
  });

  it('pass-through: triangle wave within ±R, reaching both ends; tumble: XW at ω and |c| ≤ 0.3 R', () => {
    const R = 1.7;
    const s = stateWith('pass-through', 2);
    let lo = Infinity;
    let hi = -Infinity;
    const r = mulberry32(5);
    for (let i = 0; i < 5000; i++) {
      advanceAnimation(s, r() * 0.05, R);
      expect(Math.abs(s.sliceOffset)).toBeLessThanOrEqual(R + 1e-12);
      lo = Math.min(lo, s.sliceOffset);
      hi = Math.max(hi, s.sliceOffset);
      expect(s.angles).toEqual({ XY: 0, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: 0 });
    }
    expect(lo).toBeLessThan(-0.99 * R);
    expect(hi).toBeGreaterThan(0.99 * R);
    // The wave is R · triangleWave(phase) exactly.
    expect(s.sliceOffset).toBeCloseTo(R * triangleWave(s.animation.phase), 12);

    const t = stateWith('tumble', 0.8);
    let phase = 0;
    for (let i = 0; i < 2000; i++) {
      const dt = r() * 0.05;
      advanceAnimation(t, dt, R);
      phase += 0.8 * dt;
      expect(Math.abs(t.sliceOffset)).toBeLessThanOrEqual(0.3 * R + 1e-12);
      expect(t.sliceOffset).toBeCloseTo(0.3 * R * Math.sin(phase), 9);
      expect(t.angles.XW).toBeCloseTo(wrapAngle(phase), 9);
      for (const p of ['XY', 'XZ', 'YZ', 'YW', 'ZW'] as const) expect(t.angles[p]).toBe(0);
    }
  });

  it('100 000 frames of double rotation keep every angle in (−π, π] and the rotation equal to the unwrapped one', () => {
    const s = stateWith('double-rotation', 3);
    let xy = 0;
    let zw = 0;
    let outOfRange = 0;
    for (let i = 0; i < 100_000; i++) {
      advanceAnimation(s, 0.1, 2);
      xy += 0.3;
      zw += 0.21;
      for (const p of ROTATION_PLANES) {
        const a = s.angles[p];
        if (!(a > -Math.PI && a <= Math.PI)) outOfRange++;
      }
    }
    expect(outOfRange).toBe(0);
    // Compare against the angles reduced independently by fmod.
    const reduce = (x: number): number => {
      let y = x % (2 * Math.PI);
      if (y > Math.PI) y -= 2 * Math.PI;
      if (y <= -Math.PI) y += 2 * Math.PI;
      return y;
    };
    expect(s.angles.XY).toBeCloseTo(reduce(xy), 6);
    expect(s.angles.ZW).toBeCloseTo(reduce(zw), 6);
    const unwrapped = compositeRotation({ XY: xy, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: zw });
    expect(approxEqualMat4(compositeRotation(s.angles), unwrapped, 1e-6)).toBe(true);
  });

  it('wrapAngle is exact at the boundaries and the identity inside', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(Math.PI * (1 + 1e-15))).toBeLessThan(0);
    for (const x of [-3.1, -1, 0, 1e-9, 2.5, 3.14]) expect(wrapAngle(x)).toBe(x);
  });
});

// ---------------------------------------------------------------------------
// Explainer topics the UI asks for
// ---------------------------------------------------------------------------

describe('explainer topic ids passed to show() by src/app/ui.ts exist in src/explain/content.ts', () => {
  it('shape ids, view:*, rotation:*, color and intro', () => {
    const ids = [
      'intro',
      'color',
      ...VIEW_MODES.map((m) => `view:${m}`),
      ...ROTATION_PLANES.map((p) => `rotation:${p}`),
      ...listShapes().map((e) => e.id),
      ...Object.values(SHAPE_IDS),
    ];
    for (const id of ids) expect(getExplainer(id), id).toBeDefined();
    // Every explainer has all three tiers with content.
    for (const id of ids) {
      const e = getExplainer(id)!;
      for (const tier of ['eli5', 'intermediate', 'math'] as const) expect(e.tiers[tier].trim().length, `${id}/${tier}`).toBeGreaterThan(40);
    }
  });
});
