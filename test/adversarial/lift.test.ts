/**
 * Adversarial tests for the lifting pipeline of MATH.md §9.1: the mesh3
 * generators, planar sections, extrusion, compounds and the catalogue
 * figures. Every expected value is derived in a comment from MATH.md or from
 * standard geometry; nothing here is taken from the implementation or from
 * the project's other tests. Random directions come from a seeded generator
 * so that a failure reproduces exactly.
 */
import { describe, expect, it } from 'vitest';
import type { Hyperplane, TriMesh3, Vec3, Vec4 } from '../../src/math/types';
import { hyperplane, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { add3, cross3, dot3, dot4, length3, normalize3, scale3, sub3 } from '../../src/math/vec';
import type { Mesh3 } from '../../src/geometry/mesh3';
import {
  box, capsule, cylinder, flipMesh3, icosphere, mesh3Edges, mesh3Volume, scaleMesh3, torus, torusKnot,
  torusKnotCurve, translateMesh3, uvSphere, validateMesh3,
} from '../../src/geometry/mesh3';
import {
  groupLoops, loopVectorArea, planarSection, planeBasis, projectLoop, sectionArea, signedArea2,
  triangulateSection,
} from '../../src/geometry/section';
import { ExtrudedSolid, extrude, lateralComplex, loopCorners } from '../../src/geometry/extrude';
import { compound } from '../../src/geometry/compound';
import { cubinder, human, knotPrism, mug, spherinder, torusPrism } from '../../src/geometry/figures';
import { hypervolumeByCones, signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice, signedVolume, vertexAt } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';

// ---- Seeded randomness ------------------------------------------------------

/** mulberry32: a small, well-mixed 32-bit PRNG; the seed fixes every "random" direction below. */
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

/** Standard normal by Box–Muller; normalised Gaussian vectors are uniform on the sphere. */
function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomUnit4(rng: () => number): Vec4 {
  for (;;) {
    const v: Vec4 = [gaussian(rng), gaussian(rng), gaussian(rng), gaussian(rng)];
    const l = Math.hypot(v[0], v[1], v[2], v[3]);
    if (l > 1e-3) return [v[0] / l, v[1] / l, v[2] / l, v[3] / l];
  }
}

function randomUnit3(rng: () => number): Vec3 {
  for (;;) {
    const v: Vec3 = [gaussian(rng), gaussian(rng), gaussian(rng)];
    const l = length3(v);
    if (l > 1e-3) return scale3(v, 1 / l);
  }
}

// ---- Robust slice analysis ----------------------------------------------------

interface Report {
  closed: boolean;
  consistent: boolean;
  euler: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  triangles: number;
  volume: number;
}

/**
 * MATH.md §6 asks that a slice be closed and consistently oriented "after
 * discarding zero-area triangles and merging coincident vertices". Merging
 * here is transitive (union–find over all pairs closer than `tol`), so a
 * cluster of points is merged as a whole: a greedy nearest-representative
 * weld can send two bit-identical points to different representatives when
 * a cluster straddles the tolerance, which manufactures boundary edges that
 * are not in the mesh. `tol` is a few Float32 ulps at the coordinate
 * magnitudes used here (ulp(2) ≈ 2.4e-7), enough to absorb the one-ulp
 * disagreements between the lateral and cap parts of an extruded slice.
 */
function analyse(m: TriMesh3, tol = 1e-6): Report {
  const n = m.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number): void => {
    a = find(a); b = find(b);
    if (a !== b) parent[a] = b;
  };
  const inv = 1 / tol;
  const buckets = new Map<string, number[]>();
  const cellOf = (i: number): [number, number, number] => [
    Math.floor(m.positions[3 * i] * inv), Math.floor(m.positions[3 * i + 1] * inv), Math.floor(m.positions[3 * i + 2] * inv),
  ];
  for (let i = 0; i < n; i++) {
    const key = cellOf(i).join(',');
    const list = buckets.get(key);
    if (list) list.push(i); else buckets.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz] = cellOf(i);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const j of list) {
        if (j <= i) continue;
        const ex = m.positions[3 * i] - m.positions[3 * j];
        const ey = m.positions[3 * i + 1] - m.positions[3 * j + 1];
        const ez = m.positions[3 * i + 2] - m.positions[3 * j + 2];
        if (ex * ex + ey * ey + ez * ez <= tol * tol) union(i, j);
      }
    }
  }
  const directed = new Map<string, number>();
  const used = new Set<number>();
  let F = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = find(m.indices[t]);
    const j = find(m.indices[t + 1]);
    const k = find(m.indices[t + 2]);
    if (i === j || j === k || k === i) continue;
    const a = vertexAt(m, i);
    const area2 = length3(cross3(sub3(vertexAt(m, j), a), sub3(vertexAt(m, k), a)));
    if (area2 <= 1e-12) continue;
    F++;
    used.add(i); used.add(j); used.add(k);
    for (const [p, q] of [[i, j], [j, k], [k, i]]) {
      const key = `${p},${q}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  const undirected = new Set<string>();
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split(',').map(Number);
    const ukey = a < b ? key : `${b},${a}`;
    if (undirected.has(ukey)) continue;
    undirected.add(ukey);
    const rev = directed.get(`${b},${a}`) ?? 0;
    const total = count + rev;
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (count !== 1 || rev !== 1) inconsistentEdges++;
  }
  return {
    closed: boundaryEdges === 0 && nonManifoldEdges === 0,
    consistent: inconsistentEdges === 0,
    euler: used.size - undirected.size + F,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    triangles: F,
    volume: signedVolume(m),
  };
}

const expectClosed = (r: Report, euler?: number): void => {
  expect(r.boundaryEdges, 'boundary edges').toBe(0);
  expect(r.nonManifoldEdges, 'non-manifold edges').toBe(0);
  expect(r.inconsistentEdges, 'inconsistently oriented edges').toBe(0);
  if (euler !== undefined) expect(r.euler, 'Euler characteristic').toBe(euler);
};

// ---- Analytic helpers ---------------------------------------------------------

const ballVolume = (r: number): number => (4 / 3) * Math.PI * r ** 3;

/**
 * Volume of the ball of radius r between the planes at signed distances a < b
 * along a unit direction: ∫_a^b π (r² − t²) dt = π [r² (b − a) − (b³ − a³)/3],
 * with [a, b] clamped to [−r, r].
 */
function ballSlab(r: number, a: number, b: number): number {
  const lo = Math.max(a, -r);
  const hi = Math.min(b, r);
  if (hi <= lo) return 0;
  return Math.PI * (r * r * (hi - lo) - (hi ** 3 - lo ** 3) / 3);
}

/** Smallest distance from the origin to a face plane; for a convex mesh the ball of this radius lies inside. */
function minFaceDistance(mesh: Mesh3): number {
  let d = Infinity;
  for (const [a, b, c] of mesh.triangles) {
    const p = mesh.positions[a];
    const n = normalize3(cross3(sub3(mesh.positions[b], p), sub3(mesh.positions[c], p)));
    d = Math.min(d, Math.abs(dot3(n, p)));
  }
  return d;
}

const maxRadius = (mesh: Mesh3): number => mesh.positions.reduce((r, p) => Math.max(r, length3(p)), 0);

type Profile = [number, number][]; // (ρ, z) vertices of a meridian polygon, ρ ≥ 0

/**
 * Exact volume of the solid obtained by rotating the meridian polygon D in W
 * discrete steps about the z axis (the construction of uvSphere, cylinder,
 * capsule and torus). The piece between meridians φ_i and φ_{i+1} is the
 * image of D × [0, 1] under (ρ, z, t) ↦ (ρ (t cos φ_i + (1−t) cos φ_{i+1}),
 * ρ (t sin φ_i + (1−t) sin φ_{i+1}), z), whose Jacobian is ρ sin(2π/W) for
 * every t, so V = W sin(2π/W) ∫∫_D ρ dρ dz. The first moment of a polygon is
 * (1/6) Σ (ρ_i + ρ_{i+1}) (ρ_i z_{i+1} − ρ_{i+1} z_i) (the centroid formula).
 * The quads between consecutive rings are isosceles trapezoids (two parallel
 * chords), hence planar, so the triangulation does not change the solid.
 */
function revolvedVolume(profile: Profile, W: number): number {
  let moment = 0;
  for (let i = 0; i < profile.length; i++) {
    const [r0, z0] = profile[i];
    const [r1, z1] = profile[(i + 1) % profile.length];
    moment += (r0 + r1) * (r0 * z1 - r1 * z0);
  }
  return W * Math.sin((2 * Math.PI) / W) * Math.abs(moment) / 6;
}

/**
 * Area of the horizontal section z = t of the same discrete solid of
 * revolution: the line z = t meets the polygon in ρ values ρ_1 < ρ_2 < ...;
 * the section is the union of W-gon annuli between consecutive pairs (the
 * surface quads are planar and their horizontal cuts are straight chords),
 * so A(t) = (W/2) sin(2π/W) Σ (ρ_{2k}² − ρ_{2k−1}²). A vertex exactly at
 * height t counts as below, which keeps A continuous.
 */
function revolvedSectionArea(profile: Profile, W: number, t: number): number {
  const rhos: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [r0, z0] = profile[i];
    const [r1, z1] = profile[(i + 1) % profile.length];
    if ((z0 <= t) !== (z1 <= t)) rhos.push(r0 + ((t - z0) / (z1 - z0)) * (r1 - r0));
  }
  rhos.sort((a, b) => a - b);
  let s = 0;
  for (let k = 0; k + 1 < rhos.length; k += 2) s += rhos[k + 1] ** 2 - rhos[k] ** 2;
  return (W / 2) * Math.sin((2 * Math.PI) / W) * s;
}

/**
 * ∫_a^b A(t) dt for the discrete solid of revolution. A is piecewise
 * quadratic with breaks at the polygon's vertex heights, so Simpson's rule
 * on each piece between consecutive breaks is exact.
 */
function revolvedSlabVolume(profile: Profile, W: number, a: number, b: number): number {
  if (b <= a) return 0;
  const breaks = Array.from(new Set(profile.map(([, z]) => z).filter((z) => z > a && z < b))).sort((x, y) => x - y);
  const nodes = [a, ...breaks, b];
  let v = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const p = nodes[i];
    const q = nodes[i + 1];
    const f = (t: number): number => revolvedSectionArea(profile, W, t);
    v += ((q - p) / 6) * (f(p) + 4 * f((p + q) / 2) + f(q));
  }
  return v;
}

/** Meridian polygon of uvSphere(r, W, H): pole, H−1 rings, pole, closed along the axis. */
function sphereProfile(r: number, H: number): Profile {
  const poly: Profile = [[0, r]];
  for (let k = 1; k < H; k++) poly.push([r * Math.sin((Math.PI * k) / H), r * Math.cos((Math.PI * k) / H)]);
  poly.push([0, -r]);
  return poly;
}

/** Meridian polygon of capsule(r, h, W, Q). */
function capsuleProfile(r: number, h: number, Q: number): Profile {
  const poly: Profile = [[0, h / 2 + r]];
  for (let k = 1; k <= Q; k++) {
    const th = (Math.PI * k) / (2 * Q);
    poly.push([r * Math.sin(th), h / 2 + r * Math.cos(th)]);
  }
  for (let k = Q; k >= 1; k--) {
    const th = (Math.PI * k) / (2 * Q);
    poly.push([r * Math.sin(th), -h / 2 - r * Math.cos(th)]);
  }
  poly.push([0, -h / 2 - r]);
  return poly;
}

/** Cross-section polygon of torus(R, r, m, n): the regular n-gon of circumradius r centred at ρ = R. */
function torusProfile(R: number, r: number, n: number): Profile {
  const poly: Profile = [];
  for (let j = 0; j < n; j++) poly.push([R + r * Math.cos((2 * Math.PI * j) / n), r * Math.sin((2 * Math.PI * j) / n)]);
  return poly;
}

/** Concatenate meshes without welding (used to build solids with holes from oppositely oriented boxes). */
function concatMeshes(...meshes: Mesh3[]): Mesh3 {
  const positions: Vec3[] = [];
  const triangles: [number, number, number][] = [];
  for (const m of meshes) {
    const off = positions.length;
    for (const p of m.positions) positions.push([p[0], p[1], p[2]]);
    for (const [a, b, c] of m.triangles) triangles.push([a + off, b + off, c + off]);
  }
  return { positions, triangles };
}

/**
 * Sheared-slab data of MATH.md §9.1 for the extrusion S × [−h, h] sliced by
 * H(n, c): a point (q, w) of the prism lies in H iff n_xyz · q = c − n_w w,
 * and as w runs over [−h, h] the right-hand side covers [c − |n_w| h,
 * c + |n_w| h]. So the slice is the graph of the affine map
 * w(q) = (c − n_xyz · q)/n_w over S ∩ { a ≤ m · q ≤ b } with m = n_xyz/|n_xyz|,
 * a = (c − |n_w| h)/|n_xyz|, b = (c + |n_w| h)/|n_xyz|; its 3-volume inside H is
 * the clipped volume times √(1 + |∇w|²) = √(1 + |n_xyz|²/n_w²).
 */
function slab(h: Hyperplane, halfHeight: number): { m: Vec3; a: number; b: number; stretch: number } {
  const n = h.normal;
  const nxyz: Vec3 = [n[0], n[1], n[2]];
  const len = length3(nxyz);
  const nw = Math.abs(n[3]);
  return {
    m: scale3(nxyz, 1 / len),
    a: (h.offset - nw * halfHeight) / len,
    b: (h.offset + nw * halfHeight) / len,
    stretch: Math.sqrt(1 + (len * len) / (nw * nw)),
  };
}

/** ∫_a^b area(section of mesh by m · q = t) dt by the midpoint rule (Cavalieri for the clipped 3D solid). */
function sectionIntegral(mesh: Mesh3, m: Vec3, a: number, b: number, steps: number): number {
  if (b <= a) return 0;
  const dt = (b - a) / steps;
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const t = a + (i + 0.5) * dt;
    total += sectionArea(planarSection(mesh, m, t).loops, m);
  }
  return total * dt;
}

/**
 * A genuine closed mesh of the square tube { i ≤ max(|x|, |y|) ≤ o, |z| ≤ L } (genus 1): 16 vertices,
 * 16 quads = 32 triangles, χ = 16 − 48 + 32 = 0, volume 4 (o² − i²) · 2L. Unlike two concatenated
 * boxes it has no coincident, oppositely oriented end faces.
 */
function squareTube(o: number, i: number, L: number): Mesh3 {
  const corners = (s: number): [number, number][] => [[s, s], [-s, s], [-s, -s], [s, -s]]; // CCW seen from +z
  const positions: Vec3[] = [];
  // index: level (0 bottom, 1 top) · 8 + ring (0 outer, 1 inner) · 4 + k
  for (const z of [-L, L]) for (const s of [o, i]) for (const [x, y] of corners(s)) positions.push([x, y, z]);
  const at = (level: number, ring: number, k: number): number => level * 8 + ring * 4 + (k % 4);
  const triangles: [number, number, number][] = [];
  const quad = (a: number, b: number, c: number, d: number): void => { triangles.push([a, b, c], [a, c, d]); };
  for (let k = 0; k < 4; k++) {
    quad(at(0, 0, k), at(0, 0, k + 1), at(1, 0, k + 1), at(1, 0, k)); // outer wall, normal away from the axis
    quad(at(0, 1, k + 1), at(0, 1, k), at(1, 1, k), at(1, 1, k + 1)); // inner wall, normal toward the axis
    quad(at(1, 0, k), at(1, 0, k + 1), at(1, 1, k + 1), at(1, 1, k)); // top annulus, normal +z
    quad(at(0, 0, k + 1), at(0, 0, k), at(0, 1, k), at(0, 1, k + 1)); // bottom annulus, normal −z
  }
  return { positions, triangles };
}

/** Turn a 2D polygon in the plane z = z0 into a Vec3 loop. */
const lift2 = (pts: [number, number][], z0 = 0): Vec3[] => pts.map(([x, y]) => [x, y, z0]);

const square2 = (half: number, ccw = true): [number, number][] => {
  const pts: [number, number][] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return ccw ? pts : pts.reverse();
};

const approxSet = (actual: Vec4[], expected: Vec4[], tol = 1e-12): boolean => {
  if (actual.length !== expected.length) return false;
  const key = (p: Vec4): string => p.map((x) => Math.round(x / tol) * tol).join(',');
  const a = actual.map(key).sort();
  const e = expected.map(key).sort();
  return a.every((k, i) => k === e[i]);
};

// =============================================================================
// 1. mesh3 generators
// =============================================================================

describe('mesh3 generators are closed, consistent and have the right volume', () => {
  it('box(2, 3, 5): 8 vertices, 12 triangles, 18 edges, χ = 2, volume 30, corners at ±(1, 1.5, 2.5)', () => {
    // A cube's surface is a sphere: V − E + F = 8 − 18 + 12 = 2. Volume is the product of the sides.
    const m = box(2, 3, 5);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.edgeCount, v.triangleCount, v.euler]).toEqual([8, 18, 12, 2]);
    expect(mesh3Volume(m)).toBeCloseTo(30, 12);
    for (const p of m.positions) {
      expect(Math.abs(p[0])).toBeCloseTo(1, 15);
      expect(Math.abs(p[1])).toBeCloseTo(1.5, 15);
      expect(Math.abs(p[2])).toBeCloseTo(2.5, 15);
    }
    // Each face plane is at the expected distance and every face normal points away from the centre.
    for (const [a, b, c] of m.triangles) {
      const n = cross3(sub3(m.positions[b], m.positions[a]), sub3(m.positions[c], m.positions[a]));
      expect(dot3(n, m.positions[a])).toBeGreaterThan(0);
    }
  });

  it('uvSphere(1.3, 24, 12): counts, χ = 2, exact discrete-revolution volume, sandwiched between inscribed and circumscribed balls', () => {
    // Vertices 2 + (H−1)W = 2 + 11·24 = 266, triangles 2W(H−1) = 528, edges 3F/2 = 792 → χ = 266 − 792 + 528 = 2.
    const r = 1.3;
    const m = uvSphere(r, 24, 12);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.edgeCount, v.euler]).toEqual([266, 528, 792, 2]);
    const exact = revolvedVolume(sphereProfile(r, 12), 24);
    expect(mesh3Volume(m)).toBeCloseTo(exact, 10);
    // Convex, all vertices at radius r: ball(d_min) ⊂ solid ⊂ ball(r).
    expect(mesh3Volume(m)).toBeLessThan(ballVolume(r));
    expect(mesh3Volume(m)).toBeGreaterThan(ballVolume(minFaceDistance(m)));
    for (const p of m.positions) expect(length3(p)).toBeCloseTo(r, 12);
  });

  it('uvSphere with odd segment counts (7, 5) is still closed with χ = 2', () => {
    const v = validateMesh3(uvSphere(1, 7, 5));
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect(v.euler).toBe(2);
    expect(mesh3Volume(uvSphere(1, 7, 5))).toBeCloseTo(revolvedVolume(sphereProfile(1, 5), 7), 10);
  });

  it('icosphere(1, 0) is the regular icosahedron: volume (5/12)(3 + √5) a³ with a = 1/sin(2π/5)', () => {
    // Circumradius R = (a/4)√(10 + 2√5) = a sin(2π/5), so a = 1/sin 72° for R = 1.
    const m = icosphere(1, 0);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.edgeCount, v.euler]).toEqual([12, 20, 30, 2]);
    const a = 1 / Math.sin((2 * Math.PI) / 5);
    expect(mesh3Volume(m)).toBeCloseTo((5 / 12) * (3 + Math.sqrt(5)) * a ** 3, 12);
    // Every edge has length a.
    for (const [i, j] of mesh3Edges(m)) expect(length3(sub3(m.positions[i], m.positions[j]))).toBeCloseTo(a, 12);
  });

  it('icosphere(0.7, 3): 20·4³ triangles, 10·4³ + 2 vertices, χ = 2, vertices on the sphere, volume sandwiched', () => {
    const r = 0.7;
    const m = icosphere(r, 3);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.euler]).toEqual([642, 1280, 2]);
    for (const p of m.positions) expect(length3(p)).toBeCloseTo(r, 12);
    const vol = mesh3Volume(m);
    expect(vol).toBeLessThan(ballVolume(r));
    expect(vol).toBeGreaterThan(ballVolume(minFaceDistance(m)));
    // With 1280 faces the deficit must be small: the inscribed radius alone bounds it by 1 − d_min³/r³ < 2%.
    expect(vol / ballVolume(r)).toBeGreaterThan(0.98);
    // Outward: every face normal points away from the centre.
    for (const [a, b, c] of m.triangles) {
      const n = cross3(sub3(m.positions[b], m.positions[a]), sub3(m.positions[c], m.positions[a]));
      expect(dot3(n, m.positions[a])).toBeGreaterThan(0);
    }
  });

  it('cylinder(1, 2, 48): 98 vertices, 192 triangles, χ = 2, volume = 48-gon area × height', () => {
    // Regular n-gon of circumradius r has area (n/2) r² sin(2π/n).
    const m = cylinder(1, 2, 48);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.euler]).toEqual([98, 192, 2]);
    const area = 24 * Math.sin((2 * Math.PI) / 48);
    expect(mesh3Volume(m)).toBeCloseTo(area * 2, 12);
    expect(mesh3Volume(m)).toBeCloseTo(revolvedVolume([[0, -1], [1, -1], [1, 1], [0, 1]], 48), 12);
  });

  it('capsule(0.3, 1.0, 16, 4): 130 vertices, 256 triangles, χ = 2, exact discrete-revolution volume, extent ±(h/2 + r)', () => {
    // Vertices 2 + 2·Q·W = 2 + 128 = 130; triangles 4·Q·W = 256.
    const m = capsule(0.3, 1.0, 16, 4);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.euler]).toEqual([130, 256, 2]);
    expect(mesh3Volume(m)).toBeCloseTo(revolvedVolume(capsuleProfile(0.3, 1.0, 4), 16), 10);
    const zs = m.positions.map((p) => p[2]);
    expect(Math.max(...zs)).toBeCloseTo(0.8, 12);
    expect(Math.min(...zs)).toBeCloseTo(-0.8, 12);
    // Its volume is strictly between the cylinder alone and the circumscribed cylinder of the same radius.
    expect(mesh3Volume(m)).toBeGreaterThan(8 * 0.09 * Math.sin((2 * Math.PI) / 16) * 1.0);
    expect(mesh3Volume(m)).toBeLessThan(Math.PI * 0.09 * 1.6);
  });

  it('torus(1, 0.4, 48, 24): mn vertices, 2mn triangles, χ = 0, volume m sin(2π/m) R (n/2) r² sin(2π/n)', () => {
    // A torus surface has χ = 0: V − E + F = mn − 3mn + 2mn. The cross-section n-gon has area
    // (n/2) r² sin(2π/n) and centroid at ρ = R, so its first moment is R times that.
    const m = torus(1, 0.4, 48, 24);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.edgeCount, v.euler]).toEqual([1152, 2304, 3456, 0]);
    const expected = 48 * Math.sin((2 * Math.PI) / 48) * 1 * 12 * 0.16 * Math.sin((2 * Math.PI) / 24);
    expect(mesh3Volume(m)).toBeCloseTo(expected, 10);
    expect(mesh3Volume(m)).toBeCloseTo(revolvedVolume(torusProfile(1, 0.4, 24), 48), 10);
    // Below the continuous value 2π² R r² = 3.158 but within 2% for this sampling.
    expect(mesh3Volume(m)).toBeLessThan(2 * Math.PI ** 2 * 0.16);
    expect(mesh3Volume(m) / (2 * Math.PI ** 2 * 0.16)).toBeGreaterThan(0.98);
  });

  it('torus with segment counts not divisible by 4 (7, 5) is closed with χ = 0 and the exact volume', () => {
    const m = torus(2, 0.5, 7, 5);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect(v.euler).toBe(0);
    expect(mesh3Volume(m)).toBeCloseTo(revolvedVolume(torusProfile(2, 0.5, 5), 7), 10);
  });

  it('torusKnotCurve: the returned tangent is the derivative of the point', () => {
    for (const t of [0, 0.3, 1.7, 4.2]) {
      const eps = 1e-6;
      const { point: p0 } = torusKnotCurve(0.8, 2, 3, t - eps);
      const { point: p1 } = torusKnotCurve(0.8, 2, 3, t + eps);
      const { tangent } = torusKnotCurve(0.8, 2, 3, t);
      const fd = scale3(sub3(p1, p0), 1 / (2 * eps));
      expect(length3(sub3(fd, tangent))).toBeLessThan(1e-6);
    }
    // The curve is on the carrier torus: distance from the core circle of radius R is R/2.
    const { point } = torusKnotCurve(0.8, 2, 3, 2.1);
    const rho = Math.hypot(point[0], point[1]);
    expect(Math.hypot(rho - 0.8, point[2])).toBeCloseTo(0.4, 12);
  });

  it('torusKnot(0.8, 0.25, 2, 3, 128, 16): NM vertices, 2NM triangles, χ = 0, volume ≈ tube area × knot length', () => {
    // A tube of radius r about a curve of length L has volume exactly π r² L when r is below the
    // radius of curvature (Pappus / Weyl's tube formula). The mesh has an M-gon cross-section
    // ((M/2) r² sin(2π/M)) and a chordal polyline, so its volume is that area times L up to a
    // second-order discretisation error (chord shortening ~ (2π/N)² κ² / 24, bending and residual
    // twist both O(Δ²)); 1% is generous for N = 128.
    const N = 128;
    const M = 16;
    const m = torusKnot(0.8, 0.25, 2, 3, N, M);
    const v = validateMesh3(m);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.triangleCount, v.euler]).toEqual([N * M, 2 * N * M, 0]);
    let L = 0;
    let prev = torusKnotCurve(0.8, 2, 3, 0).point;
    const S = 20000;
    for (let i = 1; i <= S; i++) {
      const p = torusKnotCurve(0.8, 2, 3, (2 * Math.PI * i) / S).point;
      L += length3(sub3(p, prev));
      prev = p;
    }
    const area = (M / 2) * 0.25 ** 2 * Math.sin((2 * Math.PI) / M);
    expect(Math.abs(mesh3Volume(m) / (area * L) - 1)).toBeLessThan(0.01);
    // Every ring vertex is at distance exactly r from its ring centre and in the ring's normal plane.
    for (let i = 0; i < N; i++) {
      const { point, tangent } = torusKnotCurve(0.8, 2, 3, (2 * Math.PI * i) / N);
      const T = normalize3(tangent);
      for (let j = 0; j < M; j++) {
        const d = sub3(m.positions[i * M + j], point);
        expect(length3(d)).toBeCloseTo(0.25, 10);
        expect(Math.abs(dot3(d, T))).toBeLessThan(1e-10);
      }
    }
  });

  it('torusKnot seam: the quads closing the tube are as regular as their neighbours (no mis-shifted seam)', () => {
    // |c′(t)| is even in t, so the chords across the seam (ring N−1 → ring 0) and the chords of
    // ring 0 → ring 1 have the same length. A seam mis-indexed by k ring positions would lengthen
    // the seam edges by a 2r sin(πk/M) ≈ 0.098 leg in quadrature (≥ 25% for k = 1).
    const N = 128;
    const M = 16;
    const m = torusKnot(0.8, 0.25, 2, 3, N, M);
    const lengths = (inA: (i: number) => boolean, inB: (i: number) => boolean): number[] => {
      const out: number[] = [];
      for (const [i, j] of mesh3Edges(m)) {
        if ((inA(i) && inB(j)) || (inA(j) && inB(i))) out.push(length3(sub3(m.positions[i], m.positions[j])));
      }
      return out.sort((x, y) => x - y);
    };
    const seam = lengths((i) => i >= (N - 1) * M, (i) => i < M);
    const next = lengths((i) => i < M, (i) => i >= M && i < 2 * M);
    expect(seam.length).toBe(2 * M);
    expect(next.length).toBe(2 * M);
    expect(seam[seam.length - 1] / next[next.length - 1]).toBeLessThan(1.1);
    expect(seam[0] / next[0]).toBeGreaterThan(0.9);
  });

  it('torusKnot variants (3, 2) and (2, 5) are closed with χ = 0; non-coprime (2, 4) throws', () => {
    for (const [p, q] of [[3, 2], [2, 5]]) {
      const v = validateMesh3(torusKnot(1, 0.1, p, q, 96, 8));
      expect(v.ok, v.errors.join('; ')).toBe(true);
      expect(v.euler).toBe(0);
    }
    expect(() => torusKnot(1, 0.1, 2, 4, 64, 8)).toThrow();
  });

  it('generator argument validation: too few segments throws', () => {
    expect(() => uvSphere(1, 2, 4)).toThrow();
    expect(() => uvSphere(1, 4, 1)).toThrow();
    expect(() => cylinder(1, 1, 2)).toThrow();
    expect(() => torus(1, 0.5, 2, 3)).toThrow();
    expect(() => capsule(1, 1, 3, 0)).toThrow();
    expect(() => icosphere(1, -1)).toThrow();
  });

  it('transforms: translation keeps the volume, a reflecting scale keeps it positive, flip negates it', () => {
    const m = uvSphere(1, 12, 6);
    const v = mesh3Volume(m);
    expect(mesh3Volume(translateMesh3(m, [3, -2, 7]))).toBeCloseTo(v, 10);
    // scale(−1, 2, 1) has determinant −2: a reflection; the winding must be flipped so the volume is +2v.
    const s = scaleMesh3(m, [-1, 2, 1]);
    expect(mesh3Volume(s)).toBeCloseTo(2 * v, 10);
    expect(validateMesh3(s).ok).toBe(true);
    expect(mesh3Volume(scaleMesh3(m, -1))).toBeCloseTo(v, 10);
    expect(mesh3Volume(flipMesh3(m))).toBeCloseTo(-v, 10);
  });
});

// =============================================================================
// 2. Planar sections
// =============================================================================

describe('planar sections of the cube [−1, 1]³', () => {
  const cube = box(2, 2, 2);

  it('z = 0: one loop of area 4, counter-clockwise about +z, all points on the plane and on the cube surface', () => {
    const { loops } = planarSection(cube, [0, 0, 1], 0);
    expect(loops.length).toBe(1);
    expect(sectionArea(loops, [0, 0, 1])).toBeCloseTo(4, 12);
    // The induced boundary orientation of the region S ∩ Π is counter-clockwise about the plane normal.
    const va = loopVectorArea(loops[0]);
    expect(va[2]).toBeCloseTo(4, 12);
    for (const q of loops[0]) {
      expect(q[2]).toBeCloseTo(0, 14);
      expect(Math.max(Math.abs(q[0]), Math.abs(q[1]))).toBeCloseTo(1, 12);
    }
  });

  it('plane x + y + z = 0 through the centre: the regular hexagon of edge √2, area 3√3', () => {
    // The six edge midpoints (±1, ∓1, 0) and permutations form a regular hexagon of side √2,
    // area (3√3/2) s² = 3√3.
    const { loops } = planarSection(cube, [1, 1, 1], 0);
    expect(loops.length).toBe(1);
    expect(sectionArea(loops)).toBeCloseTo(3 * Math.sqrt(3), 12);
    for (const q of loops[0]) expect(q[0] + q[1] + q[2]).toBeCloseTo(0, 12);
  });

  it('plane exactly along the top face z = 1 gives the face itself (limit from below), z = −1 gives nothing', () => {
    // MATH.md §6: vertices on the plane count as positive, equivalent to slicing at c − ε, so the
    // section at the top face is the full square and at the bottom face it is empty.
    const top = planarSection(cube, [0, 0, 1], 1);
    expect(top.loops.length).toBe(1);
    expect(sectionArea(top.loops, [0, 0, 1])).toBeCloseTo(4, 12);
    for (const q of top.loops[0]) expect(q[2]).toBe(1);
    expect(planarSection(cube, [0, 0, 1], -1).loops.length).toBe(0);
  });

  it('plane x + y = 0 through four vertices: the 2√2 × 2 rectangle, area 4√2', () => {
    const { loops } = planarSection(cube, [1, 1, 0], 0);
    expect(loops.length).toBe(1);
    expect(sectionArea(loops)).toBeCloseTo(4 * Math.sqrt(2), 12);
  });

  it('plane x + y + z = 1 through three vertices: the equilateral triangle of side 2√2, area 2√3', () => {
    // Only (1, 1, 1) is strictly positive; the limit from below is the triangle on (1,1,−1), (1,−1,1), (−1,1,1).
    const { loops } = planarSection(cube, [1, 1, 1], 1);
    expect(loops.length).toBe(1);
    expect(sectionArea(loops)).toBeCloseTo(2 * Math.sqrt(3), 12);
  });

  it('planes touching only an edge or a vertex give no loop', () => {
    expect(planarSection(cube, [1, 1, 0], 2).loops.length).toBe(0);
    expect(planarSection(cube, [1, 1, 1], 3).loops.length).toBe(0);
    // Just inside the corner: a small triangle. Plane x + y + z = 3 − 0.3 cuts legs of 0.3 off the corner:
    // the triangle has side 0.3√2 and area (√3/4)(0.3√2)² = 0.09·√3/2.
    const { loops } = planarSection(cube, [1, 1, 1], 2.7);
    expect(loops.length).toBe(1);
    expect(sectionArea(loops)).toBeCloseTo((0.09 * Math.sqrt(3)) / 2, 12);
  });

  it('the normal need not be unit: (0, 0, 2) with k = 0.5 is the plane z = 0.25', () => {
    const { loops } = planarSection(cube, [0, 0, 2], 0.5);
    expect(loops.length).toBe(1);
    for (const q of loops[0]) expect(q[2]).toBeCloseTo(0.25, 12);
    expect(sectionArea(loops)).toBeCloseTo(4, 12);
    expect(() => planarSection(cube, [0, 0, 0], 0)).toThrow();
  });

  it('a non-closed mesh (one triangle) yields no loop: open chains are discarded', () => {
    const tri: Mesh3 = { positions: [[0, 0, -1], [1, 0, 1], [0, 1, 1]], triangles: [[0, 1, 2]] };
    expect(planarSection(tri, [0, 0, 1], 0).loops.length).toBe(0);
  });

  it('plane far from the cube yields no loop', () => {
    expect(planarSection(cube, [0, 1, 0], 5).loops.length).toBe(0);
    expect(planarSection(cube, [0, 1, 0], -5).loops.length).toBe(0);
  });
});

describe('planar sections of the torus: nesting and orientation', () => {
  const R = 1;
  const r = 0.4;
  const m = 48;
  const n = 24;
  const T = torus(R, r, m, n);
  const ngon = (rho: number): number => (m / 2) * rho * rho * Math.sin((2 * Math.PI) / m);

  it('z = 0: outer m-gon of radius R + r counter-clockwise, hole of radius R − r clockwise, area difference', () => {
    const { loops } = planarSection(T, [0, 0, 1], 0);
    expect(loops.length).toBe(2);
    const basis = planeBasis([0, 0, 1]);
    const groups = groupLoops(loops.map((l) => projectLoop(l, basis)));
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);
    const outer = loops[groups[0].outer];
    const hole = loops[groups[0].holes[0]];
    expect(loopVectorArea(outer)[2]).toBeCloseTo(ngon(R + r), 10);
    expect(loopVectorArea(hole)[2]).toBeCloseTo(-ngon(R - r), 10);
    expect(sectionArea(loops, [0, 0, 1])).toBeCloseTo(ngon(R + r) - ngon(R - r), 10);
    for (const q of outer) expect(Math.hypot(q[0], q[1])).toBeCloseTo(R + r, 10);
    for (const q of hole) expect(Math.hypot(q[0], q[1])).toBeCloseTo(R - r, 10);
  });

  it('x = 0 passes through 2n mesh vertices and still gives two closed n-gons of area (n/2) r² sin(2π/n)', () => {
    // u = π/2 and 3π/2 are sampled (m divisible by 4), so the plane contains two whole rings.
    const { loops } = planarSection(T, [1, 0, 0], 0);
    expect(loops.length).toBe(2);
    const basis = planeBasis([1, 0, 0]);
    const groups = groupLoops(loops.map((l) => projectLoop(l, basis)));
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.holes.length === 0)).toBe(true);
    expect(sectionArea(loops, [1, 0, 0])).toBeCloseTo(2 * (n / 2) * r * r * Math.sin((2 * Math.PI) / n), 10);
    for (const loop of loops) {
      expect(loopVectorArea(loop)[0]).toBeGreaterThan(0);
      for (const q of loop) expect(q[0]).toBeCloseTo(0, 12);
    }
  });

  it('tilted planes through the centre: an annulus (one hole) below arcsin(r/R) ≈ 23.6°, two ovals above', () => {
    for (const [deg, groupsExpected, holesExpected] of [[10, 1, 1], [20, 1, 1], [30, 2, 0], [60, 2, 0]]) {
      const a = (deg * Math.PI) / 180;
      const nrm: Vec3 = [Math.sin(a), 0, Math.cos(a)];
      const { loops } = planarSection(T, nrm, 0);
      expect(loops.length, `${deg}°`).toBe(2);
      const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis(nrm))));
      expect(groups.length, `${deg}°`).toBe(groupsExpected);
      expect(groups.reduce((s, g) => s + g.holes.length, 0), `${deg}°`).toBe(holesExpected);
      expect(sectionArea(loops, nrm)).toBeGreaterThan(0);
      // The area can only decrease as the plane tilts away from the equatorial section.
      expect(sectionArea(loops, nrm)).toBeLessThan(ngon(R + r) - ngon(R - r));
    }
  });

  it('plane z = r tangent to the top ring: the section is the zero-area limit from below', () => {
    // §6: vertices on the plane are positive, so the section is the limit from below, an infinitely
    // thin annulus. planarSection returns its two boundary loops, both the ring m-gon (the top ring
    // v = π/2 is sampled since n is divisible by 4), wound opposite ways; the region between them is
    // empty, so nesting must leave both out: no group, no triangle, zero area.
    const { loops } = planarSection(T, [0, 0, 1], r);
    expect(loops.length).toBe(2);
    for (const loop of loops) {
      expect(loop.length).toBe(m);
      for (const q of loop) {
        expect(q[2]).toBe(r);
        expect(Math.hypot(q[0], q[1])).toBeCloseTo(R, 12);
      }
    }
    const a0 = loopVectorArea(loops[0])[2];
    const a1 = loopVectorArea(loops[1])[2];
    expect(Math.abs(a0)).toBeCloseTo(ngon(R), 10);
    expect(a0 + a1).toBeCloseTo(0, 10);
    expect(groupLoops(loops.map((l) => projectLoop(l, planeBasis([0, 0, 1]))))).toEqual([]);
    expect(triangulateSection(loops, [0, 0, 1], 1).triangles).toEqual([]);
    expect(sectionArea(loops, [0, 0, 1])).toBeLessThan(1e-9);
    // Reversing every loop leaves the geometry, hence the verdict, unchanged.
    expect(sectionArea(loops.map((l) => [...l].reverse()), [0, 0, 1])).toBeLessThan(1e-9);
    // The bottom ring from below is the same configuration mirrored: z = −r supports the torus from
    // below, so the limit from below (z = −r − ε) is empty and no loop at all is produced.
    expect(planarSection(T, [0, 0, 1], -r).loops).toEqual([]);
  });

  it('triangulateSection of the z = 0 annulus covers exactly the annulus, faces +z, area as the loops', () => {
    const { loops } = planarSection(T, [0, 0, 1], 0);
    const tri = triangulateSection(loops, [0, 0, 1], 1);
    let area = 0;
    for (const [a, b, c] of tri.triangles) {
      const p = tri.positions[a];
      const nn = cross3(sub3(tri.positions[b], p), sub3(tri.positions[c], p));
      expect(nn[2]).toBeGreaterThan(0);
      area += length3(nn) / 2;
      const centroid = scale3(add3(add3(p, tri.positions[b]), tri.positions[c]), 1 / 3);
      const rho = Math.hypot(centroid[0], centroid[1]);
      // Inside the outer polygon and outside the hole polygon (its inradius is (R − r) cos(π/m)).
      expect(rho).toBeLessThan(R + r + 1e-9);
      expect(rho).toBeGreaterThan((R - r) * Math.cos(Math.PI / m) - 1e-9);
    }
    expect(area).toBeCloseTo(sectionArea(loops, [0, 0, 1]), 9);
    // Orientation −1 flips every triangle.
    const flipped = triangulateSection(loops, [0, 0, 1], -1);
    for (const [a, b, c] of flipped.triangles) {
      const p = flipped.positions[a];
      expect(cross3(sub3(flipped.positions[b], p), sub3(flipped.positions[c], p))[2]).toBeLessThan(0);
    }
  });
});

describe('planar sections of hand-built solids with holes', () => {
  // Outer box [−2, 2]³ with the inward-facing box [−1, 1]² × [−2, 2] removed: a square tube along z.
  const tube = concatMeshes(box(4, 4, 4), flipMesh3(box(2, 2, 4)));
  // Four nested square tubes along z: material in 3 ≤ max(|x|,|y|) ≤ 4 and 1 ≤ max(|x|,|y|) ≤ 2.
  const nested = concatMeshes(box(8, 8, 4), flipMesh3(box(6, 6, 4)), box(4, 4, 4), flipMesh3(box(2, 2, 4)));

  it('section z = 0.3 of the square tube: outer square + hole, area 16 − 4 = 12, correct windings', () => {
    const { loops } = planarSection(tube, [0, 0, 1], 0.3);
    expect(loops.length).toBe(2);
    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis([0, 0, 1]))));
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);
    expect(loopVectorArea(loops[groups[0].outer])[2]).toBeCloseTo(16, 12);
    expect(loopVectorArea(loops[groups[0].holes[0]])[2]).toBeCloseTo(-4, 12);
    expect(sectionArea(loops, [0, 0, 1])).toBeCloseTo(12, 12);
    const tri = triangulateSection(loops, [0, 0, 1], 1);
    let area = 0;
    for (const [a, b, c] of tri.triangles) {
      const p = tri.positions[a];
      const nn = cross3(sub3(tri.positions[b], p), sub3(tri.positions[c], p));
      expect(nn[2]).toBeGreaterThan(0);
      area += length3(nn) / 2;
      const g = scale3(add3(add3(p, tri.positions[b]), tri.positions[c]), 1 / 3);
      expect(Math.max(Math.abs(g[0]), Math.abs(g[1]))).toBeLessThan(2);
      expect(Math.max(Math.abs(g[0]), Math.abs(g[1]))).toBeGreaterThan(1);
    }
    expect(area).toBeCloseTo(12, 10);
  });

  it('tilted section x + z = 0 of the square tube: 4√2 × 4 rectangle minus 2√2 × 2 hole, area 12√2', () => {
    // On the plane z = −x the outer box gives |x| ≤ 2, |y| ≤ 2 (extent 4√2 along (1,0,−1)/√2 by 4),
    // the hole |x| ≤ 1, |y| ≤ 1 (2√2 by 2).
    const nrm: Vec3 = [1, 0, 1];
    const { loops } = planarSection(tube, nrm, 0);
    expect(loops.length).toBe(2);
    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis(nrm))));
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);
    expect(sectionArea(loops, nrm)).toBeCloseTo(12 * Math.sqrt(2), 10);
  });

  it('four nested loops: depth-2 island with its own hole; area 64 − 36 + 16 − 4 = 40', () => {
    const { loops } = planarSection(nested, [0, 0, 1], 0.5);
    expect(loops.length).toBe(4);
    const loops2 = loops.map((l) => projectLoop(l, planeBasis([0, 0, 1])));
    const groups = groupLoops(loops2);
    expect(groups.length).toBe(2);
    const depths = groups.map((g) => g.depth).sort();
    expect(depths).toEqual([0, 2]);
    for (const g of groups) {
      expect(g.holes.length).toBe(1);
      // The hole attached to each outer is the one directly inside it: areas 36 inside 64, 4 inside 16.
      const outerArea = Math.abs(signedArea2(loops2[g.outer]));
      const holeArea = Math.abs(signedArea2(loops2[g.holes[0]]));
      if (g.depth === 0) expect([outerArea, holeArea]).toEqual([64, 36]);
      else expect([outerArea, holeArea]).toEqual([16, 4]);
    }
    expect(sectionArea(loops, [0, 0, 1])).toBeCloseTo(40, 10);
    const tri = triangulateSection(loops, [0, 0, 1], 1);
    let area = 0;
    for (const [a, b, c] of tri.triangles) {
      const p = tri.positions[a];
      const nn = cross3(sub3(tri.positions[b], p), sub3(tri.positions[c], p));
      expect(nn[2]).toBeGreaterThan(0);
      area += length3(nn) / 2;
      const g = scale3(add3(add3(p, tri.positions[b]), tri.positions[c]), 1 / 3);
      const d = Math.max(Math.abs(g[0]), Math.abs(g[1]));
      expect((d > 3 && d < 4) || (d > 1 && d < 2), `centroid at Chebyshev radius ${d}`).toBe(true);
    }
    expect(area).toBeCloseTo(40, 10);
  });

  it('groupLoops on synthetic loops: a hole inside an island is attached to the island, not the outer loop', () => {
    const loops2 = [square2(4), square2(3, false), square2(2), square2(1, false)];
    const groups = groupLoops(loops2);
    expect(groups.length).toBe(2);
    const byOuter = new Map(groups.map((g) => [g.outer, g]));
    expect(byOuter.get(0)?.holes).toEqual([1]);
    expect(byOuter.get(2)?.holes).toEqual([3]);
    expect(byOuter.get(0)?.depth).toBe(0);
    expect(byOuter.get(2)?.depth).toBe(2);
    // sectionArea is independent of how the loops are wound.
    const loops3 = loops2.map((l) => lift2(l));
    expect(sectionArea(loops3, [0, 0, 1])).toBeCloseTo(64 - 36 + 16 - 4, 12);
    expect(sectionArea(loops3.map((l) => [...l].reverse()), [0, 0, 1])).toBeCloseTo(40, 12);
  });

  it('loopCorners keeps exactly the corners of a square whose edges carry collinear midpoints', () => {
    const loop: Vec3[] = [[-1, -1, 0], [0, -1, 0], [1, -1, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [-1, 1, 0], [-1, 0, 0]];
    const kept = loopCorners(loop, 1e-9).map((i) => loop[i]);
    expect(kept.length).toBe(4);
    for (const q of kept) expect(Math.abs(q[0]) + Math.abs(q[1])).toBe(2);
    // A degenerate loop of distinct collinear points has no corner.
    expect(loopCorners([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], 1e-9)).toEqual([]);
  });
});

// =============================================================================
// 3. Lateral complex and extrusion structure
// =============================================================================

describe('lateral tet complex of an extrusion', () => {
  it('box(2, 2, 2) × [−1, 1]: 36 tets, open only at the two caps, outward, cone hypervolume 12', () => {
    // Each of the 12 triangles gives a prism of 3 tets. The complex is the boundary of the tesseract
    // minus its two w-cells, so its boundary faces are exactly the 2 × 12 triangles of those caps.
    // Cone 4-volume from the origin: each lateral tet lies in a hyperplane at distance 1, so the
    // cones fill 6 of the 8 cells of 4-volume 2 each: 12 (equivalently (3h/2) Vol(S) = 12).
    const c = lateralComplex(box(2, 2, 2), 1);
    expect(c.positions.length).toBe(16);
    expect(c.tets.length).toBe(36);
    const v = validateTetComplex(c.positions, c.tets);
    expect(v.nonManifoldFaces).toBe(0);
    expect(v.inconsistentFaces).toBe(0);
    expect(v.degenerateTets).toBe(0);
    expect(v.boundaryFaces).toBe(24);
    expect(hypervolumeByCones(c.positions, c.tets)).toBeCloseTo(12, 10);
    expect(signedHypervolume(c.positions, c.tets)).toBeCloseTo(12, 10);
    // Outward: every tet normal has a positive component along its triangle's outward normal.
    for (const t of c.tets) {
      const nrm = tetNormal(c.positions, t);
      const a = c.positions[t[0]];
      expect(dot4(nrm, [a[0], a[1], a[2], 0])).toBeGreaterThan(0);
    }
  });

  it('icosphere(1, 1) × [−0.7, 0.7]: boundary faces = 2F, no degenerate tets, cone hypervolume (3h/2) Vol(S)', () => {
    const mesh = icosphere(1, 1);
    const c = lateralComplex(mesh, 0.7);
    const v = validateTetComplex(c.positions, c.tets);
    expect(v.nonManifoldFaces).toBe(0);
    expect(v.inconsistentFaces).toBe(0);
    expect(v.degenerateTets).toBe(0);
    expect(v.boundaryFaces).toBe(2 * mesh.triangles.length);
    expect(c.tets.length).toBe(3 * mesh.triangles.length);
    expect(hypervolumeByCones(c.positions, c.tets)).toBeCloseTo(1.5 * 0.7 * mesh3Volume(mesh), 10);
  });

  it('a two-component mesh (square tube) still gives a consistent lateral complex open only at the caps', () => {
    const tube = concatMeshes(box(4, 4, 4), flipMesh3(box(2, 2, 4)));
    const c = lateralComplex(tube, 1);
    const v = validateTetComplex(c.positions, c.tets);
    expect(v.nonManifoldFaces).toBe(0);
    expect(v.inconsistentFaces).toBe(0);
    expect(v.boundaryFaces).toBe(2 * tube.triangles.length);
  });

  it('ExtrudedSolid structure: positions, wire counts, radius, wRange, constructor validation', () => {
    const mesh = box(2, 2, 2);
    const s = extrude(mesh, 1, 'T');
    expect(s.kind).toBe('lifted');
    expect(s.wRange()).toEqual([-1, 1]);
    expect(s.radius()).toBeCloseTo(2, 12); // hypot(√3, 1)
    const w = s.wire();
    // §9.1: edges of M (18) at both levels + one per vertex (8) = 44; faces: 12 triangles × 2 + 18 quads = 42.
    expect(w.positions.length).toBe(16);
    expect(w.edges.length).toBe(44);
    expect(w.faces.length).toBe(42);
    expect(w.faces.filter((f) => f.length === 4).length).toBe(18);
    for (const e of w.edges) for (const i of e) expect(i >= 0 && i < 16).toBe(true);
    const expected: Vec4[] = [];
    for (let i = 0; i < 16; i++) expected.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
    expect(approxSet(w.positions, expected)).toBe(true);
    expect(() => extrude(mesh, 0, 'bad')).toThrow();
    expect(() => extrude(mesh, -1, 'bad')).toThrow();
    expect(() => extrude(mesh, Number.NaN, 'bad')).toThrow();
  });
});

// =============================================================================
// 4. extrude(cube) = tesseract (MATH.md §8.4)
// =============================================================================

describe('extrude(box(2,2,2), 1) reproduces the tesseract slices of MATH.md §8.4', () => {
  const tess = extrude(box(2, 2, 2), 1, 'Tesseract');

  it('n = e_w, |c| < 1: a cube of volume 8, closed with χ = 2; c = +1 is the cube, c = −1 is empty', () => {
    for (const c of [-0.999, -0.5, 0, 0.25, 0.999]) {
      const r = analyse(tess.slice(hyperplaneW(c)));
      expectClosed(r, 2);
      expect(r.volume).toBeCloseTo(8, 5);
    }
    // §6 limit from below: at w = +1 the whole top cell lies in H and is returned; at w = −1 nothing.
    expect(analyse(tess.slice(hyperplaneW(1))).volume).toBeCloseTo(8, 5);
    expect(tess.slice(hyperplaneW(-1)).indices.length).toBe(0);
  });

  it('n = (1,1,1,1)/2, c = 0: the regular octahedron of volume 32/3, closed with χ = 2', () => {
    const r = analyse(tess.slice(hyperplane([1, 1, 1, 1], 0)));
    expectClosed(r, 2);
    // Float32 positions of magnitude ≤ 2 carry ~2e-7 absolute error → volume error ≲ 1e-5.
    expect(Math.abs(r.volume - 32 / 3)).toBeLessThan(1e-5);
    // Every slice vertex is at distance ≤ 2 (the circumradius) from the origin and the six far ones are at 2.
    let maxR = 0;
    const m = tess.slice(hyperplane([1, 1, 1, 1], 0));
    for (let i = 0; i < m.positions.length / 3; i++) maxR = Math.max(maxR, length3(vertexAt(m, i)));
    expect(maxR).toBeCloseTo(2, 5);
  });

  it('n = (1,1,1,1)/2 near the far vertex: tetrahedra of volume (4 − 2c)³/3 for 1 ≤ c < 2, nothing at c = ±2', () => {
    // With u_i = 1 − p_i ≥ 0 the slice is {Σ u_i = 4 − 2c} ∩ [0,2]⁴; for c ≥ 1 the upper bounds are
    // inactive and it is the regular tetrahedron with vertices s e_i (s = 4 − 2c), edge s√2, volume s³/3.
    for (const c of [1.25, 1.5, 1.9]) {
      const r = analyse(tess.slice(hyperplane([1, 1, 1, 1], c)));
      expectClosed(r, 2);
      expect(Math.abs(r.volume - (4 - 2 * c) ** 3 / 3)).toBeLessThan(1e-5);
    }
    // At c = 1 the tetrahedron has edge 2√2 and volume 8/3 (where truncation begins).
    expect(Math.abs(analyse(tess.slice(hyperplane([1, 1, 1, 1], 1))).volume - 8 / 3)).toBeLessThan(1e-5);
    expect(Math.abs(analyse(tess.slice(hyperplane([1, 1, 1, 1], 2))).volume)).toBeLessThan(1e-9);
    expect(analyse(tess.slice(hyperplane([1, 1, 1, 1], 2))).triangles).toBe(0);
    expect(tess.slice(hyperplane([1, 1, 1, 1], -2)).indices.length).toBe(0);
  });

  it('n = (1,1,0,0)/√2 and n = (1,0,0,1)/√2, c = 0: square prisms of volume 8√2 through eight vertices', () => {
    // The first has n_w = 0 (section of the cube by x + y = 0, a 2√2 × 2 rectangle, times 2h = 2).
    // The second involves the caps: slab |x| ≤ 1 is the whole cube, stretched by √2.
    for (const n of [[1, 1, 0, 0], [1, 0, 0, 1], [0, 1, 1, 0], [0, 0, 1, 1]] as Vec4[]) {
      const r = analyse(tess.slice(hyperplane(n, 0)));
      expectClosed(r, 2);
      expect(Math.abs(r.volume - 8 * Math.sqrt(2))).toBeLessThan(1e-5);
    }
    // Off centre, n = (1,0,0,1)/√2, c = 0.3: slab x ∈ [0.3√2 − 1, 1], volume 4 (2 − 0.3√2) √2 = 8√2 − 2.4.
    const r = analyse(tess.slice(hyperplane([1, 0, 0, 1], 0.3)));
    expectClosed(r, 2);
    expect(Math.abs(r.volume - (8 * Math.sqrt(2) - 2.4))).toBeLessThan(1e-5);
  });

  it('hyperplane exactly along a cell: n = e_x, c = 1 gives the 2×2×2 cell (limit from below), c = −1 is empty', () => {
    // §6 convention applied to a tilted-by-90° situation: the cell x = 1 is the square prism
    // [−1,1]² × [−1,1] in (y, z, w), volume 8. At x = −1 the cell lies on the negative side's limit.
    const r = analyse(tess.slice(hyperplane([1, 0, 0, 0], 1)));
    expectClosed(r, 2);
    expect(Math.abs(r.volume - 8)).toBeLessThan(1e-5);
    expect(analyse(tess.slice(hyperplane([1, 0, 0, 0], -1))).triangles).toBe(0);
    // Generic n_w = 0 slice: x = 0.4 → the cell-parallel prism, volume 8 as well.
    expect(Math.abs(analyse(tess.slice(hyperplane([1, 0, 0, 0], 0.4))).volume - 8)).toBeLessThan(1e-5);
  });

  it('the slice volume integrates to 16 along the three §8.4 directions and four seeded random ones', () => {
    // A(c) is continuous and piecewise cubic with a few kinks; the midpoint rule with 1000 steps on
    // [−2, 2] (h = 0.004) has error ≲ Σ_kinks |ΔA′| h² / 4 ≈ 16·10·1.6e-5/4 ≈ 6e-4.
    const rng = mulberry32(2024);
    const dirs: Vec4[] = [[0, 0, 0, 1], [1, 1, 1, 1], [1, 1, 0, 0], [1, 0, 0, 1]];
    for (let i = 0; i < 4; i++) dirs.push(randomUnit4(rng));
    for (const n of dirs) {
      expect(Math.abs(sliceVolumeIntegral(tess, n, 1000) - 16), `direction ${n}`).toBeLessThan(2e-3);
    }
  });

  it('the slice does not depend on the chart basis: rotating (u1, u2) within n^⊥ keeps volume and closure', () => {
    const h = hyperplane([1, 2, 3, 4], 0.37);
    const [u1, u2, u3] = h.basis;
    const phi = 0.8;
    const rot = (a: Vec4, b: Vec4, c: number, s: number): Vec4 => [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s, a[3] * c + b[3] * s];
    const h2: Hyperplane = { normal: h.normal, offset: h.offset, basis: [rot(u1, u2, Math.cos(phi), Math.sin(phi)), rot(u1, u2, -Math.sin(phi), Math.cos(phi)), u3] };
    const r1 = analyse(tess.slice(h));
    const r2 = analyse(tess.slice(h2));
    expectClosed(r1, 2);
    expectClosed(r2, 2);
    expect(Math.abs(r1.volume - r2.volume)).toBeLessThan(1e-5);
    expect(r1.volume).toBeGreaterThan(0);
  });

  it('extrude(box(2, 3, 5), 1.5): w-slices of volume 30 and slice integral 90', () => {
    const s = extrude(box(2, 3, 5), 1.5, 'Brick');
    expect(Math.abs(analyse(s.slice(hyperplaneW(0.4))).volume - 30)).toBeLessThan(1e-4);
    const rng = mulberry32(7);
    for (let i = 0; i < 3; i++) {
      const n = randomUnit4(rng);
      expect(Math.abs(sliceVolumeIntegral(s, n, 800) / 90 - 1), `direction ${n}`).toBeLessThan(2e-3);
    }
  });
});

// =============================================================================
// 5. Extruded sphere: sheared slabs
// =============================================================================

describe('extruded sphere: tilted slices are sheared slabs of the ball', () => {
  const r = 1;
  const h = 1;
  const ico = icosphere(r, 3);
  const sph = extrude(ico, h, 'Spherinder');
  const vMesh = mesh3Volume(ico);
  const dMin = minFaceDistance(ico);
  const rMax = maxRadius(ico);

  it('full slab: when the two clipping planes miss the ball the slice is the whole ball stretched by 1/|n_w|', () => {
    // n = (0.1, 0.2, 0.05, 0.97)/|·|: half-width h|n_w|/|n_xyz| = 0.97/0.229 ≈ 4.2 > r, so the clipped
    // region is all of S and V_slice = √(1 + |n_xyz|²/n_w²) · Vol(S) = Vol(S)/|n_w| exactly.
    for (const n of [[0.1, 0.2, 0.05, 0.97], [0.1, 0.2, 0.05, -0.97], [-0.05, 0.1, 0.1, 0.9]] as Vec4[]) {
      const hp = hyperplane(n, 0);
      const { stretch, a, b } = slab(hp, h);
      expect(a).toBeLessThan(-r);
      expect(b).toBeGreaterThan(r);
      const rep = analyse(sph.slice(hp));
      expectClosed(rep, 2);
      expect(Math.abs(rep.volume / (stretch * vMesh) - 1), `direction ${n}`).toBeLessThan(1e-5);
    }
  });

  it('n_w = 0: the slice is the planar section times 2h, a prism closed with χ = 2', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 4; i++) {
      const m = randomUnit3(rng);
      const c = (rng() * 1.6 - 0.8) * r;
      const hp = hyperplane([m[0], m[1], m[2], 0], c);
      const rep = analyse(sph.slice(hp));
      expectClosed(rep, 2);
      const area = sectionArea(planarSection(ico, m, c).loops, m);
      expect(Math.abs(rep.volume / (2 * h * area) - 1), `direction ${m}, c = ${c}`).toBeLessThan(1e-5);
      // Analytic sandwich: π (d_min² − c²) ≤ area ≤ π (r² − c²).
      expect(area).toBeLessThanOrEqual(Math.PI * (rMax * rMax - c * c) + 1e-9);
      expect(area).toBeGreaterThanOrEqual(Math.PI * (dMin * dMin - c * c) - 1e-9);
    }
  });

  it('seeded random hyperplanes: closed, χ = 2, volume between the slabs of the inscribed and circumscribed balls, equal to the Cavalieri integral of planar sections, sourceW consistent', () => {
    const rng = mulberry32(31415);
    let partial = 0;
    for (let i = 0; i < 12; i++) {
      const n = randomUnit4(rng);
      const extent = r * Math.hypot(n[0], n[1], n[2]) + h * Math.abs(n[3]); // max n·p over the prism
      const c = (rng() * 1.6 - 0.8) * extent;
      const hp = hyperplane(n, c);
      const { m, a, b, stretch } = slab(hp, h);
      const mesh = sph.slice(hp);
      const rep = analyse(mesh);
      expect(rep.triangles, `direction ${n}, c = ${c}: empty slice`).toBeGreaterThan(0);
      expectClosed(rep, 2);
      const clipped = rep.volume / stretch;
      // ball(d_min) ⊂ S ⊂ ball(r_max) and clipping preserves inclusion.
      expect(clipped, `direction ${n}, c = ${c}`).toBeLessThanOrEqual(ballSlab(rMax, a, b) + 1e-6);
      expect(clipped, `direction ${n}, c = ${c}`).toBeGreaterThanOrEqual(ballSlab(dMin, a, b) - 1e-6);
      // Independent of the 4D slicer: Cavalieri over 3D planar sections of the mesh. Midpoint rule with
      // 1000 steps on an interval ≤ 2: kink errors Σ |ΔA′| h²/4 ≲ 642 · 0.3 · 1e-6 ≈ 2e-4.
      const cav = sectionIntegral(ico, m, Math.max(a, -rMax), Math.min(b, rMax), 1000);
      expect(Math.abs(clipped - cav), `direction ${n}, c = ${c}`).toBeLessThan(2e-3);
      if (a > -r || b < r) partial++;
      // §10: sourceW is the w of the 4D point the slice vertex came from, i.e. unchart(h, q)_w ∈ [−h, h].
      for (let k = 0; k < mesh.positions.length / 3; k++) {
        const q = vertexAt(mesh, k);
        const p = unchart(hp, q);
        expect(Math.abs(p[3] - mesh.sourceW[k])).toBeLessThan(2e-6);
        expect(Math.abs(mesh.sourceW[k])).toBeLessThanOrEqual(h + 1e-6);
      }
    }
    expect(partial, 'the seed should produce some genuinely clipped slabs').toBeGreaterThan(4);
  });

  it('exact z-slabs of an extruded uvSphere: volume = discrete slab volume / |n_w| for both signs of n_w', () => {
    // uvSphere's axis is z, so a slab perpendicular to z has the exact area law of revolvedSectionArea.
    const W = 24;
    const H = 12;
    const uv = uvSphere(r, W, H);
    const s = extrude(uv, h, 'uv');
    const profile = sphereProfile(r, H);
    for (const [theta, c, sign] of [[0.3, 0.2, 1], [0.6, -0.4, 1], [1.2, 0.5, -1], [0.9, 0.0, -1], [0.45, 0.9, 1]]) {
      const n: Vec4 = [0, 0, Math.sin(theta), sign * Math.cos(theta)];
      const hp = hyperplane(n, c);
      const { a, b, stretch } = slab(hp, h);
      const expected = stretch * revolvedSlabVolume(profile, W, Math.max(a, -r), Math.min(b, r));
      const rep = analyse(s.slice(hp));
      expectClosed(rep, 2);
      expect(Math.abs(rep.volume / expected - 1), `θ = ${theta}, c = ${c}, sign ${sign}`).toBeLessThan(2e-5);
    }
  });

  it('cap orientation: H(n, c) and H(−n, −c) are the same hyperplane; both charts give positive, equal volumes', () => {
    const rng = mulberry32(55);
    for (let i = 0; i < 5; i++) {
      const n = randomUnit4(rng);
      const c = (rng() - 0.5) * 1.2;
      const rp = analyse(sph.slice(hyperplane(n, c)));
      const rm = analyse(sph.slice(hyperplane([-n[0], -n[1], -n[2], -n[3]], -c)));
      expectClosed(rp, 2);
      expectClosed(rm, 2);
      expect(rp.volume).toBeGreaterThan(0);
      expect(Math.abs(rp.volume - rm.volume)).toBeLessThan(1e-5);
    }
  });

  it('n = ±e_w exactly: the ball itself; the §6 limit-from-below convention at the cap levels', () => {
    for (const c of [0, 0.5, -0.5]) {
      const rp = analyse(sph.slice(hyperplane([0, 0, 0, 1], c)));
      const rm = analyse(sph.slice(hyperplane([0, 0, 0, -1], c)));
      expectClosed(rp, 2);
      expectClosed(rm, 2);
      expect(Math.abs(rp.volume / vMesh - 1)).toBeLessThan(1e-6);
      expect(Math.abs(rm.volume / vMesh - 1)).toBeLessThan(1e-6);
    }
    // +e_w: w = c; the top cap (c = h) is the limit from below → the ball; the bottom (c = −h) is empty.
    expect(Math.abs(analyse(sph.slice(hyperplane([0, 0, 0, 1], h))).volume / vMesh - 1)).toBeLessThan(1e-6);
    expect(sph.slice(hyperplane([0, 0, 0, 1], -h)).indices.length).toBe(0);
    // −e_w: −w = c; at c = h the hyperplane is w = −h, whose limit from below (c − ε → w > −h) is the ball; at c = −h empty.
    expect(Math.abs(analyse(sph.slice(hyperplane([0, 0, 0, -1], h))).volume / vMesh - 1)).toBeLessThan(1e-6);
    expect(sph.slice(hyperplane([0, 0, 0, -1], -h)).indices.length).toBe(0);
    // In both cases the slice is the mesh surface itself in the ball's own coordinates (up to the chart's
    // handedness fix e_z ↦ −e_z for −e_w): every slice vertex lies on a face of the mesh, i.e. at a distance
    // from the origin between the inscribed radius d_min and r (the slicer also emits points on the
    // prisms' diagonal edges, which are interior points of mesh edges, not mesh vertices).
    for (const nn of [[0, 0, 0, 1], [0, 0, 0, -1]] as Vec4[]) {
      const m = sph.slice(hyperplane(nn, 0));
      for (let k = 0; k < m.positions.length / 3; k++) {
        const d = length3(vertexAt(m, k));
        expect(d).toBeLessThan(r + 1e-6);
        expect(d).toBeGreaterThan(dMin - 1e-6);
      }
      // and for −e_w the z coordinate is mirrored: the sets of |z| agree with +e_w.
    }
  });

  it('cap plane exactly through mesh vertices: n = (1,0,0,1)/√2, c = 1/√2 clips at x = 0 where the icosphere has vertices', () => {
    // a = (c − h/√2)/(1/√2) = 0, b = 2: the slab is the half ball x ≥ 0, stretched by √2. The icosahedron
    // (and its subdivisions) has vertices with x = 0 exactly, so the cap plane passes through mesh vertices
    // and the lateral/cap classifications must agree (§6 symbolic perturbation).
    const hp = hyperplane([1, 0, 0, 1], Math.SQRT1_2);
    const { a, b, stretch } = slab(hp, h);
    expect(a).toBeCloseTo(0, 12);
    expect(b).toBeCloseTo(2, 12);
    const rep = analyse(sph.slice(hp));
    expectClosed(rep, 2);
    expect(Math.abs(rep.volume / ((stretch * vMesh) / 2) - 1)).toBeLessThan(1e-5);
  });

  it('nearly parallel hyperplanes (|n_xyz| = 1e-3, 1e-4) at the cap level: the half ball, to Float32 accuracy', () => {
    // n = (δ, 0, 0, 1)/√(1+δ²), c = h: the slab is x ≥ (c − |n_w| h)/|n_xyz| = δ/2 (since 1 − 1/√(1+δ²) ≈ δ²/2),
    // essentially the half ball x ≥ 0. The icosphere is mirror-symmetric in x, so the expected clipped
    // volume is Vol(S)/2 − (area of the x = 0 section)·δ/2 up to O(δ²); the section area is the
    // Cavalieri integral below. Float32 output limits the agreement to ~1e-6 relative.
    for (const delta of [1e-3, 1e-4]) {
      const hp = hyperplane([delta, 0, 0, 1], h);
      const { a, b, stretch } = slab(hp, h);
      expect(b).toBeGreaterThan(r);
      const expected = stretch * (vMesh / 2 - sectionIntegral(ico, [1, 0, 0], 0, a, 50));
      const rep = analyse(sph.slice(hp));
      expect(Math.abs(rep.volume / expected - 1), `δ = ${delta}`).toBeLessThan(1e-5);
    }
  });

  it('nearly parallel hyperplanes |n_xyz| = 1e-8 … 1e-11 at the cap level still give the half ball', () => {
    // n = (δ, 0, 0, 1)/√(1+δ²), c = h: the slab is x ≥ δ/2 ≈ 0, the half ball, with volume
    // Vol(S)/2 · √(1+δ²). The hyperplane passes through the cap-level vertices with x = 0 (the
    // icosphere has them), and §6's symbolic perturbation must be applied exactly: any literal shift
    // of the offset is divided by |n_xyz| in the cap plane and misplaces the clipping plane (a shift
    // of 2e-10 moves it by 0.028 at δ = 1e-8, and past the whole ball at δ ≤ 1e-9). Float32 output
    // limits the agreement to ~1e-6 relative; the signed distances δ·x carry a relative error of
    // ~1e-16/δ, i.e. the clipping plane is placed to within 1e-16/δ ≤ 1e-5 in x.
    for (const delta of [1e-8, 1e-10, 1e-11]) {
      const hp = hyperplane([delta, 0, 0, 1], h);
      const { stretch } = slab(hp, h);
      const expected = (stretch * vMesh) / 2;
      const rep = analyse(sph.slice(hp));
      expectClosed(rep, 2);
      expect(Math.abs(rep.volume / expected - 1), `δ = ${delta}`).toBeLessThan(1e-4);
    }
  });

  // For a hyperplane tilted 1e-5 from e_w the lateral slice legitimately contains clusters of
  // distinct crossing points ~1e-6 apart and sliver triangles of area far below 1e-12 around each
  // cap-level vertex. Any absolute area threshold for "degenerate" triangles removes slivers that
  // stitch the surface and reports cracks that are not there (so does a greedy weld, differently).
  // analyseSlice welds transitively and drops only exactly degenerate triangles; the slice must
  // then be closed with χ = 2 at both a fine and the default weld tolerance.
  it('near-parallel but generic slice is closed with χ = 2 once only exactly degenerate triangles are dropped', () => {
    const hp = hyperplane([1e-5, 0, 0, 1], 0.99999);
    const mesh = extrude(icosphere(1, 2), 1, 's').slice(hp);
    for (const tol of [1e-7, 1e-6]) {
      const rep = analyseSlice(mesh, tol);
      expect(rep.closed, `tol ${tol}`).toBe(true);
      expect(rep.consistent, `tol ${tol}`).toBe(true);
      expect(rep.euler, `tol ${tol}`).toBe(2);
    }
  });
});

// =============================================================================
// 6. Extruded cylinder, torus and knot
// =============================================================================

describe('extruded cylinder (cubinder)', () => {
  const seg = 48;
  const cyl = cylinder(1, 2, seg);
  const s = extrude(cyl, 1, 'Cubinder');
  const area = (seg / 2) * Math.sin((2 * Math.PI) / seg);

  it('z-tilted slabs: volume = polygon area × clipped height / |n_w|, closed with χ = 2', () => {
    // Clipping a cylinder of height 2 (z ∈ [−1, 1]) between z = a and z = b leaves area × |[a,b] ∩ [−1,1]|.
    for (const [theta, c] of [[0.4, 0.1], [0.8, -0.3], [1.3, 0.6], [0.2, 0.0]]) {
      const hp = hyperplane([0, 0, Math.sin(theta), Math.cos(theta)], c);
      const { a, b, stretch } = slab(hp, 1);
      const overlap = Math.max(0, Math.min(b, 1) - Math.max(a, -1));
      const rep = analyse(s.slice(hp));
      expectClosed(rep, 2);
      expect(Math.abs(rep.volume - stretch * area * overlap), `θ = ${theta}, c = ${c}`).toBeLessThan(2e-5);
    }
  });

  it('x-tilted slab: a cylinder clipped by two planes parallel to its axis has the chord-based area; sourceW is consistent', () => {
    // Slab x ∈ [a, b] of the 48-gon prism: height 2 times the polygon area between the vertical
    // lines x = a and x = b, computed here from the polygon directly (Cavalieri over x: width(x) = 2 y(x)
    // with y(x) the polygon's half-chord, piecewise linear → trapezoid rule exact between vertices).
    const theta = 0.7;
    const c = 0.35;
    const hp = hyperplane([Math.sin(theta), 0, 0, Math.cos(theta)], c);
    const { a, b, stretch } = slab(hp, 1);
    const xs = Array.from({ length: seg }, (_, i) => Math.cos((2 * Math.PI * i) / seg));
    const halfChord = (x: number): number => {
      let best = 0;
      for (let i = 0; i < seg; i++) {
        const p: [number, number] = [xs[i], Math.sin((2 * Math.PI * i) / seg)];
        const q: [number, number] = [xs[(i + 1) % seg], Math.sin((2 * Math.PI * ((i + 1) % seg)) / seg)];
        if ((p[0] <= x) !== (q[0] <= x)) best = Math.max(best, Math.abs(p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1])));
      }
      return best;
    };
    const lo = Math.max(a, -1);
    const hi = Math.min(b, 1);
    const nodes = [lo, ...xs.filter((x) => x > lo && x < hi), hi].sort((p, q) => p - q);
    let polyArea = 0;
    for (let i = 0; i + 1 < nodes.length; i++) polyArea += (nodes[i + 1] - nodes[i]) * (halfChord(nodes[i]) + halfChord(nodes[i + 1]));
    const mesh = s.slice(hp);
    const rep = analyse(mesh);
    expectClosed(rep, 2);
    expect(Math.abs(rep.volume / (stretch * polyArea * 2) - 1)).toBeLessThan(2e-5);
    for (let k = 0; k < mesh.positions.length / 3; k++) {
      expect(Math.abs(unchart(hp, vertexAt(mesh, k))[3] - mesh.sourceW[k])).toBeLessThan(2e-6);
    }
  });

  it('hyperplane exactly along a cell: n = ±e_z, c = 1 gives the 48-gon disc × [−1, 1] cell (limit from below); c = −1 is empty', () => {
    // The cylinder's top cap × [−h, h] is a whole cell of the cubinder lying in {z = 1}; §6's convention
    // returns it (volume = polygon area × 2) and returns nothing for the bottom cell at z = −1 with n = e_z.
    for (const nn of [[0, 0, 1, 0], [0, 0, -1, 0]] as Vec4[]) {
      const rep = analyse(s.slice(hyperplane(nn, 1)));
      expectClosed(rep, 2);
      expect(Math.abs(rep.volume - 2 * area), `n = ${nn}`).toBeLessThan(2e-5);
    }
    expect(s.slice(hyperplane([0, 0, 1, 0], -1)).indices.length).toBe(0);
    // Just inside, the generic prism slice has the same volume.
    expect(Math.abs(analyse(s.slice(hyperplane([0, 0, 1, 0], 0.999999))).volume - 2 * area)).toBeLessThan(2e-5);
  });

  it('slice integral along seeded random directions equals the 4-volume 4 × polygon area', () => {
    const rng = mulberry32(4242);
    for (let i = 0; i < 3; i++) {
      const n = randomUnit4(rng);
      expect(Math.abs(sliceVolumeIntegral(s, n, 500) / (4 * area) - 1), `direction ${n}`).toBeLessThan(5e-3);
    }
  });
});

describe('extruded torus (torus prism)', () => {
  const R = 1;
  const r = 0.4;
  const m = 24;
  const n = 12;
  const h = 0.6;
  const T = torus(R, r, m, n);
  const s = extrude(T, h, 'Torus prism');
  const vMesh = mesh3Volume(T);
  const profile = torusProfile(R, r, n);

  it('full slab: whole solid torus sheared, χ = 0, volume Vol(T)/|n_w|', () => {
    // n = (0.1, 0, 0, 0.995)/|·|: half-width 0.6·0.995/0.1 ≈ 6 > R + r = 1.4.
    for (const nn of [[0.1, 0, 0, 0.995], [0, 0.1, 0.05, -0.99]] as Vec4[]) {
      const hp = hyperplane(nn, 0);
      const { a, b, stretch } = slab(hp, h);
      expect(a).toBeLessThan(-(R + r));
      expect(b).toBeGreaterThan(R + r);
      const rep = analyse(s.slice(hp));
      expectClosed(rep, 0);
      expect(Math.abs(rep.volume / (stretch * vMesh) - 1)).toBeLessThan(1e-5);
    }
  });

  it('exact z-slabs: volume = discrete revolution slab / |n_w|; a slab inside |z| < r keeps χ = 0', () => {
    for (const [theta, c, sign, euler] of [[0.9, 0.3, 1, 0], [1.1, -0.2, -1, 0], [0.5, 0.45, 1, 0], [0.7, 0.1, 1, 0]]) {
      const hp = hyperplane([0, 0, Math.sin(theta), sign * Math.cos(theta)], c);
      const { a, b, stretch } = slab(hp, h);
      const lo = Math.max(a, -r);
      const hi = Math.min(b, r);
      const expected = stretch * revolvedSlabVolume(profile, m, lo, hi);
      const rep = analyse(s.slice(hp));
      expectClosed(rep, euler);
      expect(Math.abs(rep.volume / expected - 1), `θ = ${theta}, c = ${c}`).toBeLessThan(2e-5);
    }
  });

  it('seeded random hyperplanes: closed and consistent with positive volume; sourceW consistent', () => {
    const rng = mulberry32(777);
    for (let i = 0; i < 10; i++) {
      const nn = randomUnit4(rng);
      const extent = (R + r) * Math.hypot(nn[0], nn[1], nn[2]) + h * Math.abs(nn[3]);
      const c = (rng() * 1.4 - 0.7) * extent;
      const hp = hyperplane(nn, c);
      const mesh = s.slice(hp);
      const rep = analyse(mesh);
      expect(rep.triangles, `direction ${nn}, c = ${c}: empty`).toBeGreaterThan(0);
      expectClosed(rep);
      expect(rep.volume, `direction ${nn}, c = ${c}`).toBeGreaterThan(0);
      // The slab clips a torus: the slice is a torus (χ = 0) or one or more balls (χ = 2k).
      expect(rep.euler % 2).toBe(0);
      expect(rep.euler).toBeGreaterThanOrEqual(0);
      const { stretch, m: dir, a, b } = slab(hp, h);
      const cav = sectionIntegral(T, dir, Math.max(a, -(R + r)), Math.min(b, R + r), 600);
      expect(Math.abs(rep.volume / stretch - cav), `direction ${nn}, c = ${c}`).toBeLessThan(3e-3);
      for (let k = 0; k < mesh.positions.length / 3; k++) {
        expect(Math.abs(unchart(hp, vertexAt(mesh, k))[3] - mesh.sourceW[k])).toBeLessThan(2e-6);
      }
    }
  });

  it('n_w = 0 through the hole: two sheared tube sections, each a prism, χ = 4, volume 2h × section area', () => {
    const hp = hyperplane([1, 0, 0, 0], 0);
    const rep = analyse(s.slice(hp));
    expectClosed(rep, 4);
    const area = sectionArea(planarSection(T, [1, 0, 0], 0).loops, [1, 0, 0]);
    expect(Math.abs(rep.volume / (2 * h * area) - 1)).toBeLessThan(1e-5);
  });

  it('supporting hyperplane z + w = r + h touches the prism along the top ring × {h}: the cleaned slice is empty (§6)', () => {
    // max (z + w) over the prism is r + h, attained exactly on the ring v = π/2 (sampled: n is divisible
    // by 4) at w = h. H contains those vertices and the ring edges between them but no 2-face, so
    // every lateral triangle is zero-area (§6, degenerate offsets) and the top cap's section is the
    // zero-area limit from below (two coincident ring loops), which must contribute nothing.
    const hp = hyperplane([0, 0, 1, 1], (r + h) / Math.SQRT2);
    const rep = analyse(s.slice(hp));
    expect(rep.triangles).toBe(0);
    expect(Math.abs(rep.volume)).toBeLessThan(1e-12);
    // Slightly below, the slice is a thin solid torus around that ring: closed, χ = 0, with the exact
    // discrete slab volume of the surface of revolution between z = r − ε' and z = r (the cap plane of
    // the top cap), stretched by √2. ε' = 1e-3 in z is 1e-3/√2 in c.
    const eps = 1e-3;
    const below = hyperplane([0, 0, 1, 1], (r + h - eps) / Math.SQRT2);
    const { a, b, stretch } = slab(below, h);
    expect(a).toBeCloseTo(r - eps, 12);
    expect(b).toBeGreaterThan(r);
    const rep2 = analyse(s.slice(below));
    expectClosed(rep2, 0);
    expect(rep2.volume).toBeGreaterThan(0);
    expect(Math.abs(rep2.volume / (stretch * revolvedSlabVolume(profile, m, r - eps, r)) - 1)).toBeLessThan(1e-3);
  });

  it('slice integral along seeded random directions equals 2h × Vol(T)', () => {
    const rng = mulberry32(606);
    for (let i = 0; i < 3; i++) {
      const nn = randomUnit4(rng);
      expect(Math.abs(sliceVolumeIntegral(s, nn, 400) / (2 * h * vMesh) - 1), `direction ${nn}`).toBeLessThan(1e-2);
    }
  });
});

describe('extruded torus knot (knot prism)', () => {
  const K = torusKnot(0.8, 0.25, 2, 3, 64, 12);
  const s = extrude(K, 0.5, 'Knot prism');
  const vMesh = mesh3Volume(K);

  it('full slab: the whole knotted solid torus sheared, χ = 0, volume Vol(K)/|n_w|', () => {
    const hp = hyperplane([0.05, 0.02, 0, 1], 0.1);
    const { a, b, stretch } = slab(hp, 0.5);
    expect(a).toBeLessThan(-1.45);
    expect(b).toBeGreaterThan(1.45);
    const rep = analyse(s.slice(hp));
    expectClosed(rep, 0);
    expect(Math.abs(rep.volume / (stretch * vMesh) - 1)).toBeLessThan(1e-5);
  });

  it('seeded random hyperplanes: closed, consistent, positive volume, even Euler characteristic', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 8; i++) {
      const nn = randomUnit4(rng);
      const extent = 1.45 * Math.hypot(nn[0], nn[1], nn[2]) + 0.5 * Math.abs(nn[3]);
      const c = (rng() * 1.2 - 0.6) * extent;
      const rep = analyse(s.slice(hyperplane(nn, c)));
      expect(rep.triangles, `direction ${nn}, c = ${c}: empty`).toBeGreaterThan(0);
      expectClosed(rep);
      expect(rep.volume, `direction ${nn}, c = ${c}`).toBeGreaterThan(0);
      expect(rep.euler % 2).toBe(0);
    }
  });
});

describe('extruded solids with holes (square tube)', () => {
  const tube = squareTube(2, 1, 2);
  const s = extrude(tube, 1, 'Square tube prism');

  it('the hand-built tube is a closed genus-1 mesh of volume 48 whose z = 0.3 section is the 16 − 4 annulus', () => {
    const v = validateMesh3(tube);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect([v.vertexCount, v.edgeCount, v.triangleCount, v.euler]).toEqual([16, 48, 32, 0]);
    expect(mesh3Volume(tube)).toBeCloseTo(48, 12);
    const { loops } = planarSection(tube, [0, 0, 1], 0.3);
    expect(loops.length).toBe(2);
    expect(sectionArea(loops, [0, 0, 1])).toBeCloseTo(12, 12);
    // Its lateral complex is open only at the caps.
    const c = lateralComplex(tube, 1);
    const tv = validateTetComplex(c.positions, c.tets);
    expect([tv.nonManifoldFaces, tv.inconsistentFaces, tv.boundaryFaces]).toEqual([0, 0, 64]);
  });

  it('z-tilted slab containing the whole tube: a sheared solid torus, χ = 0, volume 48/|n_w|', () => {
    // θ = 20°: half-width h cot θ = 2.75 > 2, so the clipping planes miss the tube.
    const theta = (20 * Math.PI) / 180;
    const hp = hyperplane([0, 0, Math.sin(theta), Math.cos(theta)], 0);
    const { a, b, stretch } = slab(hp, 1);
    expect(a).toBeLessThan(-2);
    expect(b).toBeGreaterThan(2);
    const rep = analyse(s.slice(hp));
    expectClosed(rep, 0);
    expect(Math.abs(rep.volume - stretch * 48)).toBeLessThan(1e-4);
  });

  it('z-tilted slab clipping the tube: a shorter tube, χ = 0, volume 12 × clipped length / |n_w|', () => {
    // θ = 30°, c = 0.5: z ∈ [(0.5 − cos 30°)/sin 30°, (0.5 + cos 30°)/sin 30°] = [−0.732, 2.732] ∩ [−2, 2].
    const theta = Math.PI / 6;
    const hp = hyperplane([0, 0, Math.sin(theta), Math.cos(theta)], 0.5);
    const { a, b, stretch } = slab(hp, 1);
    const len = Math.min(b, 2) - Math.max(a, -2);
    expect(len).toBeCloseTo(2 + Math.sqrt(3) - 1, 12);
    const rep = analyse(s.slice(hp));
    expectClosed(rep, 0);
    expect(Math.abs(rep.volume - stretch * 12 * len)).toBeLessThan(1e-4);
  });

  it('n_w = 0: x = 0 cuts both walls into two boxes (χ = 4, volume 16); x = 1.5 misses the hole (χ = 2, volume 32)', () => {
    // Section at x = 0: two rectangles 1 ≤ |y| ≤ 2, |z| ≤ 2 of area 4 each, times 2h = 2 → 16.
    // Section at x = 1.5: the full 4 × 4 square (inside the wall), times 2 → 32.
    const r0 = analyse(s.slice(hyperplane([1, 0, 0, 0], 0)));
    expectClosed(r0, 4);
    expect(Math.abs(r0.volume - 16)).toBeLessThan(1e-4);
    const r1 = analyse(s.slice(hyperplane([1, 0, 0, 0], 1.5)));
    expectClosed(r1, 2);
    expect(Math.abs(r1.volume - 32)).toBeLessThan(1e-4);
  });

  it('x-tilted slabs: the sheared tube clipped by planes parallel to its axis, with the topology the slab dictates', () => {
    // n = (sin θ, 0, 0, cos θ), c: slab x ∈ [a, b] ⊂ [−2, 2]. Clipped volume = 2L × (annulus area between
    // x = a and x = b) = 4 × [ (b − a) · 4 − |[a, b] ∩ [−1, 1]| · 2 ]. Topology: both planes inside the
    // hole → two separate wall pieces (χ = 4); one inside → a connected simply connected block (χ = 2);
    // both outside → a shorter tube (χ = 0).
    for (const [theta, c] of [[1.0, 0.2], [1.0, 0.6], [0.5, 0.0]]) {
      const hp = hyperplane([Math.sin(theta), 0, 0, Math.cos(theta)], c);
      const { a, b, stretch } = slab(hp, 1);
      expect(a).toBeGreaterThan(-2);
      expect(b).toBeLessThan(2);
      const inside = (Math.abs(a) < 1 ? 1 : 0) + (Math.abs(b) < 1 ? 1 : 0);
      const euler = inside === 2 ? 4 : inside === 1 ? 2 : 0;
      const holeOverlap = Math.max(0, Math.min(b, 1) - Math.max(a, -1));
      const expected = stretch * 4 * ((b - a) * 4 - holeOverlap * 2);
      const rep = analyse(s.slice(hp));
      expectClosed(rep, euler);
      expect(Math.abs(rep.volume / expected - 1), `θ = ${theta}, c = ${c}`).toBeLessThan(2e-5);
    }
  });

  it('slice integral along seeded random directions equals the 4-volume 48 × 2', () => {
    const rng = mulberry32(8080);
    for (let i = 0; i < 2; i++) {
      const n = randomUnit4(rng);
      expect(Math.abs(sliceVolumeIntegral(s, n, 800) / 96 - 1), `direction ${n}`).toBeLessThan(3e-3);
    }
  });
});

// =============================================================================
// 7. Compounds and figures
// =============================================================================

describe('compound shapes', () => {
  it('wire concatenation offsets indices; radius and wRange are the unions; slice is the merge', () => {
    const a = extrude(box(2, 2, 2), 1, 'A');
    const b = extrude(translateMesh3(box(1, 1, 1), [3, 0, 0]), 0.25, 'B');
    const c = compound('C', [a, b]);
    expect(c.kind).toBe('compound');
    const w = c.wire();
    expect(w).not.toBeNull();
    expect(w!.positions.length).toBe(32);
    expect(w!.edges.length).toBe(88);
    expect(w!.faces.length).toBe(84);
    for (const [i, j] of w!.edges) expect(i >= 0 && i < 32 && j >= 0 && j < 32).toBe(true);
    for (const f of w!.faces) for (const i of f) expect(i >= 0 && i < 32).toBe(true);
    // Second part's positions are offset by 16 and lie at x ∈ [2.5, 3.5].
    for (let i = 16; i < 32; i++) expect(Math.abs(w!.positions[i][0] - 3)).toBeCloseTo(0.5, 12);
    expect(c.wRange()).toEqual([-1, 1]);
    expect(c.radius()).toBeCloseTo(Math.max(a.radius(), b.radius()), 12);
    // At w = 0 both parts are present: volumes add (8 + 1).
    const rep = analyse(c.slice(hyperplaneW(0)));
    expectClosed(rep, 4);
    expect(Math.abs(rep.volume - 9)).toBeLessThan(1e-5);
    // At w = 0.5 only the tall part remains.
    expect(Math.abs(analyse(c.slice(hyperplaneW(0.5))).volume - 8)).toBeLessThan(1e-5);
    expect(compound('empty', []).wire()).toBeNull();
    expect(compound('empty', []).wRange()).toEqual([0, 0]);
  });
});

describe('figures', () => {
  it('catalogue extrusions: a tilted slice of each is closed, consistent and has positive volume', () => {
    const hp = hyperplane([0.3, 0.5, -0.2, 0.8], 0.15);
    for (const make of [spherinder, cubinder, torusPrism, knotPrism]) {
      const shape = make();
      const rep = analyse(shape.slice(hp));
      expect(rep.triangles, shape.name).toBeGreaterThan(0);
      expectClosed(rep);
      expect(rep.volume, shape.name).toBeGreaterThan(0);
      // The sheared-slab law: slice volume / stretch lies below the whole mesh volume.
      const { stretch } = slab(hp, shape.halfHeight);
      expect(rep.volume / stretch, shape.name).toBeLessThanOrEqual(mesh3Volume(shape.mesh) + 1e-6);
    }
    expect(analyse(spherinder().slice(hp)).euler).toBe(2);
    expect(analyse(cubinder().slice(hp)).euler).toBe(2);
  });

  it('spherinder and cubinder at w = 0 are their own meshes: volumes match and sandwich/polygon values hold', () => {
    const sp = spherinder();
    const rep = analyse(sp.slice(hyperplaneW(0)));
    expectClosed(rep, 2);
    expect(Math.abs(rep.volume / mesh3Volume(sp.mesh) - 1)).toBeLessThan(1e-6);
    expect(rep.volume).toBeLessThan(ballVolume(1));
    expect(rep.volume).toBeGreaterThan(ballVolume(minFaceDistance(sp.mesh)));
    const cu = cubinder();
    const rc = analyse(cu.slice(hyperplaneW(0.3)));
    expectClosed(rc, 2);
    expect(Math.abs(rc.volume - 2 * 24 * Math.sin((2 * Math.PI) / 48))).toBeLessThan(1e-5);
  });

  it('mug: two parts, each closed on its own; the w = 0 slice is body + handle with χ = 2 + 0', () => {
    const m = mug();
    expect(m.parts.length).toBe(2);
    const hp = hyperplane([0.2, 0.4, 0.1, 0.9], 0.1);
    let total = 0;
    for (const part of m.parts) {
      const rep = analyse(part.slice(hp));
      expect(rep.triangles, part.name).toBeGreaterThan(0);
      expectClosed(rep);
      expect(rep.volume, part.name).toBeGreaterThan(0);
      total += rep.volume;
    }
    expect(Math.abs(analyse(m.slice(hp)).volume - total)).toBeLessThan(1e-6);
    const r0 = analyse(m.slice(hyperplaneW(0)));
    expectClosed(r0, 2);
    const parts = m.parts as readonly ExtrudedSolid[];
    const expected = parts.reduce((s, p) => s + mesh3Volume(p.mesh), 0);
    expect(Math.abs(r0.volume / expected - 1)).toBeLessThan(1e-6);
    // The handle's inner rim (x = 0.78 − 0.40 = 0.38) is inside the body wall (radius 0.5), so they overlap.
    const handle = parts[1].mesh;
    expect(Math.min(...handle.positions.map((p) => p[0]))).toBeCloseTo(0.38, 10);
    // The body stands along y: its vertices span y ∈ [−0.6, 0.6] and x² + z² ≤ 0.25.
    const body = parts[0].mesh;
    expect(Math.max(...body.positions.map((p) => p[1]))).toBeCloseTo(0.6, 12);
    expect(Math.min(...body.positions.map((p) => p[1]))).toBeCloseTo(-0.6, 12);
    for (const p of body.positions) expect(Math.hypot(p[0], p[2])).toBeLessThanOrEqual(0.5 + 1e-12);
  });

  it('human: 16 parts, height exactly 2 (y ∈ [−1, 1]), w range ±0.5, every part closed on its own', () => {
    const fig = human();
    expect(fig.parts.length).toBe(16);
    expect(fig.wRange()).toEqual([-0.5, 0.5]);
    const w = fig.wire();
    expect(w).not.toBeNull();
    const ys = w!.positions.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-1, 12);
    expect(Math.max(...ys)).toBeCloseTo(1, 12);
    // The figure fits in a box about 0.6 wide and 0.4 deep (hands at |x| ≈ 0.3, feet to z ≈ 0.17).
    const xs = w!.positions.map((p) => p[0]);
    expect(Math.max(...xs)).toBeLessThan(0.35);
    expect(Math.max(...xs)).toBeGreaterThan(0.25);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 12);
    const hp = hyperplane([0.1, 0.3, 0.2, 0.9], 0.05);
    for (const part of fig.parts) {
      const rep = analyse(part.slice(hp));
      expect(rep.triangles, part.name).toBeGreaterThan(0);
      expectClosed(rep, 2);
      expect(rep.volume, part.name).toBeGreaterThan(0);
      expect((part as ExtrudedSolid).halfHeight).toBe(0.5);
    }
    // At w = 0 the compound is the superposition of all 16 meshes: volumes add.
    const parts = fig.parts as readonly ExtrudedSolid[];
    const expected = parts.reduce((s, p) => s + mesh3Volume(p.mesh), 0);
    expect(Math.abs(analyse(fig.slice(hyperplaneW(0))).volume / expected - 1)).toBeLessThan(1e-6);
  });

  it('human is mirror-symmetric about x = 0: slices at x = t and x = −t have equal volume', () => {
    // H(e_x, t) = {x = t} and H(−e_x, t) = {x = −t}. Every primitive is x-symmetric (even segment
    // counts, boxes) and left/right parts are placed at ∓x, so the superposed slice volumes agree.
    const fig = human();
    for (const t of [0.03, 0.1, 0.2, 0.28]) {
      const vp = signedVolume(fig.slice(hyperplane([1, 0, 0, 0], t)));
      const vm = signedVolume(fig.slice(hyperplane([-1, 0, 0, 0], t)));
      expect(vp, `t = ${t}`).toBeGreaterThan(0);
      expect(Math.abs(vp - vm), `t = ${t}`).toBeLessThan(1e-6 * Math.max(vp, 1e-3));
    }
    // And the mirrored pairs are literal mirror images: left/right part meshes map onto each other.
    const parts = fig.parts as readonly ExtrudedSolid[];
    for (const left of parts) {
      if (!left.name.startsWith('Left ')) continue;
      const right = parts.find((p) => p.name === `Right ${left.name.slice(5)}`);
      expect(right, left.name).toBeDefined();
      const mirrored = left.mesh.positions.map((p): Vec3 => [-p[0], p[1], p[2]]);
      const key = (p: Vec3): string => p.map((x) => Math.round(x * 1e9)).join(',');
      expect(new Set(mirrored.map(key))).toEqual(new Set(right!.mesh.positions.map(key)));
    }
  });
});
