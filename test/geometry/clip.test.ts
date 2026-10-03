import { describe, expect, it } from 'vitest';
import {
  box, capsule, cylinder, icosphere, mesh3Area, mesh3Bounds, mesh3Edges, mesh3Volume, torus, torusKnot, uvSphere, validateMesh3,
} from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import { clipMesh3, CLIP_SNAP } from '../../src/geometry/clip';
import { planarSection, sectionArea } from '../../src/geometry/section';
import { cross3, dot3, normalize3, sub3 } from '../../src/math/vec';
import type { Vec3 } from '../../src/math/types';

// Deterministic pseudo-random numbers (same generator as the other geometry tests).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/**
 * Radius of the largest origin-centred ball inside a convex polyhedron
 * containing the origin: the smallest distance from the origin to a face
 * plane, min over triangles of n̂ · v_0. For the icosphere (all vertices on
 * the unit sphere, convex) the solid lies between this ball and the unit
 * ball, so ρ³ ≤ vol / ((4/3)π) ≤ 1 (the same fact mesh3.ts states for
 * icosphere).
 */
function inscribedRadius(mesh: Mesh3): number {
  let rho = Infinity;
  for (const [a, b, c] of mesh.triangles) {
    const n = normalize3(cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a])));
    rho = Math.min(rho, dot3(n, mesh.positions[a]));
  }
  return rho;
}

/** Triangles with all three vertices within `tol` of the plane m·q = k (the cap), as a mesh sharing the positions. */
function capOf(mesh: Mesh3, m: Vec3, k: number, tol = 1e-12): Mesh3 {
  const on = (i: number): boolean => Math.abs(dot3(m, mesh.positions[i]) - k) <= tol;
  return { positions: mesh.positions, triangles: mesh.triangles.filter(([a, b, c]) => on(a) && on(b) && on(c)) };
}

const triangleNormal = (mesh: Mesh3, t: readonly [number, number, number]): Vec3 =>
  cross3(sub3(mesh.positions[t[1]], mesh.positions[t[0]]), sub3(mesh.positions[t[2]], mesh.positions[t[0]]));

/** ∫∫ ρ dρ dz over a counter-clockwise polygon in the (ρ, z) half-plane: Σ (z₁ − z₀)(ρ₀² + ρ₀ρ₁ + ρ₁²)/6, Green's theorem as in extrude.test.ts. */
function rhoMoment(poly: readonly [number, number][]): number {
  let m = 0;
  for (let i = 0; i < poly.length; i++) {
    const [r0, z0] = poly[i];
    const [r1, z1] = poly[(i + 1) % poly.length];
    m += (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1) / 6;
  }
  return m;
}

/** Sutherland–Hodgman: the part z ≥ a of a convex polygon in the (ρ, z) half-plane. */
function keepAbove(poly: readonly [number, number][], a: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = p[1] >= a;
    const qin = q[1] >= a;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (a - p[1]) / (q[1] - p[1]);
      out.push([p[0] + t * (q[0] - p[0]), a]);
    }
  }
  return out;
}

/** Meridian polygon of torus(R, r, ·, n): (R + r cos v_j, r sin v_j), counter-clockwise. */
const torusProfile = (R: number, r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, j) => [R + r * Math.cos((2 * Math.PI * j) / n), r * Math.sin((2 * Math.PI * j) / n)]);

