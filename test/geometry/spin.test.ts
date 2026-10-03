import { describe, expect, it } from 'vitest';
import {
  box, cylinder, icosphere, mesh3Area, mesh3Edges, mesh3Volume, torus, translateMesh3, uvSphere, validateMesh3,
} from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import { clipMesh3 } from '../../src/geometry/clip';
import { firstMomentZ, SPIN_SNAP, spin, SpunSolid } from '../../src/geometry/spin';
import {
  humanParts, human, spunBall, spunCube, spunHalfBall, spunHuman, SPUN_SHAPES,
} from '../../src/geometry/figures';
import { ExtrudedSolid } from '../../src/geometry/extrude';
import { CompoundShape } from '../../src/geometry/compound';
import { hyperplane, hyperplaneW } from '../../src/math/hyperplane';
import { signedHypervolume, tetNormal, validateTetComplex } from '../../src/geometry/tets';
import { analyseSlice, vertexAt, weldVertices } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { SHAPE_IDS } from '../../src/app/registry';
import { cross3, dot3, dot4, normalize3, normalize4, sub3 } from '../../src/math/vec';
import type { Vec4 } from '../../src/math/types';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);
const relErr = (a: number, b: number): number => Math.abs(a / b - 1);

/**
 * (N/2π) sin(2π/N): the ratio of the area of the regular N-gon inscribed in a
 * circle to the circle's area. MATH.md §9.2: each point at height z sweeps an
 * N-gon of circumradius z, so the discrete 4-volume is this factor times the
 * Pappus value 2π ∫_S z dV.
 */
const polygonFactor = (n: number): number => (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);

/** The discrete Pappus value of §9.2: polygonFactor(N) · 2π · ∫_S z dV, with the moment from the divergence theorem. */
const discretePappus = (mesh: Mesh3, steps: number): number => polygonFactor(steps) * 2 * Math.PI * firstMomentZ(mesh);

/** Radius of the largest origin-centred ball inside a convex polyhedron containing the origin: min over faces of n̂ · v_0. */
function inscribedRadius(mesh: Mesh3): number {
  let rho = Infinity;
  for (const [a, b, c] of mesh.triangles) {
    const n = normalize3(cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a])));
    rho = Math.min(rho, dot3(n, mesh.positions[a]));
  }
  return rho;
}

const ballVolume = (r: number): number => (4 / 3) * Math.PI * r ** 3;
const N = 48;
/** cos(π/N): the inscribed polygon (N-gon, vertices on the circle) contains the circle of radius κ R. */
const KAPPA = Math.cos(Math.PI / N);

describe('firstMomentZ = ∫_S z dV (MATH.md §9.2, divergence theorem)', () => {
  it('unit cube [0,1]³: 1/2 (only the top face contributes, (z²/2) n_z A = 1/2)', () => {
    const cube = translateMesh3(box(1, 1, 1), [0.5, 0.5, 0.5]);
    expect(firstMomentZ(cube)).toBeCloseTo(0.5, 14);
  });

  it('box centred on the plane: 0 (the top and bottom faces cancel); a cube centred at z₀ has z₀ · volume', () => {
    expect(firstMomentZ(box(2, 2, 2))).toBeCloseTo(0, 14);
    // Planar faces: the formula is exact, so z̄ = 1.2 and vol 1 give 1.2 to rounding.
    expect(firstMomentZ(translateMesh3(box(1, 1, 1), [0, 0, 1.2]))).toBeCloseTo(1.2, 13);
    // z̄ · vol for a box a × b × c centred at z₀: z₀ a b c.
    expect(firstMomentZ(translateMesh3(box(2, 3, 0.5), [1, -1, 0.9]))).toBeCloseTo(0.9 * 3, 13);
  });

  it('ball of radius r centred at height z₀: z₀ · mesh volume (the icosphere is centrally symmetric, centroid at its centre)', () => {
    const ball = translateMesh3(icosphere(0.4, 3), [0, 0, 1.1]);
    expect(relErr(firstMomentZ(ball), 1.1 * mesh3Volume(icosphere(0.4, 3)))).toBeLessThan(1e-13);
  });

  it('half-ball z ≥ 0 of the unit ball: between ρ⁴ π/4 and π/4 (π ∫₀¹ z (1 − z²) dz = π/4 for the ball)', () => {
    // The polyhedron lies between the inscribed ball ρB and B; integrand z ≥ 0 on z ≥ 0,
    // and ∫_{ρB, z≥0} z dV = π ρ⁴ / 4.
    const ball = icosphere(1, 3);
    const rho = inscribedRadius(ball);
    const m = firstMomentZ(clipMesh3(ball, [0, 0, 1], 0));
    expect(m).toBeGreaterThanOrEqual((Math.PI / 4) * rho ** 4);
    expect(m).toBeLessThanOrEqual(Math.PI / 4);
  });
});

