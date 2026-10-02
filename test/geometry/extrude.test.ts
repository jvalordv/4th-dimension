import { describe, expect, it } from 'vitest';
import { box, icosphere, mesh3Edges, mesh3Volume, torus, translateMesh3, cylinder } from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import {
  conformTriangulationToLoops, dedupeLoop, extrude, extrudeShape, loopCorners, triangulateLoopsConforming,
} from '../../src/geometry/extrude';
import { compound, CompoundShape } from '../../src/geometry/compound';
import { hyperplane, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { hypervolumeByCones, signedHypervolume, validateTetComplex } from '../../src/geometry/tets';
import { sliceTets } from '../../src/geometry/slice';
import { analyseSlice, emptyMesh, signedVolume, triangleCount } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { groupLoops, planarSection, planeBasis, projectLoop, sectionArea } from '../../src/geometry/section';
import { cross3, dot3, dot4, normalize4, sub3 } from '../../src/math/vec';
import { tesseractFixture } from '../core/tesseract-fixture';
import type { Hyperplane, Shape4, Vec3, Vec4 } from '../../src/math/types';

// Deterministic pseudo-random for reproducible "random" directions (same generator as test/core).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

/** |a/b − 1|: relative error, for Float32 slice output (~6e-8 per coordinate) compared with exact values. */
const relErr = (a: number, b: number): number => Math.abs(a / b - 1);

/** Area of the regular n-gon inscribed in the unit circle, over π. */
const polygonRatio = (n: number): number => (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);

/**
 * ∫∫ ρ dρ dz over a counter-clockwise polygon in the (ρ, z) half-plane by
 * Green's theorem, ∫∫ ρ dρ dz = ∮ (ρ²/2) dz, with the edge integral of a
 * linearly parametrised edge (ρ₀,z₀) → (ρ₁,z₁) equal to
 * (z₁ − z₀) · ∫₀¹ (ρ₀ + s(ρ₁ − ρ₀))²/2 ds = (z₁ − z₀)(ρ₀² + ρ₀ρ₁ + ρ₁²)/6.
 */
function rhoMoment(poly: readonly [number, number][]): number {
  let m = 0;
  for (let i = 0; i < poly.length; i++) {
    const [r0, z0] = poly[i];
    const [r1, z1] = poly[(i + 1) % poly.length];
    m += (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1) / 6;
  }
  return m;
}

/** Sutherland–Hodgman clip of a convex polygon to the strip |z| ≤ a. */
function clipToStrip(poly: readonly [number, number][], a: number): [number, number][] {
  let out: [number, number][] = [...poly];
  for (const [sign, bound] of [[1, a], [-1, a]] as const) {
    // Keep the half-plane sign·z ≤ bound.
    const inside = (p: [number, number]): boolean => sign * p[1] <= bound;
    const next: [number, number][] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) next.push(p);
      if (pin !== qin) {
        const t = (bound - sign * p[1]) / (sign * (q[1] - p[1]));
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    out = next;
  }
  return out;
}

/** Cross-section polygon of torus(R, r, ·, n) in the (ρ, z) half-plane: (R + r cos v_j, r sin v_j), counter-clockwise. */
const torusProfile = (R: number, r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, j) => [R + r * Math.cos((2 * Math.PI * j) / n), r * Math.sin((2 * Math.PI * j) / n)]);

/** Undirected edges of a Mesh3 used by exactly one triangle, as sorted-pair keys. */
function boundaryEdgeKeys(mesh: Mesh3): Set<string> {
  const count = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles) {
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return new Set([...count].filter(([, n]) => n === 1).map(([k]) => k));
}

/** The loop edges of a concatenated loop list as sorted-pair keys over the concatenated indices. */
function loopEdgeKeys(loops: readonly (readonly Vec3[])[]): Set<string> {
  const keys = new Set<string>();
  let offset = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = offset + i;
      const b = offset + ((i + 1) % loop.length);
      keys.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
    offset += loop.length;
  }
  return keys;
}

/** Every triangle normal has the sign of `orientation` along n. */
function expectOriented(mesh: Mesh3, n: Vec3, orientation: 1 | -1): void {
  for (const [a, b, c] of mesh.triangles) {
    const cr = cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a]));
    expect(Math.sign(dot3(cr, n))).toBe(orientation);
  }
}

