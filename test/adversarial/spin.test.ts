/**
 * Adversarial tests for the spin module: clipMesh3 (MATH.md §9.4), spin /
 * SpunSolid (§9.2), the hypervolume and slice integral (§7), the 4-ball
 * identities of §8.5 and the spun catalogue of figures.ts.
 *
 * Every expected value below is derived in a comment from MATH.md or from
 * standard mathematics, never from the implementation. Random directions and
 * rotations come from a seeded generator so a failure is reproducible.
 *
 * The one identity used throughout: for N steps the discrete spun body is
 *   B_N = { (x, y, z·p) : (x, y, z) ∈ S, p ∈ P_N },
 * P_N the regular N-gon of circumradius 1 with a vertex at angle 0 (the
 * cross-section of B_N at fixed (x, y) is the N-gon annulus swept by the
 * z-interval of S there). Hence vol_4(B_N) = ∫_S area(z P_N) dV
 * = N sin(2π/N) ∫_S z dV, which is §9.2's "(N/2π) sin(2π/N) times Pappus",
 * and the slice of B_N at w = c is { (x, y, z) : (x, y, ρ_N(z, c)) ∈ S } with
 * ρ_N the gauge (Minkowski functional) of P_N.
 */
import { describe, expect, it } from 'vitest';
import type { Mat4, TriMesh3, Vec3, Vec4 } from '../../src/math/types';
import { hyperplane, hyperplaneFromRotation, hyperplaneW } from '../../src/math/hyperplane';
import { compositeRotation, rotation } from '../../src/math/rotation';
import { apply4, mul4 } from '../../src/math/mat4';
import { cross3, dot3, normalize3, sub3 } from '../../src/math/vec';
import type { Mesh3, Triangle } from '../../src/geometry/mesh3';
import { box, cylinder, icosphere, mesh3Area, mesh3Bounds, mesh3Edges, mesh3Volume, torus, translateMesh3, validateMesh3 } from '../../src/geometry/mesh3';
import { clipMesh3 } from '../../src/geometry/clip';
import { SPIN_SNAP, SpunSolid, firstMomentZ, spin } from '../../src/geometry/spin';
import { hypervolumeByCones, signedHypervolume, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice, mergeMeshes, signedVolume, weldVertices } from '../../src/geometry/trimesh';
import { TetShape, sliceVolumeIntegral } from '../../src/geometry/shape';
import { SPUN_SHAPES, spunBall, spunCube, spunHalfBall, spunHuman } from '../../src/geometry/figures';
import { SHAPE_IDS } from '../../src/app/registry';

// ---- Helpers ---------------------------------------------------------------

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generic (unnormalised) direction in R^4, uniform in [−1, 1]^4; callers normalise. */
const randomDirection = (rng: () => number): Vec4 => [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];

const randomRotation = (rng: () => number): Mat4 => compositeRotation({
  XY: rng() * 2 * Math.PI, XZ: rng() * 2 * Math.PI, XW: rng() * 2 * Math.PI,
  YZ: rng() * 2 * Math.PI, YW: rng() * 2 * Math.PI, ZW: rng() * 2 * Math.PI,
});

/** §9.2: the discrete construction's exact 4-volume, N sin(2π/N) ∫_S z dV. */
const discretePappus = (mesh: Mesh3, N: number): number => N * Math.sin((2 * Math.PI) / N) * firstMomentZ(mesh);

/** §9.2: the ratio of the discrete to the continuum Pappus value. */
const polygonFactor = (N: number): number => (N / (2 * Math.PI)) * Math.sin((2 * Math.PI) / N);

/**
 * Half-length of the chord { (z, c) : z ≥ 0 } ∩ ρ P_N of the regular N-gon of
 * circumradius ρ with a vertex at angle 0. Edge j has outward unit normal at
 * angle (2j+1)π/N and lies on n_j · p = ρ cos(π/N) (the apothem), so (z, c) is
 * inside iff n_j · (z, c) ≤ ρ cos(π/N) for all j; for z ≥ 0 only the edges
 * with n_z > 0 bind. The polygon is symmetric in z and convex and has a
 * vertex at angle π/2 when 4 | N, so the line w = c misses it iff |c| > ρ.
 */
function halfChord(rho: number, c: number, N: number): number {
  if (Math.abs(c) > rho) return 0;
  let h = Infinity;
  for (let j = 0; j < N; j++) {
    const a = ((2 * j + 1) * Math.PI) / N;
    const nz = Math.cos(a);
    if (nz <= 1e-15) continue;
    h = Math.min(h, (rho * Math.cos(Math.PI / N) - Math.sin(a) * c) / nz);
  }
  return Math.max(0, h);
}

/** Inradius of a convex polyhedron about the origin: the least face-plane distance. */
function inradius(mesh: Mesh3): number {
  let r = Infinity;
  for (const [a, b, c] of mesh.triangles) {
    const p = mesh.positions[a];
    const n = normalize3(cross3(sub3(mesh.positions[b], p), sub3(mesh.positions[c], p)));
    r = Math.min(r, dot3(n, p));
  }
  return r;
}

/**
 * Right circular cone with apex at the origin and a regular n-gon base of
 * circumradius r at height h: side fan (apex, ring_{i+1}, ring_i) and top fan
 * (centre, ring_i, ring_{i+1}), both counter-clockwise seen from outside.
 * Volume A h / 3 and ∫ z dV = ∫_0^h z A (z/h)² dz = A h² / 4 with
 * A = (n/2) r² sin(2π/n).
 */
function coneMesh(n: number, r: number, h: number): Mesh3 {
  const positions: Vec3[] = [[0, 0, 0]];
  for (let i = 0; i < n; i++) positions.push([r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), h]);
  positions.push([0, 0, h]);
  const top = positions.length - 1;
  const triangles: Triangle[] = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % n);
    triangles.push([0, b, a], [top, a, b]);
  }
  return { positions, triangles };
}

/** Disjoint union of meshes (indices offset). */
function unionMesh3(...meshes: Mesh3[]): Mesh3 {
  const positions: Vec3[] = [];
  const triangles: Triangle[] = [];
  for (const m of meshes) {
    const off = positions.length;
    for (const p of m.positions) positions.push([p[0], p[1], p[2]]);
    for (const [a, b, c] of m.triangles) triangles.push([a + off, b + off, c + off]);
  }
  return { positions, triangles };
}

const expectClosedMesh3 = (m: Mesh3): void => {
  const v = validateMesh3(m);
  expect(v.errors, v.errors.join('; ')).toEqual([]);
  expect(v.closed).toBe(true);
  expect(v.consistent).toBe(true);
};

const expectValidComplex = (s: SpunSolid): void => {
  const v = validateTetComplex(s.complex.positions, s.complex.tets);
  expect(v.errors, `${s.name}: ${v.errors.join('; ')}`).toEqual([]);
  expect(v.ok).toBe(true);
};

/** The rigorous Pappus checks every spun solid must pass (§9.2, §7). */
function expectPappus(s: SpunSolid): void {
  const hv = s.hypervolume();
  const disc = discretePappus(s.mesh, s.steps);
  // The identity is exact for the polyhedral body (see the file comment);
  // the only error is Float64 round-off in two O(10^5)-term sums, ≈ 1e-14.
  expect(Math.abs(hv - disc)).toBeLessThanOrEqual(1e-9 * Math.abs(disc));
  expect(hv).toBeGreaterThan(0);
  // §9.2: discrete / continuum = (N/2π) sin(2π/N).
  expect(hv / (2 * Math.PI * firstMomentZ(s.mesh))).toBeCloseTo(polygonFactor(s.steps), 9);
  // §7: the signed sum is the divergence theorem, so it cannot depend on the
  // reference point o. (A dependence would mean the boundary is not closed.)
  const o: Vec4 = [0.37, -1.21, 0.83, 2.49];
  expect(Math.abs(signedHypervolume(s.complex.positions, s.complex.tets, o) - hv)).toBeLessThanOrEqual(1e-9 * hv);
}

