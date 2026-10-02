import { describe, expect, it } from 'vitest';
import {
  box, capsule, cylinder, flipMesh3, icosphere, mesh3Area, mesh3Bounds, mesh3Edges, mesh3Volume,
  scaleMesh3, torus, torusKnot, torusKnotCurve, transformMesh3, translateMesh3, uvSphere, validateMesh3, weldMesh3,
} from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from '../../src/math/vec';
import type { Vec3 } from '../../src/math/types';

/**
 * Area of the regular n-gon inscribed in the unit circle, over π:
 * n triangles of area ½ sin(2π/n) give (n/2) sin(2π/n), divided by π.
 */
const polygonRatio = (n: number): number => (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);

/**
 * Exact volume of uvSphere(r, W, H) (derivation). The mesh is a surface of
 * revolution of the meridian polygon with W equal angular steps Δ = 2π/W.
 * Between two consecutive half-planes the lateral quads are planar (both
 * chords of a quad are perpendicular to the bisecting half-plane), and with
 * the origin on the axis the end polygons contribute nothing to
 * Σ v0·(v1×v2)/6, so one slab's volume is
 *   sin Δ · (1/6) Σ_edges (ρ_j + ρ_{j+1})(ρ_j z_{j+1} − ρ_{j+1} z_j)
 *   = sin Δ · ∫∫_polygon ρ dρ dz      (Green's theorem, polygon counter-clockwise)
 * i.e. Pappus with 2π replaced by W sin(2π/W). For the meridian polygon with
 * vertices (r sin θ_k, r cos θ_k), θ_k = kπ/H, the edge terms are
 * r³ (sin θ_k + sin θ_{k+1}) sin(π/H), and Σ_{k=1}^{H−1} sin(kπ/H) = cot(π/2H), so
 *   ∫∫ ρ dρ dz = (r³/3) sin(π/H) cot(π/2H) = (2r³/3) cos²(π/2H)
 * (→ 2r³/3, the half-disc value, as H → ∞). Hence
 *   V = W sin(2π/W) · (2r³/3) cos²(π/2H) = (4/3)π r³ · polygonRatio(W) · cos²(π/2H).
 */
const uvSphereVolume = (r: number, W: number, H: number): number =>
  (4 / 3) * Math.PI * r ** 3 * polygonRatio(W) * Math.cos(Math.PI / (2 * H)) ** 2;

/** Cylinder: polygon area × height = π r² h · polygonRatio(n). */
const cylinderVolume = (r: number, h: number, n: number): number => Math.PI * r * r * h * polygonRatio(n);

/**
 * Torus: same slab argument with the cross-section a regular n-gon of
 * circumradius r whose centroid is at distance R from the axis, so
 * ∫∫ ρ dρ dz = R · (n/2) r² sin(2π/n) and
 *   V = m sin(2π/m) · R · (n/2) r² sin(2π/n) = 2π² R r² · polygonRatio(m) · polygonRatio(n).
 */
const torusVolume = (R: number, r: number, m: number, n: number): number =>
  2 * Math.PI ** 2 * R * r * r * polygonRatio(m) * polygonRatio(n);

const centroid = (mesh: Mesh3, t: readonly [number, number, number]): Vec3 =>
  scale3(add3(add3(mesh.positions[t[0]], mesh.positions[t[1]]), mesh.positions[t[2]]), 1 / 3);

const triangleNormal = (mesh: Mesh3, t: readonly [number, number, number]): Vec3 =>
  cross3(sub3(mesh.positions[t[1]], mesh.positions[t[0]]), sub3(mesh.positions[t[2]], mesh.positions[t[0]]));

/** Minimum over triangles of the distance from the origin to the triangle's plane. */
function minPlaneDistance(mesh: Mesh3): number {
  let d = Infinity;
  for (const t of mesh.triangles) {
    d = Math.min(d, Math.abs(dot3(normalize3(triangleNormal(mesh, t)), mesh.positions[t[0]])));
  }
  return d;
}