describe('extrude(box) is the tesseract (MATH.md §9.1, §8.4)', () => {
  const cube = box(2, 2, 2); // [-1, 1]³: 8 vertices, 12 triangles, 18 edges
  const tess = extrude(cube, 1, 'tesseract');
  const { positions, tets } = tess.complex;

  it('has the 16 vertices (±1)⁴ and 36 outward lateral tets whose only open faces are the 24 cap triangles', () => {
    expect(tess.kind).toBe('lifted');
    expect(tess.name).toBe('tesseract');
    expect(positions.length).toBe(16);
    const corners = new Set(positions.map((p) => p.map(Math.sign).join(',')));
    expect(corners.size).toBe(16);
    for (const p of positions) for (const v of p) expect(Math.abs(v)).toBe(1);
    // Three tets per prism, one prism per triangle.
    expect(tets.length).toBe(3 * 12);
    const v = validateTetComplex(positions, tets);
    expect(v.inconsistentFaces).toBe(0);
    expect(v.nonManifoldFaces).toBe(0);
    expect(v.degenerateTets).toBe(0);
    // The caps are not tetrahedralised: the 12 triangles at each level are
    // faces of one tet only, 2 × 12 = 24 boundary faces. Every other face is
    // shared by two tets: 36 × 4 = 144 face incidences, 24 single, so
    // 24 + (144 − 24)/2 = 84 faces in all.
    expect(v.boundaryFaces).toBe(2 * cube.triangles.length);
    expect(v.faceCount).toBe(84);
    expect(v.errors).toEqual(['24 faces belong to only one tet (boundary not closed)']);
    // Outwardness (§5.1, §7): the cone from the origin over a cubic cell of
    // volume 8 at distance 1 has 4-volume 8·1/4 = 2; the six lateral cells
    // give 12, and the signed sum equals the unsigned one only when every
    // tet is outward oriented. The tesseract's 16 is reached with the two
    // caps, which contribute the missing 2 + 2.
    expect(hypervolumeByCones(positions, tets)).toBeCloseTo(12, 10);
    expect(signedHypervolume(positions, tets)).toBeCloseTo(12, 10);
  });

  it('slices are the cube, octahedron and square prism of §8.4, closed with Euler characteristic 2', () => {
    // Tolerance: slice positions are Float32 (relative 6e-8), so volumes of
    // order 10 are exact to ~1e-6; five decimals (5e-6) leaves a margin.
    const cases: Array<{ h: Hyperplane; volume: number; what: string }> = [
      { h: hyperplaneW(0.3), volume: 8, what: 'cube of side 2' },
      { h: hyperplane([1, 1, 1, 1], 0), volume: 32 / 3, what: 'regular octahedron' },
      { h: hyperplane([1, 1, 0, 0], 0), volume: 8 * Math.SQRT2, what: 'square prism' },
    ];
    for (const { h, volume } of cases) {
      const a = analyseSlice(tess.slice(h));
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expect(a.volume).toBeCloseTo(volume, 5);
    }
  });

  it('slice at w = +1 is the cube and at w = −1 empty: the limit from below of §6', () => {
    const top = analyseSlice(tess.slice(hyperplaneW(1)), 1e-5);
    expect(top.closed).toBe(true);
    expect(top.volume).toBeCloseTo(8, 4);
    expect(triangleCount(tess.slice(hyperplaneW(-1)))).toBe(0);
    // The caps' outward normal ±e_w projects to zero into w = c, so no cap
    // triangles are emitted and the lateral tets alone give the result.
    expect(triangleCount(tess.slice(hyperplaneW(0.3)))).toBe(triangleCount(sliceTets(positions, tets, hyperplaneW(0.3))));
  });

  it('agrees slice for slice with the independently built tesseract fixture', () => {
    // The fixture cones each cell from its centroid (96 tets, caps included);
    // the extrusion uses 36 lateral tets plus planar cap sections. Both are
    // the same solid, so every slice has the same volume.
    const fixture = tesseractFixture();
    const r = rng(21);
    for (let i = 0; i < 4; i++) {
      const h = hyperplane(randUnit4(r), (r() - 0.5) * 2);
      const a = analyseSlice(tess.slice(h));
      const b = analyseSlice(sliceTets(fixture.positions, fixture.tets, h));
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.volume).toBeCloseTo(b.volume, 5);
    }
  });

  it('slice volume integrates to the hypervolume 16 along random directions (§7)', () => {
    // Midpoint rule over [−R, R] with R = radius() = 2 and 200 steps: A(c) is
    // piecewise polynomial with kinks, so the error is O(dc²) ~ 1e-4 relative;
    // the 1% bound asked for is loose by two orders of magnitude.
    expect(tess.radius()).toBeCloseTo(2, 12);
    const r = rng(5);
    for (let i = 0; i < 3; i++) expect(relErr(sliceVolumeIntegral(tess, randUnit4(r)), 16)).toBeLessThan(0.01);
    // Along e_w every sample in (−1, 1) is the cube (volume 8) and the 400
    // midpoints −2 + (i + ½)/100 never hit ±1: exactly 200 samples × 8 × 0.01.
    expect(sliceVolumeIntegral(tess, [0, 0, 0, 1], 400)).toBeCloseTo(16, 5);
  });

  it('wire: 16 vertices, 44 edges and 42 faces, versus the tesseract\'s 32 edges and 24 squares', () => {
    // MATH.md §9.1: edges of M at both levels plus one per vertex; faces:
    // triangles of M at both levels plus one quad per edge of M. The box
    // mesh has 18 edges (12 cube edges + 6 face diagonals) and 12 triangles:
    //   edges 2 × 18 + 8 = 44, faces 2 × 12 + 18 = 42.
    // The tesseract (§8) has 32 edges and 24 squares. The 12 extra edges are
    // the 6 face diagonals at both levels. Of the 18 quads, 12 stand over
    // true cube edges and are tesseract squares; the 6 over diagonals are
    // 2 × 2√2 rectangles cutting the lateral cells. The remaining 12 tesseract
    // squares are the cube faces at both levels, here drawn as 24 triangles.
    const w = tess.wire();
    expect(mesh3Edges(cube).length).toBe(18);
    expect(w.positions.length).toBe(16);
    expect(w.edges.length).toBe(44);
    expect(w.faces.length).toBe(42);
    expect(w.faces.filter((f) => f.length === 3).length).toBe(24);
    const quads = w.faces.filter((f) => f.length === 4);
    expect(quads.length).toBe(18);
    const len = (i: number, j: number): number => Math.hypot(...w.positions[i].map((v, k) => v - w.positions[j][k]));
    // 32 edges of length 2 are the tesseract's own; 12 have length 2√2.
    expect(w.edges.filter(([i, j]) => Math.abs(len(i, j) - 2) < 1e-12).length).toBe(32);
    expect(w.edges.filter(([i, j]) => Math.abs(len(i, j) - 2 * Math.SQRT2) < 1e-12).length).toBe(12);
    const isSquare = (f: number[]): boolean => f.every((v, k) => Math.abs(len(v, f[(k + 1) % 4]) - 2) < 1e-12);
    expect(quads.filter(isSquare).length).toBe(12);
    for (const [i, j] of w.edges) { expect(i).not.toBe(j); expect(Math.max(i, j)).toBeLessThan(16); }
    for (const f of w.faces) for (const i of f) expect(i).toBeLessThan(16);
    expect(new Set(w.edges.map(([i, j]) => `${Math.min(i, j)},${Math.max(i, j)}`)).size).toBe(44);
    expect(tess.wire()).toBe(w); // cached
    expect(tess.wRange()).toEqual([-1, 1]);
    expect(extrudeShape(cube, 1, 'tess').kind).toBe('lifted');
    expect(() => extrude(cube, 0, 'bad')).toThrow();
  });
});