describe('SpunSolid construction (MATH.md §9.2)', () => {
  const cube = translateMesh3(box(1, 1, 1), [0, 0, 1.2]); // z ∈ [0.7, 1.7]

  it('spin(cube) has the vertex copies, tets and bounds the construction prescribes', () => {
    const s = spin(cube, N, 'cube');
    expect(s).toBeInstanceOf(SpunSolid);
    expect(s.kind).toBe('lifted');
    expect(s.name).toBe('cube');
    expect(s.steps).toBe(N);
    expect(s.clipped).toBe(false);
    expect(s.mesh).toBe(cube); // not clipped: the input itself
    // No vertex in z = 0: 8 vertices × 48 copies; 12 triangles × 48 steps × 3 tets.
    expect(s.complex.positions.length).toBe(8 * N);
    expect(s.complex.tets.length).toBe(12 * N * 3);
    // Copy k of vertex (x, y, z) is (x, y, z cos φ_k, z sin φ_k), φ_k = 2πk/48; the
    // quadrant steps are exact, so w = 0 passes through k = 0 and k = N/2 exactly.
    for (let i = 0; i < 8; i++) {
      const [x, y, z] = cube.positions[i];
      for (const k of [0, 1, 7, 12, 24, 35, 47]) {
        const p = s.complex.positions[i * N + k];
        const phi = (2 * Math.PI * k) / N;
        expect(p[0]).toBe(x);
        expect(p[1]).toBe(y);
        expect(p[2]).toBeCloseTo(z * Math.cos(phi), 14);
        expect(p[3]).toBeCloseTo(z * Math.sin(phi), 14);
      }
      expect(s.complex.positions[i * N + 0].slice(2)).toEqual([z, 0]);
      expect(s.complex.positions[i * N + 12].slice(2)).toEqual([0, z]);
      expect(s.complex.positions[i * N + 24].slice(2)).toEqual([-z, 0]);
      expect(s.complex.positions[i * N + 36].slice(2)).toEqual([0, -z]);
    }
    // |p|² = x² + y² + z², so the radius is the cube's farthest corner: √(0.25 + 0.25 + 1.7²).
    expect(s.radius()).toBeCloseTo(Math.sqrt(0.5 + 1.7 * 1.7), 13);
    expect(s.wRange()).toEqual([-1.7, 1.7]);
  });

  it('default steps is 48; bad step counts and a solid with nothing above z = 0 are rejected', () => {
    expect(spin(cube, undefined, 'cube').steps).toBe(48);
    expect(() => spin(cube, 2, 'x')).toThrow(/steps/);
    expect(() => spin(cube, 4.5, 'x')).toThrow(/steps/);
    // A cube below the plane clips to nothing; a cube lying exactly in z ≤ 0 has no triangle above it.
    expect(() => spin(translateMesh3(box(1, 1, 1), [0, 0, -2]), 12, 'below')).toThrow(/nothing to spin/);
    expect(() => spin(translateMesh3(box(1, 1, 1), [0, 0, -0.5]), 12, 'touching below')).toThrow(/nothing to spin/);
  });

  it('every tet is outward: the hypervolume is positive and equals signedHypervolume of the complex', () => {
    const s = spin(cube, N, 'cube');
    expect(s.hypervolume()).toBeGreaterThan(0);
    expect(s.hypervolume()).toBe(signedHypervolume(s.complex.positions, s.complex.tets));
  });

  it('tet orientation: each tet normal is parallel to (n_x, n_y, n_z/cos(π/N) · (cos φ, sin φ)) at the step middle, hence agrees with the spun normal', () => {
    // The prism over a triangle with outward normal n and step k lies in a 3-flat spanned by the
    // triangle's plane at φ_k and the chord direction δ = u(φ_{k+1}) − u(φ_k) in the zw-plane.
    // Its normal N has N · δ = 0, so its (z, w) part is along u(φ_mid) (δ ⊥ u(φ_mid)), say
    // λ u(φ_mid), and N · (e, f, g u(φ_k)) = 0 for every direction (e, f, g) ⊥ n of the triangle's
    // plane gives (N_x, N_y, λ cos(π/N)) ∥ n: N ∥ (n_x, n_y, (n_z / cos(π/N)) u(φ_mid)). The dot
    // product with the spun normal (n_x, n_y, n_z u(φ_mid)) is n_x² + n_y² + n_z²/cos(π/N) > 0.
    // An oblique triangle mesh (icosphere, all three normal components nonzero) tests the
    // formula, not just the sign. Tets are emitted per triangle, per step, three per prism.
    const steps = 12;
    const mesh = translateMesh3(icosphere(0.4, 1), [0.3, 0.2, 1.2]);
    const s = spin(mesh, steps, 'oblique');
    expect(s.complex.tets.length).toBe(mesh.triangles.length * steps * 3);
    const kappa = Math.cos(Math.PI / steps);
    let widest = 0;
    mesh.triangles.forEach(([a, b, c], ti) => {
      const n = cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a]));
      for (let k = 0; k < steps; k++) {
        const phi = (2 * Math.PI * (k + 0.5)) / steps;
        const pred = normalize4([n[0], n[1], (n[2] / kappa) * Math.cos(phi), (n[2] / kappa) * Math.sin(phi)]);
        const spun = normalize4([n[0], n[1], n[2] * Math.cos(phi), n[2] * Math.sin(phi)]);
        for (let j = 0; j < 3; j++) {
          const nt = normalize4(tetNormal(s.complex.positions, s.complex.tets[(ti * steps + k) * 3 + j]));
          widest = Math.max(widest, 1 - dot4(nt, pred));
          expect(dot4(nt, spun)).toBeGreaterThan(0.99); // 1/cos(π/12) = 1.035 skews it by at most ~1 %
        }
      }
    });
    expect(widest).toBeLessThan(1e-12); // parallel to the prediction to rounding (1 − cos θ ~ θ²/2)
  });
});

