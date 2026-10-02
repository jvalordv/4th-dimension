import { describe, expect, it } from 'vitest';
import { box, cylinder, mesh3Area, torus, uvSphere } from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import {
  groupLoops, loopVectorArea, planarSection, planeBasis, pointInPolygon2, projectLoop, sectionArea, signedArea2, triangulateSection,
} from '../../src/geometry/section';
import { cross3, dot3, length3, normalize3, sub3 } from '../../src/math/vec';
import type { Vec3 } from '../../src/math/types';

/** Area of the regular n-gon of circumradius ρ: (n/2) ρ² sin(2π/n). */
const polygonArea = (n: number, rho: number): number => (n / 2) * rho * rho * Math.sin((2 * Math.PI) / n);

/** Signed area of a loop about the unit normal n (positive = counter-clockwise about n). */
const signedAreaAbout = (loop: readonly Vec3[], n: Vec3): number => dot3(loopVectorArea(loop), normalize3(n));

/** Largest distance of any loop point from the plane m·q = k. */
function maxPlaneError(loops: readonly (readonly Vec3[])[], m: Vec3, k: number): number {
  const n = normalize3(m);
  const kk = k / length3(m);
  let e = 0;
  for (const loop of loops) for (const q of loop) e = Math.max(e, Math.abs(dot3(n, q) - kk));
  return e;
}

/** Every triangle normal has the sign of `orientation` along n; returns the count checked. */
function expectOriented(mesh: Mesh3, n: Vec3, orientation: 1 | -1): number {
  for (const [a, b, c] of mesh.triangles) {
    const cr = cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a]));
    expect(Math.sign(dot3(cr, n))).toBe(orientation);
  }
  return mesh.triangles.length;
}

/** Minimum over triangles of the distance from the origin to the triangle's plane. */
function minPlaneDistance(mesh: Mesh3): number {
  let d = Infinity;
  for (const [a, b, c] of mesh.triangles) {
    const n = normalize3(cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a])));
    d = Math.min(d, Math.abs(dot3(n, mesh.positions[a])));
  }
  return d;
}

describe('planarSection of a box (MATH.md §9.1)', () => {
  const cube = box(2, 2, 2); // [-1, 1]³

  it('axis plane x = 0.3 gives one square loop of area 4, counter-clockwise about the normal', () => {
    const n: Vec3 = [1, 0, 0];
    const { loops } = planarSection(cube, n, 0.3);
    expect(loops.length).toBe(1);
    expect(maxPlaneError(loops, n, 0.3)).toBeLessThan(1e-12);
    // Material lies on the left when travelling the loop with the normal
    // toward the viewer, so the signed area about n is +4 (the 2×2 square).
    expect(signedAreaAbout(loops[0], n)).toBeCloseTo(4, 12);
    expect(sectionArea(loops)).toBeCloseTo(4, 12);
    expect(sectionArea(loops, n)).toBeCloseTo(4, 12);
    // Every loop point is on the cube's surface: one coordinate at ±1.
    for (const q of loops[0]) expect(Math.max(Math.abs(q[1]), Math.abs(q[2]))).toBeCloseTo(1, 12);
  });

  it('a non-unit normal describes the same plane', () => {
    const a = planarSection(cube, [1, 0, 0], 0.3);
    const b = planarSection(cube, [2, 0, 0], 0.6);
    expect(sectionArea(b.loops)).toBeCloseTo(sectionArea(a.loops), 12);
    expect(maxPlaneError(b.loops, [1, 0, 0], 0.3)).toBeLessThan(1e-12);
  });

  it('a face plane is the limit from below: x = +1 is the face, x = −1 is empty (MATH.md §6)', () => {
    // Vertices on the plane count as positive, so at x = +1 the four face
    // vertices are positive and the other four negative: the loop is the
    // face itself, with exactly its four corners once zero-length steps go.
    const face = planarSection(cube, [1, 0, 0], 1);
    expect(face.loops.length).toBe(1);
    expect(face.loops[0].length).toBe(4);
    expect(sectionArea(face.loops)).toBeCloseTo(4, 12);
    expect(signedAreaAbout(face.loops[0], [1, 0, 0])).toBeCloseTo(4, 12);
    // At x = −1 every vertex has s ≥ 0: nothing crosses.
    expect(planarSection(cube, [1, 0, 0], -1).loops).toEqual([]);
    // Planes missing the box entirely.
    expect(planarSection(cube, [0, 0, 1], 1.5).loops).toEqual([]);
    expect(planarSection(cube, [0, 0, 1], -1.5).loops).toEqual([]);
  });

  it('diagonal planes through edges and edge midpoints give the exact rectangle and hexagon', () => {
    // x + y = 0 passes through the edges at (1,−1,±1) and (−1,1,±1): a
    // 2√2 × 2 rectangle, area 4√2 (cf. MATH.md §8.4, square prism 8√2 one dimension up).
    const rect = planarSection(cube, [1, 1, 0], 0);
    expect(rect.loops.length).toBe(1);
    expect(sectionArea(rect.loops)).toBeCloseTo(4 * Math.SQRT2, 12);
    expect(maxPlaneError(rect.loops, [1, 1, 0], 0)).toBeLessThan(1e-12);
    // x + y + z = 0 passes through the six edge midpoints (±1, ∓1, 0) and
    // permutations: a regular hexagon of side √2, area (3√3/2)·2 = 3√3
    // (cf. the octahedron of MATH.md §8.4 one dimension up).
    const hex = planarSection(cube, [1, 1, 1], 0);
    expect(hex.loops.length).toBe(1);
    expect(sectionArea(hex.loops)).toBeCloseTo(3 * Math.sqrt(3), 12);
    expect(maxPlaneError(hex.loops, [1, 1, 1], 0)).toBeLessThan(1e-12);
    // The loop passes through all six midpoints; it also carries one
    // collinear point per face where the plane crosses that face's
    // triangulation diagonal (12 points in all), which is harmless.
    const keys = new Set(hex.loops[0].map((q) => q.map((v) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(9)).join(',')));
    for (const mid of [[1, -1, 0], [-1, 1, 0], [1, 0, -1], [-1, 0, 1], [0, 1, -1], [0, -1, 1]]) {
      expect(keys.has(mid.map((v) => v.toFixed(9)).join(','))).toBe(true);
    }
    expect(hex.loops[0].length).toBe(12);
  });

  it('triangulation covers the square with normals along ±n as requested', () => {
    const n: Vec3 = [1, 0, 0];
    const { loops } = planarSection(cube, n, 0.3);
    for (const orientation of [1, -1] as const) {
      const tri = triangulateSection(loops, n, orientation);
      expect(tri.triangles.length).toBeGreaterThan(0);
      expectOriented(tri, n, orientation);
      expect(mesh3Area(tri)).toBeCloseTo(4, 12);
      for (const q of tri.positions) expect(q[0]).toBeCloseTo(0.3, 12);
    }
  });
});