describe('extruded icosphere', () => {
  const ball = icosphere(1, 2); // 320 triangles, convex
  const h = 0.7;
  const shape = extrude(ball, h, 'spherinder');

  it('tilted slices through the centre are closed spheres and the slice integral is vol(S) · 2h', () => {
    // For n_w ≠ 0 the slice is an affine image of S clipped between two
    // parallel planes (§9.1); S is convex, so the slice is convex: a
    // topological ball with Euler characteristic 2. The 4-volume is
    // vol(S) · 2h (Cavalieri along w), and §7 makes the slice integral equal
    // it in every direction; 200 midpoint steps of a smooth A(c) are far
    // more accurate than the 1% asked for.
    const expected = mesh3Volume(ball) * 2 * h;
    const r = rng(8);
    for (let i = 0; i < 3; i++) {
      const n = randUnit4(r);
      const a = analyseSlice(shape.slice(hyperplane(n, 0)));
      expect(a.triangles).toBeGreaterThan(0);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expect(relErr(sliceVolumeIntegral(shape, n), expected)).toBeLessThan(0.01);
    }
  });

  it('a slab that contains all of S gives volume vol(S) / |n_w| exactly', () => {
    // The slice is {(q, w(q)) : q ∈ S, |w(q)| ≤ h} with w(q) = (c − n_xyz·q)/n_w.
    // The map q ↦ (q, w(q)) has Gram determinant 1 + |n_xyz|²/n_w² = 1/n_w²,
    // so the chart volume is vol(S ∩ slab)/|n_w|. With n ∝ (0.1, 0.2, 0.1, 1)
    // and c = 0, |n_xyz·q| ≤ √0.06 < 0.7 = h·n_w (unnormalised), so the slab
    // holds all of S and the volume is vol(S) · √1.06. The e_w slice is S itself.
    const n: Vec4 = [0.1, 0.2, 0.1, 1];
    const a = analyseSlice(shape.slice(hyperplane(n, 0)));
    expect(a.closed).toBe(true);
    expect(a.euler).toBe(2);
    expect(relErr(a.volume, mesh3Volume(ball) * Math.sqrt(1.06))).toBeLessThan(1e-5);
    const b = analyseSlice(shape.slice(hyperplaneW(0.2)));
    expect(b.closed).toBe(true);
    expect(relErr(b.volume, mesh3Volume(ball))).toBeLessThan(1e-6);
    expect(shape.radius()).toBeCloseTo(Math.hypot(1, h), 12);
  });
});