// Shared catalogue instances (each is expensive; nothing below mutates them).
const BALL = spunBall(); // icosphere(0.4, 3) at height 1.1, 48 steps: a torisphere
const HALF = spunHalfBall(); // icosphere(1, 3) clipped to z ≥ 0, 48 steps: the 4-ball
const CUBE = spunCube(); // unit cube at height 1.2, 48 steps: a square ring
const BALL_MESH_VOLUME = mesh3Volume(BALL.mesh);

// ============================================================================
describe('clipMesh3: clip(S, m, k) = S ∩ { m · q ≥ k } (MATH.md §9.4)', () => {
  const B = box(2, 2, 2); // [−1, 1]³, volume 8, vertices (±1, ±1, ±1)

  // Each row: plane (normal, k), exact kept volume, how it is derived.
  const boxCases: Array<[string, Vec3, number, number]> = [
    // Half the box: §9.4's own example.
    ['z ≥ 0', [0, 0, 1], 0, 4],
    // A slab of height 0.7 over the 2×2 base.
    ['z ≥ 0.3', [0, 0, 1], 0.3, 4 * 0.7],
    // The plane x + y = 0 contains the four vertices with x = −y and halves the box.
    ['x + y ≥ 0 (through 4 vertices)', [1, 1, 0], 0, 4],
    // The plane x = y contains (1,1,±1) and (−1,−1,±1); again half.
    ['x − y ≥ 0 (through 4 vertices)', [1, -1, 0], 0, 4],
    // x + y + z = 1 passes through (1,1,−1), (1,−1,1), (−1,1,1); the kept part is
    // the corner tetrahedron at (1,1,1) with legs of length 2: volume 2³/6 = 4/3.
    ['x + y + z ≥ 1 (through 3 vertices, a corner tetrahedron)', [1, 1, 1], 1, 4 / 3],
    // x + y + z = 0 cuts a regular hexagon through six edge midpoints; by the
    // central symmetry of the box each side has volume 4.
    ['x + y + z ≥ 0 (hexagonal section)', [1, 1, 1], 0, 4],
    // 2x + y = 1 contains the edge x = 1, y = −1 and crosses y = 1 at x = 0: the
    // section of the (x, y) square is the triangle (1,−1), (1,1), (0,1) of area
    // 1, extruded over z ∈ [−1, 1]: volume 2.
    ['2x + y ≥ 1 (through an edge, cutting elsewhere)', [2, 1, 0], 1, 2],
  ];

  it.each(boxCases)('box [−1,1]³ clipped by %s has the exact volume, is closed and outward', (_name, m, k, expected) => {
    const clipped = clipMesh3(B, m, k);
    // Exact rational answers: 1e-12 absolute is pure Float64 round-off.
    expect(mesh3Volume(clipped)).toBeCloseTo(expected, 12);
    expectClosedMesh3(clipped);
    // Complement: clipping by the opposite half-space keeps the rest, §9.4's
    // "vol_3(S) minus the removed part"; the two volumes sum to 8.
    const rest = clipMesh3(B, [-m[0], -m[1], -m[2]], -k);
    expectClosedMesh3(rest);
    expect(mesh3Volume(clipped) + mesh3Volume(rest)).toBeCloseTo(8, 12);
    // Idempotence: everything kept now lies on the kept side (cut points are
    // on the plane and snap to it), so a second clip returns a copy.
    const again = clipMesh3(clipped, m, k);
    expect(again.positions).toEqual(clipped.positions);
    expect(again.triangles).toEqual(clipped.triangles);
    // Crossing points are created once per edge: no two vertices coincide.
    expect(new Set(clipped.positions.map((p) => p.join(','))).size).toBe(clipped.positions.length);
  });

  it('a plane containing a face with the solid behind it leaves the doubled face: volume 0, area 2·4 (§9.4, §6)', () => {
    // z ≥ 1: the top face (z = 1, four vertices with s = 0, all positive) is
    // kept, every other triangle collapses, and the cap is the same square
    // facing −z. The limit from the removed side is a doubled square.
    const top = clipMesh3(B, [0, 0, 1], 1);
    expect(mesh3Volume(top)).toBeCloseTo(0, 12);
    expect(mesh3Area(top)).toBeCloseTo(8, 12);
    expect(top.positions.length).toBe(4);
    expect(top.triangles.length).toBe(4);
    // The opposite clip keeps everything: s = −z + 1 ≥ 0 at every vertex.
    const all = clipMesh3(B, [0, 0, -1], -1);
    expect(mesh3Volume(all)).toBeCloseTo(8, 12);
    expect(all.positions).toEqual(B.positions);
    expect(all.triangles).toEqual(B.triangles);
  });

  it('a plane touching only a vertex or only an edge removes everything (§9.4)', () => {
    // x + y + z = 3 supports the box at (1, 1, 1) alone.
    const vertex = clipMesh3(B, [1, 1, 1], 3);
    expect(vertex.positions.length).toBe(0);
    expect(vertex.triangles.length).toBe(0);
    // x + y = 2 supports it along the edge x = y = 1.
    const edge = clipMesh3(B, [1, 1, 0], 2);
    expect(edge.positions.length).toBe(0);
    expect(edge.triangles.length).toBe(0);
    // And the complements keep the whole box.
    expect(mesh3Volume(clipMesh3(B, [-1, -1, -1], -3))).toBeCloseTo(8, 12);
    expect(mesh3Volume(clipMesh3(B, [-1, -1, 0], -2))).toBeCloseTo(8, 12);
  });

  it('the plane is invariant under rescaling (normal, k); a zero normal throws', () => {
    // (0,0,2)·q ≥ 1 is z ≥ 1/2: a slab of height 1/2 over the 2×2 base, volume 2.
    const a = clipMesh3(B, [0, 0, 2], 1);
    expect(mesh3Volume(a)).toBeCloseTo(2, 12);
    const b = clipMesh3(B, [0, 0, 1], 0.5);
    expect(a.positions).toEqual(b.positions);
    expect(a.triangles).toEqual(b.triangles);
    expect(() => clipMesh3(B, [0, 0, 0], 0)).toThrow();
  });

  it('snapping: a vertex within 1e-9 of the extent from the plane counts as on it, one at 1e-6 is cut (§9.4)', () => {
    // Bottom face at z = −1e-12: within 1e-9·extent (extent 2 − 1e-12), so the
    // whole box is on the kept side and comes back unchanged.
    const noise = translateMesh3(B, [0, 0, 1 - 1e-12]);
    const kept = clipMesh3(noise, [0, 0, 1], 0);
    expect(kept.positions).toEqual(noise.positions);
    expect(kept.triangles).toEqual(noise.triangles);
    // Bottom at z = −1e-6: genuinely below, volume 4·(2 − 1e-6), closed and
    // consistent. (Not checked: freedom from slivers. The cap loop has two
    // re-inserted collinear points 1e-6 from the corner (−1, −1, 0), and the
    // fan that puts them back makes a needle of doubled area 1e-6 · 1e-6 =
    // 1e-12, which validateMesh3 flags at its default 1e-12·R² tolerance; a
    // fan from the opposite corner would have kept every area ≥ 1e-6. §9.4
    // promises closedness, orientation and volume, all of which hold.)
    const dip = translateMesh3(B, [0, 0, 1 - 1e-6]);
    const cut = clipMesh3(dip, [0, 0, 1], 0);
    expect(mesh3Volume(cut)).toBeCloseTo(4 * (2 - 1e-6), 10);
    const v = validateMesh3(cut, { allowDegenerate: true });
    expect(v.closed).toBe(true);
    expect(v.consistent).toBe(true);
    expect(v.errors).toEqual([]);
    expect(cut.positions.length).toBe(12);
    expect(cut.triangles.length).toBe(20);
  });

  describe('the ball (icosphere) at several planes', () => {
    const ICO3 = icosphere(1, 3);
    const ICO2 = icosphere(1, 2);
    const V3 = mesh3Volume(ICO3);
    const V2 = mesh3Volume(ICO2);
    // The icosphere is inscribed in the unit ball and contains the ball of
    // its inradius r_in, so any cap of it lies between the corresponding caps
    // of those two balls: π(R − c)²(2R + c)/3 with R = r_in and R = 1.
    const rIn = inradius(ICO3);
    const cap = (R: number, c: number): number => (c >= R ? 0 : (Math.PI * (R - c) ** 2 * (2 * R + c)) / 3);

    it('icosphere(1, 3) is inscribed in the unit ball with inradius above 0.99', () => {
      for (const p of ICO3.positions) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 12);
      expect(rIn).toBeGreaterThan(0.99);
      expect(rIn).toBeLessThan(1);
    });

    it('z ≥ 0 and x ≥ 0 halve it exactly (the vertex set is symmetric), through 32 vertices in the plane', () => {
      // The icosahedron's vertices (±1, ±φ, 0), (0, ±1, ±φ), (±φ, 0, ±1) are
      // symmetric under z ↦ −z and x ↦ −x, and midpoint subdivision keeps the
      // symmetry; the planes pass through vertices and cut edges elsewhere.
      const halfZ = clipMesh3(ICO3, [0, 0, 1], 0);
      expect(mesh3Volume(halfZ)).toBeCloseTo(V3 / 2, 12);
      expectClosedMesh3(halfZ);
      expect(ICO3.positions.filter((p) => p[2] === 0).length).toBe(32);
      const halfX = clipMesh3(ICO2, [1, 0, 0], 0);
      expect(mesh3Volume(halfX)).toBeCloseTo(V2 / 2, 12);
      expectClosedMesh3(halfX);
      // §9.4's stated value, up to the icosphere's own volume deficit.
      expect(mesh3Volume(halfZ)).toBeLessThan((2 / 3) * Math.PI);
      expect(mesh3Volume(halfZ)).toBeGreaterThan((2 / 3) * Math.PI * rIn ** 3);
    });

    it.each([-0.5, 0.3, 0.7])('z ≥ %s: a cap between the caps of the inscribed and circumscribed balls, closed, complementary', (c) => {
      const m = clipMesh3(ICO3, [0, 0, 1], c);
      const vol = mesh3Volume(m);
      expectClosedMesh3(m);
      expect(vol).toBeGreaterThan(cap(rIn, c));
      expect(vol).toBeLessThan(cap(1, c));
      const rest = clipMesh3(ICO3, [0, 0, -1], -c);
      expectClosedMesh3(rest);
      expect(vol + mesh3Volume(rest)).toBeCloseTo(V3, 12);
    });

    it('a tilted plane: complementary volumes sum to the whole, both halves closed and idempotent', () => {
      const n: Vec3 = [1, 2, 3];
      const a = clipMesh3(ICO3, n, 0.37);
      const b = clipMesh3(ICO3, [-1, -2, -3], -0.37);
      expectClosedMesh3(a);
      expectClosedMesh3(b);
      expect(mesh3Volume(a) + mesh3Volume(b)).toBeCloseTo(V3, 12);
      // Bracket: the kept side is the cap of height (1 − 0.37/|n|) of the ball.
      const c = 0.37 / Math.hypot(1, 2, 3);
      expect(mesh3Volume(a)).toBeGreaterThan(cap(rIn, c));
      expect(mesh3Volume(a)).toBeLessThan(cap(1, c));
      const again = clipMesh3(a, n, 0.37);
      expect(again.positions).toEqual(a.positions);
      expect(again.triangles).toEqual(a.triangles);
      expect(new Set(a.positions.map((p) => p.join(','))).size).toBe(a.positions.length);
    });

    it('the plane tangent at the pole vertex removes everything; a plane through the pole and the centre halves it', () => {
      // Level ≥ 1 has the vertex normalise((0,1,φ) + (0,−1,φ)) = (0, 0, 1).
      const zMax = Math.max(...ICO2.positions.map((p) => p[2]));
      expect(zMax).toBeCloseTo(1, 12);
      expect(ICO2.positions.filter((p) => p[2] === zMax).length).toBe(1);
      const tangent = clipMesh3(ICO2, [0, 0, 1], zMax);
      expect(tangent.triangles.length).toBe(0);
      expect(tangent.positions.length).toBe(0);
      // y ≥ 0 passes through the pole and halves the ball (y ↦ −y symmetry).
      const half = clipMesh3(ICO2, [0, 1, 0], 0);
      expect(mesh3Volume(half)).toBeCloseTo(V2 / 2, 12);
      expectClosedMesh3(half);
    });
  });

  describe('the torus: caps with a hole, two caps, planes through vertex rings', () => {
    // torus(R=1, r=0.4, 24, 12): rings j at v = 2πj/12, z = 0.4 sin v; j = 3 is
    // the top ring z = 0.4; j = 2 and j = 4 both sit at z = 0.4 sin(π/3).
    const T = torus(1, 0.4, 24, 12);
    const VT = mesh3Volume(T);

    it('z ≥ 0 keeps half (annular cap with a hole); x ≥ 0 keeps half (two disc caps)', () => {
      // v ↦ −v and u ↦ π − u are symmetries of the vertex set (12 | 2·6, 24 | 2·12).
      const top = clipMesh3(T, [0, 0, 1], 0);
      expect(mesh3Volume(top)).toBeCloseTo(VT / 2, 12);
      expectClosedMesh3(top);
      const right = clipMesh3(T, [1, 0, 0], 0);
      expect(mesh3Volume(right)).toBeCloseTo(VT / 2, 12);
      expectClosedMesh3(right);
      // Halved by a plane through its axis the solid torus becomes a bent
      // cylinder (the cut is two discs): boundary of Euler characteristic 2.
      // The half above z = 0 is still a ring (the cut is an annulus): Euler
      // characteristic 0.
      expect(validateMesh3(right).euler).toBe(2);
      expect(validateMesh3(top).euler).toBe(0);
    });

    it('the plane through the top ring of vertices (z = 0.4) touches only edges: everything is removed', () => {
      expect(T.positions.filter((p) => p[2] === 0.4).length).toBe(24);
      const m = clipMesh3(T, [0, 0, 1], 0.4);
      expect(m.positions.length).toBe(0);
      expect(m.triangles.length).toBe(0);
    });

    it('the plane z = 0.4 sin(π/3) through two vertex rings cuts the body: closed, complementary', () => {
      const z = 0.4 * Math.sin(Math.PI / 3);
      // sin(π/3) and sin(2π/3) differ by one ulp; snapping puts both rings on the plane.
      expect(T.positions.filter((p) => Math.abs(p[2] - z) < 1e-12).length).toBe(48);
      const upper = clipMesh3(T, [0, 0, 1], z);
      const lower = clipMesh3(T, [0, 0, -1], -z);
      expectClosedMesh3(upper);
      expectClosedMesh3(lower);
      expect(mesh3Volume(upper)).toBeGreaterThan(0);
      expect(mesh3Volume(upper)).toBeLessThan(VT / 2);
      expect(mesh3Volume(upper) + mesh3Volume(lower)).toBeCloseTo(VT, 12);
      // The same cut from below keeps the mirror image by the v ↦ −v symmetry.
      expect(mesh3Volume(clipMesh3(T, [0, 0, 1], -z))).toBeCloseTo(mesh3Volume(lower), 12);
    });
  });

  it('a component entirely on the removed side vanishes; one entirely on the kept side is copied', () => {
    const upper = translateMesh3(box(1, 1, 1), [0, 0, 1]);
    const lower = translateMesh3(box(1, 1, 1), [0, 0, -1]);
    const both = unionMesh3(upper, lower);
    const kept = clipMesh3(both, [0, 0, 1], 0);
    expect(kept.positions.length).toBe(8);
    expect(kept.triangles.length).toBe(12);
    expect(mesh3Volume(kept)).toBeCloseTo(1, 12);
    expectClosedMesh3(kept);
    for (const p of kept.positions) expect(p[2]).toBeGreaterThanOrEqual(0.5);
  });
});