describe('planarSection of a torus', () => {
  const R = 1;
  const r = 0.3;

  it('equatorial plane: an outer loop and a hole whose triangulation has the discretised annulus area', () => {
    // n = 8 is even, so the rings v = 0 (ρ = R + r) and v = π (ρ = R − r)
    // lie exactly in z = 0: the section is the regular 24-gon of circumradius
    // R + r minus the 24-gon of circumradius R − r. The plane passes through
    // 48 mesh vertices, which exercises the s ≥ 0 perturbation.
    const m = 24;
    const mesh = torus(R, r, m, 8);
    const n: Vec3 = [0, 0, 1];
    const { loops } = planarSection(mesh, n, 0);
    expect(loops.length).toBe(2);
    expect(loops.map((l) => l.length).sort()).toEqual([m, m]);
    expect(maxPlaneError(loops, n, 0)).toBeLessThan(1e-12);

    const outerArea = polygonArea(m, R + r);
    const holeArea = polygonArea(m, R - r);
    const signed = loops.map((l) => signedAreaAbout(l, n)).sort((a, b) => a - b);
    expect(signed[1]).toBeCloseTo(outerArea, 12); // outer: counter-clockwise about n
    expect(signed[0]).toBeCloseTo(-holeArea, 12); // hole: clockwise about n

    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis(n))));
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);

    // Annulus area (m/2) sin(2π/m) [(R+r)² − (R−r)²] = 2 m R r sin(2π/m).
    const annulus = 2 * m * R * r * Math.sin((2 * Math.PI) / m);
    expect(outerArea - holeArea).toBeCloseTo(annulus, 12);
    expect(sectionArea(loops)).toBeCloseTo(annulus, 12);
    for (const orientation of [1, -1] as const) {
      const tri = triangulateSection(loops, n, orientation);
      // A polygon with V vertices and h holes triangulates into V + 2h − 2 triangles.
      expect(tri.triangles.length).toBe(2 * m + 2 - 2);
      expectOriented(tri, n, orientation);
      expect(mesh3Area(tri)).toBeCloseTo(annulus, 10);
    }
  });

  it('plane through the hole (x = 0) with vertices on it: two regular n-gons, two outer groups', () => {
    // m = 12 puts rings at u = 90° and 270° exactly in x = 0; each ring is a
    // regular n-gon of circumradius r (the tube cross-section).
    const nSeg = 8;
    const mesh = torus(R, r, 12, nSeg);
    const n: Vec3 = [1, 0, 0];
    const { loops } = planarSection(mesh, n, 0);
    expect(loops.length).toBe(2);
    expect(loops.map((l) => l.length)).toEqual([nSeg, nSeg]);
    expect(maxPlaneError(loops, n, 0)).toBeLessThan(1e-12);
    for (const l of loops) expect(signedAreaAbout(l, n)).toBeCloseTo(polygonArea(nSeg, r), 12);
    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis(n))));
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.holes.length === 0 && g.depth === 0)).toBe(true);
    expect(sectionArea(loops)).toBeCloseTo(2 * polygonArea(nSeg, r), 12);
    // The two loops sit at y ≈ +R and y ≈ −R.
    const ys = loops.map((l) => l.reduce((s, q) => s + q[1], 0) / l.length).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-R, 12);
    expect(ys[1]).toBeCloseTo(R, 12);
    for (const orientation of [1, -1] as const) {
      const tri = triangulateSection(loops, n, orientation);
      expect(tri.triangles.length).toBe(2 * (nSeg - 2));
      expectOriented(tri, n, orientation);
      expect(mesh3Area(tri)).toBeCloseTo(2 * polygonArea(nSeg, r), 12);
    }
  });

  it('generic plane through the hole (x = 0.1): two mirror-image outer loops of 2n points', () => {
    // Vertex x-coordinates are ρ_j cos u_i with ρ_j ∈ [0.7, 1.3] and
    // cos u_i ∈ {0, ±½, ±√3/2, ±1}: none equals 0.1, and the plane lies
    // between the rings u = 60°, 90° (and 270°, 300°). Each quad of those two
    // strips is cut on its rung and on its diagonal: 2n points per loop. The
    // mesh is symmetric under y → −y (i → −i), which fixes the plane, so the
    // two loops have equal area.
    const nSeg = 8;
    const mesh = torus(R, r, 12, nSeg);
    const n: Vec3 = [1, 0, 0];
    const { loops } = planarSection(mesh, n, 0.1);
    expect(loops.length).toBe(2);
    expect(loops.map((l) => l.length)).toEqual([2 * nSeg, 2 * nSeg]);
    expect(maxPlaneError(loops, n, 0.1)).toBeLessThan(1e-12);
    const areas = loops.map((l) => signedAreaAbout(l, n));
    expect(areas[0]).toBeGreaterThan(0);
    expect(areas[1]).toBeCloseTo(areas[0], 12);
    // Loop points lie on chords between mesh vertices, so they stay in the
    // convex region {√(x²+y²) ≤ R + r, |z| ≤ r} that contains the vertices.
    // (They need not stay within r of the core circle: on the inner side a
    // chord across the 30° step bows toward the axis by ρ(1 − cos 15°).)
    for (const l of loops) {
      for (const q of l) {
        expect(Math.hypot(q[0], q[1])).toBeLessThanOrEqual(R + r + 1e-12);
        expect(Math.abs(q[2])).toBeLessThanOrEqual(r + 1e-12);
      }
    }
    expect(groupLoops(loops.map((l) => projectLoop(l, planeBasis(n)))).length).toBe(2);
    expect(sectionArea(loops)).toBeCloseTo(areas[0] + areas[1], 12);
  });
});

