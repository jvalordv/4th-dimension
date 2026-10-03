/**
 * Spin lifting (MATH.md §9.2): the solid S ⊂ { z ≥ 0 } bounded by a closed,
 * outward-oriented triangle mesh M is swept about the plane z = 0,
 *
 *   spin(S) = { (x, y, z cos φ, z sin φ) : (x, y, z) ∈ S, φ ∈ [0, 2π) },
 *
 * the 4D analogue of a solid of revolution: a half-ball becomes the 4-ball, a
 * ball floating above z = 0 a torisphere (a ball swept round a circle, S¹ × B³,
 * boundary S² × S¹; MATH.md §9.3) and a cube a ring with
 * square cross-section. The boundary is the spin of the triangles of M not
 * lying in z = 0, discretised with N steps φ_k = 2πk/N into prisms that are
 * split into three tets each. Slices are marching tetrahedra (§6) of that
 * complex. A point (x, y, z) is in the slice at w = c iff (x, y, √(z² + c²))
 * ∈ S, so the figure passes through our space as a pair of mirror twins that
 * approach each other and vanish once |c| exceeds its greatest height.
 */
import type { Edge, Hyperplane, Shape4, Tet, TetComplex, TriMesh3, Vec4, WireMesh4 } from '../math/types';
import { cross3 } from '../math/vec';
import type { Mesh3, Triangle } from './mesh3';
import { mesh3Bounds, mesh3Edges } from './mesh3';
import { CLIP_SNAP, clipMesh3 } from './clip';
import { sliceTets } from './slice';
import { signedHypervolume, tetNormal } from './tets';

/** A vertex with z ≤ PLANE_TOL · radius is taken to lie in z = 0 (§9.2: it maps to the single point (x, y, 0, 0)). */
const PLANE_TOL = 1e-12;

/**
 * ∫_S z dV for the solid bounded by `mesh`, the first moment about the plane
 * z = 0 that the Pappus formula of MATH.md §9.2 needs: vol_4(spin S) = 2π ∫_S z dV.
 *
 * Divergence theorem with the field F = (0, 0, z²/2), div F = z:
 * ∫ z dV = ∮ (z²/2) n_z dA. On a triangle (a, b, c) n_z is constant and z is
 * linear, and the exact integral of the square of a linear function over a
 * triangle of area A is (A/6)(z_a² + z_b² + z_c² + z_a z_b + z_b z_c + z_c z_a)
 * (the quadratic quadrature rule, exact for degree 2). With
 * n_z A = ((b − a) × (c − a))_z / 2 the triangle contributes
 * ((b − a) × (c − a))_z · (z_a² + z_b² + z_c² + z_a z_b + z_b z_c + z_c z_a) / 24.
 * Check: the unit cube [0,1]³ has only its top face (z = 1, n_z A = 1) and
 * gives (1/2) · 1 = 1/2 = ∫ z dV.
 *
 * Exact for any closed outward-oriented mesh, with sign: the part below z = 0
 * counts negatively.
 */
export function firstMomentZ(mesh: Mesh3): number {
  let sum = 0;
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.positions[i];
    const b = mesh.positions[j];
    const c = mesh.positions[k];
    const nzA2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const za = a[2];
    const zb = b[2];
    const zc = c[2];
    sum += nzA2 * (za * za + zb * zb + zc * zc + za * zb + zb * zc + zc * za);
  }
  return sum / 24;
}

/**
 * cos and sin of the step angle φ_k = 2πk/N. Exact (0, ±1) at the quadrant
 * angles and symmetric under k ↔ N − k, so that the hyperplane w = 0 passes
 * exactly through the steps k = 0 and k = N/2 (the two mirror twins) instead
 * of within 1e-16 of them.
 */
