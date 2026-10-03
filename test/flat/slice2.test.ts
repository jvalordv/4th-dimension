import { describe, expect, it } from 'vitest';
import { box, icosphere, mesh3Edges, mesh3Volume, torus, transformMesh3, translateMesh3, validateMesh3, type Mesh3 } from '../../src/geometry/mesh3';
import { pointInPolygon2, signedArea2 } from '../../src/geometry/section';
import { FLAT_SHAPE_IDS } from '../../src/explain';
import { FLAT_SHAPES, octahedron, tetrahedron } from '../../src/flat/shapes';
import { apply3, compositeRotation3, planeChart, planeFromRotation, unchart2, type Plane, type Vec2 } from '../../src/flat/math';
import { planeZField } from '../../src/flat/draw';
import { removeCollinear, sliceMesh3, sliceMeshes3, sliceSection } from '../../src/flat/slice2';
import { dot3, length3, normalize3, sub3 } from '../../src/math/vec';
import type { Vec3 } from '../../src/math/types';

/*
 * Tolerances. Section vertices are lerps p = a + (b − a) t with t = s_a / (s_a − s_b) from float64
 * signed distances, so each coordinate is exact to a few ulps (≲ 1e-15 for coordinates of size ≤ 2),
 * and areas are shoelace sums of ≤ ~100 such terms: ≲ 1e-13. Exact-shape comparisons below therefore
 * use 1e-10, three orders above that and many orders below any structural error.
 */
const EXACT = 1e-10;
const SQRT3 = Math.sqrt(3);

const cube = (): Mesh3 => box(2, 2, 2);
const zPlane = (c: number): Plane => planeChart([0, 0, 1], c);
const diagonal = normalize3([1, 1, 1]);

/** Area of the triangles of a slice, by the cross product in the chart. */
function triangleAreaSum(s: ReturnType<typeof sliceMesh3>): number {
  let a = 0;
  const { positions, indices } = s.triangles;
  for (let t = 0; t < indices.length; t += 3) {
    a += signedArea2([positions[indices[t]], positions[indices[t + 1]], positions[indices[t + 2]]]);
  }
  return a;
}

/** Cavalieri sum Σ A(c_i) h by the midpoint rule over [−R, R] in N steps, along the unit direction n. §11 */
function cavalieri(meshes: readonly Mesh3[], n: Vec3, R: number, steps: number): number {
  const h = (2 * R) / steps;
  let total = 0;
  for (let i = 0; i < steps; i++) total += sliceMeshes3(meshes, planeChart(n, -R + (i + 0.5) * h)).area;
  return total * h;
}