/** Length of the (p, q) knot by a fine chordal polyline (error O(1/S²), ~1e-9 relative here). */
function knotLength(R: number, p: number, q: number, S = 20000): number {
  let L = 0;
  let prev = torusKnotCurve(R, p, q, 0).point;
  for (let i = 1; i <= S; i++) {
    const { point } = torusKnotCurve(R, p, q, (2 * Math.PI * i) / S);
    L += length3(sub3(point, prev));
    prev = point;
  }
  return L;
}

describe('generators are closed, consistently oriented meshes', () => {
  // V, F from the constructions; E = 3F/2 for a closed triangle mesh; χ = V − E + F.
  const cases: Array<{ name: string; mesh: Mesh3; V: number; F: number; euler: number }> = [
    { name: 'box', mesh: box(1, 2, 3), V: 8, F: 12, euler: 2 },
    // uvSphere: 2 poles + (H−1) rings of W; W fan triangles per pole + 2W per band.
    { name: 'uvSphere 24×12', mesh: uvSphere(1, 24, 12), V: 2 + 11 * 24, F: 2 * 24 * 11, euler: 2 },
    { name: 'uvSphere 3×2 (triangular bipyramid)', mesh: uvSphere(0.5, 3, 2), V: 5, F: 6, euler: 2 },
    // icosphere: F = 20·4^L, E = 30·4^L, V = E − F + 2 = 10·4^L + 2.
    { name: 'icosphere 0', mesh: icosphere(1, 0), V: 12, F: 20, euler: 2 },
    { name: 'icosphere 3', mesh: icosphere(2, 3), V: 10 * 64 + 2, F: 20 * 64, euler: 2 },
    // cylinder: two n-rings + two centres; 2n side + 2n cap triangles.
    { name: 'cylinder 16', mesh: cylinder(0.5, 2, 16), V: 34, F: 64, euler: 2 },
    { name: 'cylinder 3', mesh: cylinder(1, 1, 3), V: 8, F: 12, euler: 2 },
    // capsule: 2 poles + 2·Q rings of W; 4·Q·W triangles (see generator doc).
    { name: 'capsule 16×4', mesh: capsule(0.5, 2, 16, 4), V: 2 + 2 * 4 * 16, F: 4 * 4 * 16, euler: 2 },
    { name: 'capsule 5×1', mesh: capsule(1, 0.5, 5, 1), V: 12, F: 20, euler: 2 },
    // torus: m·n vertices, 2 triangles per quad.
    { name: 'torus 24×8', mesh: torus(1, 0.3, 24, 8), V: 192, F: 384, euler: 0 },
    { name: 'torus 3×3', mesh: torus(2, 0.5, 3, 3), V: 9, F: 18, euler: 0 },
    // torusKnot: N·M vertices, 2 triangles per quad, seam re-indexed to ring 0.
    { name: 'torusKnot (2,3) 64×8', mesh: torusKnot(1, 0.15, 2, 3, 64, 8), V: 512, F: 1024, euler: 0 },
    { name: 'torusKnot (3,5) 150×6', mesh: torusKnot(1, 0.08, 3, 5, 150, 6), V: 900, F: 1800, euler: 0 },
    { name: 'torusKnot (2,5) 100×7', mesh: torusKnot(1.5, 0.1, 2, 5, 100, 7), V: 700, F: 1400, euler: 0 },
  ];

  for (const { name, mesh, V, F, euler } of cases) {
    it(`${name}: closed, consistent, χ = ${euler}, V = ${V}, F = ${F}`, () => {
      const v = validateMesh3(mesh);
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.closed).toBe(true);
      expect(v.consistent).toBe(true);
      expect(v.boundaryEdges).toBe(0);
      expect(v.nonManifoldEdges).toBe(0);
      expect(v.inconsistentEdges).toBe(0);
      expect(v.degenerateTriangles).toBe(0);
      expect(mesh.positions.length).toBe(V);
      expect(v.vertexCount).toBe(V);
      expect(v.triangleCount).toBe(F);
      expect(v.edgeCount).toBe((3 * F) / 2);
      expect(mesh3Edges(mesh).length).toBe((3 * F) / 2);
      expect(v.euler).toBe(euler);
      expect(mesh3Volume(mesh)).toBeGreaterThan(0);
    });
  }

  it('convex generators have every triangle normal pointing away from the origin', () => {
    for (const mesh of [box(1, 2, 3), uvSphere(1, 24, 12), icosphere(1, 2), cylinder(0.5, 2, 16), capsule(0.5, 2, 16, 4)]) {
      for (const t of mesh.triangles) expect(dot3(triangleNormal(mesh, t), centroid(mesh, t))).toBeGreaterThan(0);
    }
  });

  it('torus triangle normals point away from the core circle', () => {
    const R = 1;
    const mesh = torus(R, 0.3, 24, 8);
    for (const t of mesh.triangles) {
      const c = centroid(mesh, t);
      const core: Vec3 = scale3([c[0], c[1], 0], R / Math.hypot(c[0], c[1]));
      expect(dot3(triangleNormal(mesh, t), sub3(c, core))).toBeGreaterThan(0);
    }
  });

  it('torusKnot triangle normals point away from the knot (radially to the ring frame)', () => {
    const N = 64;
    const M = 8;
    const mesh = torusKnot(1, 0.15, 2, 3, N, M);
    mesh.triangles.forEach((t) => {
      // Vertex index i·M + j lies on ring i; a triangle spans rings i and i+1
      // (the seam quads use ring 0 for "ring N"). Use the lower ring's centre
      // and tangent, and the component of (centroid − centre) across the tangent.
      const ring = Math.min(...t.map((idx) => Math.floor(idx / M)));
      const { point, tangent } = torusKnotCurve(1, 2, 3, (2 * Math.PI * ring) / N);
      const tn = normalize3(tangent);
      const d = sub3(centroid(mesh, t), point);
      const radial = sub3(d, scale3(tn, dot3(d, tn)));
      expect(dot3(triangleNormal(mesh, t), radial)).toBeGreaterThan(0);
    });
  });

  it('sphere vertices lie on the sphere and uvSphere has no small triangles', () => {
    const uv = uvSphere(1, 24, 12);
    for (const p of uv.positions) expect(length3(p)).toBeCloseTo(1, 12);
    const ico = icosphere(1.5, 2);
    for (const p of ico.positions) expect(length3(p)).toBeCloseTo(1.5, 12);
    // Smallest triangles are the pole fans: ½ ρ₁² sin(2π/W) with ρ₁ = sin(π/H),
    // = ½ · sin²(15°) · sin(15°) ≈ 0.00867 for W = 24, H = 12. Assert well above 0.
    let minArea = Infinity;
    for (const t of uv.triangles) minArea = Math.min(minArea, length3(triangleNormal(uv, t)) / 2);
    expect(minArea).toBeGreaterThan(0.5 * Math.sin(Math.PI / 12) ** 3 * 0.99);
  });

  it('rejects bad parameters', () => {
    expect(() => uvSphere(1, 2, 2)).toThrow();
    expect(() => uvSphere(1, 3, 1)).toThrow();
    expect(() => cylinder(1, 1, 2)).toThrow();
    expect(() => torus(1, 0.5, 2, 3)).toThrow();
    expect(() => torusKnot(1, 0.1, 2, 4, 32, 6)).toThrow(/coprime/);
    expect(() => icosphere(1, -1)).toThrow();
  });
});

