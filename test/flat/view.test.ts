import { describe, expect, it } from 'vitest';
import { box, cylinder, icosphere, torus, type Mesh3 } from '../../src/geometry/mesh3';
import { wColorScale, symmetricWScale } from '../../src/app/colors';
import { drawProjection, drawSheet, drawSlice, planeZField, sliceStyle, COLOR_BUCKETS, type Viewport } from '../../src/flat/draw';
import { apply3, compositeRotation3, identity3, planeFromRotation, sliceScale2, type Plane } from '../../src/flat/math';
import { buildModel, MAX_CORNER_DOTS } from '../../src/flat/model';
import { FLAT_SHAPES, octahedron, tetrahedron } from '../../src/flat/shapes';
import { sliceSection } from '../../src/flat/slice2';
import { faceFacing, projectedExtent2, projectModel } from '../../src/flat/view';
import type { Vec3 } from '../../src/math/types';

const TOL = 1e-12;
const SQRT3 = Math.sqrt(3);
const creases = (m: ReturnType<typeof buildModel>): number => m.edges.filter((e) => e.crease).length;

describe('buildModel: which edges are the solid\'s own (creases)', () => {
  it('cube: 8 vertices, 12 faces, 18 mesh edges of which the 12 cube edges are creases (the 6 face diagonals are not)', () => {
    const m = buildModel([box(2, 2, 2)]);
    expect(m.vertices).toHaveLength(8);
    expect(m.faces).toHaveLength(12);
    expect(m.edges).toHaveLength(18); // Euler: V − E + F = 2
    expect(creases(m)).toBe(12);
    expect(m.corners).toHaveLength(8);
    expect(Math.abs(m.radius - SQRT3)).toBeLessThanOrEqual(TOL);
    expect(m.zRange).toEqual([-1, 1]);
    // Every edge has two faces (closed mesh).
    for (const e of m.edges) {
      expect(e.f1).toBeGreaterThanOrEqual(0);
      expect(e.f2).toBeGreaterThanOrEqual(0);
    }
  });

  it('tetrahedron and octahedron: every edge is a crease (dihedral normal angles 109.5° and 70.5° exceed 35°)', () => {
    const t = buildModel([tetrahedron()]);
    expect(t.edges).toHaveLength(6);
    expect(creases(t)).toBe(6);
    const o = buildModel([octahedron()]);
    expect(o.edges).toHaveLength(12);
    expect(creases(o)).toBe(12);
  });

  it('smooth meshes (ball, torus) have no creases; a cylinder has its two 48-gon rims', () => {
    expect(creases(buildModel([icosphere(1, 3)]))).toBe(0);
    expect(creases(buildModel([torus(1, 0.4, 48, 24)]))).toBe(0);
    const c = buildModel([cylinder(1, 2, 48)]);
    expect(creases(c)).toBe(96);
    expect(c.corners).toHaveLength(96);
    // 96 corners are too many to draw as dots.
    expect(c.corners.length).toBeGreaterThan(MAX_CORNER_DOTS);
  });

  it('concatenates parts with offset indices and takes the extremes over all parts', () => {
    const parts: Mesh3[] = FLAT_SHAPES.human.create();
    const m = buildModel(parts);
    expect(m.vertices).toHaveLength(parts.reduce((s, p) => s + p.positions.length, 0));
    expect(m.faces).toHaveLength(parts.reduce((s, p) => s + p.triangles.length, 0));
    for (const [a, b, c] of m.faces) for (const i of [a, b, c]) expect(i).toBeLessThan(m.vertices.length);
    // Crown at y = +1, so R ≥ 1; the figure is thin in z (≈ ±0.15).
    expect(m.radius).toBeGreaterThanOrEqual(1);
    expect(m.zRange[0]).toBeLessThan(0);
    expect(m.zRange[1]).toBeGreaterThan(0);
    expect(m.zRange[1] - m.zRange[0]).toBeLessThan(0.5);
  });
});