describe('sliceMesh3: the cube [−1, 1]^3 by z = c (MATH.md §11)', () => {
  it('is one square loop of area 4 for z = 0.3', () => {
    const s = sliceMesh3(cube(), zPlane(0.3));
    expect(s.loops).toHaveLength(1);
    // The four vertical edges cross z = 0.3 at their (x, y) = (±1, ±1); the crossing of each side face's
    // diagonal lies on the cut between them and is dropped as collinear.
    expect(s.loops[0]).toHaveLength(4);
    const corners = s.loops[0].map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).sort();
    expect(corners).toEqual(['-1,-1', '-1,1', '1,-1', '1,1']);
    for (const [x, y] of s.loops[0]) {
      expect(Math.abs(Math.abs(x) - 1)).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(Math.abs(y) - 1)).toBeLessThanOrEqual(EXACT);
    }
    expect(Math.abs(s.area - 4)).toBeLessThanOrEqual(EXACT);
    // Outer loops are counter-clockwise in the chart: the shoelace area is +4.
    expect(Math.abs(signedArea2(s.loops[0]) - 4)).toBeLessThanOrEqual(EXACT);
  });

  it('triangulates the square: counter-clockwise triangles of total area 4, colour variable 0.3 everywhere', () => {
    const s = sliceMesh3(cube(), zPlane(0.3));
    expect(s.triangles.indices.length).toBe(6); // a quadrilateral: n − 2 = 2 triangles
    expect(s.triangles.positions).toHaveLength(s.sourceZ.length);
    for (const i of s.triangles.indices) expect(i).toBeLessThan(s.triangles.positions.length);
    expect(Math.abs(triangleAreaSum(s) - 4)).toBeLessThanOrEqual(EXACT);
    const { positions, indices } = s.triangles;
    for (let t = 0; t < indices.length; t += 3) {
      expect(signedArea2([positions[indices[t]], positions[indices[t + 1]], positions[indices[t + 2]]])).toBeGreaterThan(0);
    }
    // Every source point of the slice z = 0.3 of the unrotated cube has z = 0.3.
    for (const z of s.sourceZ) expect(Math.abs(z - 0.3)).toBeLessThanOrEqual(EXACT);
  });

  it('is a square of area 4 for every |c| < 1 and empty beyond', () => {
    for (const c of [-0.99, -0.5, 0, 0.7, 0.99]) {
      const s = sliceMesh3(cube(), zPlane(c));
      expect(s.loops).toHaveLength(1);
      expect(s.loops[0]).toHaveLength(4);
      expect(Math.abs(s.area - 4)).toBeLessThanOrEqual(EXACT);
    }
    for (const c of [-1.5, 1.01, 5]) {
      const s = sliceMesh3(cube(), zPlane(c));
      expect(s.loops).toHaveLength(0);
      expect(s.area).toBe(0);
      expect(s.triangles.indices).toHaveLength(0);
      expect(s.triangles.positions).toHaveLength(0);
      expect(s.sourceZ).toHaveLength(0);
    }
  });

  it('by the plane (1,1,1)/√3 through the origin is a regular hexagon on the six edge midpoints, area 3√3', () => {
    const plane = planeChart(diagonal, 0);
    const s = sliceMesh3(cube(), plane);
    expect(s.loops).toHaveLength(1);
    // Six vertices, not twelve: the cut also crosses face diagonals, at points on the straight cut
    // between two edge midpoints; those are dropped.
    expect(s.loops[0]).toHaveLength(6);
    // The vertices are the midpoints of the six cube edges on x + y + z = 0: the permutations of (1, −1, 0).
    const midpoints: Vec3[] = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
    const lifted = s.loops[0].map((q) => unchart2(plane, q));
    for (const m of midpoints) {
      expect(lifted.some((p) => length3(sub3(p, m)) <= EXACT)).toBe(true);
    }
    // Regular with side |(1,−1,0) − (1,0,−1)| = √2: consecutive distances √2, circumradius = side = √2.
    s.loops[0].forEach((q, i) => {
      const next = s.loops[0][(i + 1) % 6];
      expect(Math.abs(Math.hypot(next[0] - q[0], next[1] - q[1]) - Math.SQRT2)).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(Math.hypot(q[0], q[1]) - Math.SQRT2)).toBeLessThanOrEqual(EXACT);
    });
    // Area of a regular hexagon of side a is (3√3/2) a²; a² = 2 gives 3√3.
    expect(Math.abs(s.area - 3 * SQRT3)).toBeLessThanOrEqual(EXACT);
    expect(Math.abs(signedArea2(s.loops[0]) - 3 * SQRT3)).toBeLessThanOrEqual(EXACT);
    expect(s.triangles.indices.length).toBe(12); // n − 2 = 4 triangles
    expect(Math.abs(triangleAreaSum(s) - 3 * SQRT3)).toBeLessThanOrEqual(EXACT);
  });

  /*
   * Moving the plane x + y + z = √3 k along the diagonal from one corner to the opposite one. With
   * σ = √3 k = x + y + z the cube's section has area (derived from V(σ) = volume of {x+y+z ≤ σ}, A = √3 dV/dσ):
   *
   *   triangle, σ ∈ [1, 3]:  the cap at the corner (1,1,1) is a tetrahedron with legs t = 3 − σ along the three
   *                          edges, V = t³/6, so the section is the equilateral triangle with side t√2:
   *                          A = (√3/2) t² = (√3/2)(3 − √3 k)²;
   *   hexagon,  σ ∈ [−1, 1]: V = [(σ+3)³ − 3(σ+1)³]/6, A = √3(3 − σ²) = 3√3 (1 − k²).
   *
   * (The two pieces agree, with equal slope, at σ = 1.) At k = ±1.5: t = 3 − 1.5√3 ≈ 0.4019, the triangle's
   * vertices lie that far from the corner along each edge, 0.2010 of the edge length 2, and
   * A = (√3/2) t² = 63√3/8 − 27/2 ≈ 0.13990. (They are near, but not at, the quarter points of the edges.)
   */
  const diagonalArea = (k: number): number => {
    const t = 3 - SQRT3 * Math.abs(k);
    return Math.abs(k) <= 1 / SQRT3 ? 3 * SQRT3 * (1 - k * k) : (SQRT3 / 2) * t * t;
  };

  it('moving along the diagonal gives point, triangle, hexagon, triangle, point', () => {
    const sliceAt = (k: number) => sliceMesh3(cube(), planeChart(diagonal, k));
    // Beyond the corners (|k| > √3 ≈ 1.7321): nothing.
    expect(sliceAt(-1.75).loops).toHaveLength(0);
    expect(sliceAt(1.75).loops).toHaveLength(0);
    // Loop vertex counts at the three named offsets.
    expect(sliceAt(-1.5).loops.map((l) => l.length)).toEqual([3]);
    expect(sliceAt(0).loops.map((l) => l.length)).toEqual([6]);
    expect(sliceAt(1.5).loops.map((l) => l.length)).toEqual([3]);
    // Triangle for |k| > 1/√3 ≈ 0.577, hexagon inside.
    for (const k of [-1.73, -1.7, -1.2, -0.6, 0.6, 1.2, 1.7, 1.73]) expect(sliceAt(k).loops.map((l) => l.length)).toEqual([3]);
    for (const k of [-0.5, -0.2, 0.3, 0.5]) expect(sliceAt(k).loops.map((l) => l.length)).toEqual([6]);
    // Areas follow the closed forms above, at ±1.5 and elsewhere.
    for (const k of [-1.73, -1.5, -1.2, -0.6, -0.5, -0.2, 0, 0.3, 0.5, 0.6, 1.2, 1.5, 1.73]) {
      expect(Math.abs(sliceAt(k).area - diagonalArea(k))).toBeLessThanOrEqual(EXACT);
    }
    expect(Math.abs(sliceAt(-1.5).area - (63 * SQRT3 / 8 - 13.5))).toBeLessThanOrEqual(EXACT);
    expect(Math.abs(sliceAt(1.5).area - (63 * SQRT3 / 8 - 13.5))).toBeLessThanOrEqual(EXACT);
    // The triangle grows from the corner (area strictly increasing in k up to 0).
    const ks = [-1.73, -1.7, -1.6, -1.5, -1.2, -0.8, -0.6, -0.3, 0];
    const areas = ks.map((k) => sliceAt(k).area);
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThan(areas[i - 1]);
  });

  it('is symmetric under the central symmetry of the cube: A(k) = A(−k)', () => {
    for (const k of [0.2, 0.9, 1.4, 1.7]) {
      const a = sliceMesh3(cube(), planeChart(diagonal, k)).area;
      const b = sliceMesh3(cube(), planeChart(diagonal, -k)).area;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(EXACT);
    }
  });
});