describe('validity and Pappus for spun balls, cubes, half-balls and meshes touching z = 0 (§5.2, §9.2)', () => {
  // Each entry: a mesh and the number of steps. For every one the tet complex
  // must be valid (every face in exactly two tets, opposite orientations, no
  // degenerate tet), and the signed hypervolume must equal the discrete Pappus
  // value polygonFactor(N) · 2π ∫_S z dV with the moment from the 3D divergence
  // theorem: two independent computations of the same number. The moment of the
  // mesh that is actually spun (s.mesh, clipped when needed) is used.
  const cases: Array<[string, Mesh3, number]> = [
    ['spun ball (icosphere 0.4 at height 1.1)', translateMesh3(icosphere(0.4, 3), [0, 0, 1.1]), 48],
    ['spun cube (side 1 at height 1.2)', translateMesh3(box(1, 1, 1), [0, 0, 1.2]), 48],
    ['spun half-ball (icosphere 1 clipped at z = 0)', icosphere(1, 3), 48],
    ['uvSphere touching z = 0 at its pole vertex', translateMesh3(uvSphere(0.5, 12, 6), [0, 0, 0.5]), 48],
    ['box resting on z = 0 (a whole face in the plane)', translateMesh3(box(1, 1, 1), [0, 0, 0.5]), 48],
    ['cylinder resting on z = 0 (cap fan in the plane)', translateMesh3(cylinder(0.5, 1, 16), [0, 0, 0.5]), 36],
    ['torus resting on z = 0 (a ring of vertices in the plane)', translateMesh3(torus(1, 0.4, 24, 12), [0, 0, 0.4]), 24],
    ['ball crossing z = 0 (clipped)', translateMesh3(icosphere(0.5, 3), [0, 0, 0.1]), 48],
    ['ball crossing z = 0 through mesh vertices (clipped at z₀ = 0.25: some vertices lie exactly in the plane)', translateMesh3(icosphere(0.5, 3), [0, 0, 0.25]), 48],
  ];

  for (const [name, mesh, steps] of cases) {
    it(`${name}: valid complex, hypervolume = polygon factor × Pappus to 1e-9`, () => {
      const s = spin(mesh, steps, name);
      const v = validateTetComplex(s.complex.positions, s.complex.tets); // allowDegenerate: false
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.boundaryFaces).toBe(0);
      expect(v.degenerateTets).toBe(0);
      const pappus = discretePappus(s.mesh, steps);
      expect(pappus).toBeGreaterThan(0);
      expect(relErr(s.hypervolume(), pappus)).toBeLessThan(1e-9);
    });
  }

  it('prism counts at the plane: a box resting on z = 0 has 4 vertices in the plane and 18 tets per step', () => {
    // Bottom face (2 triangles) is F and is dropped. Each side face is a quad over a
    // bottom edge in the plane: the triangle with 2 plane vertices gives 1 tet per step
    // (the prism is a tet), the one with 1 plane vertex gives 2 (a pyramid); the top
    // face's 2 triangles give 3 each: 4 · (1 + 2) + 2 · 3 = 18. Positions: the 4 plane
    // vertices once each, the 4 top vertices N times.
    const s = spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5]), 48, 'resting box');
    expect(s.complex.positions.length).toBe(4 + 4 * 48);
    expect(s.complex.tets.length).toBe(18 * 48);
    // Pappus: vol 1, z̄ = 1/2: discrete value polygonFactor(48) · π.
    expect(relErr(s.hypervolume(), polygonFactor(48) * Math.PI)).toBeLessThan(1e-12);
  });

  it('a mesh whose bottom is within rounding of z = 0 is not clipped and is treated as lying in it', () => {
    // bottom face at z = −1e-13 (≪ SPIN_SNAP · N · radius): noise, not geometry.
    const noisy = translateMesh3(box(1, 1, 1), [0, 0, 0.5 - 1e-13]);
    const s = spin(noisy, 48, 'noisy');
    expect(s.clipped).toBe(false);
    const v = validateTetComplex(s.complex.positions, s.complex.tets);
    expect(v.ok).toBe(true);
    // Same combinatorics as the exact resting box.
    expect(s.complex.tets.length).toBe(18 * 48);
    // The 4 plane vertices are the single points (x, y, 0, 0); an off-plane copy has z or w nonzero.
    expect(s.complex.positions.filter((p) => p[2] === 0 && p[3] === 0).length).toBe(4);
  });

  it('vertices within SPIN_SNAP · N · radius of z = 0, on either side, are moved onto it (the spun mesh is the snapped mesh), so no sliver is spun', () => {
    const N = 48;
    const radius = Math.hypot(0.5, 0.5, 0.5);
    const band = SPIN_SNAP * N * radius;
    for (const sign of [-1, 1]) {
      const near = translateMesh3(box(1, 1, 1), [0, 0, 0.5 + sign * 0.5 * band]);
      const s = spin(near, N, 'near');
      expect(s.clipped).toBe(false);
      expect(s.mesh).not.toBe(near);
      expect(s.mesh.positions.filter((p) => p[2] === 0).length).toBe(4); // exactly on the plane
      expect(s.complex.tets.length).toBe(18 * N); // as the exact resting box
      expect(validateTetComplex(s.complex.positions, s.complex.tets).ok).toBe(true);
      expect(relErr(s.hypervolume(), discretePappus(s.mesh, N))).toBeLessThan(1e-12);
    }
    // 1.5 bands below: geometry. The mesh is clipped and the clip is a valid complex too.
    const dip = spin(translateMesh3(box(1, 1, 1), [0, 0, 0.5 - 1.5 * band]), N, 'dip');
    expect(dip.clipped).toBe(true);
    expect(validateTetComplex(dip.complex.positions, dip.complex.tets).ok).toBe(true);
    // The input is not modified, and a mesh with nothing to snap is spun as is.
    const exact = translateMesh3(box(1, 1, 1), [0, 0, 0.5]);
    const copy = JSON.stringify(exact);
    expect(spin(exact, N, 'exact').mesh).toBe(exact);
    expect(JSON.stringify(exact)).toBe(copy);
  });
});

