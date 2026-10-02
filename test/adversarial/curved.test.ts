/**
 * Adversarial tests for src/geometry/curved.ts (4-ball, duocylinder, Clifford
 * torus, Hopf fibration). Every expected value below is derived in a comment
 * from docs/MATH.md or from standard mathematics, never from the code under
 * test. Random directions and rotations come from a seeded generator so a
 * failure reproduces exactly.
 *
 * Tolerance policy. Two kinds of statements appear:
 *  - exact identities (polytope hypervolumes, symmetry, scaling, Hopf algebra):
 *    relative tolerance 1e-9 or tighter, except where the slicer's Float32
 *    output positions force ~1e-6;
 *  - discretisation statements about the 4-ball: two RIGOROUS bounds
 *    (inscribed: discrete <= exact; inner ball: discrete >= value for the ball
 *    of radius r_in, where r_in is the least distance from the origin to a
 *    boundary tet's hyperplane) plus a documented EMPIRICAL bound measured at
 *    the given level and quoted with its margin.
 */
import { describe, expect, it } from 'vitest';
import {
  cliffordTorus,
  duocylinder,
  duocylinderComplex,
  hopfBasePoints,
  hopfFiber,
  hopfFibration,
  hopfLift,
  hopfShape,
  hypersphere,
  hypersphereComplex,
  subdivideSphericalTets,
} from '../../src/geometry/curved';
import { hypervolumeByCones, orientTetsOutward, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { PHI, regularPolytope } from '../../src/geometry/polytopes';
import { analyseSlice, signedVolume, triangleCount } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { sliceTets } from '../../src/geometry/slice';
import { hyperplane, hyperplaneFromRotation, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { projectStereographic } from '../../src/math/projection';
import { compositeRotation } from '../../src/math/rotation';
import { apply4 } from '../../src/math/mat4';
import { add3, cross3, dot3, dot4, length3, length4, normalize4, scale3, sub3, sub4 } from '../../src/math/vec';
import type { RotationAngles, Tet, TetComplex, TriMesh3, Vec3, Vec4 } from '../../src/math/types';

// ---------------------------------------------------------------------------
// Helpers (test-local, independent of the implementation)
// ---------------------------------------------------------------------------

/** mulberry32: small seeded PRNG, uniform in [0, 1). */
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

/** Standard normal via Box-Muller, from a uniform source. */
function gaussian(rng: () => number): number {
  const u = rng() || 1e-12;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Uniform random unit vector in R^4 (normalised Gaussian vector). */
const randomUnit4 = (rng: () => number): Vec4 => normalize4([gaussian(rng), gaussian(rng), gaussian(rng), gaussian(rng)]);

/** Uniform random unit vector in R^3. */
function randomUnit3(rng: () => number): Vec3 {
  const v: Vec3 = [gaussian(rng), gaussian(rng), gaussian(rng)];
  return scale3(v, 1 / length3(v));
}

function randomAngles(rng: () => number): RotationAngles {
  const a = (): number => rng() * 2 * Math.PI;
  return { XY: a(), XZ: a(), XW: a(), YZ: a(), YW: a(), ZW: a() };
}

const EXACT_BALL_VOLUME = (R: number): number => (Math.PI ** 2 * R ** 4) / 2; // MATH.md §8.5
const EXACT_BALL_SLICE = (R: number, c: number): number => (4 / 3) * Math.PI * Math.max(0, R * R - c * c) ** 1.5; // §8.5

/**
 * Least distance from the origin to the affine hull of any boundary tet. Every
 * boundary point lies on some tet, hence at distance >= r_in from the origin;
 * for a star-shaped solid every ray from the origin therefore leaves the solid
 * at distance >= r_in, so the solid contains the ball of radius r_in.
 */
function innerBallRadius(cx: TetComplex): number {
  let r = Infinity;
  for (const t of cx.tets) {
    const n = tetNormal(cx.positions, t);
    r = Math.min(r, Math.abs(dot4(n, cx.positions[t[0]])) / length4(n));
  }
  return r;
}

/** Longest edge of any tet. */
function longestEdge(cx: TetComplex): number {
  let m = 0;
  for (const t of cx.tets) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) m = Math.max(m, length4(sub4(cx.positions[t[i]], cx.positions[t[j]])));
    }
  }
  return m;
}

/** Vertex, edge, face and tet counts of a tet list (combinatorial). */
function complexCounts(tets: readonly Tet[]): { V: number; E: number; F: number; T: number } {
  const verts = new Set<number>();
  const edges = new Set<string>();
  const faces = new Set<string>();
  for (const t of tets) {
    for (const v of t) verts.add(v);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) edges.add(Math.min(t[i], t[j]) + ',' + Math.max(t[i], t[j]));
    }
    for (let skip = 0; skip < 4; skip++) {
      faces.add(t.filter((_, k) => k !== skip).sort((a, b) => a - b).join(','));
    }
  }
  return { V: verts.size, E: edges.size, F: faces.size, T: tets.length };
}

/** Regular n-gon of circumradius r with vertex 0 on the positive first axis. */
const regularPolygon = (r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, j) => [r * Math.cos((2 * Math.PI * j) / n), r * Math.sin((2 * Math.PI * j) / n)]);

/** Area of the regular n-gon of circumradius r: n isosceles triangles of apex angle 2π/n. */
const polygonArea = (r: number, n: number): number => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

/**
 * Length of the chord of a convex polygon cut by the line {coordinate `fixed`
 * = c}, measured along the other coordinate. A vertex exactly on the line
 * contributes itself, so at a supporting line through a vertex the chord has
 * length 0 (the limit from inside), matching MATH.md §6's limit-from-below
 * convention for the slicer.
 */
function polygonChord(poly: [number, number][], fixed: 0 | 1, c: number): number {
  const along = fixed === 0 ? 1 : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < poly.length; j++) {
    const p = poly[j];
    const q = poly[(j + 1) % poly.length];
    const sp = p[fixed] - c;
    const sq = q[fixed] - c;
    if ((sp > 0 && sq > 0) || (sp < 0 && sq < 0) || (sp === 0 && sq === 0)) continue;
    const t = sp / (sp - sq);
    const v = p[along] + t * (q[along] - p[along]);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi > lo ? hi - lo : 0;
}

/** Hopf map h(z1, z2) = (2 Re(z1 conj z2), 2 Im(z1 conj z2), |z1|^2 - |z2|^2), with z1 = x + iy, z2 = z + iw. */
function hopfMap(p: Vec4): Vec3 {
  const [a, b, c, d] = p;
  // z1 * conj(z2) = (a + ib)(c - id) = (ac + bd) + i(bc - ad)
  return [2 * (a * c + b * d), 2 * (b * c - a * d), a * a + b * b - c * c - d * d];
}

/** Circumcircle of three points in R^3: centre, unit normal of their plane, radius. */
function circumcircle(p0: Vec3, p1: Vec3, p2: Vec3): { centre: Vec3; normal: Vec3; radius: number } {
  const a = sub3(p1, p0);
  const b = sub3(p2, p0);
  const axb = cross3(a, b);
  const num = cross3(sub3(scale3(b, dot3(a, a)), scale3(a, dot3(b, b))), axb);
  const centre = add3(p0, scale3(num, 1 / (2 * dot3(axb, axb))));
  return { centre, normal: scale3(axb, 1 / length3(axb)), radius: length3(sub3(p0, centre)) };
}

/**
 * Linking number of closed polygon B with a closed polygon A whose vertices
 * lie on a circle: signed count of crossings of B's segments through the flat
 * disc spanning A's circle. Exact for polygons, no quadrature.
 */
function linkingWithCircle(circlePolygon: Vec3[], other: Vec3[]): number {
  const n = circlePolygon.length;
  const { centre, normal, radius } = circumcircle(circlePolygon[0], circlePolygon[Math.floor(n / 3)], circlePolygon[Math.floor((2 * n) / 3)]);
  let sum = 0;
  for (let k = 0; k < other.length; k++) {
    const p = other[k];
    const q = other[(k + 1) % other.length];
    const sp = dot3(sub3(p, centre), normal);
    const sq = dot3(sub3(q, centre), normal);
    if ((sp >= 0 && sq >= 0) || (sp < 0 && sq < 0)) continue;
    const x = add3(p, scale3(sub3(q, p), sp / (sp - sq)));
    if (length3(sub3(x, centre)) < radius) sum += sp > 0 ? -1 : 1;
  }
  return sum;
}