describe('clipMesh3: the ball and the box of MATH.md §9.4', () => {
  const ball = icosphere(1, 3);

  it('icosphere(1, 3) clipped by z ≥ 0 is the closed hemisphere, volume exactly half, (2/3)π within the discretisation', () => {
    const half = clipMesh3(ball, [0, 0, 1], 0);
    const v = validateMesh3(half); // no degenerate triangles allowed
    expect(v.errors).toEqual([]);
    expect(v.closed).toBe(true);
    expect(v.consistent).toBe(true);
    expect(v.euler).toBe(2);

    // The 12 icosahedron vertices (0, ±1, ±t), (±1, ±t, 0), (±t, 0, ±1) are closed
    // under z ↦ −z and midpoint subdivision commutes with it, so the polyhedron
    // is mirror symmetric in z = 0 and z ≥ 0 holds exactly half its volume.
    // Both volumes are sums of ~10³ terms of size ~1e-3, so rounding is ~1e-15.
    const full = mesh3Volume(ball);
    expect(Math.abs(mesh3Volume(half) / full - 0.5)).toBeLessThan(1e-12);

    // Against (2/3)π: the polyhedron is convex with every vertex on the unit
    // sphere, so ρ³ (4/3)π ≤ vol ≤ (4/3)π with ρ the inscribed radius.
    const rho = inscribedRadius(ball);
    expect(rho).toBeGreaterThan(0.99); // ≈ 0.9955 for 1280 triangles: the bracket is about 1.3 % wide
    expect(mesh3Volume(half)).toBeGreaterThanOrEqual((2 / 3) * Math.PI * rho ** 3);
    expect(mesh3Volume(half)).toBeLessThanOrEqual((2 / 3) * Math.PI);
    expect(Math.abs(mesh3Volume(half) / ((2 / 3) * Math.PI) - 1)).toBeLessThan(1 - rho ** 3 + 1e-12);

    // Everything is above the plane; the cap lies in it, faces −z, and its area is the
    // section area of the mesh by z = 0 (computed by the independent loop-area formula).
    const b = mesh3Bounds(half);
    expect(b.min[2]).toBeGreaterThanOrEqual(-1e-12);
    expect(b.max[2]).toBeCloseTo(1, 12); // the pole is a vertex at z = 1
    const cap = capOf(half, [0, 0, 1], 0);
    expect(cap.triangles.length).toBeGreaterThan(0);
    for (const t of cap.triangles) expect(triangleNormal(half, t)[2]).toBeLessThan(0);
    const { loops } = planarSection(ball, [0, 0, 1], 0);
    expect(Math.abs(mesh3Area(cap) / sectionArea(loops, [0, 0, 1]) - 1)).toBeLessThan(1e-12);
    // The equatorial polygon contains the disc of radius ρ and lies in the unit disc.
    expect(mesh3Area(cap)).toBeGreaterThan(Math.PI * rho * rho);
    expect(mesh3Area(cap)).toBeLessThan(Math.PI);
  });

  it('shares crossing points between neighbours: vertex count = kept vertices + crossing edges, none duplicated', () => {
    // The equator passes through mesh vertices (z = 0 exactly, those on the
    // x–y plane of the icosahedron's symmetry) and through the interior of
    // some edges. Every edge with one end at z > 0 and one at z < 0 gets one
    // new vertex, shared by its two triangles; vertices with z ≥ 0 are kept.
    const half = clipMesh3(ball, [0, 0, 1], 0);
    const keptVertices = ball.positions.filter((p) => p[2] >= 0).length;
    const crossing = mesh3Edges(ball).filter(([i, j]) => ball.positions[i][2] * ball.positions[j][2] < 0).length;
    expect(half.positions.length).toBe(keptVertices + crossing);
    const keys = new Set(half.positions.map((p) => p.join(',')));
    expect(keys.size).toBe(half.positions.length);
    // Some vertices lie exactly on the plane (they are mesh vertices, not cuts).
    expect(ball.positions.filter((p) => p[2] === 0).length).toBeGreaterThan(0);
  });

  it('box(2, 2, 2) clipped by z ≥ 0 is [−1,1]² × [0,1]: volume exactly 4, area 16, 12 vertices, 20 triangles', () => {
    const clipped = clipMesh3(box(2, 2, 2), [0, 0, 1], 0);
    // Volume 2 · 2 · 1; the cut points are the exact midpoints (t = 1/2), so
    // the arithmetic is exact up to the last bit.
    expect(mesh3Volume(clipped)).toBeCloseTo(4, 14);
    // Area 2 (4 + 2 + 2) = 16: top 4, cap 4, four sides 2 each.
    expect(mesh3Area(clipped)).toBeCloseTo(16, 13);
    const v = validateMesh3(clipped);
    expect(v.errors).toEqual([]);
    expect(v.euler).toBe(2);
    // Vertices: 4 top corners + 4 cut corners (vertical edges) + 4 cuts of the
    // face diagonals = 12. Triangles: top 2; each side face (2 triangles, one
    // with 2 vertices above the plane giving a quad = 2 triangles, one with 1
    // vertex above giving 1) 3 × 4 = 12; the cap square with the 4 diagonal
    // cut points on its edges, triangulated into 2 + 4 = 6. Euler: 12 − 30 + 20 = 2.
    expect(clipped.positions.length).toBe(12);
    expect(clipped.triangles.length).toBe(20);
    const b = mesh3Bounds(clipped);
    expect(b.min).toEqual([-1, -1, 0]);
    expect(b.max).toEqual([1, 1, 1]);
    // Cap: 6 triangles at z = 0 facing −z.
    const cap = capOf(clipped, [0, 0, 1], 0);
    expect(cap.triangles.length).toBe(6);
    for (const t of cap.triangles) expect(triangleNormal(clipped, t)[2]).toBeLessThan(0);
    expect(mesh3Area(cap)).toBeCloseTo(4, 14);
  });

  it('the plane is (normal, k) up to a common positive factor; the opposite normal keeps the other side', () => {
    const cube = box(2, 2, 2);
    // z ≥ 1/2 of [−1,1]³: [−1,1]² × [1/2, 1], volume 4 · 1/2 = 2, by (0,0,2)·q ≥ 1 as well.
    for (const [n, k] of [[[0, 0, 1], 0.5], [[0, 0, 2], 1], [[0, 0, 7], 3.5]] as const) {
      expect(mesh3Volume(clipMesh3(cube, [...n], k))).toBeCloseTo(2, 12);
    }
    // m = −e_z, k = −1/2 keeps −z ≥ −1/2, i.e. z ≤ 1/2: volume 4 · 3/2 = 6.
    expect(mesh3Volume(clipMesh3(cube, [0, 0, -1], -0.5))).toBeCloseTo(6, 12);
    expect(() => clipMesh3(cube, [0, 0, 0], 0)).toThrow(/zero normal/);
  });

  it('an oblique plane through the centre gives the regular hexagon of §11: volume 4, cap area 3√3', () => {
    // The cube [−1,1]³ is centrally symmetric, so every plane through the
    // origin halves it: volume 8/2 = 4. The plane x + y + z = 0 meets no vertex
    // (the vertex sums are ±1, ±3) and cuts the cube in the regular hexagon with
    // the six edge midpoints as vertices, side √2, area (3√3/2)(√2)² = 3√3 (§11).
    const m = normalize3([1, 1, 1]);
    const clipped = clipMesh3(box(2, 2, 2), m, 0);
    expect(validateMesh3(clipped).errors).toEqual([]);
    expect(validateMesh3(clipped).euler).toBe(2);
    expect(mesh3Volume(clipped)).toBeCloseTo(4, 12);
    const cap = capOf(clipped, m, 0);
    expect(mesh3Area(cap)).toBeCloseTo(3 * Math.sqrt(3), 12);
    for (const t of cap.triangles) expect(dot3(triangleNormal(clipped, t), m)).toBeLessThan(0);
  });
});