describe('wRange (MATH.md §10: the ends of the slice colour gradient)', () => {
  it('is the w extent of the complex: z_max when 4 | N, z_max · max sin φ_k otherwise (N = 6: z_max sin 60°)', () => {
    const cube = translateMesh3(box(1, 1, 1), [0, 0, 1.2]); // z_max = 1.7
    for (const N of [3, 5, 6, 7, 8, 12, 48]) {
      const s = spin(cube, N, 'cube');
      const ws = s.complex.positions.map((p) => p[3]);
      expect(s.wRange()[1]).toBeCloseTo(Math.max(...ws), 13);
      expect(s.wRange()[0]).toBeCloseTo(Math.min(...ws), 13);
    }
    expect(spin(cube, 6, 'N6').wRange()[1]).toBeCloseTo(1.7 * Math.sin(Math.PI / 3), 13);
    expect(spin(cube, 8, 'N8').wRange()).toEqual([-1.7, 1.7]);
  });
});

describe('a mesh crossing z = 0 is clipped first (MATH.md §9.2, §9.4)', () => {
  it('icosphere(0.5, 3) centred at z = 0.1: clipped, hypervolume = Pappus value of the clipped mesh, moment within the ball bounds', () => {
    const mesh = translateMesh3(icosphere(0.5, 3), [0, 0, 0.1]);
    const s = spin(mesh, 48, 'crossing');
    expect(s.clipped).toBe(true);
    expect(s.mesh).not.toBe(mesh);
    const clippedMesh = clipMesh3(mesh, [0, 0, 1], 0);
    expect(validateMesh3(clippedMesh).errors).toEqual([]);
    expect(relErr(s.hypervolume(), discretePappus(clippedMesh, 48))).toBeLessThan(1e-9);
    // Against the exact ball: ∫ z dV over {|p − (0,0,z₀)| ≤ r, z ≥ 0} =
    //   π ∫₀^b z (r² − (z − z₀)²) dz, b = z₀ + r, = π [r² b²/2 − (b⁴/4 − 2 z₀ b³/3 + z₀² b²/2)].
    // The polyhedron lies between the concentric balls of radii ρ r and r (ρ the inscribed
    // radius), the integrand is ≥ 0 on z ≥ 0, so the moment lies between the two exact values.
    const moment = (r: number, z0: number): number => {
      const b = z0 + r;
      return Math.PI * ((r * r * b * b) / 2 - (b ** 4 / 4 - (2 * z0 * b ** 3) / 3 + (z0 * z0 * b * b) / 2));
    };
    const rho = inscribedRadius(icosphere(1, 3));
    const m = firstMomentZ(clippedMesh);
    expect(m).toBeGreaterThanOrEqual(moment(0.5 * rho, 0.1));
    expect(m).toBeLessThanOrEqual(moment(0.5, 0.1));
    // A mesh not below the plane is passed through untouched.
    expect(spin(translateMesh3(icosphere(0.5, 2), [0, 0, 0.5]), 12, 'above').clipped).toBe(false);
  });
});

describe('the half-ball {|p| ≤ 1, z ≥ 0} spun is the 4-ball (MATH.md §9.2, §8.5)', () => {
  const ball = icosphere(1, 3);
  const half = spin(ball, N, 'half-ball');
  const rho = inscribedRadius(ball);

  it('is clipped, and its 4-volume is the polygon factor × Pappus to 1e-9, loosely π²/2', () => {
    expect(half.clipped).toBe(true);
    // The Pappus moment of the clipped mesh (independent clip call) and the discrete factor.
    const pappus = polygonFactor(N) * 2 * Math.PI * firstMomentZ(clipMesh3(ball, [0, 0, 1], 0));
    expect(relErr(half.hypervolume(), pappus)).toBeLessThan(1e-9);
    // Continuum value π²/2 = 4.9348: the discrete solid lies between the 4-ball of radius
    // κ ρ (ρ the polyhedron's inscribed radius, κ = cos(π/N): the N-gon over a fibre
    // contains the circle of radius κ z) and the unit 4-ball (every boundary tet is a convex
    // combination of unit vectors), so π²/2 (κρ)⁴ ≤ vol ≤ π²/2. ≈ 1.7 % wide.
    const cont = Math.PI ** 2 / 2;
    expect(half.hypervolume()).toBeGreaterThanOrEqual(cont * (KAPPA * rho) ** 4);
    expect(half.hypervolume()).toBeLessThanOrEqual(cont);
    expect(relErr(half.hypervolume(), cont)).toBeLessThan(0.02);
    expect(half.radius()).toBeCloseTo(1, 12);
    expect(half.wRange()).toEqual([-1, 1]);
    const v = validateTetComplex(half.complex.positions, half.complex.tets);
    expect(v.errors).toEqual([]);
  });

  it('slices at w = 0, 0.5, 0.9 are closed spheres with volume within the derived bracket of (4/3)π(1 − c²)^{3/2}', () => {
    // §8.5: the slice at w = c of the 4-ball is a ball of radius √(1 − c²). For the discrete
    // solid, sandwiched between the 4-balls of radius κρ and 1 as above, the slice at c lies
    // between the balls of radius √((κρ)² − c²) and √(1 − c²): volumes (4/3)π times the
    // 3/2 powers. The bracket widens as c → 1 (≈ 1.7 %, 2.4 %, 7 % here) because the slice
    // radius √(1 − c²) is then small against the polyhedron's radial error. Float32
    // output and the 6e-8 relative coordinate rounding are covered by 1e-5.
    for (const c of [0, 0.5, 0.9]) {
      const a = analyseSlice(half.slice(hyperplaneW(c)));
      expect(a.closed, `c = ${c}`).toBe(true);
      expect(a.consistent, `c = ${c}`).toBe(true);
      expect(a.euler, `c = ${c}`).toBe(2);
      const hi = ballVolume(Math.sqrt(1 - c * c));
      const lo = ballVolume(Math.sqrt((KAPPA * rho) ** 2 - c * c));
      expect(a.volume, `c = ${c}`).toBeGreaterThanOrEqual(lo * (1 - 1e-5));
      expect(a.volume, `c = ${c}`).toBeLessThanOrEqual(hi * (1 + 1e-5));
    }
    // At w = 0 the slice is S together with its mirror image, i.e. the whole polyhedral
    // ball: its volume is the mesh volume of icosphere(1, 3) exactly (the two halves meet
    // along the equator vertices, which are shared).
    const a0 = analyseSlice(half.slice(hyperplaneW(0)));
    expect(relErr(a0.volume, mesh3Volume(ball))).toBeLessThan(1e-5);
  });
});