describe('sliceMesh3: the ball (icosphere(1, 3))', () => {
  const ball = icosphere(1, 3);

  it('is one disc-like loop of area ≈ π(1 − c²), never larger', () => {
    /*
     * The mesh is inscribed (vertices on the unit sphere, faces inside it), so the convex section lies
     * inside the disc of radius ρ = √(1 − c²): area ≤ π ρ² exactly. Each section vertex lies on an edge of
     * length ℓ ≲ 0.145 (the level-3 icosphere: 1.0515 / 8 = 0.131 on average), at most the sagitta
     * δ = ℓ²/8 ≈ 0.0026 inside the sphere, which shrinks the in-plane radius by δ/ρ and the area by a
     * factor (1 − δ/ρ²)² ≈ 1 − 2δ/ρ² ≤ 0.7 % for |c| ≤ 0.5. The measured deficits are 0.51 %, 0.64 %,
     * 0.78 % at c = 0, 0.3, 0.5; the tolerance is 1 %.
     */
    for (const c of [0, 0.1, 0.2, 0.3, 0.4, 0.5, -0.4]) {
      const s = sliceMesh3(ball, zPlane(c));
      expect(s.loops).toHaveLength(1);
      const disc = Math.PI * (1 - c * c);
      expect(s.area).toBeLessThanOrEqual(disc * (1 + 1e-12));
      expect(s.area).toBeGreaterThan(disc * 0.99);
      expect(Math.abs(signedArea2(s.loops[0]) - s.area)).toBeLessThanOrEqual(EXACT);
    }
  });

  it('is symmetric in c and shrinks monotonically with |c|', () => {
    const area = (c: number): number => sliceMesh3(ball, zPlane(c)).area;
    expect(Math.abs(area(0.3) - area(-0.3))).toBeLessThanOrEqual(1e-9);
    const cs = [0, 0.2, 0.4, 0.6, 0.8, 0.95];
    const as = cs.map(area);
    for (let i = 1; i < as.length; i++) expect(as[i]).toBeLessThan(as[i - 1]);
    expect(area(1.01)).toBe(0);
  });
});