describe('clipMesh3: planes through vertices stay closed (MATH.md §6 convention, zero is positive)', () => {
  it('the plane x + y = 0 through four vertices of the cube keeps volume 4 and is closed with Euler 2', () => {
    // It contains the vertices (−1,1,±1) and (1,−1,±1); those count as kept
    // (s = 0 ≥ 0), the cut along the plane is the 2√2 × 2 rectangle.
    const clipped = clipMesh3(box(2, 2, 2), [1, 1, 0], 0);
    const v = validateMesh3(clipped);
    expect(v.errors).toEqual([]);
    expect(v.euler).toBe(2);
    expect(mesh3Volume(clipped)).toBeCloseTo(4, 12);
    expect(mesh3Area(capOf(clipped, normalize3([1, 1, 0]), 0))).toBeCloseTo(2 * 2 * Math.SQRT2, 12);
  });

  it('a plane through a whole ring of the torus (z = r sin 30°) gives a closed genus-1 body of the exact volume', () => {
    // torus(1, 0.4, 48, 24): the vertices of meridian index j = 2 and j = 10 have
    // z = 0.4 sin 30° = 0.2 up to 2e-17 of rounding, so the plane z = 0.2 passes
    // through 2 × 48 vertices. They are snapped onto it (CLIP_SNAP) and kept.
    // The kept part z ≥ 0.2 is a solid torus (cap: an annulus, outer and inner
    // loop), Euler 0. Its volume is the exact solid of revolution of the
    // clipped meridian polygon: m sin(2π/m) ∫∫ ρ dρ dz (mesh3.ts, uvSphere), the
    // quads being planar trapezoids; the polygon clip is by Sutherland–Hodgman.
    const T = torus(1, 0.4, 48, 24);
    const clipped = clipMesh3(T, [0, 0, 1], 0.2);
    const v = validateMesh3(clipped);
    expect(v.errors).toEqual([]);
    expect(v.euler).toBe(0);
    const expected = 48 * Math.sin((2 * Math.PI) / 48) * rhoMoment(keepAbove(torusProfile(1, 0.4, 24), 0.2));
    expect(Math.abs(mesh3Volume(clipped) / expected - 1)).toBeLessThan(1e-12);
    expect(mesh3Bounds(clipped).min[2]).toBeGreaterThanOrEqual(0.2 - 1e-12);
    // The complementary part z ≤ 0.2 is closed too, and the two volumes add up to the torus.
    const rest = clipMesh3(T, [0, 0, -1], -0.2);
    expect(validateMesh3(rest).errors).toEqual([]);
    expect(Math.abs((mesh3Volume(clipped) + mesh3Volume(rest)) / mesh3Volume(T) - 1)).toBeLessThan(1e-12);
  });

  it('a generic plane (z ≥ 0.1) cuts the torus into the exact clipped solid of revolution', () => {
    // 0.1 is between the meridian heights 0.4 sin 15° = 0.1035 and 0.4 sin 0° = 0:
    // no vertex is near the plane, so every cut point is a genuine crossing.
    const T = torus(1, 0.4, 48, 24);
    const clipped = clipMesh3(T, [0, 0, 1], 0.1);
    expect(validateMesh3(clipped).errors).toEqual([]);
    expect(validateMesh3(clipped).euler).toBe(0);
    const expected = 48 * Math.sin((2 * Math.PI) / 48) * rhoMoment(keepAbove(torusProfile(1, 0.4, 24), 0.1));
    expect(Math.abs(mesh3Volume(clipped) / expected - 1)).toBeLessThan(1e-12);
  });

  it('z ≥ 0 splits the torus into an annulus-capped half of volume V/2 (Euler 0); x ≥ 0 into a C of V/2 (Euler 2)', () => {
    // Both halves are exact: the meridian polygon is symmetric under z ↦ −z (j ↔ 24 − j)
    // and the tubular samples under x ↦ −x (i ↔ 24 − i); the quads are planar so the
    // polyhedron, not just its vertex set, has these symmetries.
    const T = torus(1, 0.4, 48, 24);
    const V = mesh3Volume(T);
    const upper = clipMesh3(T, [0, 0, 1], 0);
    expect(validateMesh3(upper).errors).toEqual([]);
    expect(validateMesh3(upper).euler).toBe(0); // the section is an annulus: outer loop + hole
    expect(Math.abs(mesh3Volume(upper) / V - 0.5)).toBeLessThan(1e-12);
    const right = clipMesh3(T, [1, 0, 0], 0);
    expect(validateMesh3(right).errors).toEqual([]);
    expect(validateMesh3(right).euler).toBe(2); // two disc sections at y = ±1, one connected C
    expect(Math.abs(mesh3Volume(right) / V - 0.5)).toBeLessThan(1e-12);
  });
});