describe('the spun ball: a torisphere (icosphere radius 0.4 at height 1.1) (MATH.md §9.2, §9.3)', () => {
  const ballMesh = translateMesh3(icosphere(0.4, 3), [0, 0, 1.1]);
  const s = spin(ballMesh, N, 'spun ball');
  const unit = icosphere(1, 3);
  const rho = inscribedRadius(unit);
  const meshVolume = mesh3Volume(icosphere(0.4, 3));

  it('hypervolume equals the discrete Pappus value 2π · 1.1 · vol · polygon factor to 1e-9; the continuum value within the bracket', () => {
    expect(s.clipped).toBe(false);
    // z̄ = 1.1 (central symmetry), so ∫ z dV = 1.1 · mesh volume; the discrete value is
    // polygonFactor(48) · 2π · 1.1 · mesh volume.
    const expected = polygonFactor(N) * 2 * Math.PI * 1.1 * meshVolume;
    expect(relErr(s.hypervolume(), expected)).toBeLessThan(1e-9);
    expect(relErr(s.hypervolume(), discretePappus(ballMesh, N))).toBeLessThan(1e-9);
    // Continuum 2π · 1.1 · (4/3)π 0.4³ (torisphere, §9.2): the ball polyhedron holds between
    // ρ³ and 1 of the ball's volume, and the polygon factor is the rest.
    const cont = 2 * Math.PI * 1.1 * ballVolume(0.4);
    expect(s.hypervolume()).toBeGreaterThanOrEqual(cont * rho ** 3 * polygonFactor(N) * (1 - 1e-12));
    expect(s.hypervolume()).toBeLessThanOrEqual(cont * polygonFactor(N) * (1 + 1e-12));
    // Valid complex.
    const v = validateTetComplex(s.complex.positions, s.complex.tets);
    expect(v.errors).toEqual([]);
    // |p| is at most 1.1 + 0.4 (the pole vertex), and w spans ±1.5.
    expect(s.radius()).toBeCloseTo(1.5, 12);
    expect(s.wRange()).toEqual([-1.5, 1.5]);
  });

  it('the slice at w = 0 is two balls: closed, Euler 4, volume 2 × the ball mesh, mirror symmetric in z', () => {
    const slice = s.slice(hyperplaneW(0));
    const a = analyseSlice(slice);
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.euler).toBe(4); // two spheres: 2 + 2
    // The hyperplane w = 0 contains the steps k = 0 (z ≥ 0 side) and k = N/2 (the mirror
    // image z ↦ −z), and with the "limit from below" rule of §6 the slice is exactly those
    // two copies of the mesh: volume 2 · mesh volume, within Float32 rounding.
    expect(relErr(a.volume, 2 * meshVolume)).toBeLessThan(1e-5);
    // Against 2 (4/3)π 0.4³ the polyhedron is within ρ³ … 1.
    expect(a.volume).toBeGreaterThan(2 * ballVolume(0.4) * rho ** 3 * (1 - 1e-5));
    expect(a.volume).toBeLessThan(2 * ballVolume(0.4) * (1 + 1e-5));
    // Mirror symmetry: every vertex (x, y, z) has a partner (x, y, −z) within 1e-5.
    const welded = weldVertices(slice, 1e-6, true);
    const verts = Array.from({ length: welded.positions.length / 3 }, (_, i) => vertexAt(welded, i));
    expect(verts.length).toBeGreaterThanOrEqual(2 * 642); // the two icospheres
    const hasPartner = verts.map(([x, y, z]) => verts.some((q) => Math.abs(q[0] - x) < 1e-5 && Math.abs(q[1] - y) < 1e-5 && Math.abs(q[2] + z) < 1e-5));
    expect(hasPartner.every(Boolean)).toBe(true);
    // Both twins are present: vertices at z ≈ ±1.1.
    expect(verts.some((v) => v[2] > 1)).toBe(true);
    expect(verts.some((v) => v[2] < -1)).toBe(true);
    // The slice's source w is the hyperplane's: 0.
    for (const w of slice.sourceW) expect(Math.abs(w)).toBeLessThan(1e-6);
  });

  /**
   * Continuum slice volume of the spun ball of radius r centred at height z₀ with the
   * fibre annulus {k_in Z_b ≤ |(z, w)| ≤ k_out Z_t} (§9.2): over (x, y) with ρ = |(x, y)| < r,
   * h = √(r² − ρ²), Z_b = z₀ − h, Z_t = z₀ + h. The slice at w = c holds the z with
   * √(max((k_in Z_b)² − c², 0)) ≤ |z| ≤ √((k_out Z_t)² − c²), a set of length twice the
   * difference, so V = ∫ 2πρ · 2 (z_t − z_b) dρ (midpoint rule, 4000 points, error ≪ 1e-5).
   */
  const sliceVolume = (c: number, r: number, z0: number, kIn: number, kOut: number): number => {
    const n = 4000;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const rhoXY = ((i + 0.5) / n) * r;
      const h = Math.sqrt(r * r - rhoXY * rhoXY);
      const zt2 = (kOut * (z0 + h)) ** 2 - c * c;
      if (zt2 <= 0) continue;
      const zb2 = Math.max((kIn * (z0 - h)) ** 2 - c * c, 0);
      total += 2 * Math.PI * rhoXY * 2 * (Math.sqrt(zt2) - Math.sqrt(zb2)) * (r / n);
    }
    return total;
  };

  it('slices at |w| < 0.7 are two balls (Euler 4), at 0.7 < |w| < 1.5 one connected body (Euler 2), all within the derived bracket of §9.2', () => {
    // The fibre over (x, y) of the discrete solid is the region between two regular N-gons
    // of circumradii Z_b ≤ Z_t (heights of the polyhedron's lower and upper surface). An
    // N-gon contains the disc of radius κ R and lies in the disc of radius R, so the fibre is
    // sandwiched: {Z_b ≤ |·| ≤ κ Z_t} ⊆ fibre ⊆ {κ Z_b ≤ |·| ≤ Z_t}. The polyhedron lies
    // between the concentric balls of radii ρ r and r, which moves Z_b, Z_t monotonically. So the
    // slice volume at w = c lies between sliceVolume(c, ρ r, 1.1, 1, κ) and
    // sliceVolume(c, r, 1.1, κ, 1), about 2 % apart, and the continuum value
    // sliceVolume(c, r, 1.1, 1, 1) (the §9.2 formula) is nearly inside. The slack 1e-4
    // covers the quadrature and the Float32 volume.
    const topology: Array<[number, number]> = [[0, 4], [0.3, 4], [0.5, 4], [0.8, 2], [1.0, 2], [1.2, 2], [1.4, 2]];
    for (const [c, euler] of topology) {
      const a = analyseSlice(s.slice(hyperplaneW(c)));
      expect(a.closed, `c = ${c}`).toBe(true);
      expect(a.consistent, `c = ${c}`).toBe(true);
      expect(a.euler, `c = ${c}`).toBe(euler);
      const lo = sliceVolume(c, 0.4 * rho, 1.1, 1, KAPPA);
      const hi = sliceVolume(c, 0.4, 1.1, KAPPA, 1);
      expect(a.volume, `c = ${c}`).toBeGreaterThanOrEqual(lo * (1 - 1e-4));
      expect(a.volume, `c = ${c}`).toBeLessThanOrEqual(hi * (1 + 1e-4));
      expect(hi / lo - 1, `c = ${c}`).toBeLessThan(0.09); // the bracket is informative, 2–8 %
      // The slice at −c is the same as at c up to the symbolic perturbation (§6): the shape is
      // symmetric under w ↦ −w, and −c is not a vertex offset for these c.
      if (c > 0 && c !== 1.0) {
        const m = analyseSlice(s.slice(hyperplaneW(-c)));
        expect(relErr(m.volume, a.volume), `c = ±${c}`).toBeLessThan(1e-4);
      }
    }
  });

  it('beyond the greatest height z₀ + r = 1.5 the slice is empty', () => {
    for (const c of [1.6, 2, -1.6, -2]) {
      expect(s.slice(hyperplaneW(c)).indices.length, `c = ${c}`).toBe(0);
    }
  });
});