// ============================================================================
describe('spin: validity (§5.2) and the discrete Pappus identity (§9.2, §7)', () => {
  const cases: Array<[string, () => SpunSolid]> = [
    ['spun ball (torisphere)', () => BALL],
    ['spun cube (square ring)', () => CUBE],
    ['spun half-ball (4-ball), clipped', () => HALF],
    ['cone touching z = 0 at its apex', () => spin(coneMesh(16, 0.6, 1), 12, 'cone')],
    ['box with its bottom face in z = 0', () => spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5]), 12, 'flat box')],
    ['cylinder with its bottom fan in z = 0 (interior flat vertex)', () => spin(translateMesh3(cylinder(1, 1, 8), [0, 0, 0.5]), 12, 'flat cylinder')],
    ['torus lying above the plane (3-torus boundary)', () => spin(translateMesh3(torus(1, 0.4, 24, 12), [0, 0, 1.5]), 12, 'spun torus')],
    ['box, N = 3 (minimum)', () => spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), 3, 'N3')],
    ['box, N = 7 (odd)', () => spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), 7, 'N7')],
    ['box, N = 360', () => spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), 360, 'N360')],
    ['icosphere crossing z = 0 (clipped to a half-ball)', () => spin(icosphere(1, 2), 12, 'crossing')],
    ['box crossing z = 0 leaving a slab of height 0.1', () => spin(translateMesh3(box(1, 1, 1), [0, 0, -0.4]), 16, 'slab')],
  ];

  it.each(cases)('%s: valid complex, hypervolume = N sin(2π/N) ∫ z dV to 1e-9, independent of the reference point', (_name, make) => {
    const s = make();
    expectValidComplex(s);
    expectPappus(s);
  });

  it('spun cube: N sin(2π/N) · 1.2 exactly (∫ z dV = z̄ · vol = 1.2 · 1); half-ball and ball to the mesh volume', () => {
    expect(CUBE.hypervolume()).toBeCloseTo(48 * Math.sin((2 * Math.PI) / 48) * 1.2, 12);
    expect(firstMomentZ(CUBE.mesh)).toBeCloseTo(1.2, 12);
    // The icosphere is centrally symmetric, so its centroid is its centre and
    // ∫ z dV = 1.1 · vol: the torisphere volume 2π · 1.1 · vol with the
    // polyhedral ball volume, times the polygon factor.
    expect(BALL.hypervolume()).toBeCloseTo(polygonFactor(48) * 2 * Math.PI * 1.1 * BALL_MESH_VOLUME, 10);
    // The slab: vol = 0.1, ∫ z dV = 1 · 0.1² / 2 = 0.005.
    const slab = spin(translateMesh3(box(1, 1, 1), [0, 0, -0.4]), 16, 'slab');
    expect(mesh3Volume(slab.mesh)).toBeCloseTo(0.1, 12);
    expect(slab.hypervolume()).toBeCloseTo(16 * Math.sin(Math.PI / 8) * 0.005, 12);
    // The cone: A h² / 4 with A = 8 · 0.36 · sin(π/8).
    const cone = spin(coneMesh(16, 0.6, 1), 12, 'cone');
    expect(cone.hypervolume()).toBeCloseTo(12 * Math.sin(Math.PI / 6) * (8 * 0.36 * Math.sin(Math.PI / 8)) / 4, 12);
    // Flat-bottomed box of height 1: disc × square, ∫ z dV = 1/2 → N sin(2π/N) / 2 = 6 · (1/2) = 3 for N = 12.
    expect(spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5]), 12, 'flat').hypervolume()).toBeCloseTo(3, 12);
  });

  it('§7: the cone form with o = 0 overestimates the torisphere (origin outside the solid) and equals the signed form for the 4-ball', () => {
    const { positions, tets } = BALL.complex;
    const cones = hypervolumeByCones(positions, tets);
    const signed = signedHypervolume(positions, tets);
    expect(signed).toBeCloseTo(BALL.hypervolume(), 12);
    // Not star-shaped about the origin, which lies in its hole: cones overlap
    // and are counted with absolute value. The excess is far above round-off.
    expect(cones).toBeGreaterThan(signed * 1.1);
    const h = HALF.complex;
    expect(hypervolumeByCones(h.positions, h.tets)).toBeCloseTo(signedHypervolume(h.positions, h.tets), 9);
  });

  it('triangles in z = 0 are not part of the boundary: the cylinder\'s bottom centre never enters the complex', () => {
    // cylinder(1, 1, 8) lifted by 0.5: 8 bottom ring vertices and the bottom
    // centre at z = 0, 8 top ring vertices and the top centre at z = 1. The
    // bottom fan (8 triangles) is F and is dropped; its centre is used by no
    // other triangle, so it is not spun. Positions: 12 · 9 + 8.
    const s = spin(translateMesh3(cylinder(1, 1, 8), [0, 0, 0.5]), 12, 'flat cylinder');
    expect(s.clipped).toBe(false);
    expect(s.complex.positions.length).toBe(12 * 9 + 8);
    expect(s.complex.positions.filter((p) => p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0).length).toBe(0);
    // Each side triangle with two flat vertices gives exactly one tet, with
    // one flat vertex two; the top fan gives three per step: 8·(1 + 2) + 8·3 = 48 per step.
    expect(s.complex.tets.length).toBe(12 * 48);
    // The body is the 8-gon disc × the 12-gon disc: (8/2) sin(π/4) · (12/2) sin(π/6).
    expect(s.hypervolume()).toBeCloseTo(4 * Math.sin(Math.PI / 4) * 6 * Math.sin(Math.PI / 6), 12);
  });

  it('the spun cone has one position for the apex and N per other vertex, and only one tet per side prism', () => {
    const s = spin(coneMesh(16, 0.6, 1), 12, 'cone');
    expect(s.complex.positions.length).toBe(12 * 17 + 1);
    expect(s.complex.positions.filter((p) => p.every((x) => x === 0)).length).toBe(1);
    // Side triangles (apex + 2 ring vertices): a pyramid of 2 tets; top fan: 3 tets. 16·(2 + 3) per step.
    expect(s.complex.tets.length).toBe(12 * 16 * 5);
  });

  it('a mesh dipping 2e-9 below z = 0 is snapped onto the plane, not cut into slivers: the spun tets are valid at the default tolerance (§5.2)', () => {
    // The spin moves vertices within SPIN_SNAP · N · radius of z = 0 onto it.
    // Cutting at z = −2e-9 instead leaves needles whose spun prisms have
    // 6 · volume ≈ 1e-9 < validateTetComplex's 1e-9 · scale³ ≈ 6e-9 ("32
    // degenerate tets" at N = 8), although the complex is closed and Pappus holds.
    const s = spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5 - 2e-9]), 8, 'sliver');
    expect(s.clipped).toBe(false);
    for (const p of s.mesh.positions) expect(p[2] === 0 || p[2] > 0.99).toBe(true);
    expectPappus(s);
    const v = validateTetComplex(s.complex.positions, s.complex.tets);
    expect(v.errors, v.errors.join('; ')).toEqual([]);
  });

  it.each([3, 8, 48, 360])('N = %i: a box 0.5 / 1.05 / 3 snap bands below or above z = 0 spins to a valid complex; beyond the band it is clipped', (N) => {
    const radius = mesh3Bounds(translateMesh3(box(1, 1, 1), [0, 0, 0.5])).radius;
    const band = SPIN_SNAP * N * radius;
    for (const sign of [-1, 1]) {
      for (const f of [0.5, 1.05, 3]) {
        const s = spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5 + sign * f * band]), N, 'near-plane');
        // Inside the band: on the plane (not clipped); beyond it, below the plane: clipped; above it: spun as is.
        expect(s.clipped, `${sign * f} bands`).toBe(sign < 0 && f > 1);
        const v = validateTetComplex(s.complex.positions, s.complex.tets);
        expect(v.errors, `${sign * f} bands: ${v.errors.join('; ')}`).toEqual([]);
        expectPappus(s);
      }
    }
  });
});