describe('extruded torus', () => {
  const R = 1;
  const r = 0.4;
  const m = 32;
  const nSeg = 16;
  const ring = torus(R, r, m, nSeg);

  it('n = (1,0,0,1)/√2 with a slab containing the torus: closed, Euler 0, volume √2 · vol(S)', () => {
    // In H: (x + w)/√2 = 0, so w = −x and the slice is {q ∈ S : |x| ≤ h}
    // (an affine image, factor 1/|n_w| = √2). With h = 1.5 ≥ R + r = 1.4 the
    // slab contains the whole solid torus: genus 1, χ = 0.
    const shape = extrude(ring, 1.5, 'torus prism');
    const a = analyseSlice(shape.slice(hyperplane([1, 0, 0, 1], 0)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(0);
    expect(relErr(a.volume, Math.SQRT2 * mesh3Volume(ring))).toBeLessThan(1e-5);
  });

  it('n = (0,0,1,1)/√2 with h < r: the cap sections are annuli with a hole, the slice a closed solid torus', () => {
    const h = 0.3;
    const shape = extrude(ring, h, 'thin torus prism');
    // The cap at w₀ = +h meets H where z = −h (and the cap at −h where z = +h):
    // a plane cutting the tube, whose section is an annulus (outer loop + hole).
    const { loops } = planarSection(ring, [0, 0, 1], -h);
    expect(loops.length).toBe(2);
    const groups = groupLoops(loops.map((l) => projectLoop(l, planeBasis([0, 0, 1]))));
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);
    const a = analyseSlice(shape.slice(hyperplane([0, 0, 1, 1], 0)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    // The slice is S ∩ {|z| ≤ h} (factor √2): a solid torus with its top and
    // bottom shaved off is still a solid torus, χ = 0.
    expect(a.euler).toBe(0);
    // Exact volume. The mesh is a surface of revolution with m angular steps
    // of the profile polygon P (vertices (R + r cos v_j, r sin v_j)); between
    // consecutive half-planes the lateral quads are planar trapezoids and the
    // slab is the image of P × [0, 1] under (ρ, z, t) ↦ ρ f(t) + z ẑ with
    // f(t) = (1 − t) e(u_i) + t e(u_{i+1}), whose Jacobian is ρ sin(2π/m).
    // z is untouched, so vol(S ∩ {|z| ≤ h}) = m sin(2π/m) ∫∫_{P ∩ |z| ≤ h} ρ dρ dz.
    // (Sanity: the unclipped moment is R · area(P), reproducing mesh3Volume.)
    const profile = torusProfile(R, r, nSeg);
    const full = m * Math.sin((2 * Math.PI) / m) * rhoMoment(profile);
    expect(full).toBeCloseTo(mesh3Volume(ring), 12);
    expect(rhoMoment(profile)).toBeCloseTo(R * (nSeg / 2) * r * r * Math.sin((2 * Math.PI) / nSeg), 12);
    const clipped = m * Math.sin((2 * Math.PI) / m) * rhoMoment(clipToStrip(profile, h));
    expect(clipped).toBeLessThan(full);
    expect(relErr(a.volume, Math.SQRT2 * clipped)).toBeLessThan(1e-5);
  });

  it('n = e_x (n_w = 0): the slice is the prism over the planar section, volume = area × 2h, two components', () => {
    const h = 0.6;
    const shape = extrude(ring, h, 'torus prism');
    // x = 0.2 < R − r passes through the hole and cuts the tube twice: two
    // outer loops, two groups. The slice is section × [−h, h], volume
    // sectionArea · 2h, and two solid cylinders have χ = 2 + 2 = 4.
    const { loops } = planarSection(ring, [1, 0, 0], 0.2);
    expect(loops.length).toBe(2);
    expect(groupLoops(loops.map((l) => projectLoop(l, planeBasis([1, 0, 0])))).every((g) => g.holes.length === 0)).toBe(true);
    const a = analyseSlice(shape.slice(hyperplane([1, 0, 0, 0], 0.2)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(4);
    expect(relErr(a.volume, sectionArea(loops) * 2 * h)).toBeLessThan(1e-5);
    expect(shape.wRange()).toEqual([-h, h]);
    expect(shape.radius()).toBeCloseTo(Math.hypot(R + r, h), 12);
  });
});

describe('cap triangulation helpers', () => {
  // Hexagon A m₁ B m₂ C m₃ in z = 0 with m_k the exact midpoints: three
  // corners, three collinear points.
  const A: Vec3 = [-1, 1, 0];
  const B: Vec3 = [1, -1, 0];
  const C: Vec3 = [1, 1, 0];
  const mid = (p: Vec3, q: Vec3): Vec3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const hexagon: Vec3[] = [A, mid(A, B), B, mid(B, C), C, mid(C, A)];

  it('dedupeLoop merges clusters, including across the wrap-around', () => {
    const loop: Vec3[] = [[0, 0, 0], [1e-9, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1 + 1e-9, 0], [0, 1, 0], [1e-9, 1e-9, 0]];
    expect(dedupeLoop(loop, 1e-7)).toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    expect(dedupeLoop(loop, 0).length).toBe(7);
  });

  it('loopCorners keeps exactly the corners and reports none for a flat loop', () => {
    expect(loopCorners(hexagon, 1e-7).sort((a, b) => a - b)).toEqual([0, 2, 4]);
    // A square with 10 points per side.
    const sq: Vec3[] = [];
    for (const [p, q] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]] as [number, number][][]) {
      for (let k = 0; k < 10; k++) sq.push([p[0] + (q[0] - p[0]) * k / 10, p[1] + (q[1] - p[1]) * k / 10, 0]);
    }
    expect(loopCorners(sq, 1e-7).sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
    expect(loopCorners([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], 1e-7)).toEqual([]);
    // A point 2e-7 off the chord is a corner at tolerance 1e-7 and not at 1e-6.
    const bump: Vec3[] = [[0, 0, 0], [0.5, 2e-7, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    expect(loopCorners(bump, 1e-7).length).toBe(5);
    expect(loopCorners(bump, 1e-6).length).toBe(4);
  });

  it('conformTriangulationToLoops re-inserts the midpoints with the parent\'s orientation', () => {
    const one: Mesh3 = { positions: hexagon.map((p) => [...p] as Vec3), triangles: [[0, 2, 4]] };
    const tris = conformTriangulationToLoops(one, [hexagon]);
    // A hexagon triangulates into 6 − 2 = 4 triangles.
    expect(tris.length).toBe(4);
    const mesh: Mesh3 = { positions: one.positions, triangles: tris };
    expect(boundaryEdgeKeys(mesh)).toEqual(loopEdgeKeys([hexagon]));
    // (A, B, C) runs counter-clockwise about +z (A→B→C: (2,−2,0)×(0,2,0) = +4 z), as must every piece.
    expectOriented(mesh, [0, 0, 1], 1);
    // Total area is that of the triangle: ½ |AB × AC| = ½ · 4 = 2.
    let area = 0;
    for (const [a, b, c] of tris) area += Math.hypot(...cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a]))) / 2;
    expect(area).toBeCloseTo(2, 12);
    // Already-complete triangulations are returned as they are.
    expect(conformTriangulationToLoops({ positions: one.positions, triangles: tris }, [hexagon])).toBe(tris);
  });

  it('triangulateLoopsConforming matches a cylinder section with collinear fan-centre points, both orientations', () => {
    // x = 0 cuts cylinder(1, 2, 8) through the rim vertices at φ = 90°, 270°
    // and both cap centres: the loop is a 2 × 2 rectangle with collinear
    // points on the caps' fan edges. Area 4; every loop edge is a boundary
    // edge of the triangulation and nothing else is.
    const cyl = cylinder(1, 2, 8);
    const { loops } = planarSection(cyl, [1, 0, 0], 0);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBeGreaterThan(4);
    for (const orientation of [1, -1] as const) {
      const tri = triangulateLoopsConforming(loops, [1, 0, 0], orientation);
      expect(tri.positions.length).toBe(loops[0].length);
      expect(tri.triangles.length).toBe(loops[0].length - 2);
      expect(boundaryEdgeKeys(tri)).toEqual(loopEdgeKeys(loops));
      expectOriented(tri, [1, 0, 0], orientation);
      let area = 0;
      for (const [a, b, c] of tri.triangles) area += Math.hypot(...cross3(sub3(tri.positions[b], tri.positions[a]), sub3(tri.positions[c], tri.positions[a]))) / 2;
      expect(area).toBeCloseTo(4, 12);
    }
    expect(triangulateLoopsConforming([], [1, 0, 0], 1).triangles).toEqual([]);
  });
});

describe('compound shapes', () => {
  const a = extrude(box(2, 2, 2), 1, 'A');
  const b = extrude(translateMesh3(box(1, 1, 1), [3, 0, 0]), 0.5, 'B');
  const both = compound('pair', [a, b]);

  it('concatenates wires with index offsets, takes the largest radius and the union of w ranges', () => {
    expect(both).toBeInstanceOf(CompoundShape);
    expect(both.kind).toBe('compound');
    expect(both.name).toBe('pair');
    expect(both.parts.length).toBe(2);
    expect(both.parts[0]).toBe(a);
    expect(both.parts[1]).toBe(b);
    const w = both.wire();
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.positions.length).toBe(32);
    expect(w.edges.length).toBe(44 + 44);
    expect(w.faces.length).toBe(42 + 42);
    // Second part's indices are shifted by the first part's 16 vertices.
    for (const [i, j] of w.edges.slice(44)) { expect(Math.min(i, j)).toBeGreaterThanOrEqual(16); expect(Math.max(i, j)).toBeLessThan(32); }
    for (const f of w.faces.slice(42)) for (const i of f) { expect(i).toBeGreaterThanOrEqual(16); expect(i).toBeLessThan(32); }
    expect(w.positions[16]).toEqual(b.wire().positions[0]);
    // B's farthest vertex is (3.5, ±0.5, ±0.5, ±0.5): |p|² = 12.25 + 0.75 = 13 > 2² of A.
    expect(both.radius()).toBeCloseTo(Math.sqrt(13), 12);
    expect(both.wRange()).toEqual([-1, 1]);
    expect(both.wire()).toBe(w); // cached
  });

  it('slices are the merged part slices: volume 8 + 1 at w = 0, two closed components', () => {
    const sl = both.slice(hyperplaneW(0));
    expect(triangleCount(sl)).toBe(triangleCount(a.slice(hyperplaneW(0))) + triangleCount(b.slice(hyperplaneW(0))));
    const an = analyseSlice(sl);
    expect(an.closed).toBe(true);
    expect(an.consistent).toBe(true);
    expect(an.euler).toBe(4); // two spheres
    expect(an.volume).toBeCloseTo(9, 5);
    // B spans w ∈ [−0.5, 0.5], so at w = 0.75 only A (volume 8) is cut.
    expect(signedVolume(both.slice(hyperplaneW(0.75)))).toBeCloseTo(8, 5);
  });

  it('skips parts without a wire and handles the empty compound', () => {
    const noWire: Shape4 = {
      name: 'ghost', kind: 'sdf',
      wire: () => null,
      slice: () => emptyMesh(),
      radius: () => 5,
      wRange: () => [-3, 0.25],
    };
    const mixed = compound('mixed', [noWire, a]);
    const w = mixed.wire();
    expect(w?.positions.length).toBe(16);
    expect(w?.edges.length).toBe(44);
    expect(mixed.radius()).toBe(5);
    expect(mixed.wRange()).toEqual([-3, 1]);
    expect(compound('ghosts', [noWire]).wire()).toBeNull();
    const empty = compound('empty', []);
    expect(empty.wire()).toBeNull();
    expect(empty.radius()).toBe(0);
    expect(empty.wRange()).toEqual([0, 0]);
    expect(triangleCount(empty.slice(hyperplaneW(0)))).toBe(0);
  });
});

describe('random hyperplanes through extruded solids', () => {
  it('every slice of an extruded torus or box is closed and consistent, including planes through vertices', () => {
    // Planes through mesh vertices at a cap level exercise the §6
    // perturbation shared by the lateral slice and the cap sections.
    const shapes = [extrude(torus(1, 0.4, 24, 12), 0.3, 't'), extrude(box(2, 2, 2), 1, 'b'), extrude(cylinder(1, 2, 16), 1, 'c')];
    const axisNormals: Vec4[] = [[1, 0, 0, 0], [0, 0, 1, 0], [1, 1, 1, 1], [1, 0, 0, 1], [0, 0, 1, 1], [1, 1, 0, 0]];
    const r = rng(13);
    for (const shape of shapes) {
      for (let i = 0; i < 8; i++) {
        const n = randUnit4(r);
        const an = analyseSlice(shape.slice(hyperplane(n, (r() - 0.5) * shape.radius())));
        if (an.triangles === 0) continue;
        expect(an.closed).toBe(true);
        expect(an.consistent).toBe(true);
        expect(an.volume).toBeGreaterThan(0);
      }
      for (const n of axisNormals) {
        for (const c of [0, 0.1, -0.25, shape.halfHeight * Math.abs(normalize4(n)[3])]) {
          const an = analyseSlice(shape.slice(hyperplane(n, c)));
          if (an.triangles === 0) continue;
          expect(an.closed).toBe(true);
          expect(an.consistent).toBe(true);
          expect(an.volume).toBeGreaterThan(0);
        }
      }
    }
  });

  it('cap vertices carry sourceW = ±h and lateral vertices interpolate (§10)', () => {
    const shape = extrude(box(2, 2, 2), 0.5, 'b');
    const h = hyperplane([1, 1, 1, 1], 0.2);
    const sl = shape.slice(h);
    let caps = 0;
    for (let i = 0; i < sl.sourceW.length; i++) {
      const w = sl.sourceW[i];
      expect(Math.abs(w)).toBeLessThanOrEqual(0.5 + 1e-6);
      if (Math.abs(Math.abs(w) - 0.5) < 1e-6) caps++;
      // sourceW is the w coordinate of the vertex's 4D point, which lies in h
      // (up to the Float32 output and the §6 nudge of ~1e-10).
      const p = unchart(h, [sl.positions[3 * i], sl.positions[3 * i + 1], sl.positions[3 * i + 2]]);
      expect(dot4(h.normal, p)).toBeCloseTo(h.offset, 6);
      expect(p[3]).toBeCloseTo(w, 5);
    }
    expect(caps).toBeGreaterThan(0);
  });
});