describe('sliceMesh3: the torus (holes by nesting parity)', () => {
  const t = torus(1, 0.4, 48, 24);

  it('by z = 0.1 is an annulus: counter-clockwise outer loop, clockwise inner loop inside it', () => {
    const s = sliceMesh3(t, zPlane(0.1));
    expect(s.loops).toHaveLength(2);
    // One vertex per tube ring on each of the outer and inner halves: 48 each.
    expect(s.loops.map((l) => l.length)).toEqual([48, 48]);
    const [first, second] = s.loops;
    const [outer, inner] = signedArea2(first) > 0 ? [first, second] : [second, first];
    expect(signedArea2(outer)).toBeGreaterThan(0);
    expect(signedArea2(inner)).toBeLessThan(0);
    expect(pointInPolygon2(inner[0], outer)).toBe(true);
    expect(Math.abs(s.area - (signedArea2(outer) + signedArea2(inner)))).toBeLessThanOrEqual(EXACT);
    // The exact torus section at height c is the annulus with radii 1 ± √(r² − c²), area 4π√(r² − c²) = 4.867;
    // the mesh is inscribed (24-gon tube, 48-gon rings), a deficit of ≈ 0.4 % here, tolerance 2 %.
    const exact = 4 * Math.PI * Math.sqrt(0.4 * 0.4 - 0.1 * 0.1);
    expect(s.area).toBeLessThan(exact);
    expect(s.area).toBeGreaterThan(exact * 0.98);
    // No triangle of the triangulation lies in the hole.
    const { positions, indices } = s.triangles;
    expect(Math.abs(triangleAreaSum(s) - s.area)).toBeLessThanOrEqual(EXACT);
    for (let k = 0; k < indices.length; k += 3) {
      const [a, b, c] = [positions[indices[k]], positions[indices[k + 1]], positions[indices[k + 2]]];
      const centroid: Vec2 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      expect(pointInPolygon2(centroid, inner)).toBe(false);
      expect(pointInPolygon2(centroid, outer)).toBe(true);
    }
  });

  it('sliced through the hole (a plane containing the axis) gives two separate discs', () => {
    // x = 0 as a plane: normal e_x. The tube crosses it in two disjoint cross-sections, at y = ±1.
    const s = sliceMesh3(t, planeChart([1, 0, 0], 0));
    expect(s.loops).toHaveLength(2);
    for (const l of s.loops) expect(signedArea2(l)).toBeGreaterThan(0);
    // Each is the 24-gon cross-section of area (24/2) r² sin(2π/24) (regular 24-gon of circumradius r).
    const polygon = 12 * 0.16 * Math.sin((2 * Math.PI) / 24);
    expect(Math.abs(s.area - 2 * polygon)).toBeLessThanOrEqual(1e-9);
  });
});