// ============================================================================
describe('the spun half-ball is the 4-ball (§9.2, §8.5)', () => {
  const N = 48;
  const ICO3 = icosphere(1, 3);
  const rIn = inradius(ICO3);
  const cosN = Math.cos(Math.PI / N);
  // B_N ⊂ 4-ball(1): the polyhedral half-ball lies in the unit half-ball and
  // the N-gon in the unit disc. B_N ⊃ E = { x² + y² + (ζ² + ω²)/cos²(π/N) ≤ r_in² }:
  // the half-ball of radius r_in lies in the polyhedron and the disc of radius
  // cos(π/N) (the apothem) in the N-gon. E contains the 4-ball of radius r_in cos(π/N).
  const ballVol = (R: number): number => (Math.PI ** 2 * R ** 4) / 2;
  const sliceVol = (R: number, c: number): number => (c * c >= R * R ? 0 : (4 / 3) * Math.PI * (R * R - c * c) ** 1.5);

  it('is clipped, has radius 1 and w range [−1, 1]', () => {
    expect(HALF.clipped).toBe(true);
    expect(HALF.steps).toBe(N);
    expect(HALF.radius()).toBeCloseTo(1, 12);
    expect(HALF.wRange()[0]).toBeCloseTo(-1, 12);
    expect(HALF.wRange()[1]).toBeCloseTo(1, 12);
    for (const p of HALF.mesh.positions) expect(p[2]).toBeGreaterThanOrEqual(-1e-15);
  });

  it('hypervolume lies between the discrete values for the inscribed and circumscribed 4-balls: (N/2π) sin(2π/N) · π²R⁴/2', () => {
    // ∫_S z dV for the polyhedral half-ball lies between π r_in⁴/4 and π/4
    // (the integrand is positive and the solids are nested), and the discrete
    // volume is N sin(2π/N) times it.
    const hv = HALF.hypervolume();
    expect(hv).toBeGreaterThan(polygonFactor(N) * ballVol(rIn));
    expect(hv).toBeLessThan(polygonFactor(N) * ballVol(1));
    // Loosely: within 2% of π²/2 (0.29% polygon factor, ≈ 1.2% first-moment deficit of the icosphere).
    expect(Math.abs(hv - ballVol(1)) / ballVol(1)).toBeLessThan(0.02);
  });

  it.each([0, 0.3, 0.6, 0.8, 0.9, 0.95])('slice at w = %s is a closed sphere with volume between the slices of E and of the unit 4-ball', (c) => {
    const r = analyseSlice(HALF.slice(hyperplaneW(c)));
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(r.euler).toBe(2);
    // Slice of E at w = c: x² + y² + z²/cos² ≤ r_in² − c²/cos², an ellipsoid
    // with semi-axes a = √(r_in² − c²/cos²) (twice) and a cos: (4/3)π a³ cos.
    const lo = (4 / 3) * Math.PI * cosN * Math.max(0, rIn * rIn - (c * c) / (cosN * cosN)) ** 1.5;
    expect(r.volume).toBeGreaterThan(lo);
    expect(r.volume).toBeLessThan(sliceVol(1, c) * (1 + 1e-6)); // Float32 slice positions
  });

  it('slices along seeded random directions are closed and bracketed too (the body is a 4-ball, not just along w)', () => {
    const rng = mulberry32(8_5_1);
    for (let i = 0; i < 2; i++) {
      const d = randomDirection(rng);
      for (const c of [0, 0.5]) {
        const r = analyseSlice(HALF.slice(hyperplane(d, c)));
        expect(r.closed).toBe(true);
        expect(r.consistent).toBe(true);
        expect(r.volume).toBeGreaterThan(sliceVol(rIn * cosN, c));
        expect(r.volume).toBeLessThan(sliceVol(1, c) * (1 + 1e-6));
      }
    }
  });

  it('Cavalieri (§7): ∫ A(c) dc along a seeded random direction equals the hypervolume within 1%', () => {
    const rng = mulberry32(7_7_7);
    const integral = sliceVolumeIntegral(HALF, randomDirection(rng));
    // A(c) is smooth for a ball; the 200-step midpoint rule is far better than 1%.
    expect(Math.abs(integral - HALF.hypervolume()) / HALF.hypervolume()).toBeLessThan(0.01);
  });
});