describe('Cavalieri: the slice integral equals the 4-volume along any direction (MATH.md §7)', () => {
  it('spun ball (icosphere(0.4, 2) at 1.1, 48 steps): ∫ A(c) dc matches signedHypervolume along e_w and two seeded directions', () => {
    // A coarser ball (320 triangles, 46 080 tets) keeps 3 × 200 slices cheap. The slicer and the tet
    // complex are independent computations of the same solid, so agreement to the midpoint-rule
    // error of 200 steps (A(c) is piecewise smooth with a few kinks; measured 3e-6 here)
    // checks both. The 1 % tolerance of the spec is loose; 1e-3 is used.
    const ball = spin(translateMesh3(icosphere(0.4, 2), [0, 0, 1.1]), N, 'coarse ball');
    const hv = ball.hypervolume();
    const r = rng(777);
    const directions: Vec4[] = [[0, 0, 0, 1], randUnit4(r), randUnit4(r)];
    for (const d of directions) {
      const integral = sliceVolumeIntegral(ball, d, 200);
      expect(relErr(integral, hv), `direction ${d.join(',')}`).toBeLessThan(1e-3);
    }
  });

  it('a tilted hyperplane through a spun cube gives a closed slice', () => {
    const cube = spin(translateMesh3(box(1, 1, 1), [0, 0, 1.2]), N, 'cube');
    const a = analyseSlice(cube.slice(hyperplane([0.3, 0.2, 0.4, 0.8], 0.1)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.volume).toBeGreaterThan(0);
  });
});

describe('the spun cube: a solid ring with square cross-section (MATH.md §9.2)', () => {
  const cubeMesh = translateMesh3(box(1, 1, 1), [0, 0, 1.2]);
  const s = spin(cubeMesh, N, 'spun cube');

  it('is valid, and its hypervolume is the polygon factor × 2π · 1.2 · 1 (the continuum value within that factor)', () => {
    const v = validateTetComplex(s.complex.positions, s.complex.tets);
    expect(v.ok).toBe(true);
    // Pappus: vol 1, centroid height 1.2: 2π · 1.2 = 7.5398; the planar-faced cube is exact, so the
    // discrete value is that times polygonFactor(48) = 0.99886 to rounding.
    expect(relErr(s.hypervolume(), polygonFactor(N) * 2 * Math.PI * 1.2)).toBeLessThan(1e-12);
    expect(relErr(s.hypervolume(), 2 * Math.PI * 1.2)).toBeCloseTo(1 - polygonFactor(N), 12);
    expect(relErr(s.hypervolume(), discretePappus(cubeMesh, N))).toBeLessThan(1e-9);
  });

  it('wire: 8·48 vertices, 18·48 + 8·48 = 1248 edges, 12·48 + 18·48 = 1440 faces', () => {
    // The cube mesh has 8 vertices, 18 edges (12 box edges + 6 face diagonals) and 12 triangles.
    // Edges: the mesh's edges at each of 48 steps plus one step edge per vertex per step.
    // Faces: the triangles at each step plus one quad per mesh edge per step.
    const w = s.wire();
    expect(w).toBe(s.wire()); // cached
    expect(w.positions).toBe(s.complex.positions);
    expect(w.positions.length).toBe(384);
    expect(w.edges.length).toBe(18 * N + 8 * N);
    expect(w.faces.length).toBe(12 * N + 18 * N);
    expect(w.faces.filter((f) => f.length === 4).length).toBe(18 * N);
    expect(w.faces.filter((f) => f.length === 3).length).toBe(12 * N);
  });

  it('slice at w = 0 is two cubes (volume 2 exactly, Euler 4); at w = 0.5 two slabs; at 0.9 and 1.3 one body, all within the derived brackets', () => {
    // Fibre over (x, y) ∈ [−1/2, 1/2]²: heights z ∈ [0.7, 1.7], so the fibre is the annulus
    // between N-gons of circumradii 0.7 and 1.7 (§9.2). By the N-gon sandwich of the spun-ball
    // test (an N-gon of circumradius R holds the circle κR and lies in the circle R), the slice at
    // w = c has, for each (x, y), a z-set of length 2 (z_t − z_b) with z_t ∈ [√((1.7κ)² − c²),
    // √(1.7² − c²)] and z_b ∈ [√(max((0.7κ)² − c², 0)), √(max(0.7² − c², 0))]; the area
    // factor of (x, y) is 1. So V(c) ∈ [2 (z_t,min − z_b,max), 2 (z_t,max − z_b,min)]
    // (twins: the factor 2 is both signs of z). At c = 0 this is [2(1.7κ − 0.7), 2(1.7 − 0.7κ)],
    // loose; but at c = 0 the slice is exactly the two cubes (steps k = 0, N/2), volume 2.
    const a0 = analyseSlice(s.slice(hyperplaneW(0)));
    expect(a0.closed).toBe(true);
    expect(a0.euler).toBe(4);
    expect(relErr(a0.volume, 2)).toBeLessThan(1e-5);
    const bracket = (c: number): [number, number] => {
      const sq = (x: number): number => Math.sqrt(Math.max(x, 0));
      const lo = 2 * (sq((1.7 * KAPPA) ** 2 - c * c) - sq(0.7 * 0.7 - c * c));
      const hi = 2 * (sq(1.7 * 1.7 - c * c) - sq((0.7 * KAPPA) ** 2 - c * c));
      return [lo, hi];
    };
    for (const [c, euler] of [[0.5, 4], [0.9, 2], [1.3, 2]] as const) {
      const a = analyseSlice(s.slice(hyperplaneW(c)));
      expect(a.closed, `c = ${c}`).toBe(true);
      expect(a.consistent, `c = ${c}`).toBe(true);
      expect(a.euler, `c = ${c}`).toBe(euler); // two slabs until |c| = 0.7, then one prism with curved caps
      const [lo, hi] = bracket(c);
      expect(a.volume, `c = ${c}`).toBeGreaterThanOrEqual(lo * (1 - 1e-5));
      expect(a.volume, `c = ${c}`).toBeLessThanOrEqual(hi * (1 + 1e-5));
      expect(hi / lo - 1, `c = ${c}`).toBeLessThan(0.01);
    }
    expect(s.slice(hyperplaneW(1.8)).indices.length).toBe(0);
  });
});

describe('wire structure of a spun mesh with vertices in z = 0 (MATH.md §9.2)', () => {
  it('half-ball: counts follow from the clipped mesh, indices are in range, no duplicate edges, no degenerate faces', () => {
    const ball = icosphere(1, 2);
    const s = spin(ball, 24, 'half-ball');
    const mesh = s.mesh; // the clipped mesh
    const flat = (i: number): boolean => mesh.positions[i][2] <= 1e-9;
    const boundary = mesh.triangles.filter((t) => !t.every(flat)); // F is dropped
    const edges = mesh3Edges({ positions: mesh.positions, triangles: boundary });
    const bothFlat = edges.filter(([i, j]) => flat(i) && flat(j)).length;
    const bothUp = edges.filter(([i, j]) => !flat(i) && !flat(j)).length;
    const mixed = edges.length - bothFlat - bothUp;
    const used = new Set(boundary.flat());
    const up = [...used].filter((i) => !flat(i)).length;
    const onPlane = used.size - up;
    const n = 24;
    const w = s.wire();
    // Positions: one per plane vertex, n per vertex above the plane.
    expect(w.positions.length).toBe(onPlane + n * up);
    // Edges: an edge with both ends in the plane once; every other mesh edge at every step; one step
    // edge per vertex above the plane per step.
    expect(w.edges.length).toBe(bothFlat + n * (bothUp + mixed) + n * up);
    // Faces: the non-F triangles at every step; one quad per edge with both ends above the plane per step.
    expect(w.faces.length).toBe(n * boundary.length + n * bothUp);
    const keys = new Set<string>();
    for (const [a, b] of w.edges) {
      expect(a).not.toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(Math.max(a, b)).toBeLessThan(w.positions.length);
      keys.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
    expect(keys.size).toBe(w.edges.length);
    for (const f of w.faces) {
      expect(new Set(f).size).toBe(f.length);
      expect(f.length === 3 || f.length === 4).toBe(true);
      for (const i of f) expect(i).toBeLessThan(w.positions.length);
    }
    // The plane vertices are the points (x, y, 0, 0), once each; an off-plane copy has z or w nonzero.
    expect(w.positions.filter((p) => p[2] === 0 && p[3] === 0).length).toBe(onPlane);
  });
});

describe('the spun catalogue (SPUN_SHAPES) and figures', () => {
  it('lists the four spun shapes with the registry ids, one-sentence descriptions and working factories', () => {
    expect(SPUN_SHAPES.map((e) => e.id)).toEqual([SHAPE_IDS.spunBall, SHAPE_IDS.spunHalfBall, SHAPE_IDS.spunCube, SHAPE_IDS.spunHuman]);
    expect(SPUN_SHAPES.map((e) => e.id)).toEqual(['spun-ball', 'spun-half-ball', 'spun-cube', 'spun-human']);
    for (const entry of SPUN_SHAPES) {
      expect(entry.group).toBe('Spun 3D objects');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(40);
      expect(entry.description.endsWith('.')).toBe(true);
      expect(entry.description.slice(0, -1)).not.toMatch(/\.\s/); // one sentence
      expect(entry.description).toMatch(/mirror/);
    }
  });

  it('spunBall, spunHalfBall and spunCube build the documented solids', () => {
    const ball = spunBall();
    expect(ball).toBeInstanceOf(SpunSolid);
    expect(ball.steps).toBe(48);
    expect(ball.clipped).toBe(false);
    expect(ball.wRange()).toEqual([-1.5, 1.5]);
    expect(ball.complex.tets.length).toBe(1280 * 48 * 3); // icosphere level 3 has 1280 triangles, none in z = 0
    const half = spunHalfBall();
    expect(half.clipped).toBe(true);
    expect(half.wRange()).toEqual([-1, 1]);
    const cube = spunCube();
    expect(cube.wRange()).toEqual([-1.7, 1.7]);
    expect(relErr(cube.hypervolume(), polygonFactor(48) * 2 * Math.PI * 1.2)).toBeLessThan(1e-12);
    for (const entry of SPUN_SHAPES.slice(0, 3)) {
      const shape = entry.create();
      expect(shape.kind).toBe('lifted');
      expect(shape.radius()).toBeGreaterThan(0);
      expect(shape.wire()).not.toBeNull();
    }
  });

  it('humanParts() are the 16 meshes human() extrudes, unchanged by the refactor', () => {
    const parts = humanParts();
    expect(parts.length).toBe(16);
    const figure = human();
    expect(figure.parts.length).toBe(16);
    parts.forEach((mesh, i) => {
      const part = figure.parts[i] as ExtrudedSolid;
      expect(part).toBeInstanceOf(ExtrudedSolid);
      expect(part.mesh.positions).toEqual(mesh.positions);
      expect(part.mesh.triangles).toEqual(mesh.triangles);
      expect(validateMesh3(mesh).closed).toBe(true);
    });
    // The head's crown is at y = +1, the soles at y = −1 (human(): 2 units tall).
    const ys = parts.flatMap((m) => m.positions.map((p) => p[1]));
    expect(Math.max(...ys)).toBeCloseTo(1, 12);
    expect(Math.min(...ys)).toBeCloseTo(-1, 12);
  });

  it('spunHuman: 16 spun parts shifted so the figure starts at z = 0.25, every part valid with its Pappus hypervolume', () => {
    const figure = spunHuman();
    expect(figure).toBeInstanceOf(CompoundShape);
    expect(figure.kind).toBe('compound');
    expect(figure.parts.length).toBe(16);
    let minZ = Infinity;
    let maxZ = -Infinity;
    figure.parts.forEach((part) => {
      expect(part).toBeInstanceOf(SpunSolid);
      const p = part as SpunSolid;
      expect(p.steps).toBe(36);
      expect(p.clipped).toBe(false);
      for (const q of p.mesh.positions) { minZ = Math.min(minZ, q[2]); maxZ = Math.max(maxZ, q[2]); }
      const v = validateTetComplex(p.complex.positions, p.complex.tets);
      expect(v.errors, p.name).toEqual([]);
      expect(relErr(p.hypervolume(), discretePappus(p.mesh, 36)), p.name).toBeLessThan(1e-9);
    });
    // The lowest point of the figure is at z = 0.25 (the shift is 0.25 − min z of the unshifted parts).
    expect(minZ).toBeCloseTo(0.25, 12);
    const unshifted = humanParts().flatMap((m) => m.positions.map((q) => q[2]));
    expect(maxZ - minZ).toBeCloseTo(Math.max(...unshifted) - Math.min(...unshifted), 12);
    // Spinning the figure about z = 0 puts its parts' z-extent ± in w.
    expect(figure.wRange()[1]).toBeCloseTo(maxZ, 12);
    expect(figure.wRange()[0]).toBeCloseTo(-maxZ, 12);
    // A slice at w = 0.1 (below the figure's smallest height 0.25) is the two twins: closed.
    const a = analyseSlice(figure.slice(hyperplaneW(0.1)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.volume).toBeGreaterThan(0);
    expect(figure.slice(hyperplaneW(maxZ + 0.1)).indices.length).toBe(0);
  });
});