describe('volumes (divergence theorem, MATH.md §6)', () => {
  it('box is exact: sx·sy·sz', () => {
    expect(mesh3Volume(box(1, 2, 3))).toBeCloseTo(6, 12);
    expect(mesh3Volume(box(2, 2, 2))).toBeCloseTo(8, 12);
  });

  it('cylinder is exact with the polygon correction (n/2π) sin(2π/n)', () => {
    expect(mesh3Volume(cylinder(0.5, 2, 16))).toBeCloseTo(cylinderVolume(0.5, 2, 16), 12);
    expect(mesh3Volume(cylinder(1, 3, 5))).toBeCloseTo(cylinderVolume(1, 3, 5), 12);
    // n = 4: the square prism of side r√2 has volume 2 r² h.
    expect(mesh3Volume(cylinder(1, 3, 4))).toBeCloseTo(6, 12);
  });

  it('uvSphere equals the derived surface-of-revolution formula and the octahedron special case', () => {
    expect(mesh3Volume(uvSphere(1, 24, 12))).toBeCloseTo(uvSphereVolume(1, 24, 12), 12);
    expect(mesh3Volume(uvSphere(0.7, 9, 5))).toBeCloseTo(uvSphereVolume(0.7, 9, 5), 12);
    // W = 4, H = 2 is the regular octahedron with vertices ±r e_i, volume (4/3) r³.
    expect(mesh3Volume(uvSphere(1.5, 4, 2))).toBeCloseTo((4 / 3) * 1.5 ** 3, 12);
    // Polygonal-ratio argument against the ball: the relative deficit is
    // exactly 1 − polygonRatio(W) cos²(π/2H), 2.8% for 24×12 and 0.2% for 96×48.
    const ball = (4 / 3) * Math.PI;
    expect(1 - mesh3Volume(uvSphere(1, 24, 12)) / ball).toBeCloseTo(1 - polygonRatio(24) * Math.cos(Math.PI / 24) ** 2, 12);
    expect(mesh3Volume(uvSphere(1, 96, 48))).toBeGreaterThan(ball * 0.997);
    expect(mesh3Volume(uvSphere(1, 96, 48))).toBeLessThan(ball);
  });

  it('capsule = cylinder of the straight part + uvSphere with 2·rings height segments', () => {
    // ∫∫ ρ dρ dz is additive over the rectangle and the two cap half-polygons,
    // which together form the meridian polygon of uvSphere(r, W, 2Q).
    expect(mesh3Volume(capsule(0.5, 2, 16, 4))).toBeCloseTo(cylinderVolume(0.5, 2, 16) + uvSphereVolume(0.5, 16, 8), 12);
    expect(mesh3Volume(capsule(1, 0.5, 5, 1))).toBeCloseTo(cylinderVolume(1, 0.5, 5) + uvSphereVolume(1, 5, 2), 12);
    // h = 0 is the sphere itself.
    expect(mesh3Volume(capsule(1, 0, 12, 3))).toBeCloseTo(uvSphereVolume(1, 12, 6), 12);
  });

  it('torus equals 2π²Rr² times both polygon ratios, exactly', () => {
    expect(mesh3Volume(torus(1, 0.3, 24, 8))).toBeCloseTo(torusVolume(1, 0.3, 24, 8), 12);
    expect(mesh3Volume(torus(2, 0.5, 7, 5))).toBeCloseTo(torusVolume(2, 0.5, 7, 5), 12);
    // Against the smooth torus: deficit 1 − polygonRatio(m)·polygonRatio(n) (3.4% for 48×24).
    const smooth = 2 * Math.PI ** 2 * 1 * 0.3 ** 2;
    const v = mesh3Volume(torus(1, 0.3, 48, 24));
    expect(v).toBeLessThan(smooth);
    expect(1 - v / smooth).toBeCloseTo(1 - polygonRatio(48) * polygonRatio(24), 12);
  });

  it('icosphere lies between the inscribed and circumscribed balls and grows with level', () => {
    // Icosahedron of circumradius r: edge a = r / sin(2π/5), volume (5/12)(3+√5) a³.
    const a = 1 / Math.sin((2 * Math.PI) / 5);
    expect(mesh3Volume(icosphere(1, 0))).toBeCloseTo((5 / 12) * (3 + Math.sqrt(5)) * a ** 3, 12);
    let prev = 0;
    for (let level = 0; level <= 3; level++) {
      const mesh = icosphere(1, level);
      const v = mesh3Volume(mesh);
      // Convex polyhedron with all vertices on the sphere: it contains the
      // ball of radius d_min (minimum face-plane distance) and lies in the
      // unit ball, so (4/3)π d_min³ ≤ V ≤ (4/3)π.
      const dmin = minPlaneDistance(mesh);
      expect(v).toBeGreaterThanOrEqual((4 / 3) * Math.PI * dmin ** 3 * (1 - 1e-12));
      expect(v).toBeLessThan((4 / 3) * Math.PI);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    // At level 3 the deficit is below 1% (d_min ≈ 0.997 gives a 0.9% bound).
    expect(prev).toBeGreaterThan((4 / 3) * Math.PI * 0.99);
  });

  it('torusKnot tube volume approaches π r² L · polygonRatio(M) at second order in 1/N', () => {
    // Pappus for tubes: a disc of area A swept perpendicular to a curve of
    // length L with its centre on the curve has volume A·L (r below the
    // minimum radius of curvature). The cross-section polygon gives
    // A = π r² polygonRatio(M) exactly; sampling the curve at N points tilts
    // consecutive sections by the turning angle κΔs, a second-order effect,
    // so the error is O(N⁻²). Measured: 1.4% at N=64, 0.36% at 128, 0.093%
    // at 256, 0.024% at 512 (×4 per doubling). Assert 0.5% at 256 and the
    // error falling by more than 3× from 256 to 512.
    const R = 1;
    const r = 0.15;
    const M = 12;
    const expected = Math.PI * r * r * knotLength(R, 2, 3) * polygonRatio(M);
    const err256 = Math.abs(mesh3Volume(torusKnot(R, r, 2, 3, 256, M)) / expected - 1);
    const err512 = Math.abs(mesh3Volume(torusKnot(R, r, 2, 3, 512, M)) / expected - 1);
    expect(err256).toBeLessThan(0.005);
    expect(err512).toBeLessThan(err256 / 3);
  });

  it('torusKnotCurve lies on the carrier torus (minor radius R/2) and its tangent is the derivative', () => {
    const R = 1.3;
    for (const t of [0, 0.4, 1.9, 4.2]) {
      const { point, tangent } = torusKnotCurve(R, 2, 3, t);
      const rho = Math.hypot(point[0], point[1]);
      expect(Math.hypot(rho - R, point[2])).toBeCloseTo(R / 2, 12);
      const h = 1e-6;
      const fd = scale3(sub3(torusKnotCurve(R, 2, 3, t + h).point, torusKnotCurve(R, 2, 3, t - h).point), 1 / (2 * h));
      // Central difference error is O(h²) ~ 1e-12 times the third derivative.
      for (let k = 0; k < 3; k++) expect(fd[k]).toBeCloseTo(tangent[k], 6);
    }
  });
});

describe('transforms, bounds, edges, welding', () => {
  it('mesh3Bounds of a box', () => {
    const b = mesh3Bounds(box(1, 2, 3));
    expect(b.min).toEqual([-0.5, -1, -1.5]);
    expect(b.max).toEqual([0.5, 1, 1.5]);
    expect(b.radius).toBeCloseTo(Math.sqrt(0.25 + 1 + 2.25), 12);
    expect(mesh3Bounds({ positions: [], triangles: [] })).toEqual({ min: [0, 0, 0], max: [0, 0, 0], radius: 0 });
  });

  it('translate keeps the volume, scale multiplies it, negative scale stays outward', () => {
    const m = box(1, 2, 3);
    const t = translateMesh3(m, [10, -4, 2]);
    expect(mesh3Volume(t)).toBeCloseTo(6, 10);
    expect(mesh3Bounds(t).min).toEqual([9.5, -5, 0.5]);
    expect(mesh3Volume(scaleMesh3(m, 2))).toBeCloseTo(48, 12);
    expect(mesh3Volume(scaleMesh3(box(1, 1, 1), [1, 2, 3]))).toBeCloseTo(6, 12);
    const mirrored = scaleMesh3(m, [-1, 1, 1]);
    expect(mesh3Volume(mirrored)).toBeCloseTo(6, 12);
    expect(validateMesh3(mirrored).ok).toBe(true);
    // The input is not mutated.
    expect(mesh3Volume(m)).toBeCloseTo(6, 12);
  });

  it('flip negates the volume and stays closed and consistent', () => {
    const f = flipMesh3(torus(1, 0.3, 12, 6));
    expect(mesh3Volume(f)).toBeCloseTo(-torusVolume(1, 0.3, 12, 6), 12);
    const v = validateMesh3(f);
    expect(v.ok).toBe(true);
    expect(v.euler).toBe(0);
  });

  it('transform by a rotation keeps volume and area', () => {
    const m = capsule(0.5, 1, 12, 3);
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    const r = transformMesh3(m, (p) => [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]]);
    expect(mesh3Volume(r)).toBeCloseTo(mesh3Volume(m), 12);
    expect(mesh3Area(r)).toBeCloseTo(mesh3Area(m), 12);
    expect(validateMesh3(r).ok).toBe(true);
  });

  it('mesh3Edges lists each undirected edge once as a sorted pair', () => {
    const edges = mesh3Edges(box(1, 1, 1));
    expect(edges.length).toBe(18);
    const keys = new Set(edges.map(([a, b]) => `${a},${b}`));
    expect(keys.size).toBe(18);
    for (const [a, b] of edges) expect(a).toBeLessThan(b);
  });

  it('weldMesh3 reassembles a triangle soup and drops collapsed triangles', () => {
    const m = uvSphere(1, 12, 6);
    const soup: Mesh3 = { positions: [], triangles: [] };
    for (const [a, b, c] of m.triangles) {
      const base = soup.positions.length;
      soup.positions.push([...m.positions[a]], [...m.positions[b]], [...m.positions[c]]);
      soup.triangles.push([base, base + 1, base + 2]);
    }
    expect(validateMesh3(soup).closed).toBe(false);
    const welded = weldMesh3(soup, 1e-9);
    expect(welded.positions.length).toBe(m.positions.length);
    expect(welded.triangles.length).toBe(m.triangles.length);
    expect(validateMesh3(welded).ok).toBe(true);
    expect(mesh3Volume(welded)).toBeCloseTo(mesh3Volume(m), 12);

    // A near-duplicate vertex (within tol) merges and the sliver using it vanishes.
    const b = box(1, 1, 1);
    const dup: Mesh3 = {
      positions: [...b.positions, add3(b.positions[0], [1e-12, 0, 0])],
      triangles: [...b.triangles, [0, 8, 1]],
    };
    const w = weldMesh3(dup, 1e-9);
    expect(w.positions.length).toBe(8);
    expect(w.triangles.length).toBe(12);
    expect(validateMesh3(w).ok).toBe(true);
    // Points farther apart than tol are kept distinct.
    expect(weldMesh3(dup, 1e-13).positions.length).toBe(9);
  });

  it('validateMesh3 reports open, inconsistent, non-manifold, degenerate and out-of-range defects', () => {
    const b = box(1, 1, 1);
    const open = validateMesh3({ positions: b.positions, triangles: b.triangles.slice(1) });
    expect(open.closed).toBe(false);
    expect(open.boundaryEdges).toBe(3);
    expect(open.ok).toBe(false);

    const flippedOne: Mesh3 = { positions: b.positions, triangles: b.triangles.map((t, i) => (i === 0 ? [t[0], t[2], t[1]] : t)) };
    const inc = validateMesh3(flippedOne);
    expect(inc.closed).toBe(true);
    expect(inc.consistent).toBe(false);
    expect(inc.inconsistentEdges).toBe(3);

    const nonManifold = validateMesh3({ positions: b.positions, triangles: [...b.triangles, b.triangles[0]] });
    expect(nonManifold.nonManifoldEdges).toBe(3);
    expect(nonManifold.closed).toBe(false);

    // Two flat triangles (third vertex at the midpoint of the first edge),
    // back to back: closed and consistent but zero-area.
    const degenerate: Mesh3 = {
      positions: [[0, 0, 0], [2, 0, 0], [1, 0, 0]],
      triangles: [[0, 1, 2], [1, 0, 2]],
    };
    const deg = validateMesh3(degenerate);
    expect(deg.closed).toBe(true);
    expect(deg.consistent).toBe(true);
    expect(deg.degenerateTriangles).toBe(2);
    expect(deg.ok).toBe(false);
    expect(validateMesh3(degenerate, { allowDegenerate: true }).errors).toEqual([]);

    const oor = validateMesh3({ positions: b.positions, triangles: [[0, 1, 99]] });
    expect(oor.errors.some((e) => /out-of-range/.test(e))).toBe(true);
    const rep = validateMesh3({ positions: b.positions, triangles: [[0, 1, 1]] });
    expect(rep.errors.some((e) => /repeats/.test(e))).toBe(true);
  });
});