// ============================================================================
describe('slices of spun solids by w = c (§9.2, §6)', () => {
  it('spun ball at w = 0: the ball and its mirror image, volume 2·vol(mesh), mirror-symmetric vertices, two spheres', () => {
    // Steps k = 0 and k = N/2 are exactly (cos, sin) = (1, 0) and (−1, 0), so
    // the hyperplane w = 0 contains the copies (x, y, ±z) of the mesh; the
    // slice (limit from below) is exactly those two copies. Positions are
    // Float32, so 1e-6 relative covers the rounding of the volume sum.
    const slice = BALL.slice(hyperplaneW(0));
    const r = analyseSlice(slice);
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(r.euler).toBe(4); // two closed spheres
    expect(Math.abs(r.volume - 2 * BALL_MESH_VOLUME)).toBeLessThan(1e-6 * 2 * BALL_MESH_VOLUME);
    expect(r.triangles).toBe(2 * BALL.mesh.triangles.length);
    // Mirror symmetry: adding the z-reflected copy of the slice introduces no
    // new welded vertex.
    const mirrored: TriMesh3 = {
      positions: slice.positions.map((v, i) => (i % 3 === 2 ? -v : v)),
      indices: slice.indices,
      sourceW: slice.sourceW,
    };
    const alone = weldVertices(slice, 1e-6, true).positions.length;
    const together = weldVertices(mergeMeshes([slice, mirrored]), 1e-6, true).positions.length;
    expect(together).toBe(alone);
    expect(alone / 3).toBe(2 * BALL.mesh.positions.length);
  });

  it('spun half-ball at w = 0: the two halves of one ball, a single closed sphere of volume 2·vol(half mesh)', () => {
    const r = analyseSlice(HALF.slice(hyperplaneW(0)));
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(r.euler).toBe(2);
    const twice = 2 * mesh3Volume(HALF.mesh);
    expect(Math.abs(r.volume - twice)).toBeLessThan(1e-6 * twice);
    // The equator vertices (x, y, 0, 0) are shared by both halves: V = 2·(above) + (flat).
    const flat = HALF.mesh.positions.filter((p) => p[2] <= 1e-9).length;
    const above = HALF.mesh.positions.length - flat;
    expect(weldVertices(HALF.slice(hyperplaneW(0)), 1e-6, true).positions.length / 3).toBe(2 * above + flat);
  });

  it.each([3, 5, 7])('odd N = %s at w = 0: the lower twin is the mirror image scaled by cos(π/N) in z (angle π is an edge midpoint)', (N) => {
    // ρ_N(z, 0) = z for z > 0 (vertex at angle 0) and |z|/cos(π/N) for z < 0
    // (edge midpoint at angle π when N is odd), so the slice of the spun unit
    // cube is the cube plus its mirror image squeezed by cos(π/N): volume 1 + cos(π/N).
    const s = spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), N, `N${N}`);
    const r = analyseSlice(s.slice(hyperplaneW(0)));
    expect(r.closed).toBe(true);
    expect(Math.abs(r.volume - (1 + Math.cos(Math.PI / N)))).toBeLessThan(1e-6);
  });

  it.each([0, 0.5, 0.69, 0.71, 0.9, 1.6, 1.69, 1.699])('spun cube at w = %s: exactly a square × chord of the 48-gon annulus, 2·(h(1.7, c) − h(0.7, c))', (c) => {
    // B_N = [−½, ½]² × (1.7 P_N \ 0.7 P_N) exactly, so its slice at w = c is the
    // square times the horizontal chord(s) of the annulus at height c.
    const r = analyseSlice(CUBE.slice(hyperplaneW(c)));
    const expected = 2 * (halfChord(1.7, c, 48) - halfChord(0.7, c, 48));
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(Math.abs(r.volume - expected)).toBeLessThan(1e-6 * Math.max(expected, 1)); // Float32 positions
    // Two boxes while the inner polygon still reaches the line (|c| < 0.7), one box beyond.
    expect(r.euler).toBe(c < 0.7 ? 4 : 2);
    expect(r.volume).toBeGreaterThan(0);
  });

  it('spun cube: empty above z_max = 1.7, zero-volume doubled square exactly at it, small just below (descriptions in figures.ts)', () => {
    expect(CUBE.wRange()).toEqual([-1.7, 1.7]);
    for (const c of [1.7001, -1.7001, 3]) expect(CUBE.slice(hyperplaneW(c)).indices.length).toBe(0);
    // At c = 1.7 the hyperplane contains the top face at step N/4 (w = z · 1
    // exactly): §6's doubled flat polygon, volume 0, nonempty.
    const at = CUBE.slice(hyperplaneW(1.7));
    expect(at.indices.length).toBeGreaterThan(0);
    expect(Math.abs(signedVolume(at))).toBeLessThan(1e-9);
    // Just below: the chord near the top vertex of the 48-gon, 2·h(1.7, 1.699) ≈ 0.03.
    const below = analyseSlice(CUBE.slice(hyperplaneW(1.699)));
    expect(below.volume).toBeGreaterThan(0);
    expect(below.volume).toBeLessThan(0.05);
  });

  it('spun ball: empty above z_max = 1.5, empty after cleaning at it (vertex touch), small and closed just below', () => {
    // icosphere(0.4, 3) has the pole vertex (0, 0, 0.4): z_max = 1.5 and only one vertex reaches it.
    expect(BALL.wRange()[1]).toBeCloseTo(1.5, 12);
    expect(BALL.mesh.positions.filter((p) => Math.abs(p[2] - 1.5) < 1e-12).length).toBe(1);
    for (const c of [1.5001, -1.5001]) expect(BALL.slice(hyperplaneW(c)).indices.length).toBe(0);
    // Exactly at the top: only the pole's step-N/4 copy has s = 0; every emitted
    // triangle is zero-area and the cleaned slice is empty (§6).
    const top = analyseSlice(BALL.slice(hyperplaneW(1.5)));
    expect(top.triangles).toBe(0);
    expect(top.volume).toBe(0);
    // Just below, c = 1.49: nonempty (the pole copy at w = 1.5 is above the
    // hyperplane). Containment bound: the slice lies in { (x, y, √(z² + c²)) ∈
    // Ball((0,0,1.1), 0.4) }, so x² + y² ≤ 0.16 − 0.39² = 0.0079 and
    // z² ≤ 1.5² − 1.49² = 0.0299: inside a box of volume 4 · 0.0079 · 0.173 < 0.011.
    const r = analyseSlice(BALL.slice(hyperplaneW(1.49)));
    expect(r.closed).toBe(true);
    expect(r.volume).toBeGreaterThan(0);
    expect(r.volume).toBeLessThan(0.011);
  });

  it('spun ball twins: two components while |c| < z_0 − r = 0.7 (Euler 4), one body beyond (Euler 2)', () => {
    // A point of the slice at w = c has ρ_N(z, c) ∈ [0.7, 1.5] ∩ (x, y)-range;
    // z = 0 is allowed iff ρ_N(0, c) = |c| ≥ 0.7 (vertex at angle π/2), so the
    // twins touch exactly when |c| reaches 0.7, as the catalogue description says.
    for (const c of [0.3, -0.6]) {
      const r = analyseSlice(BALL.slice(hyperplaneW(c)));
      expect(r.closed).toBe(true);
      expect(r.consistent).toBe(true);
      expect(r.euler).toBe(4);
    }
    for (const c of [0.8, -1.2]) {
      const r = analyseSlice(BALL.slice(hyperplaneW(c)));
      expect(r.closed).toBe(true);
      expect(r.consistent).toBe(true);
      expect(r.euler).toBe(2);
    }
  });

  it('sourceW of a w = c slice is c (§10: the w coordinate of the 4D point before rotation)', () => {
    for (const shape of [CUBE, BALL]) {
      const m = shape.slice(hyperplaneW(0.4));
      for (let i = 0; i < m.sourceW.length; i++) expect(Math.abs(m.sourceW[i] - 0.4)).toBeLessThan(1e-6);
    }
  });

  it('every complex vertex is (x, y, z cos φ_k, z sin φ_k) of a mesh vertex: |p| preserved, (x, y) unchanged, radius = max |p|', () => {
    const keys = new Set(CUBE.mesh.positions.map((p) => `${p[0]},${p[1]}`));
    let maxR = 0;
    for (const p of CUBE.complex.positions) {
      expect(keys.has(`${p[0]},${p[1]}`)).toBe(true);
      const rho = Math.hypot(p[2], p[3]);
      // Every cube vertex has z ∈ {0.7, 1.7}.
      expect(Math.min(Math.abs(rho - 0.7), Math.abs(rho - 1.7))).toBeLessThan(1e-12);
      maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2], p[3]));
    }
    expect(CUBE.radius()).toBeCloseTo(Math.sqrt(0.25 + 0.25 + 1.7 * 1.7), 12);
    expect(CUBE.radius()).toBeCloseTo(maxR, 12);
    expect(CUBE.complex.positions.length).toBe(48 * 8);
  });
});