describe('planarSection of spheres and cylinders', () => {
  it('uvSphere at z = 0.5 has area between the inscribed- and circumscribed-ball bounds around π r²(1 − k²)', () => {
    // H = 10 puts rings at cos(18°k) = 0.951, 0.809, 0.588, 0.309, 0: none at
    // 0.5, so the plane crosses the quads between the rings at 54° and 72°.
    // The mesh is convex with all vertices on the unit sphere, so it
    // contains the ball of radius d_min (minimum face-plane distance) and
    // lies in the unit ball; its section by z = k therefore contains the
    // disc of radius √(d_min² − k²) and lies in the disc of radius √(1 − k²):
    //   π (d_min² − k²) ≤ A ≤ π (1 − k²) = 0.75π.
    const k = 0.5;
    const mesh = uvSphere(1, 24, 10);
    const n: Vec3 = [0, 0, 1];
    const { loops } = planarSection(mesh, n, k);
    expect(loops.length).toBe(1);
    expect(maxPlaneError(loops, n, k)).toBeLessThan(1e-12);
    const area = sectionArea(loops);
    const dmin = minPlaneDistance(mesh);
    expect(dmin).toBeGreaterThan(0.97); // 24 × 10 patches: sagitta ≈ 1 − cos(11.7°) ≈ 0.02
    expect(area).toBeGreaterThanOrEqual(Math.PI * (dmin * dmin - k * k));
    expect(area).toBeLessThanOrEqual(Math.PI * (1 - k * k));
    // Relative to the smooth disc the deficit is bounded by 1 − (d_min² − k²)/(1 − k²) < 6%.
    expect(Math.abs(area / (Math.PI * (1 - k * k)) - 1)).toBeLessThan(1 - (dmin * dmin - k * k) / (1 - k * k));
    for (const orientation of [1, -1] as const) {
      const tri = triangulateSection(loops, n, orientation);
      expectOriented(tri, n, orientation);
      expect(mesh3Area(tri)).toBeCloseTo(area, 10);
    }
  });

  it('uvSphere at the equator (through a ring of vertices) is the exact W-gon', () => {
    const W = 24;
    const mesh = uvSphere(1, W, 10); // H even: the ring θ = 90° lies in z = 0
    const { loops } = planarSection(mesh, [0, 0, 1], 0);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(W);
    expect(sectionArea(loops)).toBeCloseTo(polygonArea(W, 1), 12);
  });

  it('cylinder sections: the n-gon across the axis and the exact 2r × h rectangle along it', () => {
    const mesh = cylinder(0.5, 2, 16);
    const across = planarSection(mesh, [0, 0, 1], 0.25);
    expect(across.loops.length).toBe(1);
    expect(sectionArea(across.loops)).toBeCloseTo(polygonArea(16, 0.5), 12);
    // y = 0 contains the ring vertices at φ = 0 and φ = π and both centres.
    const along = planarSection(mesh, [0, 1, 0], 0);
    expect(along.loops.length).toBe(1);
    expect(sectionArea(along.loops)).toBeCloseTo(2 * 0.5 * 2, 12);
    const tri = triangulateSection(along.loops, [0, 1, 0], -1);
    expectOriented(tri, [0, 1, 0], -1);
    expect(mesh3Area(tri)).toBeCloseTo(2, 12);
  });

  it('an open mesh yields no closed loops', () => {
    const tri: Mesh3 = { positions: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], triangles: [[0, 1, 2]] };
    expect(planarSection(tri, [1, 0, 0], 0).loops).toEqual([]);
    expect(() => planarSection(tri, [0, 0, 0], 0)).toThrow();
  });
});