describe('Cavalieri: the integral of slice area over the offset is the 3-volume (§11)', () => {
  it('cube along e_z: exactly 8 with the midpoint rule', () => {
    // A(c) = 4 for |c| < 1 and 0 beyond. Over [−2, 2] with 8 steps (h = 0.5) the cell boundaries fall on c = ±1,
    // so exactly the 4 midpoints −0.75, −0.25, 0.25, 0.75 are inside: 4 · 4 · 0.5 = 8; likewise 40 steps (h = 0.1).
    expect(Math.abs(cavalieri([cube()], [0, 0, 1], 2, 8) - 8)).toBeLessThanOrEqual(EXACT);
    expect(Math.abs(cavalieri([cube()], [0, 0, 1], 2, 40) - 8)).toBeLessThanOrEqual(EXACT);
    expect(mesh3Volume(cube())).toBe(8);
  });

  it('cube along the diagonal: 8 to the midpoint-rule error', () => {
    // A(k) is C¹ and piecewise quadratic (|A''| ≤ 6√3 ≈ 10.4 on |k| ≤ 1/√3, 3√3 outside), so the midpoint rule
    // with h = 2√3/200 = 0.0173 errs by ≲ (b − a) h² max|A''| / 24 = 4.5e-4; tolerance 1e-3.
    expect(Math.abs(cavalieri([cube()], diagonal, SQRT3, 200) - 8)).toBeLessThanOrEqual(1e-3);
  });

  it('ball along e_z: the mesh volume to 1e-4, and 4π/3 to the inscribed-mesh deficit of 1 %', () => {
    // A(c) of the polyhedron is piecewise smooth with |A''| ≲ 2π; midpoint error ≲ 2 h² (2π) / 24 = 5e-5 at h = 0.01.
    const ball = icosphere(1, 3);
    const integral = cavalieri([ball], [0, 0, 1], 1, 200);
    expect(Math.abs(integral - mesh3Volume(ball))).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(integral / ((4 * Math.PI) / 3) - 1)).toBeLessThan(0.01);
  });

  it('torus along e_z: the mesh volume to 1e-3 (needs the hole subtracted)', () => {
    // A(c) ≈ 4π R √(r² − c²) has square-root endpoints at c = ±r, where the midpoint rule errs by O(h^{3/2}):
    // measured 1.9e-4 at h = 0.005; tolerance 1e-3. Adding the hole's area instead of subtracting it would
    // add 2π ∫ ρ_i(c)² dc, with inner radius ρ_i = 1 − √(r² − c²) ≥ 0.6 on |c| ≤ 0.4: at least 2π · 0.36 · 0.8 = 1.8, far above the tolerance.
    const t = torus(1, 0.4, 48, 24);
    expect(Math.abs(cavalieri([t], [0, 0, 1], 0.5, 200) - mesh3Volume(t))).toBeLessThanOrEqual(1e-3);
  });
});