// ============================================================================
describe('Cavalieri along random directions and invariance under rotation (§7, §4)', () => {
  // A smaller torisphere for the repeated integrals: icosphere(0.4, 2) at 1.1, 24 steps.
  const SMALL = spin(translateMesh3(icosphere(0.4, 2), [0, 0, 1.1]), 24, 'small torisphere');

  it('∫ A(c) dc equals signedHypervolume within 1% along e_w and three seeded directions (torisphere and cube)', () => {
    const rng = mulberry32(2024);
    for (const shape of [SMALL, CUBE]) {
      const hv = shape.hypervolume();
      expect(Math.abs(sliceVolumeIntegral(shape, [0, 0, 0, 1]) - hv) / hv).toBeLessThan(0.01);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(sliceVolumeIntegral(shape, randomDirection(rng)) - hv) / hv).toBeLessThan(0.01);
      }
    }
    // The catalogue torisphere along e_w (slow, once).
    expect(Math.abs(sliceVolumeIntegral(BALL, [0, 0, 0, 1]) - BALL.hypervolume()) / BALL.hypervolume()).toBeLessThan(0.01);
  });

  it('a random rotation of the complex preserves validity, the hypervolume, the slice integral and each slice volume', () => {
    const rng = mulberry32(31337);
    for (const shape of [CUBE, SMALL]) {
      const M = randomRotation(rng);
      const rotated = { positions: shape.complex.positions.map((p) => apply4(M, p)), tets: shape.complex.tets };
      const v = validateTetComplex(rotated.positions, rotated.tets);
      expect(v.errors, v.errors.join('; ')).toEqual([]);
      const hv = shape.hypervolume();
      // det[M a; M b; M c; M d] = det M · det[a; b; c; d] = det[a; b; c; d].
      expect(Math.abs(signedHypervolume(rotated.positions, rotated.tets) - hv)).toBeLessThan(1e-9 * hv);
      const asShape = new TetShape('rotated', 'lifted', rotated, null);
      expect(asShape.radius()).toBeCloseTo(shape.radius(), 9);
      // Slicing the rotated body by w = c is slicing the original by Mᵀe_w · p = c
      // (§4): congruent slices, equal volumes up to Float32 rounding.
      for (const c of [0, 0.4, -0.9, 1.3]) {
        const a = signedVolume(asShape.slice(hyperplaneW(c)));
        const b = signedVolume(shape.slice(hyperplaneFromRotation(M, c)));
        expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(a)));
        if (a > 1e-9) {
          const r = analyseSlice(asShape.slice(hyperplaneW(c)));
          expect(r.closed).toBe(true);
          expect(r.consistent).toBe(true);
        }
      }
      // The same function A(c) is integrated with the same sample offsets.
      const i1 = sliceVolumeIntegral(asShape, [0, 0, 0, 1]);
      const i2 = sliceVolumeIntegral(shape, hyperplaneFromRotation(M, 0).normal);
      expect(Math.abs(i1 - i2)).toBeLessThan(1e-6 * hv);
      expect(Math.abs(i1 - hv) / hv).toBeLessThan(0.01);
    }
  });
});