describe('2D helpers, nesting and sectionArea', () => {
  it('planeBasis is orthonormal with u × v = n', () => {
    for (const n of [[0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 1, 1], [0.3, -0.2, 0.9], [-1, 0, 0]] as Vec3[]) {
      const [u, v] = planeBasis(n);
      const nn = normalize3(n);
      expect(length3(u)).toBeCloseTo(1, 12);
      expect(length3(v)).toBeCloseTo(1, 12);
      expect(dot3(u, v)).toBeCloseTo(0, 12);
      expect(dot3(u, nn)).toBeCloseTo(0, 12);
      const w = cross3(u, v);
      for (let k = 0; k < 3; k++) expect(w[k]).toBeCloseTo(nn[k], 12);
    }
  });

  it('signedArea2 and pointInPolygon2', () => {
    const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(signedArea2(sq)).toBe(4);
    expect(signedArea2([...sq].reverse())).toBe(-4);
    expect(pointInPolygon2([1, 1], sq)).toBe(true);
    expect(pointInPolygon2([3, 1], sq)).toBe(false);
    expect(pointInPolygon2([-1, 1], sq)).toBe(false);
  });

  it('nested loops: outer, hole, island in the hole → two groups, area 16 − 4 + 1', () => {
    const square = (s: number, ccw: boolean): Vec3[] => {
      const h = s / 2;
      const pts: Vec3[] = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
      return ccw ? pts : pts.reverse();
    };
    const loops = [square(4, true), square(2, false), square(1, true)];
    const n: Vec3 = [0, 0, 1];
    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis(n))));
    expect(groups.length).toBe(2);
    const outer = groups.find((g) => g.outer === 0);
    const island = groups.find((g) => g.outer === 2);
    expect(outer?.holes).toEqual([1]);
    expect(outer?.depth).toBe(0);
    expect(island?.holes).toEqual([]);
    expect(island?.depth).toBe(2);
    expect(sectionArea(loops)).toBeCloseTo(13, 12);
    expect(sectionArea(loops, n)).toBeCloseTo(13, 12);
    // Area does not depend on how the loops are wound.
    expect(sectionArea(loops.map((l) => [...l].reverse()))).toBeCloseTo(13, 12);
    for (const orientation of [1, -1] as const) {
      const tri = triangulateSection(loops, n, orientation);
      expectOriented(tri, n, orientation);
      expect(mesh3Area(tri)).toBeCloseTo(13, 12);
      expect(tri.positions.length).toBe(12);
    }
    expect(sectionArea([])).toBe(0);
  });
});