function meshVertex(m: TriMesh3, i: number): Vec3 {
  return [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
}

const vertexCount = (m: TriMesh3): number => m.positions.length / 3;

// Shared fixtures (built once; level 3 is the viewer default).
const BALL3 = hypersphere(1, 3);
const BALL2 = hypersphere(1, 2);

// ===========================================================================
// 4-ball (MATH.md §8.5)
// ===========================================================================

describe('hypersphere: vertices and combinatorics', () => {
  it('puts every vertex at distance exactly R from the origin, levels 0..3, R = 1 and R = 2.5', () => {
    // §8.5: new vertices are projected onto the sphere; the 16-cell's own
    // vertices are ±R e_i. So |p| = R for all. Normalise-then-scale costs a
    // couple of ulps, hence 1e-13 relative.
    for (const R of [1, 2.5]) {
      for (let level = 0; level <= 3; level++) {
        const cx = hypersphereComplex(R, level);
        for (const p of cx.positions) expect(Math.abs(length4(p) - R)).toBeLessThanOrEqual(1e-13 * R);
      }
    }
  });

  it('has 16·8^L tets and V = 8, 32, 192, 1408 vertices at levels 0..3, with χ = V − E + F − T = 0', () => {
    // Midpoint subdivision adds exactly one vertex per edge, so V_{L+1} = V_L + E_L.
    // The boundary is a closed 3-manifold (S^3), so χ = V − E + F − T = 0 and
    // F = 2T (each face in two tets), giving E = V + T. 16-cell: V = 8, E = 24,
    // T = 16 (24 = 8 + 16, consistent). Then V_1 = 32, E_1 = 32 + 128 = 160,
    // V_2 = 192, E_2 = 192 + 1024 = 1216, V_3 = 1408.
    const expectedV = [8, 32, 192, 1408];
    for (let level = 0; level <= 3; level++) {
      const cx = hypersphereComplex(1, level);
      const { V, E, F, T } = complexCounts(cx.tets);
      expect(T).toBe(16 * 8 ** level);
      expect(cx.positions.length).toBe(expectedV[level]);
      expect(V).toBe(expectedV[level]); // every position is used by some tet
      expect(F).toBe(2 * T);
      expect(V - E + F - T).toBe(0);
    }
  });

  it('is a valid (closed, consistently oriented, non-degenerate) complex at levels 0..3', () => {
    // §5.2 validity. Also §5.1: outward orientation about the origin means the
    // signed cone sum equals the unsigned one.
    for (let level = 0; level <= 3; level++) {
      const cx = hypersphereComplex(1, level);
      const v = validateTetComplex(cx.positions, cx.tets);
      expect(v.ok, v.errors.join('; ')).toBe(true);
      expect(v.degenerateTets).toBe(0);
      const signed = signedHypervolume(cx.positions, cx.tets);
      const unsigned = hypervolumeByCones(cx.positions, cx.tets);
      expect(signed).toBeGreaterThan(0);
      expect(Math.abs(signed - unsigned)).toBeLessThanOrEqual(1e-12 * unsigned);
    }
  });

  it('subdivideSphericalTets appends exactly one midpoint per edge and returns 8 tets per input tet', () => {
    const base = hypersphereComplex(1, 0);
    const positions = base.positions.map((p) => [...p] as Vec4);
    const out = subdivideSphericalTets(positions, base.tets, 1);
    expect(out.length).toBe(8 * 16);
    // 16-cell has 24 edges (8 vertices, each joined to the 6 non-antipodal ones: 8·6/2).
    expect(positions.length).toBe(8 + 24);
    for (const p of positions) expect(Math.abs(length4(p) - 1)).toBeLessThanOrEqual(1e-13);
  });

  it('rejects a non-positive radius and a non-integer or negative level', () => {
    expect(() => hypersphereComplex(0, 1)).toThrow();
    expect(() => hypersphereComplex(-1, 1)).toThrow();
    expect(() => hypersphereComplex(1, 1.5)).toThrow();
    expect(() => hypersphereComplex(1, -1)).toThrow();
  });

  it('reports radius R and wRange [−R, R] through the Shape4 interface', () => {
    const s = hypersphere(1.5, 2);
    expect(Math.abs(s.radius() - 1.5)).toBeLessThanOrEqual(1e-13);
    const [lo, hi] = s.wRange();
    expect(lo).toBeCloseTo(-1.5, 12);
    expect(hi).toBeCloseTo(1.5, 12);
    expect(s.wire()).toBeNull();
    expect(s.kind).toBe('curved');
  });
});

describe('hypersphere: hypervolume', () => {
  it('level 0 is the 16-cell with hypervolume 2/3 and level 1 has exactly (4 + 2√2)/3', () => {
    // Level 0: §8 table, 16-cell hypervolume 2/3.
    // Level 1 by hand: 64 corner tets, e.g. (e_w, m_wx, m_wy, m_wz) with
    // m_wi = (e_w + e_i)/√2; det[e_w; m_wx; m_wy; m_wz] = −(1/√2)^3, so each
    // cone has 4-volume (1/(2√2))/24 and the 64 together give 64/(48√2) = 2√2/3.
    // The 6 midpoints of a 16-cell tet all satisfy x+y+z+w = √2 (for the
    // all-positive tet), so each inner octahedron is flat and regular with
    // edge |(e_x+e_y)/√2 − (e_x+e_z)/√2| = 1, 3-volume √2/3, at distance
    // √2/2 from the origin: cone 4-volume (√2/3)(√2/2)/4 = 1/12; 16 of them
    // give 4/3. Total (4 + 2√2)/3 ≈ 2.27614.
    const c0 = hypersphereComplex(1, 0);
    expect(hypervolumeByCones(c0.positions, c0.tets)).toBeCloseTo(2 / 3, 12);
    const c1 = hypersphereComplex(1, 1);
    expect(hypervolumeByCones(c1.positions, c1.tets)).toBeCloseTo((4 + 2 * Math.SQRT2) / 3, 12);
  });

  it('is always below π²R⁴/2 and above the inner-ball value π² r_in⁴/2', () => {
    // Every tet has its vertices on the sphere and is flat, so it lies inside
    // the ball; the star-shaped solid it bounds is inside the ball (upper
    // bound). The solid contains the ball of radius r_in (see innerBallRadius).
    for (let level = 0; level <= 4; level++) {
      const cx = hypersphereComplex(1, level);
      const v = hypervolumeByCones(cx.positions, cx.tets);
      expect(v).toBeLessThan(EXACT_BALL_VOLUME(1));
      expect(v).toBeGreaterThan(EXACT_BALL_VOLUME(innerBallRadius(cx)));
    }
  });

  it('error vs π²R⁴/2 decreases at second order with level; documented: 5.3% at level 3, 1.4% at level 4', () => {
    // Inscribed polytopes with vertices on the sphere have a volume deficit of
    // order (mesh size)², and midpoint subdivision halves the mesh size, so the
    // relative error must shrink by a factor approaching 4 per level.
    // Measured (R = 1): 0.865, 0.539, 0.191, 0.0531, 0.0136 for levels 0..4,
    // successive ratios 0.62, 0.36, 0.28, 0.26. Tolerances below are those
    // values with ~10% margin. NOTE: the default level 3 is 5.3% short, not the
    // 2% one might hope for; the construction is per §8.5 (the deficit is
    // concentrated in the squashed tets around the 16-cell's 8 vertices, where
    // the tet hyperplanes are only 0.975 from the origin), so this documents
    // the resolution rather than flagging a defect.
    const errors: number[] = [];
    for (let level = 0; level <= 4; level++) {
      const cx = hypersphereComplex(1, level);
      errors.push(Math.abs(hypervolumeByCones(cx.positions, cx.tets) - EXACT_BALL_VOLUME(1)) / EXACT_BALL_VOLUME(1));
    }
    for (let l = 1; l <= 4; l++) expect(errors[l]).toBeLessThan(errors[l - 1]);
    for (let l = 2; l <= 4; l++) expect(errors[l] / errors[l - 1]).toBeLessThan(0.4); // second order kicking in
    expect(errors[3]).toBeLessThan(0.06);
    expect(errors[4]).toBeLessThan(0.015);
  });

  it('seeding from the 600-cell (the §8.5 alternative) follows the same error curve per tet: 21.7 %, 6.7 %, 1.75 % at levels 0..2', () => {
    // §8.5 allows the 600-cell's 600 tets as the seed. Its 120 vertices are
    // the unit vectors of §8.2 and its cells are regular tetrahedra of edge
    // a = 1/φ, so each cell of regularPolytope('cell600') is one seed tet.
    // Level 0 by hand: a regular tet of edge a has 3-volume a³/(6√2) and its
    // centroid is at distance |ν| = √(1 − 3a²/8) from the origin (vertices on
    // the unit sphere, circumradius a√6/4), so the 600 cones give
    // 600 · (a³/(6√2)) · |ν| / 4 = 25 a³ |ν| / √2 ≈ 3.8627, i.e. 78.3 % of
    // π²/2: the 600-cell alone is 21.7 % short. Measured after midpoint
    // subdivision: 0.0667 at level 1 (4800 tets) and 0.0175 at level 2
    // (38 400 tets). The 16-cell seed gives 0.191 at 1024 tets, 0.0531 at
    // 8192 and 0.0136 at 65 536; interpolated at equal tet count with the
    // second-order law (error ∝ tets^(−2/3)) the two seeds agree within ~15 %,
    // so the 600-cell is not a cheaper route to a < 2 % default. The level-3
    // 16-cell (5.3 %) is therefore a resolution choice, not a seed defect.
    const p = regularPolytope('cell600');
    const positions = p.positions.slice(0, p.vertexCount).map((v) => normalize4(v));
    let tets: Tet[] = p.cells.map((cell) => {
      const vs = new Set<number>();
      for (const f of cell) for (const v of p.faces[f]) vs.add(v);
      expect(vs.size).toBe(4);
      return [...vs] as Tet;
    });
    expect(tets.length).toBe(600);
    const a = 1 / PHI;
    const exact600 = (25 * a ** 3 * Math.sqrt(1 - (3 * a * a) / 8)) / Math.SQRT2;
    const deficits: number[] = [];
    for (let level = 0; level <= 2; level++) {
      if (level > 0) tets = subdivideSphericalTets(positions, tets, 1);
      const oriented = orientTetsOutward(positions, tets, [0, 0, 0, 0]);
      expect(oriented.length).toBe(600 * 8 ** level);
      expect(validateTetComplex(positions, oriented).ok).toBe(true);
      const v = hypervolumeByCones(positions, oriented);
      if (level === 0) expect(v).toBeCloseTo(exact600, 9);
      deficits.push((EXACT_BALL_VOLUME(1) - v) / EXACT_BALL_VOLUME(1));
    }
    expect(deficits[0]).toBeCloseTo(1 - exact600 / EXACT_BALL_VOLUME(1), 9);
    expect(deficits[1]).toBeGreaterThan(0.06);
    expect(deficits[1]).toBeLessThan(0.07);
    expect(deficits[2]).toBeGreaterThan(0.016);
    expect(deficits[2]).toBeLessThan(0.019);
    // Same curve as the 16-cell seed at equal tet count (within 15 %).
    const cell16 = [3, 4].map((level) => {
      const cx = hypersphereComplex(1, level);
      return { tets: cx.tets.length, error: (EXACT_BALL_VOLUME(1) - hypervolumeByCones(cx.positions, cx.tets)) / EXACT_BALL_VOLUME(1) };
    });
    const predicted1 = cell16[0].error * (cell16[0].tets / 4800) ** (2 / 3);
    const predicted2 = cell16[1].error * (cell16[1].tets / 38400) ** (2 / 3);
    expect(Math.abs(deficits[1] / predicted1 - 1)).toBeLessThan(0.15);
    expect(Math.abs(deficits[2] / predicted2 - 1)).toBeLessThan(0.15);
  });

  it('scales as R⁴: hypersphere(2) has exactly 16× the hypervolume of hypersphere(1), and R = 0.37 gives R⁴', () => {
    // The construction commutes with scaling (midpoints of scaled points are
    // scaled midpoints and the diagonal rule compares ratios of lengths), so
    // the complex for radius R is the radius-1 complex scaled by R, and det
    // scales by R⁴. For R = 2 every operation is exact in binary floating
    // point, so the ratio is exactly 16 and the tet lists coincide.
    const unit = hypersphereComplex(1, 3);
    const two = hypersphereComplex(2, 3);
    const odd = hypersphereComplex(0.37, 3);
    const vUnit = hypervolumeByCones(unit.positions, unit.tets);
    expect(hypervolumeByCones(two.positions, two.tets) / vUnit).toBeCloseTo(16, 10);
    expect(hypervolumeByCones(odd.positions, odd.tets) / vUnit / 0.37 ** 4).toBeCloseTo(1, 9);
    expect(two.tets.length).toBe(unit.tets.length);
    expect(two.positions.length).toBe(unit.positions.length);
    for (let i = 0; i < unit.positions.length; i++) {
      for (let k = 0; k < 4; k++) expect(two.positions[i][k]).toBeCloseTo(2 * unit.positions[i][k], 14);
    }
    expect(two.tets).toEqual(unit.tets);
  });

  it('is invariant under a random rotation of the vertex positions', () => {
    // det[M a; M b; M c; M d] = det(M) det[a; b; c; d] = det[a; b; c; d] for a
    // rotation (§2.1: det R = +1), so the cone sum is unchanged exactly.
    const rng = mulberry32(2024);
    const cx = hypersphereComplex(1, 2);
    const v = hypervolumeByCones(cx.positions, cx.tets);
    for (let k = 0; k < 3; k++) {
      const m = compositeRotation(randomAngles(rng));
      const rotated = cx.positions.map((p) => apply4(m, p));
      expect(hypervolumeByCones(rotated, cx.tets)).toBeCloseTo(v, 11);
      expect(signedHypervolume(rotated, cx.tets)).toBeCloseTo(v, 11);
    }
  });
});

describe('hypersphere: slices (MATH.md §8.5, §6)', () => {
  it('level 0 slice at w = 0 is the octahedron ±e_x, ±e_y, ±e_z (volume 4/3); level 1 gives exactly 2 + 2√2/3', () => {
    // The 16-cell's equator w = 0 is the octahedron with vertices ±e_i, i ≤ 3,
    // volume (4/3)·1³ = 4/3 (regular octahedron of circumradius 1).
    // At level 1 every vertex of the equatorial octahedron's one-step
    // subdivision has w = 0 (midpoints of equatorial edges stay in w = 0), so
    // the slice is that subdivided octahedron: 24 corner triangles such as
    // (e_x, (e_x+e_y)/√2, (e_x+e_z)/√2), each coning to 4-volume... in 3D:
    // det3 = e_x · (m_y × m_z) = 1/2, cone volume 1/12, total 2; 8 central
    // triangles ((e_x+e_y)/√2, (e_y+e_z)/√2, (e_x+e_z)/√2) with det3 = 2(1/√2)³
    // = 1/√2, cone volume 1/(6√2), total 8/(6√2) = 2√2/3. Sum 2 + 2√2/3.
    const a0 = analyseSlice(hypersphere(1, 0).slice(hyperplaneW(0)));
    expect(a0.closed && a0.consistent).toBe(true);
    expect(a0.euler).toBe(2);
    expect(a0.triangles).toBe(8);
    expect(a0.volume).toBeCloseTo(4 / 3, 6);
    const a1 = analyseSlice(hypersphere(1, 1).slice(hyperplaneW(0)));
    expect(a1.closed && a1.consistent).toBe(true);
    expect(a1.euler).toBe(2);
    expect(a1.triangles).toBe(32);
    expect(a1.volume).toBeCloseTo(2 + (2 * Math.SQRT2) / 3, 6);
  });

  it('slice volume at several offsets lies in the rigorous window and within the documented level-3 tolerance', () => {
    // Exact ball slice: (4/3)π(R² − c²)^{3/2} (§8.5). Rigorous: discrete ≤ exact
    // (solid inside the ball) and discrete ≥ (4/3)π(r_in² − c²)^{3/2} (solid
    // contains the inner ball). Empirical at level 3 along e_w (R = 1): ratios
    // 0.977 (c=0), 0.952 (0.3), 0.942 (0.5), 0.930 (0.6), 0.893 (0.8), 0.837
    // (0.9). Asserted lower ratios leave ~2-4 points of margin.
    const rIn = innerBallRadius(BALL3.complex);
    expect(rIn).toBeGreaterThan(0.97); // measured 0.97497; documents the tet flatness at level 3
    const cases: Array<[number, number]> = [[0, 0.95], [0.3, 0.93], [0.5, 0.92], [0.6, 0.9], [0.8, 0.86], [0.9, 0.8]];
    for (const [c, minRatio] of cases) {
      const a = analyseSlice(BALL3.slice(hyperplaneW(c)));
      const exact = EXACT_BALL_SLICE(1, c);
      expect(a.closed && a.consistent, `c=${c}`).toBe(true);
      expect(a.euler, `c=${c}`).toBe(2);
      expect(a.volume).toBeLessThanOrEqual(exact * (1 + 1e-6));
      expect(a.volume).toBeGreaterThanOrEqual(EXACT_BALL_SLICE(rIn, c));
      expect(a.volume / exact, `c=${c}`).toBeGreaterThan(minRatio);
    }
  });

  it('slice at c = 0.99R is the regular octahedron cut from the pole star: volume (4/3)ρ³, ρ = sin(π/16)(1−c)/(1−cos(π/16))', () => {
    // The pole +R e_w keeps its 8 incident tets through subdivision (corner tets
    // keep the parent vertex), and its link stays an octahedron whose vertices
    // are the geodesic midpoints of midpoints of midpoints along the great
    // circles from e_w to ±e_x, ±e_y, ±e_z: colatitude π/16 at level 3. For
    // cos(π/16) < c < 1 the hyperplane w = c cuts only those 8 tets, in the
    // regular octahedron obtained by scaling the link from the pole by
    // (1 − c)/(1 − cos(π/16)): circumradius ρ = sin(π/16)(1 − c)/(1 − cos(π/16))
    // and volume (4/3)ρ³ (octahedron with circumradius ρ). At c = 0.99 that is
    // 1.3955e-3, only 11.9% of the exact (4/3)π(1 − 0.99²)^{3/2} = 1.1759e-2:
    // the inscribed polytope is flat near its vertices, so this is the honest
    // discrete value, not a 2% quantity. At c = cos(π/16) exactly the link
    // vertices lie in H (counted positive, §6) and the slice is the link
    // octahedron itself: volume (4/3) sin³(π/16).
    const a = Math.PI / 16;
    for (const c of [0.99, 0.995, 0.985]) {
      const rho = (Math.sin(a) * (1 - c)) / (1 - Math.cos(a));
      const an = analyseSlice(BALL3.slice(hyperplaneW(c)));
      expect(an.triangles).toBe(8);
      expect(an.euler).toBe(2);
      expect(an.closed && an.consistent).toBe(true);
      expect(an.volume).toBeCloseTo((4 / 3) * rho ** 3, 9);
      expect(an.volume).toBeLessThan(EXACT_BALL_SLICE(1, c));
    }
    const atLink = analyseSlice(BALL3.slice(hyperplaneW(Math.cos(a))));
    expect(atLink.triangles).toBe(8);
    expect(atLink.volume).toBeCloseTo((4 / 3) * Math.sin(a) ** 3, 9);
  });

  it('slice is empty at |c| ≥ R (c = R, 1.01R, 2R, −R, −1.5R) and nonempty at |c| < R', () => {
    // §8.5: slice radius √(R² − c²) vanishes at |c| = R. §6: at c = +R the pole
    // vertex lies in H and counts positive while everything else is negative,
    // so only zero-area triangles are produced; at c = −R all vertices are
    // positive (s = w + R ≥ 0) and nothing is produced; beyond R nothing at all.
    for (const c of [1, 1.01, 2, -1, -1.5]) {
      const a = analyseSlice(BALL3.slice(hyperplaneW(c)));
      expect(a.triangles, `c=${c}`).toBe(0);
      expect(a.volume).toBe(0);
    }
    expect(triangleCount(BALL3.slice(hyperplaneW(1.01)))).toBe(0);
    expect(triangleCount(BALL3.slice(hyperplaneW(-1)))).toBe(0);
    expect(analyseSlice(BALL3.slice(hyperplaneW(0.999))).volume).toBeGreaterThan(0);
    expect(analyseSlice(BALL3.slice(hyperplaneW(-0.999))).volume).toBeGreaterThan(0);
  });

  it('slice at any offset is closed, consistently oriented, Euler 2, positive volume (e_w sweep and random directions)', () => {
    // §6 consequences, for a dense sweep including offsets where vertices lie
    // exactly in H (c = 0 holds the whole equatorial octahedron; c = 1/√2 and
    // c = cos(π/16) hold rings of vertices).
    const rng = mulberry32(7);
    const special = [0, Math.SQRT1_2, -Math.SQRT1_2, Math.cos(Math.PI / 16), Math.cos(Math.PI / 8), 0.5, -0.5];
    const sweep = Array.from({ length: 39 }, (_, i) => -0.975 + (i * 1.95) / 38);
    for (const c of [...special, ...sweep]) {
      const a = analyseSlice(BALL3.slice(hyperplaneW(c)));
      expect(a.closed, `e_w c=${c}`).toBe(true);
      expect(a.consistent, `e_w c=${c}`).toBe(true);
      expect(a.euler, `e_w c=${c}`).toBe(2);
      expect(a.volume, `e_w c=${c}`).toBeGreaterThan(0);
    }
    for (let k = 0; k < 2; k++) {
      const n = randomUnit4(rng);
      for (const c of [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 0.97]) {
        // |c| ≤ 0.97 < r_in = 0.975 at level 3, so the slice is nonempty.
        const a = analyseSlice(BALL3.slice(hyperplane(n, c)));
        expect(a.triangles, `n=${n} c=${c}`).toBeGreaterThan(0);
        expect(a.closed && a.consistent, `n=${n} c=${c}`).toBe(true);
        expect(a.euler, `n=${n} c=${c}`).toBe(2);
        expect(a.volume).toBeGreaterThan(0);
      }
    }
    // Level 2 has r_in = 0.907, so along a generic direction the discrete solid
    // may end before |c| = 0.98 (an empty slice is correct there); |c| ≤ 0.9
    // keeps every slice inside the inner ball, hence nonempty.
    for (let k = 0; k < 3; k++) {
      const n = randomUnit4(rng);
      for (let i = 0; i < 21; i++) {
        const c = -0.9 + (i * 1.8) / 20;
        const a = analyseSlice(BALL2.slice(hyperplane(n, c)));
        expect(a.triangles, `L2 n=${n} c=${c}`).toBeGreaterThan(0);
        expect(a.closed && a.consistent, `L2 n=${n} c=${c}`).toBe(true);
        expect(a.euler, `L2 n=${n} c=${c}`).toBe(2);
      }
    }
  });

  it('every slice vertex lies between the inner-ball and outer-ball radii √(r² − c²), and sourceW = c', () => {
    // A slice vertex is a point of some boundary tet, hence at 4D distance in
    // [r_in, R] from the origin; in the chart |q|² = |p|² − c². §10: sourceW is
    // the w of the 4D point, which is c on the hyperplane w = c (Float32).
    const rIn = innerBallRadius(BALL3.complex);
    for (const c of [0, 0.5, 0.9]) {
      const m = BALL3.slice(hyperplaneW(c));
      const outer = Math.sqrt(1 - c * c);
      const inner = Math.sqrt(Math.max(0, rIn * rIn - c * c));
      for (let i = 0; i < vertexCount(m); i++) {
        const r = length3(meshVertex(m, i));
        expect(r).toBeLessThanOrEqual(outer + 1e-6);
        expect(r).toBeGreaterThanOrEqual(inner - 1e-6);
        expect(Math.abs(m.sourceW[i] - c)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('slice volume is symmetric in c, exactly for n ↔ −n and to 1e-3 for c ↔ −c', () => {
    // {n·p = c} = {(−n)·p = −c} is the same point set, so the volumes agree up
    // to Float32 output rounding (1e-5). The ball and the 16-cell are symmetric
    // under p ↦ −p, so A(c) = A(−c) exactly for the continuum; the discrete
    // complex is symmetric up to the index-based tie-break between equal-length
    // octahedron diagonals (which changes how slightly non-flat octahedra are
    // filled), measured at ≤ 7e-5 relative at level 3; 1e-3 is asserted.
    const rng = mulberry32(99);
    for (let k = 0; k < 3; k++) {
      const n = randomUnit4(rng);
      const c = 0.2 + 0.6 * rng();
      const a = signedVolume(BALL3.slice(hyperplane(n, c)));
      const b = signedVolume(BALL3.slice(hyperplane([-n[0], -n[1], -n[2], -n[3]], -c)));
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-5 * a);
    }
    for (const c of [0.3, 0.6, 0.9, 0.99]) {
      const a = signedVolume(BALL3.slice(hyperplaneW(c)));
      const b = signedVolume(BALL3.slice(hyperplaneW(-c)));
      expect(Math.abs(a - b), `c=${c}`).toBeLessThanOrEqual(1e-3 * a);
    }
  });

  it('slices in random directions match the exact ball slice within documented level-3 bounds', () => {
    // Along a generic direction no complex vertex lies in H, so the slice cuts
    // through tets rather than following the equatorial octahedron; measured
    // ratios at level 3: 0.958-0.961 (c=0), 0.945-0.948 (0.5), 0.78-0.80 (0.9).
    // Rigorous window as before; empirical floors 0.94, 0.92, 0.72.
    const rng = mulberry32(31337);
    const rIn = innerBallRadius(BALL3.complex);
    for (let k = 0; k < 3; k++) {
      const n = randomUnit4(rng);
      for (const [c, floor] of [[0, 0.94], [0.5, 0.92], [0.9, 0.72]] as Array<[number, number]>) {
        const v = signedVolume(BALL3.slice(hyperplane(n, c)));
        const exact = EXACT_BALL_SLICE(1, c);
        expect(v).toBeLessThanOrEqual(exact * (1 + 1e-6));
        expect(v).toBeGreaterThanOrEqual(EXACT_BALL_SLICE(rIn, c));
        expect(v / exact, `n=${n} c=${c}`).toBeGreaterThan(floor);
      }
    }
  });

  it('slicing the rotated complex by w = c equals slicing the original by hyperplaneFromRotation (§4)', () => {
    // §4: slicing the rotated object with n = e_w equals slicing the unrotated
    // object with n = Mᵀe_w, and the chart rows Mᵀe_x.. reproduce the rotated
    // object's own x, y, z. Same 4D points, same chart values: identical meshes
    // up to rounding (Float32 output, 1e-5 relative on volume).
    const rng = mulberry32(555);
    for (let k = 0; k < 3; k++) {
      const m = compositeRotation(randomAngles(rng));
      const c = -0.7 + 1.4 * rng();
      const rotated = { positions: BALL2.complex.positions.map((p) => apply4(m, p)), tets: BALL2.complex.tets };
      const a = sliceTets(rotated.positions, rotated.tets, hyperplaneW(c));
      const b = BALL2.slice(hyperplaneFromRotation(m, c));
      expect(triangleCount(a)).toBe(triangleCount(b));
      const va = signedVolume(a);
      const vb = signedVolume(b);
      expect(va).toBeGreaterThan(0);
      expect(Math.abs(va - vb)).toBeLessThanOrEqual(1e-5 * va);
    }
  });

  it('Cavalieri: ∫A(c)dc equals the cone hypervolume along e_w and random directions (level 2 and 3)', () => {
    // §7. The midpoint rule with 200 steps on the piecewise-smooth A(c) of the
    // discrete solid is accurate to ~1e-6 here (measured ≤ 3.3e-6 along e_w,
    // ≤ 1.5e-6 along random directions); 1e-4 asserted.
    const rng = mulberry32(4242);
    for (const shape of [BALL2, BALL3]) {
      const v = hypervolumeByCones(shape.complex.positions, shape.complex.tets);
      const dirs: Vec4[] = [[0, 0, 0, 1], randomUnit4(rng)];
      if (shape === BALL2) dirs.push(randomUnit4(rng), [1, 1, 1, 1]);
      for (const d of dirs) {
        const integral = sliceVolumeIntegral(shape, d, 200);
        expect(Math.abs(integral - v) / v, `dir=${d}`).toBeLessThan(1e-4);
      }
    }
  });

  it('radius scaling of slices: A_R(c) = R³ A_1(c/R)', () => {
    // The radius-R complex is the unit complex scaled by R (see the hypervolume
    // scaling test), and the slice at R·c₀ of the scaled solid is the scaled
    // slice at c₀, with volume R³ times larger.
    const big = hypersphere(2, 2);
    for (const c0 of [0, 0.4, 0.8]) {
      const a = signedVolume(BALL2.slice(hyperplaneW(c0)));
      const b = signedVolume(big.slice(hyperplaneW(2 * c0)));
      expect(b).toBeCloseTo(8 * a, 5);
    }
  });
});

// ===========================================================================
// Duocylinder and Clifford torus (MATH.md §8.6)
// ===========================================================================

describe('duocylinder: tet complex', () => {
  it('hypervolume is exactly area(P1)·area(P2) = (n²/4) r1² r2² sin²(2π/n) for many (r1, r2, n, rings)', () => {
    // The discrete solid is the product of the two regular n-gons P1 (xy,
    // radius r1) and P2 (zw, radius r2): the disk triangulation (centre, rings,
    // outer polygon) covers each n-gon exactly, prisms and their tets are
    // exact, so the boundary complex is ∂(P1 × P2) and the cone formula (§7)
    // gives vol(P1 × P2) = area(P1)·area(P2) with area = (n/2) r² sin(2π/n).
    // Exact up to rounding: 1e-9 relative. §8.6 continuum value π² r1² r2² is
    // approached as n → ∞ (ratio ((n/2π) sin(2π/n))²).
    const cases: Array<[number, number, number, number]> = [
      [Math.SQRT1_2, Math.SQRT1_2, 48, 6], [1, 0.5, 16, 3], [0.8, 1.3, 12, 1], [1, 1, 3, 1], [1, 1, 4, 2], [1, 1, 5, 2], [2, 0.25, 7, 3],
    ];
    for (const [r1, r2, n, rings] of cases) {
      const cx = duocylinderComplex(r1, r2, n, rings);
      const expected = polygonArea(r1, n) * polygonArea(r2, n);
      const v = hypervolumeByCones(cx.positions, cx.tets);
      expect(Math.abs(v - expected) / expected, `n=${n} rings=${rings}`).toBeLessThan(1e-9);
      expect(Math.abs(signedHypervolume(cx.positions, cx.tets) - v)).toBeLessThan(1e-9 * v);
      expect(v).toBeLessThan(Math.PI ** 2 * r1 * r1 * r2 * r2); // inscribed polygons
    }
  });

  it('is a valid complex with 6n²(2·rings − 1) tets and n² + 2n(1 + (rings − 1)n) vertices, χ = 0', () => {
    // Disk triangles: n fan + 2n(rings − 1) between rings = n(2·rings − 1); each
    // times n segments, two tori, 3 tets per prism: 6n²(2·rings − 1). Vertices:
    // n² torus grid plus, per torus, n copies of (centre + (rings − 1)n ring
    // vertices). S^3 has χ = 0.
    const cases: Array<[number, number]> = [[3, 1], [4, 1], [5, 2], [8, 1], [12, 2], [16, 3], [48, 6]];
    for (const [n, rings] of cases) {
      const cx = duocylinderComplex(1, 0.6, n, rings);
      const val = validateTetComplex(cx.positions, cx.tets);
      expect(val.ok, `n=${n} rings=${rings}: ${val.errors.join('; ')}`).toBe(true);
      expect(val.degenerateTets).toBe(0);
      expect(cx.tets.length).toBe(6 * n * n * (2 * rings - 1));
      expect(cx.positions.length).toBe(n * n + 2 * n * (1 + (rings - 1) * n));
      const { V, E, F, T } = complexCounts(cx.tets);
      expect(V).toBe(cx.positions.length);
      expect(F).toBe(2 * T);
      expect(V - E + F - T).toBe(0);
    }
  });

  it('rejects radii ≤ 0, segments < 3 and rings < 1', () => {
    expect(() => duocylinderComplex(0, 1, 8, 1)).toThrow();
    expect(() => duocylinderComplex(1, -1, 8, 1)).toThrow();
    expect(() => duocylinderComplex(1, 1, 2, 1)).toThrow();
    expect(() => duocylinderComplex(1, 1, 8, 0)).toThrow();
    expect(() => duocylinderComplex(1, 1, 8.5, 1)).toThrow();
  });

  it('first n² positions are the Clifford torus x²+y² = r1², z²+w² = r2², and all other vertices are strictly inside one disc', () => {
    // §8.6: the two solid tori are glued along the Clifford torus. The grid
    // vertices (r1 cos α_i, r1 sin α_i, r2 cos β_j, r2 sin β_j) satisfy both
    // equations; interior vertices of torus A have z²+w² < r2², of B x²+y² < r1².
    const r1 = 1.1, r2 = 0.7, n = 12, rings = 3;
    const cx = duocylinderComplex(r1, r2, n, rings);
    const torus = cliffordTorus(r1, r2, n, n);
    for (let i = 0; i < n * n; i++) {
      const p = cx.positions[i];
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(r1, 12);
      expect(Math.hypot(p[2], p[3])).toBeCloseTo(r2, 12);
      for (let k = 0; k < 4; k++) expect(p[k]).toBeCloseTo(torus.positions[i][k], 12);
    }
    for (let i = n * n; i < cx.positions.length; i++) {
      const p = cx.positions[i];
      const rxy = Math.hypot(p[0], p[1]);
      const rzw = Math.hypot(p[2], p[3]);
      expect(rxy).toBeLessThanOrEqual(r1 + 1e-12);
      expect(rzw).toBeLessThanOrEqual(r2 + 1e-12);
      expect(rxy < r1 - 1e-9 || rzw < r2 - 1e-9).toBe(true);
    }
  });

  it('shape reports radius √(r1²+r2²), wRange r2·[min sin β_j, max sin β_j], and the Clifford torus as its wire', () => {
    // Farthest vertices are the torus grid at |p|² = r1² + r2². The w extent is
    // attained on the outer polygon P2 (interior rings are scaled towards the
    // centre), i.e. r2·sin β_j over j; for 4 | n that is [−r2, r2].
    for (const [n, rings] of [[16, 3], [6, 2], [5, 1]] as Array<[number, number]>) {
      const r1 = 0.9, r2 = 0.5;
      const d = duocylinder(r1, r2, n, rings);
      expect(d.radius()).toBeCloseTo(Math.hypot(r1, r2), 12);
      const sines = Array.from({ length: n }, (_, j) => Math.sin((2 * Math.PI * j) / n));
      const [lo, hi] = d.wRange();
      expect(lo).toBeCloseTo(r2 * Math.min(...sines), 12);
      expect(hi).toBeCloseTo(r2 * Math.max(...sines), 12);
      const wire = d.wire();
      expect(wire).not.toBeNull();
      expect(wire!.positions.length).toBe(n * n);
      expect(wire!.edges.length).toBe(2 * n * n);
      expect(wire!.faces.length).toBe(n * n);
      expect(d.kind).toBe('curved');
    }
    expect(duocylinder(1, 0.5, 16, 3).wRange()).toEqual([-0.5, 0.5]);
  });
});

describe('duocylinder: slices (MATH.md §8.6, §6)', () => {
  const r1 = 1, r2 = 0.5, n = 16, rings = 3;
  const duo = duocylinder(r1, r2, n, rings);
  const P1 = regularPolygon(r1, n);
  const P2 = regularPolygon(r2, n);

  it('slice by w = c is the prism P1 × chord_P2(c): volume area(P1)·width, correct z-extent, x²+y² ≤ r1², sourceW = c', () => {
    // §8.6: the slice {w = c} of P1 × P2 is P1 × {z : (z, c) ∈ P2}, a prism over
    // the n-gon whose height is the chord of P2 at height c (for the continuum
    // 2√(r2² − c²)). Marching tets is exact on flat tets, so the discrete slice
    // is exactly this prism: 1e-6 relative (Float32 output).
    for (const c of [0, 0.1, 0.23, -0.31, 0.4, 0.49, -0.49]) {
      const width = polygonChord(P2, 1, c);
      const expected = polygonArea(r1, n) * width;
      const m = duo.slice(hyperplaneW(c));
      const a = analyseSlice(m);
      expect(a.closed && a.consistent, `c=${c}`).toBe(true);
      expect(a.euler, `c=${c}`).toBe(2);
      expect(Math.abs(a.volume - expected) / expected, `c=${c}`).toBeLessThan(1e-6);
      let zlo = Infinity, zhi = -Infinity;
      for (let i = 0; i < vertexCount(m); i++) {
        const q = meshVertex(m, i);
        expect(Math.hypot(q[0], q[1])).toBeLessThanOrEqual(r1 + 1e-6);
        expect(Math.abs(m.sourceW[i] - c)).toBeLessThanOrEqual(1e-6);
        zlo = Math.min(zlo, q[2]);
        zhi = Math.max(zhi, q[2]);
      }
      expect(zhi - zlo).toBeCloseTo(width, 6);
      // The chord of P2 at height c: for 4 | n P2 is symmetric under z ↦ −z, so the chord is centred.
      expect(zhi + zlo).toBeCloseTo(0, 6);
    }
  });

  it('slice by w = c is empty for |c| > r2 and has zero volume at the supporting offset c = r2', () => {
    // No point of P2 has |w| > r2. At c = r2 the hyperplane touches P1 × {top
    // vertex of P2}: the limit from below (§6) has zero height.
    expect(triangleCount(duo.slice(hyperplaneW(0.6)))).toBe(0);
    expect(triangleCount(duo.slice(hyperplaneW(-0.51)))).toBe(0);
    const top = duo.slice(hyperplaneW(r2));
    expect(Math.abs(signedVolume(top))).toBeLessThan(1e-9);
    for (let i = 0; i < vertexCount(top); i++) expect(Math.abs(meshVertex(top, i)[2])).toBeLessThan(1e-6);
  });

  it('slice at the supporting offset c = r2 is the doubled flat disc P1 that §6 describes: not closed, volume 0', () => {
    // §6 (degenerate offsets): when H contains a 2-face F of the complex and
    // both tets adjacent to F have their fourth vertex below H, F is emitted
    // twice with opposite orientations; the cleaned output is a doubled flat
    // polygon with every interior edge in four triangles and volume 0, and the
    // closedness claim is made only for positive-volume offsets. Here w = r2
    // contains the 2-face P1 × {(0, r2)} (P2 has a vertex at (0, r2) since
    // 4 | n), which is the disc triangulation of P1 in torus B at β = π/2:
    // V = 1 + rings·n = 49 vertices, F = n(2·rings − 1) = 80 triangles, hence
    // E = V + F − 1 = 128 edges of which n = 16 are the polygon boundary. The
    // tets of torus A meet H only along the ring ∂P1 × {(0, r2)} and emit
    // zero-area triangles, which the cleaning removes. Doubled: 160 triangles,
    // 112 interior edges in four triangles each (non-manifold), the 16 boundary
    // edges once per copy in opposite directions (so no boundary edge and no
    // inconsistent edge), Euler 49 − 128 + 160 = 81.
    const a = analyseSlice(duo.slice(hyperplaneW(r2)));
    expect(a.closed).toBe(false);
    expect(a.triangles).toBe(2 * n * (2 * rings - 1));
    expect(a.nonManifoldEdges).toBe(1 + rings * n + n * (2 * rings - 1) - 1 - n);
    expect(a.boundaryEdges).toBe(0);
    expect(a.inconsistentEdges).toBe(0);
    expect(a.edgeCount).toBe(1 + rings * n + n * (2 * rings - 1) - 1);
    expect(a.euler).toBe(81);
    expect(Math.abs(a.volume)).toBeLessThan(1e-9);
  });

  it('slice by x = c is the symmetric case: volume area(P2)·chord_P1(c), and equals the w-slice of duocylinder(r2, r1) when 4 | n', () => {
    // By the same argument the slice {x = c} is chord_P1(c) × P2 with chord
    // measured along y at abscissa c. The coordinate swap (x,y,z,w) ↦ (z,w,x,y)
    // maps duocylinder(r1, r2) to duocylinder(r2, r1) and {x = c} to {z = c};
    // {z = c} and {w = c} are related by the quarter turn of the zw-plane, a
    // symmetry of the n-gon exactly when 4 | n. So for n = 16 the two slice
    // volumes coincide to rounding.
    const swapped = duocylinder(r2, r1, n, rings);
    for (const c of [0, 0.2, 0.5, 0.77, -0.95]) {
      const expected = polygonArea(r2, n) * polygonChord(P1, 0, c);
      const a = analyseSlice(duo.slice(hyperplane([1, 0, 0, 0], c)));
      expect(a.closed && a.consistent, `c=${c}`).toBe(true);
      expect(a.euler).toBe(2);
      expect(Math.abs(a.volume - expected) / expected, `c=${c}`).toBeLessThan(1e-6);
      const b = signedVolume(swapped.slice(hyperplaneW(c)));
      expect(Math.abs(a.volume - b) / expected, `c=${c}`).toBeLessThan(1e-6);
    }
  });

  it('slice by z = c of duocylinder(r1, r2) equals slice by x = c of duocylinder(r2, r1) for n = 6 (no quarter-turn symmetry needed)', () => {
    const a = duocylinder(0.9, 0.4, 6, 2);
    const b = duocylinder(0.4, 0.9, 6, 2);
    for (const c of [0.1, 0.35, -0.2]) {
      const va = signedVolume(a.slice(hyperplane([0, 0, 1, 0], c)));
      const vb = signedVolume(b.slice(hyperplane([1, 0, 0, 0], c)));
      expect(va).toBeGreaterThan(0);
      expect(Math.abs(va - vb) / va).toBeLessThan(1e-6);
    }
  });

  it('generic slices are closed with Euler 2 and sourceW agrees with the uncharted point, and Cavalieri holds in random directions', () => {
    // §6 consequences for random hyperplanes; §10 sourceW is the w of the 4D
    // point, recoverable as unchart(h, q)·e_w (Float32: 1e-5). §7: the
    // midpoint-rule integral of A(c) is piecewise-cubic in c with kinks only at
    // vertex offsets; measured ≤ 3e-5 relative along e_w with 200 steps, ≤ 2e-7
    // along random directions; 1e-3 asserted.
    // The solid's extent along unit n is its support r1|n_xy| + r2|n_zw| for
    // the continuum; the inscribed n-gons reduce it by at most cos(π/n) = 0.98,
    // so offsets up to 0.9 of the continuum support give nonempty slices.
    const rng = mulberry32(2718);
    const vol = hypervolumeByCones(duo.complex.positions, duo.complex.tets);
    for (let k = 0; k < 3; k++) {
      const dir = randomUnit4(rng);
      const support = r1 * Math.hypot(dir[0], dir[1]) + r2 * Math.hypot(dir[2], dir[3]);
      for (const c of [0, 0.3 * support, 0.6 * support, 0.9 * support]) {
        const h = hyperplane(dir, c);
        const m = duo.slice(h);
        const a = analyseSlice(m);
        expect(a.triangles, `dir=${dir} c=${c}`).toBeGreaterThan(0);
        expect(a.closed && a.consistent, `dir=${dir} c=${c}`).toBe(true);
        expect(a.euler, `dir=${dir} c=${c}`).toBe(2);
        expect(a.volume).toBeGreaterThan(0);
        for (let i = 0; i < vertexCount(m); i += 7) {
          expect(Math.abs(unchart(h, meshVertex(m, i))[3] - m.sourceW[i])).toBeLessThan(1e-5);
        }
      }
      const integral = sliceVolumeIntegral(duo, dir, 200);
      expect(Math.abs(integral - vol) / vol).toBeLessThan(1e-3);
    }
    expect(Math.abs(sliceVolumeIntegral(duo, [0, 0, 0, 1], 200) - vol) / vol).toBeLessThan(1e-3);
    expect(Math.abs(sliceVolumeIntegral(duo, [1, 0, 0, 0], 200) - vol) / vol).toBeLessThan(1e-3);
  });

  it('slices by (0,1,1,0)/√2 and (1,1,1,1)/2 at c = 0 have equal volume (symmetry of the 16-gons under 45° turns)', () => {
    // Rotating the xy-plane by −45° and the zw-plane by +45° is a symmetry of
    // P1 × P2 when 8 | n, and maps (0,1,1,0)/√2 to (1,1,1,1)/2 up to sign. Same
    // point set, so equal volumes (1e-6).
    const a = signedVolume(duo.slice(hyperplane([0, 1, 1, 0], 0)));
    const b = signedVolume(duo.slice(hyperplane([1, 1, 1, 1], 0)));
    expect(a).toBeGreaterThan(0);
    expect(Math.abs(a - b) / a).toBeLessThan(1e-6);
  });

  it('slice by a hyperplane containing axis-parallel edges of the complex is closed after cleaning, with exact coordinates', () => {
    // The hyperplane y + z = 0 contains, in exact arithmetic, complex edges
    // such as the one from the torus vertex (−r1, 0, 0, −r2) (α = π, β = 3π/2)
    // to the centre (0, 0, 0, −r2) of torus B's disc at β = 3π/2: a chain of
    // collinear vertices along the x-axis at w = −r2. §6's symbolic
    // perturbation classifies all of them as positive (s = 0) and the edges lie
    // in the slice; the output is watertight. That needs the coordinates to be
    // exactly 0: with y = r1 sin π = 1.2e-16·r1 and z = r2 cos(3π/2) =
    // −1.8e-16·r2 the two endpoints had signed distances of opposite sign
    // (+2e-17 and −6e-17), the slicer "crossed" the edge at the
    // noise-determined point x = −0.75, and the collinear zero-area triangle
    // bridging the T-junction was removed by the cleaning, leaving three
    // boundary edges (x = −1, −0.75, 0) and Euler 1. The positions are now
    // built from a table (circleTable) in which every coincidence forced by
    // the symmetries the n-gon shares with the axes is bit-exact: 0 and ±1 at
    // multiples of π/2, and values at angles related by θ ↦ −θ, π − θ,
    // π/2 − θ and quarter turns equal up to sign/swap. With r1 = r2 (the
    // viewer's duocylinder) the hyperplane x + z = 0 contains the whole grid
    // curve β = π − α, which needs cos α_i = −cos α_{n/2−i} exactly, and
    // x + w = 0 needs cos α_i = −sin β_j for j = 3n/4 − i. Checked for the
    // eight hyperplanes spanned by two coordinate axes, at c = 0 and at an
    // offset through vertices, for several (n, rings) including the viewer's
    // 48 segments; for 8 | n the (0,1,1,0) slice has the volume of the
    // (1,1,1,1)/2 slice (the 45° turns of both 16-gons are symmetries).
    const directions: Vec4[] = [
      [0, 1, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [1, 0, 0, 1], [1, 1, 0, 0], [0, 0, 1, 1], [1, -1, 0, 0], [0, 0, 1, -1],
    ];
    for (const [r1, r2] of [[1, 0.5], [1, 1]] as Array<[number, number]>) {
      for (const [nn, rr] of [[8, 1], [8, 3], [12, 2], [16, 3], [48, 1]] as Array<[number, number]>) {
        const shape = duocylinder(r1, r2, nn, rr);
        for (const dir of directions) {
          const support = r1 * Math.hypot(dir[0], dir[1]) + r2 * Math.hypot(dir[2], dir[3]);
          for (const c of [0, 0.5 * support]) {
            const a = analyseSlice(shape.slice(hyperplane(dir, c)));
            const label = `r=(${r1},${r2}) n=${nn} rings=${rr} dir=${dir} c=${c}`;
            expect(a.triangles, label).toBeGreaterThan(0);
            expect(a.closed, label).toBe(true);
            expect(a.consistent, label).toBe(true);
            expect(a.euler, label).toBe(2);
            expect(a.volume, label).toBeGreaterThan(0);
          }
        }
        if (nn % 8 === 0) {
          const diag = signedVolume(shape.slice(hyperplane([1, 1, 1, 1], 0)));
          const axis = signedVolume(shape.slice(hyperplane([0, 1, 1, 0], 0)));
          expect(Math.abs(axis - diag) / diag, `n=${nn} rings=${rr}`).toBeLessThan(1e-6);
        }
      }
    }
    // The table's identities, read off the Clifford torus grid (vertex
    // (i, 0) is (cos α_i, sin α_i, r2, 0)): exact quarter and octant points,
    // and bit-exact reflections and quarter turns where the n-gon has them.
    for (const nn of [3, 5, 6, 8, 12, 16, 18, 48]) {
      const t = cliffordTorus(1, 1, nn, 3);
      const cs = (i: number): number => t.positions[(((i % nn) + nn) % nn) * 3][0];
      const sn = (i: number): number => t.positions[(((i % nn) + nn) % nn) * 3][1];
      for (let i = 0; i < nn; i++) {
        expect(Math.abs(Math.hypot(cs(i), sn(i)) - 1)).toBeLessThan(1e-15);
        expect(Math.abs(cs(i) - Math.cos((2 * Math.PI * i) / nn))).toBeLessThan(2e-15);
        expect(Math.abs(sn(i) - Math.sin((2 * Math.PI * i) / nn))).toBeLessThan(2e-15);
        if ((4 * i) % nn === 0) expect([cs(i), sn(i)]).toEqual([[1, 0], [0, 1], [-1, 0], [0, -1]][(4 * i) / nn]);
        if ((8 * i) % nn === 0 && (4 * i) % nn !== 0) expect([Math.abs(cs(i)), Math.abs(sn(i))]).toEqual([Math.SQRT1_2, Math.SQRT1_2]);
        expect([cs(nn - i), sn(nn - i)]).toEqual([cs(i), -sn(i) + 0]);
        if (nn % 2 === 0) expect([cs(nn / 2 - i), sn(nn / 2 - i)]).toEqual([-cs(i) + 0, sn(i)]);
        if (nn % 4 === 0) {
          expect([cs(nn / 4 - i), sn(nn / 4 - i)]).toEqual([sn(i), cs(i)]);
          expect([cs(i + nn / 4), sn(i + nn / 4)]).toEqual([-sn(i) + 0, cs(i)]);
        }
      }
    }
  });

  it('default duocylinder (r1 = r2 = 1/√2, 48 segments, 6 rings) has the exact discrete hypervolume and a correct w-slice', () => {
    // area(P)² with r² = 1/2: (48/2 · 1/2 · sin(2π/48))² = (12 sin 7.5°)² ≈ 2.45334,
    // 0.57% below π²/4 (continuum, §8.6).
    const d = duocylinder();
    const expected = polygonArea(Math.SQRT1_2, 48) ** 2;
    const v = hypervolumeByCones(d.complex.positions, d.complex.tets);
    expect(Math.abs(v - expected) / expected).toBeLessThan(1e-9);
    expect(v / (Math.PI ** 2 / 4)).toBeGreaterThan(0.994);
    expect(v / (Math.PI ** 2 / 4)).toBeLessThan(1);
    const c = 0.3;
    const a = analyseSlice(d.slice(hyperplaneW(c)));
    const sliceExpected = polygonArea(Math.SQRT1_2, 48) * polygonChord(regularPolygon(Math.SQRT1_2, 48), 1, c);
    expect(a.closed && a.consistent).toBe(true);
    expect(a.euler).toBe(2);
    expect(Math.abs(a.volume - sliceExpected) / sliceExpected).toBeLessThan(1e-6);
  });
});

describe('Clifford torus wire (MATH.md §8.6)', () => {
  it('vertices satisfy x²+y² = r1² and z²+w² = r2², n·m of them, and lie on S^3 when r1 = r2 = 1/√2', () => {
    const r1 = 0.6, r2 = 1.4, n = 10, m = 7;
    const t = cliffordTorus(r1, r2, n, m);
    expect(t.positions.length).toBe(n * m);
    for (const p of t.positions) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(r1, 12);
      expect(Math.hypot(p[2], p[3])).toBeCloseTo(r2, 12);
    }
    const unit = cliffordTorus(Math.SQRT1_2, Math.SQRT1_2, 9, 11);
    for (const p of unit.positions) expect(length4(p)).toBeCloseTo(1, 12);
  });

  it('edges come in exactly two lengths 2r1 sin(π/n) and 2r2 sin(π/m), n·m of each, every vertex of degree 4, no duplicates', () => {
    // A step of 2π/n on a circle of radius r1 is a chord 2r1 sin(π/n); the
    // other parameter direction likewise. The grid is a torus: 2nm edges, each
    // vertex has two neighbours in each direction.
    const r1 = 0.75, r2 = 1.25, n = 12, m = 9;
    const t = cliffordTorus(r1, r2, n, m);
    const la = 2 * r1 * Math.sin(Math.PI / n);
    const lb = 2 * r2 * Math.sin(Math.PI / m);
    expect(t.edges.length).toBe(2 * n * m);
    let countA = 0, countB = 0;
    const degree = new Array<number>(n * m).fill(0);
    const seen = new Set<string>();
    for (const [i, j] of t.edges) {
      expect(i).not.toBe(j);
      const key = Math.min(i, j) + ',' + Math.max(i, j);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      degree[i]++; degree[j]++;
      const len = length4(sub4(t.positions[i], t.positions[j]));
      if (Math.abs(len - la) < 1e-12) countA++;
      else if (Math.abs(len - lb) < 1e-12) countB++;
      else throw new Error(`edge (${i},${j}) has unexpected length ${len}`);
    }
    expect(countA).toBe(n * m);
    expect(countB).toBe(n * m);
    for (const d of degree) expect(d).toBe(4);
  });

  it('every face is a planar rectangle la × lb (equal diagonals √(la² + lb²))', () => {
    // Displacements along α live in the xy-plane and along β in the zw-plane,
    // which are orthogonal, so each grid cell is a rectangle.
    const r1 = 0.75, r2 = 1.25, n = 12, m = 9;
    const t = cliffordTorus(r1, r2, n, m);
    const la = 2 * r1 * Math.sin(Math.PI / n);
    const lb = 2 * r2 * Math.sin(Math.PI / m);
    const diag = Math.hypot(la, lb);
    expect(t.faces.length).toBe(n * m);
    for (const f of t.faces) {
      expect(f.length).toBe(4);
      const p = f.map((i) => t.positions[i]);
      const sides = [0, 1, 2, 3].map((k) => length4(sub4(p[k], p[(k + 1) % 4])));
      expect(new Set(sides.map((s) => (Math.abs(s - la) < 1e-12 ? 'a' : Math.abs(s - lb) < 1e-12 ? 'b' : '?'))).size).toBe(2);
      expect(sides[0]).toBeCloseTo(sides[2], 12);
      expect(sides[1]).toBeCloseTo(sides[3], 12);
      expect(length4(sub4(p[0], p[2]))).toBeCloseTo(diag, 12);
      expect(length4(sub4(p[1], p[3]))).toBeCloseTo(diag, 12);
    }
  });

  it('stereographic image of the unit Clifford torus is the round torus with major radius √2 and minor radius 1', () => {
    // S(p) = (x,y,z)/(1−w) with p = (cos α, sin α, cos β, sin β)/√2: distance
    // from the z-axis ρ = 1/(√2 − sin β), height z = cos β/(√2 − sin β). Then
    // (ρ − √2)² + z² = [1 − 2√2 D + 2D² + cos²β]/D² with D = √2 − sin β; since
    // D² = 2 − 2√2 sin β + sin²β the bracket equals D², so (ρ − √2)² + z² = 1.
    const t = cliffordTorus(Math.SQRT1_2, Math.SQRT1_2, 24, 24);
    for (const p of t.positions) {
      const q = projectStereographic(p);
      expect((Math.hypot(q[0], q[1]) - Math.SQRT2) ** 2 + q[2] ** 2).toBeCloseTo(1, 10);
    }
  });

  it('rejects n or m below 3', () => {
    expect(() => cliffordTorus(1, 1, 2, 5)).toThrow();
    expect(() => cliffordTorus(1, 1, 5, 2)).toThrow();
    expect(() => cliffordTorus(1, 1, 4.5, 5)).toThrow();
  });
});

// ===========================================================================
// Hopf fibration (MATH.md §3.3)
// ===========================================================================

describe('Hopf fibration', () => {
  const FIBRES = 24, POINTS = 64;
  const wire = hopfFibration(FIBRES, POINTS);
  const bases = hopfBasePoints(FIBRES);
  const fibre = (f: number): Vec4[] => wire.positions.slice(f * POINTS, (f + 1) * POINTS);

  it('every fibre point lies on the unit sphere, for the wire and for random base points (including near the south pole)', () => {
    // §3.3: the fibres live on S^3. The fibre over a unit base point is the
    // orbit of a unit spinor under the circle action, which preserves the norm.
    const rng = mulberry32(1);
    expect(wire.positions.length).toBe(FIBRES * POINTS);
    for (const p of wire.positions) expect(Math.abs(length4(p) - 1)).toBeLessThanOrEqual(1e-12);
    for (let k = 0; k < 20; k++) {
      const b = randomUnit3(rng);
      for (const p of hopfFiber(b, 17)) expect(Math.abs(length4(p) - 1)).toBeLessThanOrEqual(1e-12);
    }
    for (const b of [[0, 0, 1], [0, 0, -1], [1e-7, 0, -Math.sqrt(1 - 1e-14)], [0.6, 0, -0.8]] as Vec3[]) {
      for (const p of hopfFiber(b, 12)) expect(Math.abs(length4(p) - 1)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('every point of the fibre over b maps to b under the Hopf map, and hopfLift(b) too', () => {
    // The fibre over b is h⁻¹(b): h must be constant on it with value b. Uses
    // the standard Hopf map h(z1, z2) = (2 z1 conj z2, |z1|² − |z2|²) with
    // z1 = x + iy, z2 = z + iw (the convention the module documents; MATH.md
    // fixes only that the fibres are the circles of the Hopf fibration).
    const rng = mulberry32(2);
    const check = (b: Vec3): void => {
      expect(length3(sub3(hopfMap(hopfLift(b)), b))).toBeLessThanOrEqual(1e-12);
      for (const p of hopfFiber(b, 11)) expect(length3(sub3(hopfMap(p), b))).toBeLessThanOrEqual(1e-12);
    };
    for (const b of bases) check(b);
    for (let k = 0; k < 20; k++) check(randomUnit3(rng));
    check([0, 0, 1]);
    check([0, 0, -1]);
    check([0.6, 0.8, 0]);
  });

  it('each fibre is a great circle sampled uniformly: closed polyline, all 64 chords equal 2 sin(π/64), points in a 2-plane through the origin', () => {
    // A great circle of the unit sphere sampled at equal angles 2π/N has all
    // consecutive chords (including the closing one) equal to 2 sin(π/N). The
    // circle lies in a 2-plane through 0: every sample is a combination of the
    // first sample p0 and the unit vector J p0 = (−y, x, −w, z) (multiplication
    // by i on both complex coordinates), with coefficients cos t, sin t.
    const chord = 2 * Math.sin(Math.PI / POINTS);
    for (let f = 0; f < FIBRES; f++) {
      const pts = fibre(f);
      const p0 = pts[0];
      const j0: Vec4 = [-p0[1], p0[0], -p0[3], p0[2]];
      expect(Math.abs(dot4(p0, j0))).toBeLessThanOrEqual(1e-15);
      for (let k = 0; k < POINTS; k++) {
        const p = pts[k];
        const q = pts[(k + 1) % POINTS];
        expect(Math.abs(length4(sub4(p, q)) - chord)).toBeLessThanOrEqual(1e-12);
        const t = (2 * Math.PI * k) / POINTS;
        const residual = sub4(p, [
          p0[0] * Math.cos(t) + j0[0] * Math.sin(t),
          p0[1] * Math.cos(t) + j0[1] * Math.sin(t),
          p0[2] * Math.cos(t) + j0[2] * Math.sin(t),
          p0[3] * Math.cos(t) + j0[3] * Math.sin(t),
        ]);
        expect(length4(residual)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('the wire is a disjoint union of 24 cycles of length 64 (every vertex of degree 2, no cross-fibre edges)', () => {
    expect(wire.edges.length).toBe(FIBRES * POINTS);
    expect(wire.faces).toEqual([]);
    const adj = new Map<number, number[]>();
    for (const [a, b] of wire.edges) {
      expect(a).not.toBe(b);
      expect(Math.floor(a / POINTS)).toBe(Math.floor(b / POINTS));
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    for (let v = 0; v < wire.positions.length; v++) expect(adj.get(v)?.length, `vertex ${v}`).toBe(2);
    for (let f = 0; f < FIBRES; f++) {
      const start = f * POINTS;
      let prev = -1, cur = start, steps = 0;
      do {
        const [x, y] = adj.get(cur)!;
        const next = x === prev ? y : x;
        prev = cur; cur = next; steps++;
      } while (cur !== start && steps <= POINTS);
      expect(steps).toBe(POINTS);
    }
  });

  it('fibres over a latitude circle lie on the torus x²+y² = (1+b_z)/2, z²+w² = (1−b_z)/2; equatorial fibres lie on the unit Clifford torus', () => {
    // |z1|² = (1 + b_z)/2 and |z2|² = (1 − b_z)/2 follow from h's third
    // component |z1|² − |z2|² = b_z and |z1|² + |z2|² = 1; the circle action
    // preserves both moduli. For b_z = 0 both equal 1/2 (§8.6, Clifford torus).
    for (let f = 0; f < FIBRES; f++) {
      const bz = bases[f][2];
      for (const p of fibre(f)) {
        expect(p[0] * p[0] + p[1] * p[1]).toBeCloseTo((1 + bz) / 2, 12);
        expect(p[2] * p[2] + p[3] * p[3]).toBeCloseTo((1 - bz) / 2, 12);
      }
    }
    for (const p of hopfFiber([0.28, -0.96, 0], 10)) {
      expect(p[0] * p[0] + p[1] * p[1]).toBeCloseTo(0.5, 12);
    }
  });

  it('two distinct fibres never share a point: pairwise distance ≥ 2 sin(θ/4) where θ is the base angle, and that bound is tight', () => {
    // For unit spinors p ∈ h⁻¹(b), q ∈ h⁻¹(b'), |⟨p, q⟩|² = (1 + b·b')/2 =
    // cos²(θ/2), and the circle action lets the phase of ⟨p, q⟩ be rotated
    // away, so the least chord distance between the two fibres is
    // √(2 − 2 cos(θ/2)) = 2 sin(θ/4) (the Hopf map is a Riemannian submersion
    // onto the sphere of radius 1/2). Sampled minima are ≥ that; they exceed it
    // by at most two half-steps, 2·2 sin(π/(2N)) < 0.1 for N = 64.
    let globalMin = Infinity;
    for (let i = 0; i < FIBRES; i++) {
      const A = fibre(i);
      for (let j = i + 1; j < FIBRES; j++) {
        const B = fibre(j);
        const cosTheta = Math.max(-1, Math.min(1, dot3(bases[i], bases[j])));
        const theta = Math.acos(cosTheta);
        expect(theta).toBeGreaterThan(0.5); // base points distinct; the closest pair is on the colatitude-30° ring: 2 asin(sin²30°) ≈ 0.505
        const bound = 2 * Math.sin(theta / 4);
        let minD = Infinity;
        for (const p of A) for (const q of B) minD = Math.min(minD, length4(sub4(p, q)));
        expect(minD, `fibres ${i},${j}`).toBeGreaterThanOrEqual(bound - 1e-9);
        expect(minD, `fibres ${i},${j}`).toBeLessThanOrEqual(bound + 0.1);
        globalMin = Math.min(globalMin, minD);
      }
    }
    expect(globalMin).toBeGreaterThan(0.25); // 2 sin(0.5054/4) = 0.2520
  });

  it('stereographic image of every fibre is a circle: equidistant from the centre fitted through three points, coplanar, radius √(2/(1+b_z)), centre at √((1−b_z)/(1+b_z))', () => {
    // §3.3: stereographic projection sends circles to circles. For a great
    // circle whose height |w| reaches m = |z2| = √((1−b_z)/2), the images of
    // its points with w = ±m are at distances √((1+m)/(1−m)) and √((1−m)/(1+m))
    // from the origin on one line, and its w = 0 points at unit distance on a
    // perpendicular line; the circle through them has centre at distance
    // m/√(1−m²) = √((1−b_z)/(1+b_z)) and radius 1/√(1−m²) = √(2/(1+b_z)).
    const rng = mulberry32(3);
    const checkFibre = (pts4: Vec4[], bz: number): void => {
      const pts = pts4.map((p) => projectStereographic(p));
      const N = pts.length;
      const { centre, normal, radius } = circumcircle(pts[0], pts[Math.floor(N / 3)], pts[Math.floor((2 * N) / 3)]);
      for (const q of pts) {
        expect(Math.abs(length3(sub3(q, centre)) - radius) / radius).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(dot3(sub3(q, centre), normal)) / radius).toBeLessThanOrEqual(1e-9);
      }
      expect(radius).toBeCloseTo(Math.sqrt(2 / (1 + bz)), 9);
      expect(length3(centre)).toBeCloseTo(Math.sqrt((1 - bz) / (1 + bz)), 9);
    };
    for (let f = 0; f < FIBRES; f++) checkFibre(fibre(f), bases[f][2]);
    for (let k = 0; k < 10; k++) {
      const b = randomUnit3(rng);
      if (b[2] < -0.99) continue; // keep clear of the pole, where the image degenerates to a line
      checkFibre(hopfFiber(b, 40), b[2]);
    }
    // The fibre over the north pole is the unit circle in the xy-plane: radius 1, centre 0.
    checkFibre(hopfFiber([0, 0, 1], 30), 1);
  });

  it('any two fibres are linked exactly once, with the same sign for every pair', () => {
    // The Hopf link: distinct fibres have linking number ±1. The stereographic
    // images are circles, so the linking number is the signed count of
    // crossings of one polygon through the flat disc of the other, exact for
    // polygons. All pairs share the orientation induced by the circle action,
    // hence the same sign.
    const images = Array.from({ length: FIBRES }, (_, f) => fibre(f).map((p) => projectStereographic(p)));
    const signs = new Set<number>();
    for (let i = 0; i < FIBRES; i++) {
      for (let j = i + 1; j < FIBRES; j++) {
        const l1 = linkingWithCircle(images[i], images[j]);
        const l2 = linkingWithCircle(images[j], images[i]);
        expect(Math.abs(l1), `fibres ${i},${j}`).toBe(1);
        expect(l2).toBe(l1);
        signs.add(l1);
      }
    }
    expect(signs.size).toBe(1);
  });

  it('hopfBasePoints returns exactly `count` distinct unit vectors for many counts and rejects count < 1', () => {
    for (const count of [1, 2, 3, 5, 7, 13, 18, 24, 100, 1000]) {
      const pts = hopfBasePoints(count);
      expect(pts.length).toBe(count);
      const keys = new Set<string>();
      for (const b of pts) {
        expect(Math.abs(length3(b) - 1)).toBeLessThanOrEqual(1e-12);
        keys.add(b.map((v) => v.toFixed(9)).join(','));
      }
      expect(keys.size).toBe(count);
    }
    expect(() => hopfBasePoints(0)).toThrow();
    expect(() => hopfBasePoints(2.5)).toThrow();
    expect(() => hopfFibration(4, 2)).toThrow();
  });

  it('hopfShape is a wire-only curved shape on the unit S^3: empty slices, radius 1, wRange containing the wire', () => {
    const s = hopfShape(12, 16);
    expect(s.kind).toBe('curved');
    expect(s.radius()).toBe(1);
    const w = s.wire();
    expect(w).not.toBeNull();
    expect(w!.positions.length).toBe(12 * 16);
    const [lo, hi] = s.wRange();
    for (const p of w!.positions) {
      expect(p[3]).toBeGreaterThanOrEqual(lo);
      expect(p[3]).toBeLessThanOrEqual(hi);
      expect(length4(p)).toBeLessThanOrEqual(s.radius() + 1e-12);
    }
    for (const h of [hyperplaneW(0), hyperplaneW(0.5), hyperplane([1, 1, 0, 0], 0.2)]) {
      expect(triangleCount(s.slice(h))).toBe(0);
    }
  });
});