// ============================================================================
describe('clipping inside spin (§9.2, §9.4) and argument checks', () => {
  it('a mesh crossing z = 0 is clipped and flagged; spinning the pre-clipped mesh gives the identical complex', () => {
    const ico = icosphere(1, 2);
    const s = spin(ico, 12, 'crossing');
    expect(s.clipped).toBe(true);
    expect(s.mesh).not.toBe(ico);
    for (const p of s.mesh.positions) expect(p[2]).toBeGreaterThanOrEqual(-1e-15);
    expect(mesh3Volume(s.mesh)).toBeCloseTo(mesh3Volume(ico) / 2, 12);
    const pre = spin(clipMesh3(ico, [0, 0, 1], 0), 12, 'pre-clipped');
    expect(pre.clipped).toBe(false);
    expect(pre.complex.tets).toEqual(s.complex.tets);
    expect(pre.complex.positions).toEqual(s.complex.positions);
    expect(s.hypervolume()).toBeCloseTo(pre.hypervolume(), 12);
  });

  it('a mesh wholly in z ≥ 0 is spun as is (same mesh object), rounding noise below the plane is not clipping', () => {
    const above = translateMesh3(box(1, 1, 1), [0, 0, 1.2]);
    const s = spin(above, 8, 'above');
    expect(s.clipped).toBe(false);
    expect(s.mesh).toBe(above);
    // Bottom at z = −1e-13: noise (above −1e-9 · radius); the bottom vertices
    // are taken to lie in the plane and the bottom face is F.
    const noisy = translateMesh3(box(1, 1, 1), [0, 0, 0.5 - 1e-13]);
    const t = spin(noisy, 8, 'noisy');
    expect(t.clipped).toBe(false);
    expect(t.complex.positions.length).toBe(8 * 4 + 4);
    expectValidComplex(t);
    expectPappus(t);
  });

  it('two boxes, one below the plane: the lower one is clipped away and the spin equals that of the upper box', () => {
    const upper = translateMesh3(box(1, 1, 1), [0, 0, 1]);
    const both = unionMesh3(upper, translateMesh3(box(1, 1, 1), [0, 0, -1]));
    const s = spin(both, 8, 'two boxes');
    expect(s.clipped).toBe(true);
    expect(s.mesh.positions.length).toBe(8);
    expectValidComplex(s);
    expectPappus(s);
    expect(s.hypervolume()).toBeCloseTo(spin(upper, 8, 'upper').hypervolume(), 12);
    // ∫ z dV = z̄ · vol = 1 · 1.
    expect(s.hypervolume()).toBeCloseTo(8 * Math.sin(Math.PI / 4) * 1, 12);
  });

  it('throws when there is nothing to spin or the step count is not an integer ≥ 3', () => {
    expect(() => spin(translateMesh3(box(1, 1, 1), [0, 0, -5]), 8, 'below')).toThrow(/nothing to spin/);
    // A box of zero height lying in z = 0: every triangle is in F.
    expect(() => spin(box(1, 1, 0), 8, 'flat')).toThrow(/nothing to spin/);
    const m = translateMesh3(box(1, 1, 1), [0, 0, 1]);
    expect(() => spin(m, 2, 'two')).toThrow();
    expect(() => spin(m, 4.5, 'half')).toThrow();
    expect(() => spin(m, Number.NaN, 'nan')).toThrow();
    expect(() => spin(m, 3, 'three')).not.toThrow();
  });
});