describe('sliceMesh3 with a rotated plane (§4 one dimension down)', () => {
  const angles = { XY: 0.4, XZ: -0.9, YZ: 0.3 };
  const m = compositeRotation3(angles);
  const c = 0.37;

  it('slicing the unrotated cube by planeFromRotation(M, c) equals slicing the rotated cube by z = c', () => {
    const direct = sliceMesh3(cube(), planeFromRotation(m, c));
    const rotatedMesh = transformMesh3(cube(), (p) => apply3(m, p));
    const reference = sliceMesh3(rotatedMesh, zPlane(c));
    expect(direct.loops).toHaveLength(1);
    expect(direct.loops[0].length).toBe(reference.loops[0].length);
    expect(Math.abs(direct.area - reference.area)).toBeLessThanOrEqual(EXACT);
    const key = (q: Vec2): [number, number] => [q[0], q[1]];
    const sorted = (loop: Vec2[]): [number, number][] => loop.map(key).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const a = sorted(direct.loops[0]);
    const b = sorted(reference.loops[0]);
    a.forEach((p, i) => {
      expect(Math.abs(p[0] - b[i][0])).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(p[1] - b[i][1])).toBeLessThanOrEqual(EXACT);
    });
  });

  it('sourceZ is the z of the unrotated source point, the affine function z_0 + g_x q_0 + g_y q_1 of the chart position', () => {
    const plane = planeFromRotation(m, c);
    const s = sliceMesh3(cube(), plane);
    const field = planeZField(plane);
    expect(s.sourceZ.length).toBeGreaterThan(0);
    s.triangles.positions.forEach((q, i) => {
      expect(Math.abs(s.sourceZ[i] - (field.z0 + field.gx * q[0] + field.gy * q[1]))).toBeLessThanOrEqual(EXACT);
      // and it is the z coordinate of the 3D point the chart position stands for.
      expect(Math.abs(s.sourceZ[i] - unchart2(plane, q)[2])).toBeLessThanOrEqual(EXACT);
    });
    // The source points lie on the cube: |z| ≤ 1.
    for (const z of s.sourceZ) expect(Math.abs(z)).toBeLessThanOrEqual(1 + EXACT);
  });
});

describe('sliceMeshes3 and removeCollinear', () => {
  it('concatenates loops, triangles and areas of several parts', () => {
    const a = cube();
    const b = translateMesh3(cube(), [5, 0, 0]);
    const s = sliceMeshes3([a, b], zPlane(0.2));
    expect(s.loops).toHaveLength(2);
    expect(Math.abs(s.area - 8)).toBeLessThanOrEqual(EXACT);
    expect(s.triangles.positions).toHaveLength(s.sourceZ.length);
    expect(s.triangles.indices.length).toBe(12);
    expect(Math.abs(triangleAreaSum(s) - 8)).toBeLessThanOrEqual(EXACT);
    const maxIndex = Math.max(...s.triangles.indices);
    expect(maxIndex).toBe(s.triangles.positions.length - 1);
    // The second cube's section sits at x ∈ [4, 6].
    const xs = s.loops[1].map((q) => q[0]);
    expect(Math.min(...xs)).toBeGreaterThan(3.9);
  });

  it('sliceSection returns the loops in 3D and in the chart, consistent with each other', () => {
    const plane = planeFromRotation(compositeRotation3({ XY: 0.2, XZ: 0.5, YZ: -0.4 }), 0.1);
    const sec = sliceSection(cube(), plane);
    expect(sec.loops3).toHaveLength(sec.loops.length);
    sec.loops3.forEach((loop, i) => {
      loop.forEach((p, j) => {
        expect(Math.abs(dot3(plane.normal, p) - plane.offset)).toBeLessThanOrEqual(EXACT);
        expect(Math.abs(sec.loops[i][j][0] - dot3(plane.basis[0], p))).toBeLessThanOrEqual(EXACT);
        expect(Math.abs(sec.loops[i][j][1] - dot3(plane.basis[1], p))).toBeLessThanOrEqual(EXACT);
      });
    });
  });

  it('removeCollinear drops points on a straight run and keeps corners and reversals', () => {
    // A square with a midpoint on every side: 8 points, 4 corners.
    const sq: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0], [0, 2, 0], [0, 1, 0]];
    expect(removeCollinear(sq, 1e-9)).toEqual([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]);
    // The same square starting at a midpoint: the starting point is dropped too, cyclically.
    expect(removeCollinear([...sq.slice(1), sq[0]], 1e-9)).toHaveLength(4);
    // A genuine corner at distance 1e-3 from the line is kept at tolerance 1e-9 and dropped at 1e-2.
    const bent: Vec3[] = [[0, 0, 0], [1, 1e-3, 0], [2, 0, 0], [1, 5, 0]];
    expect(removeCollinear(bent, 1e-9)).toHaveLength(4);
    expect(removeCollinear(bent, 1e-2)).toHaveLength(3);
    // A reversal (spike) is not "between": a → b → c with c back inside a–b keeps b.
    const spike: Vec3[] = [[0, 0, 0], [2, 0, 0], [1, 0, 0], [1, 1, 0]];
    expect(removeCollinear(spike, 1e-9)).toHaveLength(4);
    // Triangles are returned unchanged.
    const tri: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    expect(removeCollinear(tri, 1e-9)).toEqual(tri);
  });
});