describe('clipMesh3: trivial and supporting planes', () => {
  const ball = icosphere(1, 3);

  it('a plane with the whole mesh on the kept side returns the mesh unchanged (a copy)', () => {
    for (const k of [-2, -1.5]) {
      const out = clipMesh3(ball, [0, 0, 1], k); // all z ≥ −1 > k
      expect(out.positions).toEqual(ball.positions);
      expect(out.triangles).toEqual(ball.triangles);
      expect(out.positions).not.toBe(ball.positions);
    }
    // Touching from below: every vertex has s ≥ 0, and a vertex on the plane counts as kept.
    const bottom = clipMesh3(box(2, 2, 2), [0, 0, 1], -1);
    expect(mesh3Volume(bottom)).toBeCloseTo(8, 14);
    expect(bottom.triangles.length).toBe(12);
  });

  it('a plane with the whole mesh strictly on the removed side returns the empty mesh', () => {
    for (const k of [2, 1.0001]) {
      const out = clipMesh3(ball, [0, 0, 1], k);
      expect(out.positions).toEqual([]);
      expect(out.triangles).toEqual([]);
    }
    // The opposite normal: −z ≥ −k' keeps z ≤ k'; the ball lies in z ≥ −1, so k' = −2 removes it all.
    expect(clipMesh3(ball, [0, 0, -1], 2).triangles).toEqual([]);
  });

  it('a plane touching a ball at one vertex leaves nothing (the limit from below, MATH.md §6)', () => {
    // uvSphere has a vertex at the pole (0, 0, 1). z ≥ 1 keeps that vertex as s = 0,
    // but every triangle through it collapses to a point: the result is empty.
    const sphere = uvSphere(1, 12, 6);
    const out = clipMesh3(sphere, [0, 0, 1], 1);
    expect(out.triangles).toEqual([]);
    expect(out.positions).toEqual([]);
  });

  it('a plane containing a face with the solid below it leaves the doubled flat face, volume 0', () => {
    // z ≥ 1 on [−1,1]³ is the limit z ≥ 1 − ε: a slab of thickness 0, i.e. the top
    // square (normal +z) and the cap (normal −z) on top of each other, as §6 says
    // for the slicer. Volume 0, every vertex in z = 1, area 4 + 4. (Whether the two
    // sheets share a diagonal, which would put an edge in four triangles, depends on
    // the triangulation, so manifoldness is not asserted here.)
    const out = clipMesh3(box(2, 2, 2), [0, 0, 1], 1);
    expect(Math.abs(mesh3Volume(out))).toBeLessThan(1e-14);
    for (const p of out.positions) expect(p[2]).toBe(1);
    expect(mesh3Area(out)).toBeCloseTo(8, 14);
    // The same plane taken from the other side keeps the solid below: the whole box.
    expect(mesh3Volume(clipMesh3(box(2, 2, 2), [0, 0, -1], -1))).toBeCloseTo(8, 14);
  });

  it('vertices within CLIP_SNAP·extent of the plane count as on it: a rotated box with rounding noise stays closed', () => {
    // Rotate the cube [−1,1]³ by 45° about x and then about y. Its vertices
    // acquire arbitrary coordinates, and a plane through four of them (the
    // planes x + y = 0, x = y, x = z of the original cube, none of which contains
    // a face) is hit by every one of the four with a rounding error of ~1e-16.
    // Without snapping, the crossings on the edges at such a vertex would be
    // clusters of points 1e-16 apart and the cap could not be triangulated reliably.
    const c = Math.SQRT1_2;
    const cube = box(2, 2, 2);
    const rotated: Mesh3 = {
      positions: cube.positions.map((p): Vec3 => {
        const [x, y, z] = p;
        const y1 = c * y - c * z;
        const z1 = c * y + c * z; // about x by 45°
        return [c * x + c * z1, y1, -c * x + c * z1]; // about y by 45°
      }),
      triangles: cube.triangles,
    };
    expect(CLIP_SNAP).toBeGreaterThan(1e-12);
    // Vertex triples of the planes: {1,2,5,6} is x + y = 0, {0,3,4,7} is x = y, {0,2,5,7} is x = z.
    for (const [i, j, l] of [[1, 2, 5], [0, 3, 4], [0, 2, 5]]) {
      const p = rotated.positions[i];
      const n = normalize3(cross3(sub3(rotated.positions[j], p), sub3(rotated.positions[l], p)));
      const k = dot3(n, p);
      const a = clipMesh3(rotated, n, k);
      const b = clipMesh3(rotated, [-n[0], -n[1], -n[2]], -k);
      for (const side of [a, b]) {
        const v = validateMesh3(side, { allowDegenerate: true });
        expect(v.closed, v.errors.join('; ')).toBe(true);
        expect(v.consistent).toBe(true);
        expect(v.euler).toBe(2);
      }
      // Each plane contains the centre of the cube, which is central symmetric: halves of 4.
      expect(mesh3Volume(a)).toBeCloseTo(4, 12);
      expect(mesh3Volume(b)).toBeCloseTo(4, 12);
    }
  });
});