// ============================================================================
describe('wire structure of spun solids (§9.2, §5.3)', () => {
  const checkIndices = (s: SpunSolid): void => {
    const w = s.wire();
    const n = w.positions.length;
    expect(w.positions).toBe(s.complex.positions);
    const seen = new Set<string>();
    for (const [a, b] of w.edges) {
      expect(Number.isInteger(a) && a >= 0 && a < n).toBe(true);
      expect(Number.isInteger(b) && b >= 0 && b < n).toBe(true);
      expect(a).not.toBe(b);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      expect(seen.has(key), `duplicate edge ${key}`).toBe(false);
      seen.add(key);
    }
    for (const f of w.faces) {
      expect(f.length).toBeGreaterThanOrEqual(3);
      expect(new Set(f).size).toBe(f.length);
      for (const i of f) expect(Number.isInteger(i) && i >= 0 && i < n).toBe(true);
    }
  };

  /** Counts predicted from the clipped mesh: N copies of a vertex above the plane, one of a vertex in it. */
  const predicted = (s: SpunSolid, tol: number): { positions: number; edges: number; faces: number } => {
    const N = s.steps;
    const flat = s.mesh.positions.map((p) => p[2] <= tol);
    const boundary = s.mesh.triangles.filter(([a, b, c]) => !(flat[a] && flat[b] && flat[c]));
    const referenced = new Set<number>();
    for (const t of boundary) for (const v of t) referenced.add(v);
    let positions = 0;
    let stepEdges = 0;
    for (const v of referenced) { positions += flat[v] ? 1 : N; if (!flat[v]) stepEdges += N; }
    let edges = 0;
    let quads = 0;
    for (const [i, j] of mesh3Edges({ positions: s.mesh.positions, triangles: boundary })) {
      if (flat[i] && flat[j]) edges += 1;
      else { edges += N; if (!flat[i] && !flat[j]) quads += N; }
    }
    return { positions, edges: edges + stepEdges, faces: boundary.length * N + quads };
  };

  it('spun cube: 48·8 positions, 48·(18 + 8) edges, 48·(12 + 18) faces, all indices in range', () => {
    const w = CUBE.wire();
    expect(w.positions.length).toBe(48 * 8);
    expect(w.edges.length).toBe(48 * (18 + 8));
    expect(w.faces.length).toBe(48 * (12 + 18));
    checkIndices(CUBE);
  });

  it('spun half-ball: N·(vertices above) + (vertices in z = 0) positions, cap edges drawn once', () => {
    const p = predicted(HALF, 1e-9);
    const w = HALF.wire();
    expect(w.positions.length).toBe(p.positions);
    expect(w.edges.length).toBe(p.edges);
    expect(w.faces.length).toBe(p.faces);
    const flat = HALF.mesh.positions.filter((q) => q[2] <= 1e-9).length;
    expect(flat).toBeGreaterThan(0);
    expect(w.positions.length).toBe(48 * (HALF.mesh.positions.length - flat) + flat);
    checkIndices(HALF);
  });

  it('spun ball: 48 · 642 positions (icosphere level 3 has 10·4³ + 2 vertices), indices in range', () => {
    expect(BALL.mesh.positions.length).toBe(642);
    expect(BALL.wire().positions.length).toBe(48 * 642);
    checkIndices(BALL);
  });

  it('flat-bottomed box and cone: counts follow the same rule (bottom edges once, no quads over collapsed edges)', () => {
    const flatBox = spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5]), 12, 'flat box');
    // 4 top vertices × 12 + 4 bottom = 52; edges: 4 bottom edges once + 13
    // other boundary edges × 12 + 4 × 12 step edges = 208; faces: 10 × 12
    // triangles + 5 top edges × 12 quads = 180.
    expect(flatBox.wire().positions.length).toBe(52);
    expect(flatBox.wire().edges.length).toBe(208);
    expect(flatBox.wire().faces.length).toBe(180);
    expect(predicted(flatBox, 1e-12)).toEqual({ positions: 52, edges: 208, faces: 180 });
    checkIndices(flatBox);
    const cone = spin(coneMesh(16, 0.6, 1), 12, 'cone');
    const p = predicted(cone, 1e-12);
    expect(cone.wire().positions.length).toBe(p.positions);
    expect(cone.wire().edges.length).toBe(p.edges);
    expect(cone.wire().faces.length).toBe(p.faces);
    checkIndices(cone);
  });
});

// ============================================================================
describe('the spun catalogue (SPUN_SHAPES) and the torisphere identity (§9.3)', () => {
  it('ids are exactly the registry\'s spun ids, unique, all in the spun group', () => {
    const registry = Object.values(SHAPE_IDS).filter((id) => id.startsWith('spun')).sort();
    const ids = SPUN_SHAPES.map((e) => e.id).sort();
    expect(ids).toEqual(registry);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SPUN_SHAPES) {
      expect(e.group).toBe('Spun 3D objects');
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it.each(SPUN_SHAPES.map((e) => [e.id, e] as const))('%s: create() slices closed and outward at w = 0, with the stated w range', (_id, entry) => {
    const shape = entry.create();
    const r = analyseSlice(shape.slice(hyperplaneW(0)));
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(r.volume).toBeGreaterThan(0);
    const [lo, hi] = shape.wRange();
    expect(lo).toBeCloseTo(-hi, 12);
    expect(shape.radius()).toBeGreaterThanOrEqual(hi);
    // Beyond the w range nothing is left (§9.2: the twins vanish past the greatest height).
    expect(shape.slice(hyperplaneW(hi * (1 + 1e-6))).indices.length).toBe(0);
  });

  it('spun human: 16 unclipped parts in 36 steps, lowest point at z = 0.25, each part valid with its Pappus value', () => {
    const human = spunHuman();
    expect(human.parts.length).toBe(16);
    let minZ = Infinity;
    for (const part of human.parts) {
      expect(part).toBeInstanceOf(SpunSolid);
      const s = part as SpunSolid;
      expect(s.clipped).toBe(false);
      expect(s.steps).toBe(36);
      for (const p of s.mesh.positions) minZ = Math.min(minZ, p[2]);
      expectValidComplex(s);
      expectPappus(s);
    }
    expect(minZ).toBeCloseTo(0.25, 12);
  });

  it('the spun ball turned by R_YW(π/2) R_XZ(π/2) satisfies the torisphere equation √((√(x²+y²) − 1.1)² + z² + w²) = 0.4', () => {
    // Every mesh vertex is at distance 0.4 from (0, 0, 1.1); its spun copies
    // are at distance 0.4 from the circle (0, 0, 1.1 cos φ, 1.1 sin φ). The
    // rotation sends (x, y, ζ, ω) to (−ζ, −ω, x, y), carrying that circle to
    // the circle of radius 1.1 in the xy-plane of §9.3's torisphere.
    const M = mul4(rotation('YW', Math.PI / 2), rotation('XZ', Math.PI / 2));
    expect(apply4(M, [0, 0, 1.1, 0])).toEqual(expect.arrayContaining([expect.closeTo(-1.1, 12)]));
    for (const p of BALL.complex.positions) {
      const q = apply4(M, p);
      const d = Math.hypot(Math.hypot(q[0], q[1]) - 1.1, q[2], q[3]);
      expect(Math.abs(d - 0.4)).toBeLessThan(1e-12);
    }
  });

  it.each([3, 5, 6, 7, 12])('wRange() is the true w extent of the complex, ±z_max · max sin φ_k, for N = %i (z_max itself only when 4 | N)', (N) => {
    // §10: the slice-view colour ends are the object's own w extent. For N = 6
    // the steps are at 0°, 60°, ..., 300°, so max w = z_max sin 60° =
    // 1.7 · 0.866 = 1.472 (the highest point of the box is at 1.7).
    const s = spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), N, `N${N}`);
    const ws = s.complex.positions.map((p) => p[3]);
    const actual = Math.max(...ws);
    expect(Math.min(...ws)).toBeCloseTo(-actual, 12);
    expect(s.wRange()[0]).toBeCloseTo(-actual, 12);
    expect(s.wRange()[1]).toBeCloseTo(actual, 12);
    const expected = N % 4 === 0 ? 1.7 : 1.7 * Math.max(...Array.from({ length: N }, (_, k) => Math.sin((2 * Math.PI * k) / N)));
    expect(s.wRange()[1]).toBeCloseTo(expected, 12);
    if (N === 6) expect(s.wRange()[1]).toBeCloseTo(1.7 * Math.sin(Math.PI / 3), 12);
  });
});