function stepAngle(k: number, n: number): [number, number] {
  if ((4 * k) % n === 0) {
    const quadrant = ((4 * k) / n) % 4;
    return quadrant === 0 ? [1, 0] : quadrant === 1 ? [0, 1] : quadrant === 2 ? [-1, 0] : [0, -1];
  }
  if (2 * k > n) {
    const [c, s] = stepAngle(n - k, n);
    return [c, -s];
  }
  const a = (2 * Math.PI * k) / n;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Three tets filling the prism over the triangle with sorted indices
 * a < b < c, whose vertex v at step k is `id(v, k)` and at step k + 1
 * `id(v, k + 1)`: (a0 b0 c0 c1), (a0 b0 c1 b1), (a0 b1 c1 a1). The quad over
 * the mesh edge (i < j) is split along the diagonal i_k – j_{k+1}, a rule
 * that depends on the edge only, so the prisms sharing the quad (and the
 * prisms of consecutive steps sharing a triangle) split it alike and the
 * boundary is a valid complex (§5.2). The lateral quads are planar
 * trapezoids (§9.2), so the split is exact. Same rule as extrude.ts.
 */
function prismTets(sorted: readonly [number, number, number], id: (v: number, k: number) => number, k: number): Tet[] {
  const [a, b, c] = sorted;
  const a0 = id(a, k);
  const b0 = id(b, k);
  const c0 = id(c, k);
  const a1 = id(a, k + 1);
  const b1 = id(b, k + 1);
  const c1 = id(c, k + 1);
  return [[a0, b0, c0, c1], [a0, b0, c1, b1], [a0, b1, c1, a1]];
}

const distinct = (t: Tet): boolean => t[0] !== t[1] && t[0] !== t[2] && t[0] !== t[3] && t[1] !== t[2] && t[1] !== t[3] && t[2] !== t[3];

/**
 * The spin of the solid bounded by a closed mesh about the plane z = 0
 * (MATH.md §9.2), as a tet boundary complex plus the wire structure of the
 * projection view.
 *
 * Vertices: a mesh vertex with z > 0 has one copy per step k,
 * (x, y, z cos φ_k, z sin φ_k); a vertex with z = 0 (within 1e-12 of the
 * radius) has the single copy (x, y, 0, 0). Triangles with all three vertices
 * in z = 0 (F in §9.2) are not part of the boundary and are dropped; every
 * other triangle and every step gives one prism, three tets, of which those
 * with a repeated vertex (the prism collapsed onto a pyramid or tet by its
 * vertices in z = 0) are dropped; the rest still close up. Each tet is
 * oriented so that its normal agrees with the spun triangle normal
 * (n_x, n_y, n_z cos φ, n_z sin φ) at the middle angle φ of its step. The
 * prism lies in a 3-flat whose normal is, up to a positive factor,
 * (n_x, n_y, (n_z / cos(π/N)) (cos φ, sin φ)): its (z, w) part is exactly
 * along the middle angle (the chord direction is perpendicular to it) but
 * longer by 1/cos(π/N) because the bottom triangle sits at the end angle.
 * The dot product with the spun normal is n_x² + n_y² + n_z²/cos(π/N) > 0, so
 * the sign test is exact (checked in test/geometry/spin.test.ts).
 */
export class SpunSolid implements Shape4 {
  readonly kind = 'lifted' as const;
  readonly complex: TetComplex;
  /** The mesh that was spun: the input, or its clip to z ≥ 0 when it dipped below z = 0 (§9.4). */
  readonly mesh: Mesh3;
  /** Whether the input had vertices below z = 0 and was clipped first (§9.2, §9.4); the viewer says so. */
  readonly clipped: boolean;
  readonly steps: number;
  private readonly boundary: Triangle[];
  private readonly base: Int32Array;
  private readonly flat: Uint8Array;
  private readonly r: number;
  private readonly zMax: number;
  private wireCache: WireMesh4 | null = null;

  /**
   * @param name display name
   * @param source closed, outward-oriented mesh of a solid in z ≥ 0, or crossing z = 0 (then clipped)
   * @param steps N, the number of angular steps (an integer ≥ 3)
   * @throws if there is nothing to spin: the solid lies in z ≤ 0 or has no triangle off the plane
   */
  constructor(public readonly name: string, source: Mesh3, steps = 48) {
    if (!Number.isInteger(steps) || steps < 3) throw new Error(`spin: steps must be an integer ≥ 3, got ${steps}`);
    this.steps = steps;
    const sourceRadius = mesh3Bounds(source).radius;
    // Below z = −1e-9·radius is geometry; above it is rounding noise.
    this.clipped = source.positions.some((p) => p[2] < -CLIP_SNAP * sourceRadius);
    this.mesh = this.clipped ? clipMesh3(source, [0, 0, 1], 0) : source;
    const mesh = this.mesh;
    // After a clip, vertices the clip snapped onto the plane (within CLIP_SNAP) are in z = 0.
    const planeTol = (this.clipped ? CLIP_SNAP : PLANE_TOL) * sourceRadius;

    const nv = mesh.positions.length;
    this.flat = new Uint8Array(nv);
    for (let i = 0; i < nv; i++) this.flat[i] = mesh.positions[i][2] <= planeTol ? 1 : 0;
    this.boundary = mesh.triangles.filter(([a, b, c]) => !(this.flat[a] && this.flat[b] && this.flat[c]));
    if (this.boundary.length === 0) {
      throw new Error(`spin: nothing to spin for '${name}' (the solid lies in z ≤ 0 or has no triangle above z = 0)`);
    }

    // Positions: one copy per step for a vertex above the plane, one for a vertex in it.
    const N = steps;
    const angles = Array.from({ length: N }, (_, k) => stepAngle(k, N));
    const referenced = new Uint8Array(nv);
    for (const t of this.boundary) for (const v of t) referenced[v] = 1;
    this.base = new Int32Array(nv).fill(-1);
    const positions: Vec4[] = [];
    let zMax = 0;
    let r2 = 0;
    for (let i = 0; i < nv; i++) {
      if (!referenced[i]) continue;
      const [x, y, z] = mesh.positions[i];
      this.base[i] = positions.length;
      if (this.flat[i]) {
        positions.push([x, y, 0, 0]);
        r2 = Math.max(r2, x * x + y * y);
      } else {
        r2 = Math.max(r2, x * x + y * y + z * z);
        zMax = Math.max(zMax, z);
        for (let k = 0; k < N; k++) positions.push([x, y, z * angles[k][0], z * angles[k][1]]);
      }
    }
    this.zMax = zMax;
    this.r = Math.sqrt(r2);

    const id = (v: number, k: number): number => (this.flat[v] ? this.base[v] : this.base[v] + (k % N));
    const tets: Tet[] = [];
    for (const tri of this.boundary) {
      const [a, b, c] = tri;
      const pa = mesh.positions[a];
      const n = cross3(
        [mesh.positions[b][0] - pa[0], mesh.positions[b][1] - pa[1], mesh.positions[b][2] - pa[2]],
        [mesh.positions[c][0] - pa[0], mesh.positions[c][1] - pa[1], mesh.positions[c][2] - pa[2]],
      );
      const sorted = [a, b, c].sort((p, q) => p - q) as [number, number, number];
      for (let k = 0; k < N; k++) {
        const phi = (2 * Math.PI * (k + 0.5)) / N;
        const outward: Vec4 = [n[0], n[1], n[2] * Math.cos(phi), n[2] * Math.sin(phi)];
        for (const t of prismTets(sorted, id, k)) {
          if (!distinct(t)) continue;
          const nt = tetNormal(positions, t);
          const dot = nt[0] * outward[0] + nt[1] * outward[1] + nt[2] * outward[2] + nt[3] * outward[3];
          tets.push(dot < 0 ? [t[0], t[2], t[1], t[3]] : t);
        }
      }
    }
    this.complex = { positions, tets };
  }

  /**
   * 4-volume as the signed sum of cone volumes det[a − o; b − o; c − o; d − o] / 24
   * over the boundary tets with o = 0 (MATH.md §7): valid although a spun
   * solid with a hole (the torisphere) is not star-shaped about the origin.
   * Equals the polygon factor (N / 2π) sin(2π / N) times the Pappus value
   * 2π ∫_S z dV = 2π firstMomentZ(mesh) (§9.2).
   */
  hypervolume(): number {
    return signedHypervolume(this.complex.positions, this.complex.tets);
  }

  /**
   * Projection structure (§9.2): the mesh's edges at every step plus the step
   * edges v_k – v_{k+1} of every vertex above the plane, and the mesh's
   * triangles at every step plus one quad per mesh edge per step. "The
   * mesh" is the part of M off the plane: triangles in z = 0 are not part of
   * the boundary and edges only they use are not drawn. An edge with both
   * ends in z = 0 is drawn once (it is the same at every step), and a quad
   * over an edge with an end in z = 0 collapses to a triangle and is skipped
   * (the mesh triangles at the steps cover it).
   */
  wire(): WireMesh4 {
    if (this.wireCache) return this.wireCache;
    const N = this.steps;
    const { flat, base } = this;
    const id = (v: number, k: number): number => (flat[v] ? base[v] : base[v] + (k % N));
    const edges: Edge[] = [];
    const faces: number[][] = [];
    for (const [i, j] of mesh3Edges({ positions: this.mesh.positions, triangles: this.boundary })) {
      if (flat[i] && flat[j]) { edges.push([base[i], base[j]]); continue; }
      for (let k = 0; k < N; k++) {
        edges.push([id(i, k), id(j, k)]);
        if (!flat[i] && !flat[j]) faces.push([id(i, k), id(j, k), id(j, k + 1), id(i, k + 1)]);
      }
    }
    for (let v = 0; v < base.length; v++) {
      if (base[v] < 0 || flat[v]) continue;
      for (let k = 0; k < N; k++) edges.push([id(v, k), id(v, k + 1)]);
    }
    for (const [a, b, c] of this.boundary) {
      for (let k = 0; k < N; k++) faces.push([id(a, k), id(b, k), id(c, k)]);
    }
    this.wireCache = { positions: this.complex.positions, edges, faces };
    return this.wireCache;
  }

  /** Marching tetrahedra of the boundary complex (§6); there are no caps, the boundary is fully tetrahedralised. */
  slice(h: Hyperplane): TriMesh3 {
    return sliceTets(this.complex.positions, this.complex.tets, h);
  }

  /** Largest |p| over the complex: spinning preserves |p|, so the largest distance of a vertex of the spun triangles. */
  radius(): number {
    return this.r;
  }

  /** [−z_max, z_max], the w extent of the full circle of radius z_max (exact for N divisible by 4). */
  wRange(): [number, number] {
    return [-this.zMax, this.zMax];
  }
}

/** Spin the solid bounded by `mesh` about the plane z = 0 in `steps` steps (clipped to z ≥ 0 first if needed). MATH.md §9.2 */
export function spin(mesh: Mesh3, steps = 48, name: string): SpunSolid {
  return new SpunSolid(name, mesh, steps);
}