describe('clipMesh3: seeded random planes, closedness and the volume partition', () => {
  const meshes: Array<[string, Mesh3]> = [
    ['box', box(2, 1.5, 1)],
    ['icosphere', icosphere(1, 2)],
    ['uvSphere', uvSphere(1, 12, 6)],
    ['torus', torus(1, 0.4, 24, 12)],
    ['cylinder', cylinder(1, 2, 16)],
    ['capsule', capsule(0.5, 1, 12, 3)],
    ['torus knot', torusKnot(0.8, 0.25, 2, 3, 96, 12)],
  ];

  it('every cut is closed and consistently oriented, and V(clip(m, k)) + V(clip(−m, −k)) = V', () => {
    // The two kept sets S ∩ {m·q ≥ k − ε} and S ∩ {m·q ≤ k + ε} (zero counts
    // positive on both sides) overlap in a slab whose volume vanishes with ε, so
    // their volumes add up to vol(S); each is a closed oriented mesh. Planes: through
    // a random vertex (s = 0 snapped), through three random vertices, and generic.
    // Random normals never contain a mesh face, so no doubled flat polygons occur.
    const r = rng(2024);
    let planes = 0;
    for (const [name, mesh] of meshes) {
      const V = mesh3Volume(mesh);
      expect(V).toBeGreaterThan(0);
      for (let trial = 0; trial < 21; trial++) {
        let n: Vec3 = normalize3([r() - 0.5, r() - 0.5, r() - 0.5]);
        let k: number;
        const pick = (): Vec3 => mesh.positions[Math.floor(r() * mesh.positions.length)];
        if (trial % 3 === 0) {
          k = dot3(n, pick());
        } else if (trial % 3 === 1) {
          const [p, q, w] = [pick(), pick(), pick()];
          const c = cross3(sub3(q, p), sub3(w, p));
          if (dot3(c, c) < 1e-6) continue; // (nearly) collinear picks define no plane
          n = normalize3(c);
          k = dot3(n, p);
        } else {
          k = (r() - 0.5) * 1.6;
        }
        const a = clipMesh3(mesh, n, k);
        const b = clipMesh3(mesh, [-n[0], -n[1], -n[2]], -k);
        planes++;
        for (const side of [a, b]) {
          const v = validateMesh3(side, { allowDegenerate: true });
          expect(v.closed, `${name} trial ${trial}: ${v.errors.join('; ')}`).toBe(true);
          expect(v.consistent, `${name} trial ${trial}`).toBe(true);
          expect(mesh3Volume(side), `${name} trial ${trial}`).toBeGreaterThanOrEqual(-1e-12);
        }
        expect(Math.abs(mesh3Volume(a) + mesh3Volume(b) - V), `${name} trial ${trial}`).toBeLessThan(1e-11 * V);
        // A convex solid cut by a plane stays convex: one sphere (when non-empty).
        if ((name === 'box' || name === 'icosphere') && a.triangles.length > 0) {
          expect(validateMesh3(a, { allowDegenerate: true }).euler, `${name} trial ${trial}`).toBe(2);
        }
      }
    }
    expect(planes).toBeGreaterThan(120);
  });
});