describe('projectModel', () => {
  const cube = buildModel([box(2, 2, 2)]);

  it('cube from d = 3 at zero rotation: the square inside a square, scales 3/2 and 3/4 (§11)', () => {
    const frame = projectModel(cube, identity3(), { kind: 'perspective', distance: 3 });
    cube.vertices.forEach((p, i) => {
      const scale = p[2] === 1 ? 3 / 2 : 3 / 4;
      expect(Math.abs(frame.x[i] - p[0] * scale)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(frame.y[i] - p[1] * scale)).toBeLessThanOrEqual(TOL);
      expect(frame.z[i]).toBe(p[2]);
    });
    // Only the 12 creases are drawn: the side faces are back-facing from the eye (0,0,3) inside the slab |x| < 1,
    // and the face diagonals separate coplanar faces.
    expect(frame.edges).toHaveLength(12);
  });

  it('rotated z is the colour variable: z of M p', () => {
    const m = compositeRotation3({ XY: 0.3, XZ: 0.8, YZ: -0.5 });
    const frame = projectModel(cube, m, { kind: 'orthographic' });
    cube.vertices.forEach((p, i) => expect(Math.abs(frame.z[i] - apply3(m, p)[2])).toBeLessThanOrEqual(TOL));
    // Orthographic: x, y are the rotated x, y.
    cube.vertices.forEach((p, i) => {
      expect(Math.abs(frame.x[i] - apply3(m, p)[0])).toBeLessThanOrEqual(TOL);
      expect(Math.abs(frame.y[i] - apply3(m, p)[1])).toBeLessThanOrEqual(TOL);
    });
  });

  it('orders faces back to front: ascending mean z, a permutation of all faces', () => {
    const m = compositeRotation3({ XY: 0.3, XZ: 0.8, YZ: -0.5 });
    const frame = projectModel(cube, m, { kind: 'perspective', distance: 3 });
    expect([...frame.faceOrder].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    for (let i = 1; i < frame.faceOrder.length; i++) {
      expect(frame.faceZ[frame.faceOrder[i]]).toBeGreaterThanOrEqual(frame.faceZ[frame.faceOrder[i - 1]]);
    }
    // faceZ is the mean of the three vertex z.
    cube.faces.forEach(([a, b, c], f) => expect(Math.abs(frame.faceZ[f] - (frame.z[a] + frame.z[b] + frame.z[c]) / 3)).toBeLessThanOrEqual(TOL));
  });

  it('faceFacing: from the eye (0,0,d) the +z face is front, the −z face back, side faces edge-on in orthographic', () => {
    const rotated = cube.vertices as Vec3[];
    const ortho = faceFacing(rotated, cube, { kind: 'orthographic' });
    const persp = faceFacing(rotated, cube, { kind: 'perspective', distance: 3 });
    cube.faces.forEach((f, i) => {
      const zs = f.map((v) => rotated[v][2]);
      if (zs.every((z) => z === 1)) { expect(ortho[i]).toBe(1); expect(persp[i]).toBe(1); }
      else if (zs.every((z) => z === -1)) { expect(ortho[i]).toBe(-1); expect(persp[i]).toBe(-1); }
      else { expect(ortho[i]).toBe(0); expect(persp[i]).toBe(-1); }
    });
  });

  describe('silhouette of the ball (icosphere(1, 3), edge ℓ ≲ 0.145)', () => {
    const ball = buildModel([icosphere(1, 3)]);
    const degrees = (frame: ReturnType<typeof projectModel>): Map<number, number> => {
      const deg = new Map<number, number>();
      for (const ei of frame.edges) {
        const e = ball.edges[ei];
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      }
      return deg;
    };

    it('orthographic: an outline with no gaps around the equator z ≈ 0, even where facets are exactly edge-on', () => {
      const frame = projectModel(ball, identity3(), { kind: 'orthographic' });
      expect(frame.edges.length).toBeGreaterThan(30);
      // A silhouette edge separates a face with n_z > 0 from one with n_z < 0 (or from an exactly edge-on one, the
      // mirror-symmetric facets of this mesh): its endpoints lie within about one edge length of the plane z = 0.
      for (const ei of frame.edges) {
        const e = ball.edges[ei];
        expect(Math.abs(frame.z[e.a])).toBeLessThan(0.15);
        expect(Math.abs(frame.z[e.b])).toBeLessThan(0.15);
      }
      // No gaps: the projected edge midpoints, as seen from the centre, leave no angular gap larger than 0.2 rad
      // (consecutive outline edges are ≤ ℓ ≈ 0.145 apart on a ring of radius ≈ 1).
      const angles = Array.from(frame.edges).map((ei) => {
        const e = ball.edges[ei];
        return Math.atan2(frame.y[e.a] + frame.y[e.b], frame.x[e.a] + frame.x[e.b]);
      }).sort((p, q) => p - q);
      let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
      for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
      expect(gap).toBeLessThan(0.2);
    });

    it('perspective from d = 3: a closed ring (every vertex of even degree) on the tangent circle z = R²/d = 1/3 (polar plane of the eye)', () => {
      const frame = projectModel(ball, identity3(), { kind: 'perspective', distance: 3 });
      expect(frame.edges.length).toBeGreaterThan(30);
      for (const d of degrees(frame).values()) expect(d % 2).toBe(0);
      for (const ei of frame.edges) {
        const e = ball.edges[ei];
        expect(Math.abs(frame.z[e.a] - 1 / 3)).toBeLessThan(0.15);
        expect(Math.abs(frame.z[e.b] - 1 / 3)).toBeLessThan(0.15);
      }
    });
  });

  it('projectedExtent2: r orthographic, and the maximum of √(r² − z²) d/(d − z) under perspective', () => {
    expect(projectedExtent2(2, { kind: 'orthographic' })).toBe(2);
    // r = 1, d = 3: maximise f(z)² = (1 − z²) · 9 / (3 − z)². Setting the logarithmic derivative −2z/(1 − z²) + 2/(3 − z)
    // to zero gives z(3 − z) = 1 − z², i.e. z = 1/3 (the polar plane R²/d of the eye), where
    // f = √(8/9) · 3 / (8/3) = (2√2/3)(9/8) = 3√2/4 ≈ 1.0607. The 65-point scan has step 1/32, within 1e-3 of the maximum.
    const exact = (3 * Math.SQRT2) / 4;
    const scanned = projectedExtent2(1, { kind: 'perspective', distance: 3 });
    expect(scanned).toBeLessThanOrEqual(exact + 1e-12);
    expect(exact - scanned).toBeLessThan(1e-3);
  });
});

// ---- Painters against a recording 2D context --------------------------------

interface Recorded {
  calls: string[];
  fills: Array<{ rule: string | undefined; style: unknown }>;
  strokes: unknown[];
  moveTos: Array<[number, number]>;
  gradients: Array<{ x0: number; y0: number; x1: number; y1: number; stops: Array<[number, string]> }>;
  arcs: number;
}

function recorder(): { ctx: CanvasRenderingContext2D; rec: Recorded } {
  const rec: Recorded = { calls: [], fills: [], strokes: [], moveTos: [], gradients: [], arcs: 0 };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      switch (prop) {
        case 'fill': return (rule?: string) => { rec.calls.push('fill'); rec.fills.push({ rule, style: target.fillStyle }); };
        case 'stroke': return () => { rec.calls.push('stroke'); rec.strokes.push(target.strokeStyle); };
        case 'moveTo': return (x: number, y: number) => { rec.calls.push('moveTo'); rec.moveTos.push([x, y]); };
        case 'arc': return () => { rec.calls.push('arc'); rec.arcs++; };
        case 'createLinearGradient': return (x0: number, y0: number, x1: number, y1: number) => {
          const g = { x0, y0, x1, y1, stops: [] as Array<[number, string]> };
          rec.gradients.push(g);
          return { addColorStop: (o: number, c: string) => { g.stops.push([o, c]); } };
        };
        default: return () => { rec.calls.push(prop); };
      }
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

const vp: Viewport = { cx: 400, cy: 300, k: 100, width: 800, height: 600 };

describe('drawProjection', () => {
  it('cube: one fill per face in back-to-front order, a dot per corner, a gradient per edge running through depth', () => {
    const cube = buildModel([box(2, 2, 2)]);
    const m = compositeRotation3({ XY: 0.2, XZ: 0.6, YZ: 0.4 });
    const frame = projectModel(cube, m, { kind: 'perspective', distance: 3 });
    const { ctx, rec } = recorder();
    drawProjection(ctx, vp, cube, frame, symmetricWScale(cube.radius));
    // 12 faces + 8 corner dots.
    expect(rec.fills).toHaveLength(12 + 8);
    expect(rec.arcs).toBe(8);
    // The 12 face paths are the first 12 moveTos, in faceOrder: far to near.
    const expected = Array.from(frame.faceOrder).map((f) => {
      const a = cube.faces[f][0];
      return [vp.cx + vp.k * frame.x[a], vp.cy - vp.k * frame.y[a]];
    });
    expect(rec.moveTos.slice(0, 12)).toEqual(expected);
    // An edge is stroked with its own gradient when its colour parameter changes by more than 0.08 along it.
    const scale = symmetricWScale(cube.radius);
    const long = Array.from(frame.edges).filter((ei) => {
      const e = cube.edges[ei];
      return Math.abs(scale.t(frame.z[e.a]) - scale.t(frame.z[e.b])) > 0.08;
    });
    expect(rec.gradients).toHaveLength(long.length);
    expect(long.length).toBeGreaterThan(0);
    for (const g of rec.gradients) {
      expect(g.stops).toHaveLength(9);
      expect(g.stops[0][0]).toBe(0);
      expect(g.stops[8][0]).toBe(1);
    }
  });

  it('dense meshes batch faces by colour class: at most COLOR_BUCKETS face fills, no corner dots', () => {
    const ball = buildModel([icosphere(1, 3)]);
    const frame = projectModel(ball, identity3(), { kind: 'perspective', distance: 3 });
    const { ctx, rec } = recorder();
    drawProjection(ctx, vp, ball, frame, symmetricWScale(ball.radius));
    expect(rec.fills.length).toBeGreaterThan(0);
    expect(rec.fills.length).toBeLessThanOrEqual(COLOR_BUCKETS);
    expect(rec.arcs).toBe(0);
    // The silhouette edges are batched by colour too.
    expect(rec.strokes.length).toBeLessThanOrEqual(COLOR_BUCKETS + rec.gradients.length);
  });

  it('the alpha argument scales every opacity (ghost drawing)', () => {
    const cube = buildModel([box(2, 2, 2)]);
    const frame = projectModel(cube, identity3(), { kind: 'perspective', distance: 3 });
    const solid = recorder();
    drawProjection(solid.ctx, vp, cube, frame, symmetricWScale(cube.radius), 1);
    const ghost = recorder();
    drawProjection(ghost.ctx, vp, cube, frame, symmetricWScale(cube.radius), 0.4);
    const alphaOf = (style: unknown): number => Number(String(style).match(/, ([\d.]+)\)$/)?.[1]);
    expect(alphaOf(ghost.rec.fills[0].style)).toBeCloseTo(0.4 * alphaOf(solid.rec.fills[0].style), 12);
  });
});

describe('drawSlice: colour by source z as an exact gradient over the plane', () => {
  const cubeMesh = box(2, 2, 2);
  const scale = wColorScale([-1, 1]);

  it('the plane z = c of the unrotated cube is a flat colour (z constant): no gradient, even–odd fill', () => {
    const plane = planeFromRotation(identity3(), 0.3);
    const { loops } = sliceSection(cubeMesh, plane);
    const { ctx, rec } = recorder();
    drawSlice(ctx, vp, loops, planeZField(plane), scale, 1, false);
    expect(rec.gradients).toHaveLength(0);
    expect(rec.fills).toHaveLength(1);
    expect(rec.fills[0].rule).toBe('evenodd');
    // 4 corners at (±1, ±1) · k about the centre.
    expect(rec.moveTos).toHaveLength(1);
    const c = scale.color(0.3);
    expect(rec.fills[0].style).toBe(`rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, 0.78)`);
  });

  it('several parts use the non-zero rule (union of overlapping parts)', () => {
    const plane = planeFromRotation(identity3(), 0.3);
    const { loops } = sliceSection(cubeMesh, plane);
    const { ctx, rec } = recorder();
    drawSlice(ctx, vp, [...loops, ...loops], planeZField(plane), scale, 1, true);
    expect(rec.fills[0].rule).toBe('nonzero');
  });

  it('draws nothing for an empty slice', () => {
    const { ctx, rec } = recorder();
    drawSlice(ctx, vp, [], { z0: 0, gx: 0, gy: 0 }, scale, 1, false);
    expect(rec.calls.filter((c) => c === 'fill' || c === 'stroke')).toHaveLength(0);
  });

  /*
   * For a tilted plane the source z of the chart position q is z0 + gx q0 + gy q1. A pixel P = origin + a (q0, −q1)
   * (screen y runs down) therefore has z(P). The gradient axis runs from the pixel where z = lo to the pixel where
   * z = hi, so mapping its end points back through this relation must return lo and hi exactly (to rounding), for
   * every scale a = k · sliceScale, including the overlay's d/(d − c) ≠ 1.
   */
  it('the gradient axis runs from the pixel of z = min to the pixel of z = max, at any slice scale', () => {
    const m = compositeRotation3({ XY: 0.4, XZ: -0.9, YZ: 0.3 });
    const plane: Plane = planeFromRotation(m, 0.37);
    const field = planeZField(plane);
    for (const s of [1, sliceScale2({ kind: 'perspective', distance: 3 }, 0.37)]) {
      const a = vp.k * s;
      const { ctx, rec } = recorder();
      const style = sliceStyle(ctx, vp, field, a, scale, 1);
      expect(typeof style).toBe('object');
      expect(rec.gradients).toHaveLength(1);
      const g = rec.gradients[0];
      const zAt = (X: number, Y: number): number => field.z0 + field.gx * ((X - vp.cx) / a) + field.gy * ((vp.cy - Y) / a);
      expect(Math.abs(zAt(g.x0, g.y0) - scale.min)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(zAt(g.x1, g.y1) - scale.max)).toBeLessThanOrEqual(1e-9);
      // Stops: first is the cool end, last the warm end, offsets non-decreasing in [0, 1], and the colour at the
      // stop for z = 0 (offset 1/2 on this symmetric scale) is the mid-gradient colour.
      const offsets = g.stops.map((st) => st[0]);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
      const mid = scale.color(0);
      const midStyle = `rgba(${Math.round(mid.r * 255)}, ${Math.round(mid.g * 255)}, ${Math.round(mid.b * 255)}, 1)`;
      expect(g.stops.some(([o, c]) => Math.abs(o - 0.5) < 1e-12 && c === midStyle)).toBe(true);
    }
  });

  it('a slice scaled by s about the origin: loop points land at origin + k s (q0, −q1)', () => {
    const plane = planeFromRotation(identity3(), 0.3);
    const { ctx, rec } = recorder();
    drawSlice(ctx, vp, [[[1, 1], [-1, 1], [-1, -1], [1, -1]]], planeZField(plane), scale, 1.5, false);
    expect(rec.moveTos[0]).toEqual([vp.cx + vp.k * 1.5, vp.cy - vp.k * 1.5]);
  });
});

describe('drawSheet', () => {
  it('draws the sheet without error and strokes grid lines, axes and border', () => {
    const { ctx, rec } = recorder();
    drawSheet(ctx, vp, 2, 0.5);
    expect(rec.calls.filter((c) => c === 'stroke').length).toBeGreaterThanOrEqual(2);
    expect(rec.calls).toContain('strokeRect');
    expect(rec.calls).toContain('fillRect');
    // Grid: 2·n lines with n = 2/0.5 = 4 on each side of the axis, vertical and horizontal: 2 · 8 = 16 moveTos, +2 for the axes.
    expect(rec.moveTos.length).toBe(2 * 8 + 2);
  });
});