describe('Flatland shapes (src/flat/shapes.ts)', () => {
  it('has exactly the ids the explainers use, each with a label, description and fresh closed meshes', () => {
    expect(Object.keys(FLAT_SHAPES)).toEqual([...FLAT_SHAPE_IDS]);
    for (const id of FLAT_SHAPE_IDS) {
      const entry = FLAT_SHAPES[id];
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
      const a = entry.create();
      const b = entry.create();
      expect(a.length).toBeGreaterThan(0);
      expect(a).not.toBe(b);
      for (const mesh of a) {
        const v = validateMesh3(mesh);
        expect(v.errors).toEqual([]);
        expect(mesh3Volume(mesh)).toBeGreaterThan(0);
      }
    }
  });

  it('the human has the 16 parts of humanParts()', () => {
    expect(FLAT_SHAPES.human.create()).toHaveLength(16);
  });

  it('the cube is box(2,2,2) of volume 8, the ball icosphere(1,3), the cylinder a 48-gon prism', () => {
    expect(mesh3Volume(FLAT_SHAPES.cube.create()[0])).toBe(8);
    expect(FLAT_SHAPES.ball.create()[0].triangles).toHaveLength(1280);
    expect(FLAT_SHAPES.cylinder.create()[0].triangles).toHaveLength(48 * 4);
    expect(FLAT_SHAPES.torus.create()[0].triangles).toHaveLength(2 * 48 * 24);
  });

  describe('tetrahedron: four alternate corners of the cube, edge 2√2, volume 8/3', () => {
    const t = tetrahedron();

    it('is closed and consistently outward-oriented', () => {
      const v = validateMesh3(t);
      expect(v.errors).toEqual([]);
      expect(v.closed).toBe(true);
      expect(v.consistent).toBe(true);
      expect(v.euler).toBe(2); // V − E + F = 4 − 6 + 4
      expect(t.positions).toHaveLength(4);
      expect(t.triangles).toHaveLength(4);
    });

    it('has volume 8/3 = 8 − 4·(4/3) (the cube minus four corner pyramids of volume 2·2·2/6)', () => {
      // Exact in float64: all coordinates are ±1 and the triple products are small integers.
      expect(Math.abs(mesh3Volume(t) - 8 / 3)).toBeLessThanOrEqual(1e-15);
    });

    it('has six edges of length 2√2 and every face normal points away from the centre', () => {
      const edges = mesh3Edges(t);
      expect(edges).toHaveLength(6);
      for (const [a, b] of edges) {
        expect(Math.abs(length3(sub3(t.positions[a], t.positions[b])) - 2 * Math.SQRT2)).toBeLessThanOrEqual(1e-15);
      }
      for (const [a, b, c] of t.triangles) {
        const centroid: Vec3 = [0, 1, 2].map((k) => (t.positions[a][k] + t.positions[b][k] + t.positions[c][k]) / 3) as Vec3;
        const u = sub3(t.positions[b], t.positions[a]);
        const w = sub3(t.positions[c], t.positions[a]);
        const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        expect(dot3(n, centroid)).toBeGreaterThan(0);
      }
    });

    it('slices by z = c in the rectangle of area 2(1 − c²), integrating to 8/3', () => {
      // Top edge (1,1,1)–(−1,−1,1), bottom edge (1,−1,−1)–(−1,1,−1), both of length 2√2 and perpendicular. A plane
      // parallel to both, at fraction τ = (1 − c)/2 from top to bottom, cuts a rectangle with sides (1 − τ)·2√2 and
      // τ·2√2: area 8 τ(1 − τ) = 2(1 − c²). ∫_{−1}^{1} 2(1 − c²) dc = 8/3.
      for (const c of [-0.9, -0.3, 0, 0.5, 0.95]) {
        const s = sliceMesh3(t, zPlane(c));
        expect(s.loops.map((l) => l.length)).toEqual([4]);
        expect(Math.abs(s.area - 2 * (1 - c * c))).toBeLessThanOrEqual(EXACT);
      }
      expect(sliceMesh3(t, zPlane(1.2)).loops).toHaveLength(0);
      // The midpoint rule on a quadratic f over [a, b] with cell boundaries on a and b satisfies
      // M − I = −(h²/24)(f'(b) − f'(a)) (exact for a quadratic); here f' = −4c, f'(1) − f'(−1) = −8, so M = 8/3 + h²/3. Over [−2, 2] with 40 steps
      // (h = 0.1, boundaries on c = ±1) this is 8/3 + 1/300, an exact identity for the quadratic section areas.
      const h = 0.1;
      expect(Math.abs(cavalieri([t], [0, 0, 1], 2, 40) - (8 / 3 + (h * h) / 3))).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(cavalieri([t], [0, 0, 1], 2, 400) - 8 / 3)).toBeLessThanOrEqual(1e-4); // h²/3 = 3.3e-5
    });
  });

  describe('octahedron: vertices ±e_i, edge √2, volume 4/3', () => {
    const o = octahedron();

    it('is closed and consistently outward-oriented', () => {
      const v = validateMesh3(o);
      expect(v.errors).toEqual([]);
      expect(v.closed).toBe(true);
      expect(v.consistent).toBe(true);
      expect(v.euler).toBe(2); // 6 − 12 + 8
      expect(o.positions).toHaveLength(6);
      expect(o.triangles).toHaveLength(8);
    });

    it('has volume 4/3 = 8 faces · (1/6) and twelve edges of length √2', () => {
      expect(Math.abs(mesh3Volume(o) - 4 / 3)).toBeLessThanOrEqual(1e-15);
      const edges = mesh3Edges(o);
      expect(edges).toHaveLength(12);
      for (const [a, b] of edges) {
        expect(Math.abs(length3(sub3(o.positions[a], o.positions[b])) - Math.SQRT2)).toBeLessThanOrEqual(1e-15);
      }
    });

    it('slices by z = c in the square |x| + |y| ≤ 1 − |c|, area 2(1 − |c|)², integrating to 4/3', () => {
      // The square has diagonal 2(1 − |c|), area d²/2 = 2(1 − |c|)²; ∫ = 2 · 2 ∫_0^1 (1 − c)² dc = 4/3.
      for (const c of [-0.9, -0.3, 0.2, 0.7]) {
        const s = sliceMesh3(o, zPlane(c));
        expect(s.loops.map((l) => l.length)).toEqual([4]);
        expect(Math.abs(s.area - 2 * (1 - Math.abs(c)) ** 2)).toBeLessThanOrEqual(EXACT);
      }
      expect(Math.abs(cavalieri([o], [0, 0, 1], 1, 400) - 4 / 3)).toBeLessThanOrEqual(1e-4);
    });
  });
});
