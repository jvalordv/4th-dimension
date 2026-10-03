import { describe, expect, it } from 'vitest';
import {
  ball, box, capsule, difference, ditorus, duocylinder, intersection, rotate, rotateScene, scale, scaleScene, sdfScene,
  smoothMin, smoothUnion, smoothUnionMargin, spheritorus, tiger, torisphere, translate, translateScene, union,
} from '../../src/geometry/sdf';
import type { Sdf4 } from '../../src/geometry/sdf';
import { marchingPentatopes, marchingTets3 } from '../../src/geometry/isosurface';
import { SdfShape, complexWire, sdfToTetShape, tetEdges } from '../../src/geometry/sdf-shape';
import {
  CREATURE_BLEND, CREATURE_PARTS, SDF_SHAPES, creatureScene, creatureShape, ditorusShape, spheritorusShape,
  tigerShape, torisphereShape,
} from '../../src/geometry/sdf-figures';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { analyseSlice, checkClosedOriented, signedVolume, triangleCount, vertexAt } from '../../src/geometry/trimesh';
import { signedHypervolume, validateTetComplex } from '../../src/geometry/tets';
import { hyperplane, hyperplaneFromRotation, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { compositeRotation, rotation } from '../../src/math/rotation';
import { dist4, length4, normalize4 } from '../../src/math/vec';
import { SHAPE_IDS } from '../../src/app/registry';
import type { Vec4 } from '../../src/math/types';

// Deterministic pseudo-random numbers in [0, 1) (the generator used by test/core).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);
const randBox4 = (r: () => number, s: number): Vec4 => [(r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s];

const PI = Math.PI;
const E_W: Vec4 = [0, 0, 0, 1];

// ---------------------------------------------------------------------------
// Primitives of the §9.3 table
// ---------------------------------------------------------------------------

describe('primitives (MATH.md §9.3 table), values derived by hand', () => {
  it('ball(r): |p| − r', () => {
    const f = ball(2);
    expect(f([0, 0, 0, 0])).toBe(-2);
    expect(f([2, 0, 0, 0])).toBe(0);
    expect(f([1, 2, 2, 4])).toBe(3); // |p| = √(1 + 4 + 4 + 16) = 5
  });

  it('box(h): the exact distance outside, minus the distance to the nearest face inside', () => {
    const f = box([1, 2, 3, 4]);
    expect(f([0, 0, 0, 0])).toBe(-1); // q = (−1, −2, −3, −4): max q = −1
    expect(f([3, 0, 0, 0])).toBe(2); // q_x = 2 above the face x = 1
    expect(f([3, 5, 0, 0])).toBeCloseTo(Math.sqrt(4 + 9), 14); // beyond a 2-face: √(2² + 3²)
    expect(f([3, 5, 7, 8])).toBeCloseTo(Math.sqrt(4 + 9 + 16 + 16), 14); // beyond a vertex
    expect(f([1, 0, 0, 0])).toBe(0); // on the face
    // The outside value is the Euclidean distance to the box, i.e. to the clamped point.
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const p = randBox4(r, 7);
      const clamped: Vec4 = [Math.max(-1, Math.min(1, p[0])), Math.max(-2, Math.min(2, p[1])), Math.max(-3, Math.min(3, p[2])), Math.max(-4, Math.min(4, p[3]))];
      const d = dist4(p, clamped);
      if (d > 0) expect(f(p)).toBeCloseTo(d, 12);
      else expect(f(p)).toBeLessThanOrEqual(0);
    }
  });

  it('capsule(a, b, r): the distance to the segment minus r; a = b is a ball', () => {
    const f = capsule([0, 0, 0, 0], [2, 0, 0, 0], 0.5);
    expect(f([1, 1, 0, 0])).toBeCloseTo(0.5, 14); // t = 1/2, distance 1
    expect(f([3, 0, 0, 0])).toBeCloseTo(0.5, 14); // clamped to b: distance 1
    expect(f([-1, 0, 0, 0])).toBeCloseTo(0.5, 14);
    expect(f([1, 0, 0, 0])).toBeCloseTo(-0.5, 14);
    expect(f([1, 0, 0.5, 0])).toBeCloseTo(0, 14);
    const g = capsule([1, 2, 3, 4], [1, 2, 3, 4], 0.7);
    expect(g([1, 2, 3, 4])).toBeCloseTo(-0.7, 14);
    expect(g([2, 2, 3, 4])).toBeCloseTo(0.3, 14);
    // Oblique segment: distance from p to the line through a, b when t is interior.
    const h = capsule([0, 0, 0, 0], [1, 1, 1, 1], 0.1);
    // p = (1, 0, 0, 0): t = 1/4, foot (1/4)(1,1,1,1), |p − foot|² = (3/4)² + 3(1/4)² = 3/4.
    expect(h([1, 0, 0, 0])).toBeCloseTo(Math.sqrt(0.75) - 0.1, 14);
  });

  it('duocylinder(r1, r2): max(√(x²+y²) − r1, √(z²+w²) − r2), exact on the two tori', () => {
    const f = duocylinder(1, 2);
    expect(f([0.5, 0, 0, 0])).toBeCloseTo(-0.5, 14);
    expect(f([0, 0, 0, 3])).toBeCloseTo(1, 14);
    expect(f([3, 4, 0, 0])).toBeCloseTo(4, 14);
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const a = r() * 2 * PI;
      const b = r() * 2 * PI;
      // The Clifford-type torus (r1 cos α, r1 sin α, r2 cos β, r2 sin β) is on the surface.
      expect(f([Math.cos(a), Math.sin(a), 2 * Math.cos(b), 2 * Math.sin(b)])).toBeCloseTo(0, 14);
    }
  });

  it('spheritorus, torisphere, tiger, ditorus are |distance to their core| − r on parametrised surfaces', () => {
    /*
     * Each is the set within r of a core (a 2-sphere, a circle, a flat torus, a
     * torus), so the point at distance r' from the core along a unit normal has
     * f = r' − r exactly. Parametrisations (α, β, φ angles, (u1, u2, u3) a unit vector):
     *  - spheritorus (R = 2, r = 0.5): core point 2 ê (ê ∈ S² ⊂ R³, w = 0); normal
     *    directions (ê, e_w): p = (2 + r' cos γ) ê + r' sin γ e_w.
     *  - torisphere (R = 2, r = 0.5): core point 2(cos α, sin α, 0, 0); normals
     *    span ê_ρ, e_z, e_w: p = core + r'(u1 ê_ρ + u2 e_z + u3 e_w).
     *  - tiger (R1 = 1, R2 = 2, r = 0.5): core (cos α, sin α, 2 cos β, 2 sin β); the
     *    normal plane is spanned by ê_ρ1 = (cos α, sin α, 0, 0) and ê_ρ2 = (0, 0, cos β, sin β).
     *  - ditorus (R1 = 3, R2 = 1, r = 0.25): core (R1 + R2 cos φ) ê_ρ + R2 sin φ e_z;
     *    normals: n_s = cos φ ê_ρ + sin φ e_z and e_w.
     */
    const r = rng(5);
    for (let i = 0; i < 60; i++) {
      const a = r() * 2 * PI;
      const b = r() * 2 * PI;
      const g = r() * 2 * PI;
      const rp = 0.5 * r();
      // spheritorus
      const u = randUnit4(r);
      const e = normalize4([u[0], u[1], u[2], 0]);
      const sp: Vec4 = [(2 + rp * Math.cos(g)) * e[0], (2 + rp * Math.cos(g)) * e[1], (2 + rp * Math.cos(g)) * e[2], rp * Math.sin(g)];
      expect(spheritorus(2, 0.5)(sp)).toBeCloseTo(rp - 0.5, 12);
      // torisphere
      const [u1, u2, u3] = normalize4([r() - 0.5, r() - 0.5, r() - 0.5, 0]).slice(0, 3);
      const tp: Vec4 = [(2 + rp * u1) * Math.cos(a), (2 + rp * u1) * Math.sin(a), rp * u2, rp * u3];
      expect(torisphere(2, 0.5)(tp)).toBeCloseTo(rp - 0.5, 12);
      // tiger
      const ti: Vec4 = [(1 + rp * Math.cos(g)) * Math.cos(a), (1 + rp * Math.cos(g)) * Math.sin(a), (2 + rp * Math.sin(g)) * Math.cos(b), (2 + rp * Math.sin(g)) * Math.sin(b)];
      expect(tiger(1, 2, 0.5)(ti)).toBeCloseTo(rp - 0.5, 12);
      // ditorus: φ = b is the angle round the core torus's tube, r' = rr ≤ r the distance from the core.
      const rr = 0.25 * r();
      const rhoD = 3 + Math.cos(b) + rr * Math.cos(g) * Math.cos(b);
      const dp: Vec4 = [rhoD * Math.cos(a), rhoD * Math.sin(a), Math.sin(b) + rr * Math.cos(g) * Math.sin(b), rr * Math.sin(g)];
      expect(ditorus(3, 1, 0.25)(dp)).toBeCloseTo(rr - 0.25, 12);
    }
  });

  it('known values at the centre: the tori are not solid there', () => {
    expect(spheritorus(2, 0.5)([0, 0, 0, 0])).toBeCloseTo(2 - 0.5, 14); // |a| = R
    expect(torisphere(2, 0.5)([0, 0, 0, 0])).toBeCloseTo(2 - 0.5, 14);
    expect(tiger(1, 2, 0.5)([0, 0, 0, 0])).toBeCloseTo(Math.sqrt(5) - 0.5, 14);
    // ditorus: a = −3 (ρ = 0), b = √(a² + z²) − R2 = 3 − 1 = 2, f = √(b² + w²) − r = 2 − 0.25.
    expect(ditorus(3, 1, 0.25)([0, 0, 0, 0])).toBeCloseTo(1.75, 14);
  });

  it('rejects non-positive parameters', () => {
    expect(() => ball(0)).toThrow(RangeError);
    expect(() => box([1, 1, 0, 1])).toThrow(RangeError);
    expect(() => capsule([0, 0, 0, 0], [1, 0, 0, 0], -1)).toThrow(RangeError);
    expect(() => tiger(1, NaN, 0.1)).toThrow(RangeError);
    expect(() => smoothUnion(0, ball(1), ball(1))).toThrow(RangeError);
    expect(() => scale(ball(1), 0)).toThrow(RangeError);
    expect(() => sdfScene(ball(1), 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Operations of §9.3
// ---------------------------------------------------------------------------

describe('operations (§9.3)', () => {
  const a = ball(1);
  const b = translate(ball(1), [1, 0, 0, 0]);

  it('union = min, intersection = max, difference = max(f, −g)', () => {
    const p: Vec4 = [0.25, 0.5, 0, 0];
    expect(union(a, b)(p)).toBe(Math.min(a(p), b(p)));
    expect(intersection(a, b)(p)).toBe(Math.max(a(p), b(p)));
    expect(difference(a, b)(p)).toBe(Math.max(a(p), -b(p)));
    // The point (0.5, 0, 0, 0) is inside both unit balls (|p| = 0.5 and |p − e_x| = 0.5):
    // union −0.5, intersection −0.5, difference max(−0.5, 0.5) = 0.5 (outside a \ b).
    const q: Vec4 = [0.5, 0, 0, 0];
    expect(union(a, b)(q)).toBeCloseTo(-0.5, 14);
    expect(intersection(a, b)(q)).toBeCloseTo(-0.5, 14);
    expect(difference(a, b)(q)).toBeCloseTo(0.5, 14);
    // Three-argument forms fold.
    const c = translate(ball(1), [0, 1, 0, 0]);
    expect(union(a, b, c)([0, 0.9, 0, 0])).toBeCloseTo(Math.min(a([0, 0.9, 0, 0]), b([0, 0.9, 0, 0]), c([0, 0.9, 0, 0])), 14);
  });

  it('smoothMin: min − (k − |a − b|)₊² / (4k), within k/4 below min, equal to min when |a − b| ≥ k', () => {
    // a = 1, b = 1.2, k = 0.5: h = 0.3, drop 0.09 / 2 = 0.045.
    expect(smoothMin(1, 1.2, 0.5)).toBeCloseTo(1 - 0.045, 14);
    expect(smoothMin(1.2, 1, 0.5)).toBeCloseTo(1 - 0.045, 14); // commutative
    expect(smoothMin(1, 1.5, 0.5)).toBe(1); // |a − b| = k: no blend
    expect(smoothMin(1, 3, 0.5)).toBe(1);
    expect(smoothMin(2, 2, 0.5)).toBeCloseTo(2 - 0.125, 14); // the largest drop, k/4
    const r = rng(8);
    for (let i = 0; i < 1000; i++) {
      const x = r() * 4 - 2;
      const y = r() * 4 - 2;
      const k = 0.05 + r();
      const s = smoothMin(x, y, k);
      expect(s).toBeLessThanOrEqual(Math.min(x, y) + 1e-15);
      expect(s).toBeGreaterThanOrEqual(Math.min(x, y) - k / 4 - 1e-15);
    }
  });

  it('smoothUnion folds smoothMin from the left', () => {
    const f1 = ball(1);
    const f2 = translate(ball(1), [1.5, 0, 0, 0]);
    const f3 = translate(ball(0.7), [0, 1.2, 0, 0]);
    const p: Vec4 = [0.7, 0.5, 0.1, 0.05];
    expect(smoothUnion(0.4, f1, f2, f3)(p)).toBeCloseTo(smoothMin(smoothMin(f1(p), f2(p), 0.4), f3(p), 0.4), 14);
  });

  it('smoothUnionMargin(k, n) is attained by n equal fields and is an upper bound on the drop below the minimum', () => {
    // n fields all equal to 0 fold to −D_n: D_2 = k/4, D_3 = k/4 + (3k/4)²/(4k) = k/4 + 9k/64, ...
    const k = 0.3;
    for (let n = 2; n <= 8; n++) {
      const fs = Array.from({ length: n }, () => (): number => 0);
      const [f0, f1, ...rest] = fs as unknown as Sdf4[];
      expect(smoothUnion(k, f0, f1, ...rest)([0, 0, 0, 0])).toBeCloseTo(-smoothUnionMargin(k, n), 14);
    }
    expect(smoothUnionMargin(k, 2)).toBeCloseTo(k / 4, 14);
    expect(smoothUnionMargin(k, 3)).toBeCloseTo(k / 4 + 9 * k / 64, 14);
    expect(smoothUnionMargin(k, 1)).toBe(0);
    expect(smoothUnionMargin(k, 6)).toBeCloseTo(0.60 * k, 2);
    expect(smoothUnionMargin(k, 1000)).toBeLessThan(k);
    // Random values: the drop below the minimum never exceeds D_n.
    const r = rng(21);
    for (let trial = 0; trial < 3000; trial++) {
      const n = 2 + Math.floor(r() * 5);
      const vals = Array.from({ length: n }, () => (r() - 0.5) * 2 * k);
      const fs = vals.map((v) => (): number => v) as unknown as Sdf4[];
      const [f0, f1, ...rest] = fs;
      const s = smoothUnion(k, f0, f1, ...rest)([0, 0, 0, 0]);
      expect(Math.min(...vals) - s).toBeLessThanOrEqual(smoothUnionMargin(k, n) + 1e-12);
      expect(s).toBeLessThanOrEqual(Math.min(...vals) + 1e-12);
    }
  });

  it('translate(f, t) = f(p − t); scale(f, s) = s f(p / s); rotate(f, M) = f(Mᵀp)', () => {
    const f = capsule([0, 0, 0, 0], [1, 0, 0, 0], 0.25);
    const t: Vec4 = [0.5, -1, 2, 0.25];
    const p: Vec4 = [1.3, -0.4, 1.8, 0.4];
    expect(translate(f, t)(p)).toBe(f([p[0] - t[0], p[1] - t[1], p[2] - t[2], p[3] - t[3]]));
    expect(translate(f, t)(t)).toBeCloseTo(f([0, 0, 0, 0]), 14);
    // Scale: ball(1) scaled by 3 is ball(3): 3(|p|/3 − 1) = |p| − 3.
    expect(scale(ball(1), 3)(p)).toBeCloseTo(ball(3)(p), 13);
    expect(scale(f, 2)([2, 0, 0, 0])).toBeCloseTo(2 * f([1, 0, 0, 0]), 14);
    // Rotation by 90° in XY turns e_x into e_y: the capsule along x becomes one along y,
    // so the rotated field at (0, 0.5, 0, 0) is the original at Mᵀp = (0.5, 0, 0, 0).
    const m = rotation('XY', PI / 2);
    expect(rotate(f, m)([0, 0.5, 0, 0])).toBeCloseTo(-0.25, 14);
    expect(rotate(f, m)([0.5, 0, 0, 0])).toBeCloseTo(f([0, -0.5, 0, 0]), 14); // Mᵀ(0.5, 0, 0, 0) = (0, −0.5, 0, 0)
    // General composite: f_rot(Mq) = f(q).
    const M = compositeRotation({ XY: 0.3, XZ: -0.5, XW: 0.7, YZ: 0.4, YW: -0.9, ZW: 1.1 });
    const q: Vec4 = [0.7, 0.2, -0.3, 0.5];
    const Mq: Vec4 = [0, 1, 2, 3].map((r) => M[4 * r] * q[0] + M[4 * r + 1] * q[1] + M[4 * r + 2] * q[2] + M[4 * r + 3] * q[3]) as Vec4;
    expect(rotate(f, M)(Mq)).toBeCloseTo(f(q), 12);
    expect(() => rotate(f, [1, 0, 0, 1])).toThrow(RangeError);
  });

  it('all fields are 1-Lipschitz (§9.3): |f(p) − f(q)| ≤ |p − q| on random pairs', () => {
    const fields: Array<[string, Sdf4]> = [
      ['ball', ball(0.8)], ['box', box([0.5, 0.7, 0.9, 1.1])], ['capsule', capsule([0.1, 0.2, -0.3, 0.4], [-0.5, 0.2, 0.3, -0.4], 0.3)],
      ['duocylinder', duocylinder(0.6, 0.9)], ['spheritorus', spheritorus(0.7, 0.3)], ['torisphere', torisphere(0.7, 0.3)],
      ['tiger', tiger(0.6, 0.6, 0.25)], ['ditorus', ditorus(0.6, 0.25, 0.1)],
      ['union', union(ball(0.5), translate(box([0.3, 0.3, 0.3, 0.3]), [0.4, 0, 0, 0]))],
      ['difference', difference(ball(1), translate(ball(0.5), [0.5, 0, 0, 0]))],
      ['smooth union', smoothUnion(0.3, ball(0.5), translate(ball(0.4), [0.6, 0, 0, 0]), translate(ball(0.3), [0, 0.7, 0, 0.3]))],
      ['creature', creatureScene().f],
      ['rotated', rotate(box([0.5, 0.7, 0.9, 1.1]), compositeRotation({ XY: 0.3, XZ: -0.5, XW: 0.7, YZ: 0.4, YW: -0.9, ZW: 1.1 }))],
      ['scaled', scale(torisphere(0.7, 0.3), 1.7)],
    ];
    const r = rng(99);
    for (const [name, f] of fields) {
      for (let i = 0; i < 3000; i++) {
        const p = randBox4(r, 1.6);
        const d = randUnit4(r);
        const len = r() < 0.5 ? r() * 0.05 : r() * 2;
        const q: Vec4 = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len, p[3] + d[3] * len];
        // 1e-12 absorbs rounding in the difference of two values of size up to ~3.
        expect(Math.abs(f(p) - f(q)), name).toBeLessThanOrEqual(len + 1e-12);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scenes and their bounds
// ---------------------------------------------------------------------------

describe('scenes: bounds are true bounds', () => {
  it('sdfScene defaults wRange to [−radius, radius] and copies it; translate/rotate/scaleScene transform the bounds', () => {
    const s = sdfScene(ball(1), 1);
    expect(s.wRange).toEqual([-1, 1]);
    const w: [number, number] = [-0.5, 0.5];
    const s2 = sdfScene(ball(1), 1, w);
    w[0] = -9;
    expect(s2.wRange).toEqual([-0.5, 0.5]);
    expect(() => sdfScene(ball(1), 1, [1, -1])).toThrow(RangeError);
    const t = translateScene(sdfScene(ball(1), 1, [-1, 1]), [3, 0, 4, 2]);
    expect(t.radius).toBeCloseTo(1 + Math.sqrt(9 + 16 + 4), 14);
    expect(t.wRange).toEqual([1, 3]);
    expect(t.f([3, 0, 4, 2])).toBeCloseTo(-1, 14);
    const sc = scaleScene(sdfScene(ball(1), 1, [-1, 1]), 2.5);
    expect(sc.radius).toBe(2.5);
    expect(sc.wRange).toEqual([-2.5, 2.5]);
    expect(sc.f([2.5, 0, 0, 0])).toBeCloseTo(0, 14);
    const rs = rotateScene(sdfScene(ball(1), 1, [-0.2, 0.2]), compositeRotation({ XY: 0, XZ: 0, XW: 1, YZ: 0, YW: 0, ZW: 0 }));
    expect(rs.radius).toBe(1);
    expect(rs.wRange).toEqual([-1, 1]);
  });

  /*
   * For each shape the solid {f ≤ 0} lies in the ball |p| ≤ radius and in the
   * slab w ∈ wRange: sampled points beyond either bound have f > 0. The
   * extremal points are attained for the analytic figures (derived in
   * sdf-figures.ts), where f = 0 there; for the creature the bound exceeds
   * the actual extent by at most the smooth-union margin D_6.
   */
  const scenes: Array<[string, ReturnType<typeof creatureScene>]> = [
    ['spheritorus', spheritorusShape().scene],
    ['torisphere', torisphereShape().scene],
    ['tiger', tigerShape().scene],
    ['ditorus', ditorusShape().scene],
    ['creature', creatureScene()],
  ];

  for (const [name, scene] of scenes) {
    it(`${name}: f > 0 beyond radius ${scene.radius.toFixed(4)} and beyond wRange [${scene.wRange[0].toFixed(3)}, ${scene.wRange[1].toFixed(3)}]`, () => {
      const r = rng(1234);
      for (let i = 0; i < 20000; i++) {
        const u = randUnit4(r);
        const norm = scene.radius * (1.0001 + r());
        expect(scene.f([u[0] * norm, u[1] * norm, u[2] * norm, u[3] * norm])).toBeGreaterThan(0);
        // |w| beyond the range, the other coordinates anywhere in the ball.
        const side = r() < 0.5 ? 1 : -1;
        const w = side === 1 ? scene.wRange[1] * (1.0001 + r() * 0.5) + 1e-9 : scene.wRange[0] * (1.0001 + r() * 0.5) - 1e-9;
        const p = randBox4(r, scene.radius);
        expect(scene.f([p[0], p[1], p[2], w])).toBeGreaterThan(0);
      }
    });
  }

  it('the analytic figures attain their bounds: f = 0 at the extremal points', () => {
    const sp = spheritorusShape(0.7, 0.3).scene; // |p| = R + r at (R + r, 0, 0, 0); w = r at (R, 0, 0, r)
    expect(sp.f([sp.radius, 0, 0, 0])).toBeCloseTo(0, 14);
    expect(sp.f([0.7, 0, 0, sp.wRange[1]])).toBeCloseTo(0, 14);
    const to = torisphereShape(0.7, 0.3).scene;
    expect(to.f([to.radius, 0, 0, 0])).toBeCloseTo(0, 14);
    expect(to.f([0.7, 0, 0, to.wRange[1]])).toBeCloseTo(0, 14);
    // tiger: the farthest point is on the ray through the core point (R1, R2) in the (ρ1, ρ2) plane.
    const R1 = 0.6;
    const R2 = 0.6;
    const r = 0.25;
    const ti = tigerShape(R1, R2, r).scene;
    const c = Math.hypot(R1, R2);
    expect(ti.f([R1 * (1 + r / c), 0, R2 * (1 + r / c), 0])).toBeCloseTo(0, 12);
    expect(length4([R1 * (1 + r / c), 0, R2 * (1 + r / c), 0])).toBeCloseTo(ti.radius, 12);
    expect(ti.f([R1, 0, 0, ti.wRange[1]])).toBeCloseTo(0, 12); // w = R2 + r
    const di = ditorusShape(0.6, 0.25, 0.1).scene;
    expect(di.f([di.radius, 0, 0, 0])).toBeCloseTo(0, 14);
    expect(di.f([0.6 + 0.25, 0, 0, di.wRange[1]])).toBeCloseTo(0, 14);
  });

  it('the creature bound exceeds its parts by at most the smooth-union margin D_6 = 0.6 k', () => {
    const scene = creatureScene();
    const margin = smoothUnionMargin(CREATURE_BLEND, CREATURE_PARTS.length);
    // Farthest point of a capsule: the far endpoint plus r along the axis (or radially for a ball).
    let farthest = 0;
    let wFarthest = 0;
    for (const p of CREATURE_PARTS) {
      for (const end of [p.a, p.b]) {
        farthest = Math.max(farthest, length4(end) + p.r);
        wFarthest = Math.max(wFarthest, Math.abs(end[3]) + p.r);
      }
    }
    expect(scene.radius).toBeCloseTo(farthest + margin, 12);
    expect(scene.wRange[1]).toBeCloseTo(wFarthest + margin, 12);
    // The tip of the +w leg is on its own capsule, hence inside the blend (smin ≤ min).
    const leg = CREATURE_PARTS.find((p) => p.label === 'leg +w');
    expect(leg).toBeDefined();
    if (!leg) return;
    const axis = normalize4([leg.b[0] - leg.a[0], leg.b[1] - leg.a[1], leg.b[2] - leg.a[2], leg.b[3] - leg.a[3]]);
    const tip: Vec4 = [leg.b[0] + leg.r * axis[0], leg.b[1] + leg.r * axis[1], leg.b[2] + leg.r * axis[2], leg.b[3] + leg.r * axis[3]];
    expect(scene.f(tip)).toBeLessThanOrEqual(1e-12);
    expect(scene.radius - length4(tip)).toBeLessThanOrEqual(margin + (farthest - length4(tip)) + 1e-12);
  });
});

// ---------------------------------------------------------------------------
// SdfShape
// ---------------------------------------------------------------------------

describe('SdfShape', () => {
  it('is a Shape4 of kind sdf with the scene bounds, and validates its options', () => {
    const shape = new SdfShape('Ball', sdfScene(ball(1), 1, [-1, 1]));
    expect(shape.kind).toBe('sdf');
    expect(shape.name).toBe('Ball');
    expect(shape.radius()).toBe(1);
    expect(shape.wRange()).toEqual([-1, 1]);
    // wRange() hands out a copy.
    shape.wRange()[0] = 7;
    expect(shape.wRange()).toEqual([-1, 1]);
    expect(() => new SdfShape('x', sdfScene(ball(1), 1), { sliceResolution: 0 })).toThrow(RangeError);
    expect(() => new SdfShape('x', sdfScene(ball(1), 1), { wireResolution: 2.5 })).toThrow(RangeError);
  });

  it('slice(h) is closed and outward in the chart of h: the 4-ball cut by a random hyperplane', () => {
    // Slice of the unit 4-ball by n·p = c is a ball of radius √(1 − c²) centred at the chart
    // origin (chart(c n) = 0), volume (4/3)π (1 − c²)^{3/2}, for any unit n (§8.5, §4).
    const shape = new SdfShape('Ball', sdfScene(ball(1), 1), { sliceResolution: 40 });
    const r = rng(17);
    for (let i = 0; i < 3; i++) {
      const n = randUnit4(r);
      const c = (r() - 0.5) * 1.2;
      const h = hyperplane(n, c);
      const m = shape.slice(h);
      const rep = checkClosedOriented(m);
      expect(rep.closed && rep.consistent).toBe(true);
      expect(rep.euler).toBe(2);
      const exact = (4 / 3) * PI * (1 - c * c) ** 1.5;
      // Sphere law: below the exact volume by 0.5 (h/ρ)², bound 0.75 (see isosurface.test.ts); h = 2/40.
      const rho2 = 1 - c * c;
      expect(Math.abs(signedVolume(m) / exact - 1)).toBeLessThanOrEqual(0.75 * (2 / 40) ** 2 / rho2);
      // The ball is centred at the chart origin: the mesh centroid-ish extremes are symmetric.
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < m.positions.length; k += 3) { lo = Math.min(lo, m.positions[k]); hi = Math.max(hi, m.positions[k]); }
      expect(lo + hi).toBeCloseTo(0, 1);
    }
  });

  it('slice vertices lie on the 4D surface and sourceW is the 4D w of the vertex (§10)', () => {
    // p = unchart(h, q) is the 4D point of chart vertex q. On the 4-ball the interpolated crossing
    // is inside the ball and within L²/(8|p|) of the surface, L ≤ √3 h the edge length, |p| ≥ 0.9
    // here: depth ≤ 3h²/7.2 < 0.5 h² with h = 2/24. A crossing within 2% of a grid vertex is moved
    // onto it, where |f| ≤ 0.0205 L ≤ 0.036 h (isosurface.ts, CROSSING_SNAP), either side.
    const shape = new SdfShape('Ball', sdfScene(ball(1), 1), { sliceResolution: 24 });
    const h = hyperplane([0.3, -0.5, 0.6, 0.55], 0.2);
    const m = shape.slice(h);
    expect(triangleCount(m)).toBeGreaterThan(100);
    const f = ball(1);
    for (let i = 0; i < m.positions.length / 3; i++) {
      const p = unchart(h, vertexAt(m, i));
      // Float32 chart coordinates: ~6e-8 per coordinate.
      const snap = 0.0205 * Math.sqrt(3) * (2 / 24);
      expect(f(p)).toBeLessThanOrEqual(snap + 1e-6);
      expect(f(p)).toBeGreaterThanOrEqual(-0.5 * (2 / 24) ** 2 - snap - 1e-6);
      expect(Math.abs(m.sourceW[i] - p[3])).toBeLessThan(1e-6);
    }
    // At w = c the 4D w of every vertex is c.
    const flat = shape.slice(hyperplaneW(0.35));
    for (const w of flat.sourceW) expect(Math.abs(w - 0.35)).toBeLessThan(1e-6);
  });

  it('a hyperplane outside the support of the bounds gives the empty mesh without evaluating the field', () => {
    // sdfScene(ball(1), 1): ball |p| ≤ 1 and |w| ≤ 1. The support interval of n·p over it is [−1, 1] for every unit n.
    let calls = 0;
    const counting: Sdf4 = (p) => { calls++; return ball(1)(p); };
    const shape = new SdfShape('Ball', sdfScene(counting, 1), { sliceResolution: 8 });
    expect(shape.slice(hyperplaneW(1)).indices.length).toBe(0);
    expect(shape.slice(hyperplane([1, 1, 0, 0], -1.5)).indices.length).toBe(0);
    expect(calls).toBe(0);
    expect(shape.slice(hyperplaneW(0.9)).indices.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0);
    // A thin figure: the ditorus has |w| ≤ 0.1, so for n = e_w the support interval is [−0.1, 0.1] and a
    // slice at w = 0.13 is skipped; for n = (0, 0, 0.6, 0.8)/1 the interval is wider but still
    // narrower than the ball's [−0.95, 0.95]: max over w ∈ [−0.1, 0.1] of 0.6 √(0.95² − w²) + 0.8 w
    // = 0.6 √(0.95² − 0.1²) + 0.08 = 0.6 · 0.94472 + 0.08 = 0.6468 (the maximiser w = 0.8 · 0.95 is clamped to 0.1).
    let calls2 = 0;
    const di = ditorusShape();
    const counted = new SdfShape('Ditorus', { ...di.scene, f: (p) => { calls2++; return di.scene.f(p); } }, { sliceResolution: 8 });
    expect(counted.slice(hyperplaneW(0.13)).indices.length).toBe(0);
    expect(counted.slice(hyperplane([0, 0, 0.6, 0.8], 0.65)).indices.length).toBe(0);
    expect(calls2).toBe(0);
    counted.slice(hyperplane([0, 0, 0.6, 0.8], 0.64)); // inside the interval: evaluated
    expect(calls2).toBeGreaterThan(0);
  });

  it('whenever the early exit fires the slice really is empty: random hyperplanes against a direct extraction on every figure', () => {
    // The skip is an optimisation of the true slice, so for every skipped (n, c) the direct
    // marching-tetrahedra extraction of the same field must also be empty.
    const r = rng(2024);
    let skipped = 0;
    let evaluated = 0;
    for (const e of SDF_SHAPES) {
      const base = e.create() as SdfShape;
      let calls = 0;
      const shape = new SdfShape(base.name, { ...base.scene, f: (p) => { calls++; return base.scene.f(p); } }, { sliceResolution: 14 });
      const R = base.radius();
      for (let i = 0; i < 30; i++) {
        const n = i < 6 ? E_W : randUnit4(r);
        const c = (r() - 0.5) * 2 * R;
        const h = hyperplane(n, c);
        calls = 0;
        const m = shape.slice(h);
        if (calls === 0) {
          skipped++;
          expect(m.indices.length).toBe(0);
          // The same extraction without the early exit: the field itself on the grid.
          const g = (q: [number, number, number]): number => base.scene.f(unchart(h, q));
          const viaField = marchingTets3(g, [-R, -R, -R], [R, R, R], 14);
          expect(viaField.indices.length).toBe(0);
        } else {
          evaluated++;
        }
      }
    }
    expect(skipped).toBeGreaterThan(10);
    expect(evaluated).toBeGreaterThan(10);
  });

  it('wire(): vertices and deduplicated tet edges of the extracted complex, computed once', () => {
    const scene = sdfScene(ball(1), 1);
    const shape = new SdfShape('Ball', scene, { wireResolution: 6 });
    const wire = shape.wire();
    expect(shape.wire()).toBe(wire); // cached
    expect(wire.faces).toEqual([]);
    // The same grid as sdfToTetShape at resolution 6, so the edge set must be exactly the tets' edges.
    const complex = marchingPentatopes(scene.f, [-1, -1, -1, -1], [1, 1, 1, 1], 6);
    expect(wire.positions.length).toBe(complex.positions.length);
    const expected = new Set<string>();
    for (const t of complex.tets) {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expected.add(`${Math.min(t[i], t[j])},${Math.max(t[i], t[j])}`);
    }
    const got = new Set(wire.edges.map(([a, b]) => `${a},${b}`));
    expect(got.size).toBe(wire.edges.length); // no duplicates
    expect(got).toEqual(expected);
    for (const [a, b] of wire.edges) {
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(wire.positions.length);
    }
    // Every vertex is inside the ball: a crossing point of a convex field is inside (see isosurface.test.ts).
    for (const p of wire.positions) expect(length4(p)).toBeLessThanOrEqual(1 + 1e-12);
    // Euler-type sanity: a tet has six edges and each is shared by several tets, so E < 6 T.
    expect(wire.edges.length).toBeLessThan(6 * complex.tets.length);
    expect(tetEdges(complex.positions.length, complex.tets).length).toBe(wire.edges.length);
    expect(complexWire(complex).edges.length).toBe(wire.edges.length);
  });

  it('sdfToTetShape: a valid complex whose slices match the direct slices to within both discretisations', () => {
    const scene = sdfScene(ball(1), 1);
    const ts = sdfToTetShape('Ball complex', scene, 12);
    expect(ts.kind).toBe('sdf');
    expect(ts.name).toBe('Ball complex');
    const v = validateTetComplex(ts.complex.positions, ts.complex.tets);
    expect(v.errors).toEqual([]);
    const vol = signedHypervolume(ts.complex.positions, ts.complex.tets);
    // 4-ball law (isosurface.test.ts): −1.0 (h/ρ)² measured, 1.25 asserted; h = 2/12.
    expect(vol).toBeLessThan(PI ** 2 / 2);
    expect(PI ** 2 / 2 - vol).toBeLessThanOrEqual(1.25 * (2 / 12) ** 2 * (PI ** 2 / 2));
    expect(ts.wire()?.edges.length).toBe(tetEdges(ts.complex.positions.length, ts.complex.tets).length);
    expect(ts.radius()).toBeLessThanOrEqual(1 + 1e-12);
    const direct = new SdfShape('Ball', scene, { sliceResolution: 48 });
    for (const c of [0, 0.5]) {
      const exact = (4 / 3) * PI * (1 - c * c) ** 1.5;
      const rho2 = 1 - c * c;
      const viaComplex = analyseSlice(ts.slice(hyperplaneW(c)));
      expect(viaComplex.closed && viaComplex.consistent).toBe(true);
      const dv = signedVolume(direct.slice(hyperplaneW(c)));
      const eC = 1.0 * ((2 / 12) ** 2 / rho2) * exact;
      const eD = 0.75 * ((2 / 48) ** 2 / rho2) * exact;
      expect(Math.abs(viaComplex.volume - dv)).toBeLessThanOrEqual(eC + eD);
    }
  });
});

describe('the extracted complexes of the figures (marching pentatopes, §9.3)', () => {
  /*
   * Each figure's boundary extracted at a modest resolution is a valid tet complex under the default
   * tolerances of validateTetComplex (closed, consistently oriented, no degenerate tet; §5.2), even
   * though the figures are not star-shaped and have thin tubes. The hypervolume is below the exact
   * value (the fields are convex only locally, so this is not a theorem here, but measured at every
   * resolution) and converges: errors at n = 10 and n = 14 in the comment of each case.
   */
  const PI3 = PI ** 3;
  const cases: Array<{ name: string; shape: () => SdfShape; exact: number; n: [number, number] }> = [
    { name: 'spheritorus', shape: () => spheritorusShape(), exact: 4 * PI ** 2 * 0.7 ** 2 * 0.3 ** 2 + PI ** 2 * 0.3 ** 4, n: [10, 14] }, // −9.1%, −4.7%
    { name: 'torisphere', shape: () => torisphereShape(), exact: 2 * PI * 0.7 * (4 / 3) * PI * 0.3 ** 3, n: [10, 14] }, // −21.7%, −11.4%
    { name: 'tiger', shape: () => tigerShape(), exact: 4 * PI3 * 0.6 * 0.6 * 0.25 ** 2, n: [10, 14] }, // −13.8%, −6.8%
    { name: 'ditorus', shape: () => ditorusShape(), exact: 4 * PI3 * 0.6 * 0.25 * 0.1 ** 2, n: [10, 14] }, // −50%, −36% (tube 0.1 vs h 0.14)
  ];
  for (const { name, shape, exact, n } of cases) {
    it(`${name}: valid complex at n = ${n[0]} and ${n[1]}, hypervolume increasing toward ${exact.toFixed(4)}`, () => {
      const vols = n.map((res) => {
        const ts = sdfToTetShape(name, shape().scene, res);
        const v = validateTetComplex(ts.complex.positions, ts.complex.tets);
        expect(v.errors).toEqual([]);
        expect(v.ok).toBe(true);
        return signedHypervolume(ts.complex.positions, ts.complex.tets);
      });
      expect(vols[0]).toBeGreaterThan(0);
      expect(vols[0]).toBeLessThan(vols[1]);
      expect(vols[1]).toBeLessThan(exact);
    });
  }

  it('the creature complex is valid and its hypervolume converges to the slice integral (0.2017 at slice resolution 80)', () => {
    // Complex volumes at n = 8, 12, 16, 20: 0.1144, 0.1555, 0.1743, 0.1837; the Cavalieri integral
    // of the direct slices at resolution 80 is 0.2017, at 40 it is 0.1991.
    const scene = creatureScene();
    const vols = [8, 12, 16].map((res) => {
      const ts = sdfToTetShape('Creature', scene, res);
      expect(validateTetComplex(ts.complex.positions, ts.complex.tets).ok).toBe(true);
      return signedHypervolume(ts.complex.positions, ts.complex.tets);
    });
    expect(vols[0]).toBeLessThan(vols[1]);
    expect(vols[1]).toBeLessThan(vols[2]);
    expect(vols[2]).toBeLessThan(0.2017 * 1.02);
    expect(vols[2]).toBeGreaterThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// Cavalieri: the slice integral against the §9.3 table
// ---------------------------------------------------------------------------

describe('Cavalieri (§7): ∫ A(c) dc along e_w and a random direction equals the 4-volume of the table', () => {
  /*
   * Exact 4-volumes (all with r < the other radii, so the normal discs do not overlap):
   *  - torisphere (R, r): 2πR · (4/3)π r³ (Pappus), as the table says;
   *  - tiger (R1, R2, r): 4π³ R1 R2 r², as the table says;
   *  - ditorus (R1, R2, r): 2πR1 · 2πR2 · π r² = 4π³ R1 R2 r², as the table says
   *    (the 4π² printed in the task text lacks a π);
   *  - spheritorus (R, r): the set within r of a 2-SPHERE of radius R, whose 4-volume
   *    in the (s, w) half-plane picture is ∫∫ 4π s² ds dw over the disc (s − R)² + w² ≤ r²
   *    = 4π (R² · πr² + π r⁴/4) = 4π² R² r² + π² r⁴. (Check by the slice formula of the
   *    spheritorus test in isosurface.test.ts, V(c) = 8πR²a + (8π/3)a³ with
   *    a = √(r² − c²): ∫ a dc = π r²/2 and ∫ a³ dc = 3π r⁴/8 give 4π² R² r² + π² r⁴.)
   *    The table of MATH.md §9.3 prints 2πR · (4/3)π r³ for this row, which is the
   *    volume of a ball swept round a CIRCLE (the torisphere); for R = 0.7, r = 0.3 it is
   *    0.497 against the true 1.821, and the field of the row is not that solid.
   *
   * Tolerance. Per slice the marching-tetrahedra volume is below the exact one by
   * ≈ 0.5 (h/r)² of it (sphere law, measured at 0.5 for balls in isosurface.test.ts, with
   * r the tube radius, the smallest radius of curvature) and the midpoint rule over c adds
   * ≤ 0.5%: |ΔV|/V ≤ 0.5 (h/r)² + 0.005 with h = 2 radius / sliceResolution. Measured
   * (default resolutions, 48 slices along e_w, 64 along the random direction): spheritorus
   * 0.2%/0.4% (bound 1.9%), torisphere 0.9%/1.0% (1.9%), tiger 0.4%/0.4% (2.2%), ditorus
   * 0.6%/1.0% (4.9%; its tube radius 0.1 is only 3.4 cells).
   */
  const randomDir = randUnit4(rng(20240607));

  const cases: Array<{ name: string; make: () => SdfShape; exact: number; tube: number }> = [
    { name: 'spheritorus', make: () => spheritorusShape(), exact: 4 * PI ** 2 * 0.7 ** 2 * 0.3 ** 2 + PI ** 2 * 0.3 ** 4, tube: 0.3 },
    { name: 'torisphere', make: () => torisphereShape(), exact: 2 * PI * 0.7 * (4 / 3) * PI * 0.3 ** 3, tube: 0.3 },
    { name: 'tiger', make: () => tigerShape(), exact: 4 * PI ** 3 * 0.6 * 0.6 * 0.25 ** 2, tube: 0.25 },
    { name: 'ditorus', make: () => ditorusShape(), exact: 4 * PI ** 3 * 0.6 * 0.25 * 0.1 ** 2, tube: 0.1 },
  ];

  for (const { name, make, exact, tube } of cases) {
    it(`${name}: 4-volume ${exact.toFixed(4)} along e_w and along a random direction`, () => {
      const shape = make();
      const n = shape.scene.radius;
      // Spacing of the slice grid.
      const res = name === 'tiger' ? 48 : name === 'ditorus' ? 64 : 40;
      const h = (2 * n) / res;
      const tol = 0.5 * (h / tube) ** 2 + 0.005;
      // Along e_w the solid is supported on |c| ≤ wRange (integrating over [−n, n] would waste
      // most midpoint samples on empty slices for the ditorus, |w| ≤ 0.1).
      const wMax = Math.max(Math.abs(shape.wRange()[0]), Math.abs(shape.wRange()[1]));
      const alongW = sliceVolumeIntegral(shape, E_W, 48, wMax);
      expect(Math.abs(alongW / exact - 1)).toBeLessThanOrEqual(tol);
      const alongRandom = sliceVolumeIntegral(shape, randomDir, 64);
      expect(Math.abs(alongRandom / exact - 1)).toBeLessThanOrEqual(tol);
      // The two directions agree with each other (direction independence of §7) to the same tolerance.
      expect(Math.abs(alongW / alongRandom - 1)).toBeLessThanOrEqual(2 * tol);
    });
  }

  it('ball and capsule through the same pipeline: π²/2 and π² r⁴/2 + (4/3)π r³ |b − a|', () => {
    const r = 0.4;
    const a: Vec4 = [-0.3, 0, 0, 0];
    const b: Vec4 = [0.3, 0.2, 0, 0.1];
    const len = dist4(a, b);
    const capsuleExact = (PI ** 2 * r ** 4) / 2 + (4 / 3) * PI * r ** 3 * len;
    const shapes: Array<[SdfShape, number, number]> = [
      [new SdfShape('Ball', sdfScene(ball(1), 1, [-1, 1]), { sliceResolution: 40 }), PI ** 2 / 2, 1],
      [new SdfShape('Capsule', sdfScene(capsule(a, b, r), 0.5 + r, [-0.1 - r, 0.1 + r]), { sliceResolution: 40 }), capsuleExact, r],
    ];
    for (const [shape, exact, rad] of shapes) {
      const h = (2 * shape.radius()) / 40;
      const tol = 0.5 * (h / rad) ** 2 + 0.005;
      for (const dir of [E_W, randomDir]) {
        const v = sliceVolumeIntegral(shape, dir, 64);
        expect(Math.abs(v / exact - 1)).toBeLessThanOrEqual(tol);
      }
    }
  });
});

describe('smooth union volume (§9.3)', () => {
  /*
   * Two unit 4-balls centred at (∓1/2, 0, 0, 0): V(ball) = π²/2 = 4.9348, sum 9.8696.
   * Their plain union has exact volume π² − 2 V_cap with V_cap = (4π/3)∫_{1/2}^{1}(1 − x²)^{3/2} dx
   * (the cap beyond the mid-plane, whose slices are balls of radius √(1 − x²)): computed
   * below by Simpson's rule, 8.6203.
   *
   * The smooth solid {smin_k(f, g) ≤ 0} contains the union (smin ≤ min), and for k = 0.4
   * adds only a thin blend, so max < V_union ≤ V_smooth < sum. This is checked on the 4D
   * grid [−1.6, 1.6]⁴, n = 16 (h = 0.2): all three solids are measured on the same grid, and
   * then {L_ball < 0} ⊂ {L_union < 0} ⊂ {L_smooth < 0} (vertexwise f_ball ≥ min ≥ smin, so the
   * interpolants are ordered), a rigorous order of the measured volumes. The measured union is
   * compared with the exact one at the 4-ball law's bound 1.25 h² (3.7% measured against 5%).
   * (For a large blend width the bound by the sum fails: k = 1 gives 11.4 > 9.87, since the
   * blend adds material; the sum bound is a statement about moderate k.)
   */
  const a = translate(ball(1), [-0.5, 0, 0, 0]);
  const b = translate(ball(1), [0.5, 0, 0, 0]);
  const L = 1.6;
  const n = 16;
  const volume = (f: Sdf4): number => {
    const cx = marchingPentatopes(f, [-L, -L, -L, -L], [L, L, L, L], n);
    return signedHypervolume(cx.positions, cx.tets);
  };

  it('max(V_a, V_b) < V_union ≤ V_smooth(k = 0.4) < V_a + V_b, and the union volume matches the cap formula', () => {
    // Simpson's rule for ∫_{0.5}^{1} (1 − x²)^{3/2} dx with 2000 panels.
    const N = 2000;
    const x0 = 0.5;
    const dx = (1 - x0) / N;
    const g = (x: number): number => (1 - x * x) ** 1.5;
    let s = g(x0) + g(1);
    for (let i = 1; i < N; i++) s += g(x0 + i * dx) * (i % 2 === 0 ? 2 : 4);
    const cap = ((4 * PI) / 3) * (s * dx) / 3;
    const unionExact = PI ** 2 - 2 * cap;
    expect(unionExact).toBeCloseTo(8.6203, 3);

    const vA = volume(a);
    const vU = volume(union(a, b));
    const vS = volume(smoothUnion(0.4, a, b));
    expect(vA).toBeLessThan(vU);
    expect(vU).toBeLessThanOrEqual(vS);
    // Exact bounds on the true smooth solid, tested on the measured volume with the discretisation allowance.
    expect(vS).toBeGreaterThan(PI ** 2 / 2);
    expect(vS).toBeLessThan(PI ** 2);
    const h = (2 * L) / n;
    expect(Math.abs(vU / unionExact - 1)).toBeLessThanOrEqual(1.25 * h * h);
    // The smooth union is larger than the union by the blend; it is more than the grid error here.
    expect(vS).toBeGreaterThan(vU + 0.1);
  });

  it('the volume grows with the blend width (smin_k decreases with k), and k → 0 recovers the union', () => {
    const vU = volume(union(a, b));
    const v005 = volume(smoothUnion(0.05, a, b));
    const v04 = volume(smoothUnion(0.4, a, b));
    expect(v005).toBeGreaterThanOrEqual(vU);
    expect(v04).toBeGreaterThanOrEqual(v005);
    // k = 0.05 moves the surface by at most k/4 = 0.0125 over the crease ring only: the added volume
    // is below (crease measure ≈ 2π² ... ) a few percent of the union.
    expect(v005 - vU).toBeLessThan(0.02 * vU);
  });
});

describe('rotate(M) commutes with slicing (§4, §9.3)', () => {
  /*
   * Slicing rotate(f, M) by w = c uses g(q) = f(Mᵀ(q, c)). Slicing f by
   * hyperplaneFromRotation(M, c) uses g(q) = f(c Mᵀe_w + Σ q_k Mᵀe_k) = f(Mᵀ(q, c)): the same
   * function. The grids and evaluation points coincide, so the volumes agree up to the
   * rounding of two different arithmetic paths (≤ 1e-15 relative per value; a vertex that
   * rounds across zero changes the volume by a sliver, ≤ 1e-9): tolerance 1e-6 relative.
   */
  const M = compositeRotation({ XY: 0.3, XZ: -0.5, XW: 0.7, YZ: 0.4, YW: -0.9, ZW: 1.1 });
  const scene = creatureScene();
  const rotated = new SdfShape('rotated creature', rotateScene(scene, M), { sliceResolution: 40 });
  const original = new SdfShape('creature', scene, { sliceResolution: 40 });

  for (const c of [0, 0.25, -0.4]) {
    it(`offset ${c}: slice of the rotated field by w = c has the volume of the slice of the field by the rotated hyperplane`, () => {
      const viaRotated = signedVolume(rotated.slice(hyperplaneW(c)));
      const viaHyperplane = signedVolume(original.slice(hyperplaneFromRotation(M, c)));
      // Non-empty slices (volumes 0.31, 0.12, 0.014 at the three offsets).
      expect(viaRotated).toBeGreaterThan(0.005);
      expect(Math.abs(viaRotated / viaHyperplane - 1)).toBeLessThan(1e-6);
      const unrotated = signedVolume(original.slice(hyperplaneW(c)));
      // Not vacuous: the rotation changes what the slice cuts, for at least the offsets below.
      if (c === 0.25) expect(Math.abs(viaRotated / unrotated - 1)).toBeGreaterThan(0.05);
    });
  }

  it('the rotated slice is closed and consistently oriented', () => {
    const m = rotated.slice(hyperplaneW(0.1));
    const rep = checkClosedOriented(m);
    expect(rep.closed && rep.consistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

describe('SDF_SHAPES (the catalogue entries)', () => {
  it('lists the five forms with the registry ids, in the Smooth forms (SDF) group', () => {
    expect(SDF_SHAPES.map((e) => e.id)).toEqual([
      SHAPE_IDS.sdfSpheritorus, SHAPE_IDS.sdfTorisphere, SHAPE_IDS.sdfTiger, SHAPE_IDS.sdfDitorus, SHAPE_IDS.sdfCreature,
    ]);
    expect(new Set(SDF_SHAPES.map((e) => e.label)).size).toBe(5);
    for (const e of SDF_SHAPES) {
      expect(e.group).toBe('Smooth forms (SDF)');
      expect(e.description.length).toBeGreaterThan(40);
      expect(e.description.endsWith('.')).toBe(true);
      const s = e.create();
      expect(s.kind).toBe('sdf');
      expect(s.name).toBe(e.label);
      expect(s.radius()).toBeGreaterThan(0.5);
      expect(s.wire()).not.toBeNull();
    }
  });

  it('the factories take the documented defaults and validate their parameters', () => {
    expect(spheritorusShape().radius()).toBeCloseTo(1.0, 12); // R + r
    expect(torisphereShape().radius()).toBeCloseTo(1.0, 12);
    expect(tigerShape().radius()).toBeCloseTo(Math.hypot(0.6, 0.6) + 0.25, 12);
    expect(tigerShape().wRange()).toEqual([-0.85, 0.85]);
    expect(ditorusShape().radius()).toBeCloseTo(0.95, 12);
    expect(ditorusShape().wRange()).toEqual([-0.1, 0.1]);
    expect(() => ditorusShape(0.6, 0.25, 0.3)).toThrow(RangeError); // r ≥ R2
    expect(() => ditorusShape(0.3, 0.25, 0.1)).toThrow(RangeError); // R2 + r ≥ R1
    expect(() => spheritorusShape(0.2, 0.3)).toThrow(RangeError);
    expect(() => torisphereShape(0.2, 0.3)).toThrow(RangeError);
    expect(() => tigerShape(0.6, 0.6, 0.7)).toThrow(RangeError);
  });

  it('every figure slices to a closed, outward mesh at several offsets in w', () => {
    for (const e of SDF_SHAPES) {
      const shape = e.create();
      const wMax = shape.wRange()[1];
      for (const c of [-0.5, 0, 0.5].map((x) => x * wMax)) {
        const m = shape.slice(hyperplaneW(c));
        const rep = checkClosedOriented(m);
        expect(triangleCount(m), `${e.id} at ${c}`).toBeGreaterThan(50);
        expect(rep.closed && rep.consistent, `${e.id} at ${c}`).toBe(true);
        expect(signedVolume(m)).toBeGreaterThan(0);
      }
    }
  });

  it('slice topology of the tori at w = 0: shell (Euler 4), solid torus (0), two solid tori (0), hollow torus (0)', () => {
    expect(checkClosedOriented(spheritorusShape().slice(hyperplaneW(0))).euler).toBe(4);
    expect(checkClosedOriented(torisphereShape().slice(hyperplaneW(0))).euler).toBe(0);
    expect(checkClosedOriented(tigerShape().slice(hyperplaneW(0))).euler).toBe(0);
    expect(checkClosedOriented(ditorusShape().slice(hyperplaneW(0))).euler).toBe(0);
  });
});

describe('the creature (blended figure, sdf-figures.ts)', () => {
  const shape = creatureShape();
  const volumeAt = (c: number): number => signedVolume(shape.slice(hyperplaneW(c)));

  it('is the smooth union of a body ball, a head ball offset in +y and four limbs, two of which reach into ±w', () => {
    expect(CREATURE_PARTS.map((p) => p.label)).toEqual(['body', 'head', 'arm +x', 'arm -x', 'leg +w', 'leg -w']);
    const body = CREATURE_PARTS[0];
    const head = CREATURE_PARTS[1];
    expect(body.a).toEqual(body.b);
    expect(head.a).toEqual(head.b);
    expect(head.a[1]).toBeGreaterThan(body.r * 0.9); // the head ball is offset in +y, resting on the body
    const legs = CREATURE_PARTS.filter((p) => p.label.startsWith('leg'));
    expect(legs.map((p) => Math.sign(p.b[3]))).toEqual([1, -1]); // they reach into +w and −w
    for (const l of legs) expect(Math.abs(l.b[3])).toBeGreaterThan(0.45);
    const arms = CREATURE_PARTS.filter((p) => p.label.startsWith('arm'));
    for (const arm of arms) {
      expect(arm.a[3]).toBe(0);
      expect(arm.b[3]).toBe(0);
    }
  });

  it('its slices change shape as it passes through: arms and head only near w = 0, a leg appears away from it', () => {
    // At w = 0: body (radius 0.42) + head (0.27, centre y = 0.6) + arms: one connected closed surface.
    const mid = shape.slice(hyperplaneW(0));
    const midRep = checkClosedOriented(mid);
    expect(midRep.closed && midRep.consistent && midRep.euler === 2).toBe(true);
    let yMax = -Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < mid.positions.length; i += 3) { xMax = Math.max(xMax, Math.abs(mid.positions[i])); yMax = Math.max(yMax, mid.positions[i + 1]); }
    expect(yMax).toBeGreaterThan(0.8); // head top 0.6 + 0.27 = 0.87 (blend only adds)
    expect(xMax).toBeGreaterThan(0.75); // arm tip 0.72 + 0.12 = 0.84, sliced at w = 0 through its axis
    // At w = +0.55 the body (radius 0.42 + blend < 0.55) is gone, and the +w leg remains: a single closed
    // surface below the body's position, around the leg axis at w = 0.55: parameter t = (0.55 − 0.12)/0.5 = 0.86.
    const far = shape.slice(hyperplaneW(0.55));
    const farRep = checkClosedOriented(far);
    expect(farRep.closed && farRep.consistent && farRep.euler === 2).toBe(true);
    expect(triangleCount(far)).toBeGreaterThan(50);
    let nearest = Infinity;
    let yTop = -Infinity;
    for (let i = 0; i < far.positions.length; i += 3) {
      nearest = Math.min(nearest, Math.hypot(far.positions[i], far.positions[i + 1], far.positions[i + 2]));
      yTop = Math.max(yTop, far.positions[i + 1]);
    }
    expect(nearest).toBeGreaterThan(0.35); // nothing near the origin: the body is not there
    expect(yTop).toBeLessThan(-0.3); // the leg is below the body (y from −0.25 to −0.66 along its axis)
    // The two sides of w = 0 are different shapes: the legs differ.
    const vPlus = volumeAt(0.45);
    const vMinus = volumeAt(-0.45);
    // Measured (resolution 40): 0.0085 at +0.45, 0.0127 at −0.45 (the −w leg is thicker and nearer its root there).
    expect(vPlus).toBeGreaterThan(0.005);
    expect(vMinus).toBeGreaterThan(0.005);
    expect(Math.abs(vPlus / vMinus - 1)).toBeGreaterThan(0.2);
    // And the middle is bigger than either side.
    expect(volumeAt(0)).toBeGreaterThan(2 * Math.max(vPlus, vMinus));
    // Beyond the legs' reach nothing is left.
    expect(triangleCount(shape.slice(hyperplaneW(0.9)))).toBe(0);
    expect(triangleCount(shape.slice(hyperplaneW(-0.9)))).toBe(0);
  });

  it('Cavalieri along e_w and a random direction agree (direction independence, §7) and the volume is bracketed', () => {
    /*
     * No closed form for the blended volume. Rigorous brackets (§9.3): the solid contains the
     * plain union of its parts, hence the body ball, V ≥ π² 0.42⁴ / 2 = 0.1535; and it lies
     * inside the union of the parts dilated by D_6 = 0.6 k (smoothUnionMargin, parts are exact
     * distances), hence V ≤ Σ over parts of V(capsule(a, b, r + D_6)) with
     * V(capsule) = π² r⁴ / 2 + (4/3)π r³ |b − a| (the sum bounds the union). Measured:
     * 0.1991 (e_w) and 0.1988 (random direction) at resolution 40, 0.2017 at 80.
     *
     * The two integrals have independent sampling of the same discretised solid; each is within
     * 0.5 (h/ρ)² of the truth with h = 2 · 1.14 / 40 = 0.057 and ρ the smallest feature radius
     * 0.27 (the head): 2.2%, so they agree within 3% (measured 0.13%).
     */
    const margin = smoothUnionMargin(CREATURE_BLEND, CREATURE_PARTS.length);
    const upper = CREATURE_PARTS.reduce((sum, p) => {
      const rd = p.r + margin;
      return sum + (PI ** 2 * rd ** 4) / 2 + (4 / 3) * PI * rd ** 3 * dist4(p.a, p.b);
    }, 0);
    const lower = (PI ** 2 * 0.42 ** 4) / 2;
    const vw = sliceVolumeIntegral(shape, E_W, 64, shape.wRange()[1]);
    const vr = sliceVolumeIntegral(shape, randUnit4(rng(31)), 64);
    for (const v of [vw, vr]) {
      expect(v).toBeGreaterThan(lower);
      expect(v).toBeLessThan(upper);
    }
    expect(Math.abs(vw / vr - 1)).toBeLessThanOrEqual(0.03);
  });

  it('timings: a slice at resolution 40 takes under 40 ms (median of 9) and the wire extraction under 2 s', () => {
    // Measured on the development machine: ~11 ms per slice (65 000 field evaluations, ~6 000 triangles
    // for the creature), wire at resolution 16: ~40 ms (5.8 k vertices, 40 k edges).
    const timed = creatureShape();
    for (let i = 0; i < 3; i++) timed.slice(hyperplaneW(0.1 * i)); // warm-up (JIT)
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      timed.slice(hyperplaneW(-0.4 + 0.1 * i));
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(40);
    const w0 = performance.now();
    const wire = creatureShape().wire();
    expect(performance.now() - w0).toBeLessThan(2000);
    expect(wire.edges.length).toBeGreaterThan(10000);
  });
});
