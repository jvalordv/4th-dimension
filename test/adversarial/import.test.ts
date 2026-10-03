/**
 * Adversarial tests for the import module (MATH.md §12 with the liftings of
 * §9.1 and §9.2): parseObj and fromBufferGeometry (src/app/obj.ts),
 * normaliseMesh, registerImportedShape and sceneToMesh3 (src/app/import.ts),
 * and the `caps` option of extrude that open models rely on.
 *
 * Every expected value is derived in the comment above its test from MATH.md
 * or from standard geometry, with the tolerance justified; nothing is copied
 * from other test files. Random directions come from a seeded generator so a
 * failure can be reproduced.
 */
import { describe, expect, it } from 'vitest';
import {
  BoxGeometry, BufferGeometry, Group, InstancedMesh, Int8BufferAttribute, Matrix4, Mesh,
  SphereGeometry, TorusGeometry, TorusKnotGeometry,
} from 'three';
import type { Vec3, Vec4 } from '../../src/math/types';
import { hyperplane, hyperplaneW, unchart } from '../../src/math/hyperplane';
import { length3 } from '../../src/math/vec';
import { boundingSphere, fromBufferGeometry, parseObj, WELD_TOLERANCE } from '../../src/app/obj';
import {
  closednessText, describeReport, IMPORT_EXTRUDE_HALF_HEIGHT, IMPORT_SPIN_STEPS,
  normaliseMesh, registerImportedShape, sceneToMesh3,
} from '../../src/app/import';
import type { ImportReport } from '../../src/app/import';
import { getShape, IMPORT_ID_PREFIX, listShapes } from '../../src/app/registry';
import type { Mesh3, Triangle } from '../../src/geometry/mesh3';
import { box, flipMesh3, mesh3Volume, torus, torusKnot, torusKnotCurve, uvSphere, validateMesh3 } from '../../src/geometry/mesh3';
import { ExtrudedSolid } from '../../src/geometry/extrude';
import { SpunSolid } from '../../src/geometry/spin';
import { analyseSlice, triangleCount, vertexAt } from '../../src/geometry/trimesh';
import { sliceVolumeIntegral } from '../../src/geometry/shape';
import { validateTetComplex } from '../../src/geometry/tets';

// ---- Helpers -----------------------------------------------------------------

/** Mulberry32: a small seeded PRNG, uniform on [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal by Box–Muller (the first of the pair). */
const gaussian = (rng: () => number): number => {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Uniform random unit vector of R^4 (a normalised Gaussian vector is isotropic). */
function randomUnit4(rng: () => number): Vec4 {
  const v: Vec4 = [gaussian(rng), gaussian(rng), gaussian(rng), gaussian(rng)];
  const l = Math.hypot(v[0], v[1], v[2], v[3]);
  return [v[0] / l, v[1] / l, v[2] / l, v[3] / l];
}

const expectClose = (actual: number, expected: number, tol: number): void => {
  expect(Math.abs(actual - expected), `expected ${actual} to be within ${tol} of ${expected}`).toBeLessThanOrEqual(tol);
};

/** Centre of the axis-aligned bounding box of a mesh's vertices. */
function bboxCentre(mesh: Mesh3): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/**
 * The cube (±1)³: vertex i has x = +1 iff bit 0 of i, y iff bit 1, z iff bit 2.
 * Each quad below is counter-clockwise seen from outside; e.g. the −x face
 * (0, 4, 6, 2): (v4 − v0) × (v6 − v4) = (+z) × (+y) = −x, the outward normal.
 */
const CUBE_VERTS: Vec3[] = Array.from({ length: 8 }, (_, i): Vec3 => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
const CUBE_QUADS: number[][] = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];

/** OBJ text of the cube with its six faces as quads; `corner` formats a 0-based vertex index as an OBJ corner. */
function cubeObjText(corner: (i: number) => string = (i) => String(i + 1), eol = '\n'): string {
  const lines = CUBE_VERTS.map((v) => `v ${v[0]} ${v[1]} ${v[2]}`);
  for (const q of CUBE_QUADS) lines.push(`f ${q.map(corner).join(' ')}`);
  return lines.join(eol);
}

/** Half-side of the cube (±1)³ once normalised to bounding radius 1 (its corners are at distance √3). */
const A = 1 / Math.sqrt(3);
/** Volume of that normalised cube, (2A)³ = 8/(3√3). */
const CUBE_VOL = 8 * A ** 3;

/**
 * The cube with each face given its own four vertices (24 in all, as glTF
 * and three.js emit it), copy f of a corner displaced by `spacing · f` along
 * x, so that the copies of one corner form a chain of spacing `spacing`.
 */
function splitCube(spacing: number): Mesh3 {
  const positions: Vec3[] = [];
  const triangles: Triangle[] = [];
  CUBE_QUADS.forEach((q, f) => {
    const base = positions.length;
    for (const i of q) positions.push([CUBE_VERTS[i][0] + spacing * f, CUBE_VERTS[i][1], CUBE_VERTS[i][2]]);
    triangles.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
  });
  return { positions, triangles };
}

/**
 * Exact volume of the polyhedral surface of revolution with W angular steps
 * of the meridian polygon with vertices (r sin(kπ/H), r cos(kπ/H)),
 * k = 0..H: the horizontal cross-section at height z is a regular W-gon of
 * circumradius ρ(z), ρ linear between rings, of area (W/2) ρ² sin(2π/W), and
 * ∫ ρ² dz over a frustum of height Δz is Δz (ρ₀² + ρ₀ρ₁ + ρ₁²)/3. This is
 * what both three's SphereGeometry and mesh3's uvSphere tessellate.
 */
function revolvedSphereVolume(r: number, W: number, H: number): number {
  let integral = 0;
  for (let k = 0; k < H; k++) {
    const z0 = r * Math.cos((Math.PI * k) / H);
    const z1 = r * Math.cos((Math.PI * (k + 1)) / H);
    const r0 = r * Math.sin((Math.PI * k) / H);
    const r1 = r * Math.sin((Math.PI * (k + 1)) / H);
    integral += ((z0 - z1) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
  }
  return integral * (W / 2) * Math.sin((2 * Math.PI) / W);
}

/** Number of triangles of `mesh` that use vertex `v`. */
const degree = (mesh: Mesh3, v: number): number => mesh.triangles.filter((t) => t.includes(v)).length;

// ---- parseObj --------------------------------------------------------------------

describe('parseObj (MATH.md §12: a model arrives as triangles)', () => {
  it('fan-triangulates quads keeping the winding: the cube (±1)³ as six quads is 8 vertices, 12 triangles, volume exactly 8', () => {
    const mesh = parseObj(cubeObjText());
    expect(mesh.positions.length).toBe(8);
    expect(mesh.triangles.length).toBe(12);
    // Divergence theorem (§6): Σ v₀·(v₁×v₂)/6 = 8 for the outward cube. Every
    // product is an integer, so the sum (48) and the quotient are exact.
    expect(mesh3Volume(mesh)).toBe(8);
    const v = validateMesh3(mesh);
    expect(v.closed).toBe(true);
    expect(v.consistent).toBe(true);
    expect(v.euler).toBe(2); // V − E + F = 8 − 18 + 12
    expect(v.edgeCount).toBe(18); // 12 cube edges + 6 face diagonals
  });

  it('an inside-out quad cube stays inside out: the fan carries the winding, volume exactly −8', () => {
    // Reversing each quad reverses both fan triangles, so the signed volume
    // changes sign and nothing else: the parser must not "repair" it (that is
    // normaliseMesh's job, §12).
    const text = CUBE_VERTS.map((v) => `v ${v.join(' ')}`)
      .concat(CUBE_QUADS.map((q) => `f ${[...q].reverse().map((i) => i + 1).join(' ')}`)).join('\n');
    const mesh = parseObj(text);
    expect(mesh3Volume(mesh)).toBe(-8);
    expect(validateMesh3(mesh).consistent).toBe(true);
  });

  it('n-gons: a hexagonal prism with two 6-gon faces and six quads has 20 triangles and volume 3√3', () => {
    // Regular hexagon of circumradius 1 has area (3√3/2); height 2 gives 3√3.
    // The fan from the first corner is exact for a convex polygon. Triangles:
    // 2 × (6 − 2) for the hexagons + 6 × 2 for the quads = 20; vertices 12,
    // edges 12 + 6 + 2·3 (hexagon fan diagonals) + 6 (quad diagonals) = 30;
    // Euler 12 − 30 + 20 = 2.
    const lines: string[] = [];
    for (const z of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI * k) / 3;
        lines.push(`v ${Math.cos(a)} ${Math.sin(a)} ${z}`);
      }
    }
    // Bottom ring is 1..6 (z = −1), top ring 7..12 (z = +1).
    lines.push('f 7 8 9 10 11 12'); // top, counter-clockwise seen from +z
    lines.push('f 1 6 5 4 3 2'); // bottom, counter-clockwise seen from −z
    for (let k = 0; k < 6; k++) {
      const b0 = 1 + k;
      const b1 = 1 + ((k + 1) % 6);
      // (b₁ − b₀) is tangential (counter-clockwise), (t₀ − b₀) is +z;
      // tangential × z points radially outward.
      lines.push(`f ${b0} ${b1} ${b1 + 6} ${b0 + 6}`);
    }
    const mesh = parseObj(lines.join('\n'));
    expect(mesh.positions.length).toBe(12);
    expect(mesh.triangles.length).toBe(20);
    // cos/sin of multiples of π/3 are correct to 1 ulp; 20 triple products of
    // O(1) numbers accumulate at most ~1e-14.
    expectClose(mesh3Volume(mesh), 3 * Math.sqrt(3), 1e-12);
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.edgeCount).toBe(30);
    expect(v.euler).toBe(2);
  });

  it('negative indices count back from the most recent vertex at the point where the face appears', () => {
    // Tetrahedron A = (0,0,0), B = (1,0,0), C = (0,1,0), D = (0,0,1), volume 1/6.
    // Outward faces: (A,C,B) normal −z; (A,B,D): (1,0,0)×(0,0,1) = (0,−1,0);
    // (A,D,C): (0,0,1)×(0,1,0) = (−1,0,0); (B,C,D): (−1,1,0)×(−1,0,1) = (1,1,1).
    // The first face is written before D exists, so there −1 is C, −2 is B,
    // −3 is A; after D is defined −1 is D and A has become −4.
    const text = [
      'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
      'f -3 -1 -2', // A C B
      'v 0 0 1',
      'f -4 -3 -1', // A B D
      'f -4 -1 -2', // A D C
      'f -3 -2 -1', // B C D
    ].join('\n');
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(4);
    expect(mesh.triangles).toEqual([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]);
    expectClose(mesh3Volume(mesh), 1 / 6, 1e-15);
    expect(validateMesh3(mesh).closed).toBe(true);
  });

  it('mixing negative and positive indices in one face, with the negative ones resolved against the vertices so far', () => {
    // Same cube, every face written as "positive, negative, positive, negative".
    const mesh = parseObj(cubeObjText((i) => String(i + 1)) + '\n');
    const mixed = parseObj(CUBE_VERTS.map((v) => `v ${v.join(' ')}`)
      .concat(CUBE_QUADS.map((q) => `f ${q.map((i, k) => (k % 2 ? String(i - 8) : String(i + 1))).join(' ')}`)).join('\n'));
    expect(mixed.triangles).toEqual(mesh.triangles);
    expect(mesh3Volume(mixed)).toBe(8);
  });

  it('corner forms i/t, i//n and i/t/n use only the vertex index; vt and vn lines are not vertices', () => {
    // The tetrahedron above with texture and normal references thrown in; the
    // vt/vn indices are deliberately inconsistent and partly out of range for
    // the vertex count, which must not matter.
    const text = [
      'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 0 0 1',
      'vt 0 0', 'vt 1 0', 'vt 0 1',
      'vn 0 0 -1', 'vn 0 -1 0', 'vn -1 0 0', 'vn 1 1 1',
      'f 1/1/1 3/3/1 2/2/1',
      'f 1//2 2//2 4//2',
      'f 1/1 4/3 3/2',
      'f 2/2/4 3/3/4 4/9/4',
    ].join('\n');
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(4);
    expect(mesh.triangles.length).toBe(4);
    expectClose(mesh3Volume(mesh), 1 / 6, 1e-15);
    expect(validateMesh3(mesh).closed).toBe(true);
  });

  it('CRLF, lone CR and mixed line endings parse exactly like LF', () => {
    const lf = parseObj(cubeObjText());
    for (const eol of ['\r\n', '\r']) {
      const other = parseObj(cubeObjText(undefined, eol));
      expect(other.positions).toEqual(lf.positions);
      expect(other.triangles).toEqual(lf.triangles);
    }
    // Mixed endings and a trailing CRLF at the end of file.
    const lines = cubeObjText().split('\n');
    const mixed = lines.map((l, k) => l + (k % 3 === 0 ? '\r\n' : k % 3 === 1 ? '\n' : '\r')).join('');
    const m = parseObj(mixed);
    expect(m.positions).toEqual(lf.positions);
    expect(m.triangles).toEqual(lf.triangles);
  });

  it('leading whitespace and tabs, comment lines, inline comments, blank lines and repeated separators are tolerated', () => {
    const lf = parseObj(cubeObjText());
    const noisy = cubeObjText().split('\n').map((l, k) => {
      const indent = k % 2 ? '\t  ' : '    ';
      const spaced = l.replace(/ /g, k % 3 === 0 ? '\t' : '   ');
      return `${indent}${spaced}${k % 4 === 0 ? ' # trailing comment' : k % 4 === 1 ? '#glued' : ''}`;
    });
    const text = ['# header comment', '', '   ', ...noisy, '', '# end'].join('\n');
    const m = parseObj(text);
    expect(m.positions).toEqual(lf.positions);
    expect(m.triangles).toEqual(lf.triangles);
  });

  it("'o' and 'g' groups, 's', 'usemtl' and 'mtllib' are ignored and do not reset the global vertex numbering", () => {
    // Two cubes: the second translated by (5, 0, 0) and written with negative
    // indices. Positive indices in the first object are global (OBJ numbers
    // vertices across the whole file), so the second object's own vertices
    // are 9..16 and −8..−1 refers to them.
    const second = CUBE_VERTS.map((v) => `v ${v[0] + 5} ${v[1]} ${v[2]}`)
      .concat(CUBE_QUADS.map((q) => `f ${q.map((i) => String(i - 8)).join(' ')}`));
    const text = ['mtllib cubes.mtl', 'o cubeA', 'usemtl red', 's off', cubeObjText(), 'g groupB', 'o cubeB', ...second].join('\n');
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(16);
    expect(mesh.triangles.length).toBe(24);
    // Two disjoint outward cubes: 8 + 8 = 16, exact in integer arithmetic.
    expect(mesh3Volume(mesh)).toBe(16);
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.euler).toBe(4); // two spheres
    // After normalisation (§12) the pair is one model centred at the bbox
    // centre (2.5, 0, 0) with bounding radius √(3.5² + 1 + 1) = √14.25, so the
    // volume is 16 / 14.25^(3/2).
    const { mesh: out, report } = normaliseMesh(mesh);
    expect(report.closed).toBe(true);
    expect(report.boundaryEdges).toBe(0);
    expectClose(report.scale, 1 / Math.sqrt(14.25), 1e-15);
    expectClose(report.volume, 16 / 14.25 ** 1.5, 1e-13);
    expectClose(boundingSphere(out).radius, 1, 1e-14);
  });

  it('vertex count includes vertices no face uses; a 4th or further vertex component (w, colour) is ignored', () => {
    const text = [
      'v 0 0 0 1.0', // homogeneous weight
      'v 1 0 0 0.5 0.5 0.5', // vertex colour
      'v 0 1 0',
      'v 0 0 1',
      'v 99 99 99', // unused
      'v 1e2 -2.5E-1 +3', // scientific notation and explicit sign, also unused
      'f 1 3 2', 'f 1 2 4', 'f 1 4 3', 'f 2 3 4',
    ].join('\n');
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(6);
    expect(mesh.positions[5]).toEqual([100, -0.25, 3]);
    expect(mesh.triangles.length).toBe(4);
    expectClose(mesh3Volume(mesh), 1 / 6, 1e-15);
    // normaliseMesh drops the unused vertices (they are not part of the model,
    // §12 re-centres the *model*): the result has four vertices and the far
    // stray vertices do not shift the centre or inflate the radius. Without
    // the drop the bounding radius would be ~85 instead of √0.75.
    const { mesh: out, report } = normaliseMesh(mesh);
    expect(out.positions.length).toBe(4);
    expectClose(report.scale, 1 / Math.sqrt(0.75), 1e-15);
    expectClose(report.volume, (1 / 6) / 0.75 ** 1.5, 1e-14);
  });

  it('a trailing backslash continues a face or vertex onto the next line', () => {
    const text = [
      'v -1 -1 \\', '  -1',
      'v 1 -1 -1', 'v -1 1 -1', 'v 1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v -1 1 1', 'v 1 1 1',
      'f 1 5 \\', '7 3 # comment after a continued face',
      'f 2 4 8 6', 'f 1 2 6 5', 'f 3 7 8 4', 'f 1 3 4 2', 'f 5 6 8 7',
    ].join('\n');
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(8);
    expect(mesh.triangles.length).toBe(12);
    expect(mesh3Volume(mesh)).toBe(8);
  });

  it('a repeated corner in a face yields a repeated-index triangle that normalisation drops, leaving the closed cube', () => {
    // "f 1 5 5 7 3" fans to (1,5,5), (1,5,7), (1,7,3): the first is a repeated-
    // index triangle, the other two are the −x face. The welded model is the
    // ordinary closed cube (12 triangles).
    const text = CUBE_VERTS.map((v) => `v ${v.join(' ')}`)
      .concat(CUBE_QUADS.map((q, f) => `f ${(f === 0 ? [0, 4, 4, 6, 2] : q).map((i) => i + 1).join(' ')}`)).join('\n');
    const mesh = parseObj(text);
    expect(mesh.triangles.length).toBe(13);
    const { report } = normaliseMesh(mesh);
    expect(report.triangles).toBe(12);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expectClose(report.volume, CUBE_VOL, 1e-14);
  });

  it('errors name the offending line', () => {
    const cube = cubeObjText().split('\n');
    // Zero index on line 10 (vertices occupy lines 1..8, the first face is line 9).
    expect(() => parseObj([...cube.slice(0, 9), 'f 0 1 2', ...cube.slice(10)].join('\n'))).toThrow(/line 10\b/);
    // Out of range positive index on the last face line (14).
    expect(() => parseObj([...cube.slice(0, 13), 'f 5 6 9'].join('\n'))).toThrow(/line 14\b/);
    // Relative index reaching before the first vertex, on line 2.
    expect(() => parseObj(['v 0 0 0', 'f -2 -1 -1'].join('\n'))).toThrow(/line 2\b/);
    // A face with two corners, on line 9.
    expect(() => parseObj([...cube.slice(0, 8), 'f 1 2'].join('\n'))).toThrow(/line 9\b/);
    // Malformed vertex on line 3.
    expect(() => parseObj(['v 0 0 0', 'v 1 0 0', 'v 0 x 0', 'f 1 2 3'].join('\n'))).toThrow(/line 3\b/);
    // Too few vertex components on line 1.
    expect(() => parseObj('v 1 2\nf 1 1 1')).toThrow(/line 1\b/);
    // Non-integer index on line 5.
    expect(() => parseObj(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 0 0 1', 'f 1.5 2 3'].join('\n'))).toThrow(/line 5\b/);
    // A positive index may point forward to a vertex defined later: no error.
    expect(() => parseObj(['f 1 2 3', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0'].join('\n'))).not.toThrow();
  });
});

// ---- fromBufferGeometry -----------------------------------------------------------

describe('fromBufferGeometry (three.js primitives welded by position, §12)', () => {
  it('BoxGeometry(2,2,2): 24 per-face vertices weld to 8, 12 triangles, closed and outward with volume 8', () => {
    const geometry = new BoxGeometry(2, 2, 2);
    expect(geometry.getAttribute('position').count).toBe(24);
    const mesh = fromBufferGeometry(geometry);
    expect(mesh.positions.length).toBe(8);
    expect(mesh.triangles.length).toBe(12);
    // Float32 coordinates ±1 are exact, so the volume is exactly 8.
    expect(mesh3Volume(mesh)).toBe(8);
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.euler).toBe(2);
    // three's front faces are counter-clockwise from outside, so the model is
    // already outward and normalisation must not flip it.
    expect(normaliseMesh(mesh).report.flipped).toBe(false);
  });

  it('BoxGeometry with 2×2×2 segments welds to 26 vertices (8 corners, 12 edge midpoints, 6 face centres) and 48 triangles', () => {
    const mesh = fromBufferGeometry(new BoxGeometry(2, 2, 2, 2, 2, 2));
    expect(mesh.positions.length).toBe(26);
    expect(mesh.triangles.length).toBe(48); // 6 faces × 4 quads × 2
    expect(mesh3Volume(mesh)).toBe(8);
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.euler).toBe(2);
  });

  it('a non-indexed geometry (36 loose vertices) welds to the same cube as the indexed one', () => {
    const indexed = fromBufferGeometry(new BoxGeometry(2, 2, 2));
    const loose = new BoxGeometry(2, 2, 2).toNonIndexed();
    expect(loose.getIndex()).toBeNull();
    expect(loose.getAttribute('position').count).toBe(36);
    const mesh = fromBufferGeometry(loose);
    expect(mesh.positions.length).toBe(8);
    expect(mesh.triangles.length).toBe(12);
    expect(mesh3Volume(mesh)).toBe(8);
    expect(validateMesh3(mesh).closed).toBe(true);
    // Same vertex set (order may differ).
    const key = (p: Vec3): string => p.join(',');
    expect(new Set(mesh.positions.map(key))).toEqual(new Set(indexed.positions.map(key)));
  });

  it('SphereGeometry(1,16,8): the W+1 copies of each pole and the seam weld; V = 2 + (H−1)W, F = 2W(H−1), each pole in W triangles', () => {
    // three builds (W+1)(H+1) vertices: rings iy = 0..H at polar angle iyπ/H,
    // each with W+1 vertices (phi = 0 and 2π duplicated). Rows 0 and H are the
    // poles (ring radius √(r² − y²) = 0 exactly since cos 0 = 1 and cos π = −1
    // exactly), so all their copies coincide. Row quads give two triangles
    // except at the poles where one is skipped: F = 2W(H−1). Welded:
    // V = 2 + (H−1)W, E = F·3/2, Euler 2.
    const W = 16;
    const H = 8;
    const geometry = new SphereGeometry(1, W, H);
    expect(geometry.getAttribute('position').count).toBe((W + 1) * (H + 1));
    const mesh = fromBufferGeometry(geometry);
    expect(mesh.positions.length).toBe(2 + (H - 1) * W);
    expect(mesh.triangles.length).toBe(2 * W * (H - 1));
    const v = validateMesh3(mesh);
    expect(v.closed).toBe(true);
    expect(v.consistent).toBe(true);
    expect(v.euler).toBe(2);
    expect(v.degenerateTriangles).toBe(0);
    // The axis is y: the poles are the vertices with |y| = 1, each used by
    // exactly W fan triangles.
    const north = mesh.positions.findIndex((p) => p[1] > 0.999);
    const south = mesh.positions.findIndex((p) => p[1] < -0.999);
    expect(north).toBeGreaterThanOrEqual(0);
    expect(south).toBeGreaterThanOrEqual(0);
    expect(degree(mesh, north)).toBe(W);
    expect(degree(mesh, south)).toBe(W);
    // Volume: the tessellation is the revolved meridian polygon with W steps,
    // exactly what uvSphere(1, W, H) is (the quad diagonals differ, but the
    // quads are planar isosceles trapezoids, so the diagonal does not change
    // the enclosed volume). Positions are Float32 (relative 6e-8), so 1e-6
    // relative is a safe tolerance; the exact closed form is
    // (4/3)π · (W/2π) sin(2π/W) · cos²(π/2H).
    const expected = revolvedSphereVolume(1, W, H);
    expectClose(expected, (4 / 3) * Math.PI * (W / (2 * Math.PI)) * Math.sin((2 * Math.PI) / W) * Math.cos(Math.PI / (2 * H)) ** 2, 1e-14);
    expectClose(mesh3Volume(uvSphere(1, W, H)), expected, 1e-13);
    expectClose(mesh3Volume(mesh), expected, 1e-6 * expected);
  });

  it('SphereGeometry(1,3,2) is a triangular bipyramid: 5 vertices, 6 triangles, volume √3/2', () => {
    // One ring at the equator (θ = π/2) with 3 vertices at radius 1 forms an
    // equilateral triangle of area (3/2) sin(2π/3) = 3√3/4; two cones of
    // height 1 over it have volume 2 · (1/3) · (3√3/4) = √3/2.
    const mesh = fromBufferGeometry(new SphereGeometry(1, 3, 2));
    expect(mesh.positions.length).toBe(5);
    expect(mesh.triangles.length).toBe(6);
    expect(validateMesh3(mesh).closed).toBe(true);
    expectClose(mesh3Volume(mesh), Math.sqrt(3) / 2, 1e-6);
  });

  it('SphereGeometry(2.5,7,5) with odd counts: V = 2 + 4·7, F = 2·7·4, volume by the frustum sum (axis irrelevant)', () => {
    const W = 7;
    const H = 5;
    const mesh = fromBufferGeometry(new SphereGeometry(2.5, W, H));
    expect(mesh.positions.length).toBe(2 + (H - 1) * W);
    expect(mesh.triangles.length).toBe(2 * W * (H - 1));
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    const expected = revolvedSphereVolume(2.5, W, H);
    expectClose(mesh3Volume(mesh), expected, 1e-6 * expected);
    // Normalised (§12). With an odd W the rings are not symmetric in x (the
    // vertices sit at φ = 2πk/7, so x = −ρ cos φ spans [−ρ, 0.901ρ]) and the
    // bounding-box centre is off the axis: the farthest vertex from it is a
    // ring vertex, not a pole, at distance 2.6016, not 2.5. So the scale is
    // 1/ρ with ρ the bounding radius of the raw model (boundingSphere is the
    // independent definition), and the volume scales by scale³.
    const { mesh: out, report } = normaliseMesh(mesh);
    const raw = boundingSphere(mesh);
    expect(raw.radius).toBeGreaterThan(2.6);
    expectClose(report.scale, 1 / raw.radius, 1e-15);
    expectClose(report.volume, expected * report.scale ** 3, 1e-6 * report.volume);
    expectClose(boundingSphere(out).radius, 1, 1e-14);
    expect(report.flipped).toBe(false);
  });

  it('TorusKnotGeometry(1,0.4,64,8): the two seams weld to N·M vertices and 2NM triangles, closed with Euler 0 and a plausible volume', () => {
    // three builds (N+1)(M+1) vertices with ring N a copy of ring 0 (u = 2πp
    // vs 0) and corner M a copy of corner 0 (v = 2π vs 0), both within 1e-15
    // of each other, far below the 1e-6·radius weld tolerance. Welded: a
    // torus, V = NM, F = 2NM, E = 3NM, Euler 0.
    const N = 64;
    const M = 8;
    const geometry = new TorusKnotGeometry(1, 0.4, N, M, 2, 3);
    expect(geometry.getAttribute('position').count).toBe((N + 1) * (M + 1));
    const mesh = fromBufferGeometry(geometry);
    expect(mesh.positions.length).toBe(N * M);
    expect(mesh.triangles.length).toBe(2 * N * M);
    const v = validateMesh3(mesh);
    expect(v.closed).toBe(true);
    expect(v.consistent).toBe(true);
    expect(v.euler).toBe(0);
    expect(v.nonManifoldEdges).toBe(0);
    // Volume: a tube of radius r around a curve of length L has volume πr²L
    // (the tube formula, exact for r below the radius of curvature). The
    // discrete tube has an inscribed M-gon cross-section, factor
    // (M/2π) sin(2π/M), and 64 chords instead of arcs, so it falls a few per
    // cent short; three's frame is only approximately normal to the curve.
    // The curve is mesh3's torusKnotCurve (the same formula as three's, with
    // t = u/p); L by the midpoint rule with 20 000 samples is exact to ~1e-9.
    const samples = 20000;
    let L = 0;
    for (let i = 0; i < samples; i++) L += length3(torusKnotCurve(1, 2, 3, (2 * Math.PI * (i + 0.5)) / samples).tangent);
    L *= (2 * Math.PI) / samples;
    const pappus = Math.PI * 0.4 ** 2 * L * (M / (2 * Math.PI)) * Math.sin((2 * Math.PI) / M);
    const volume = mesh3Volume(mesh);
    expect(volume).toBeGreaterThan(0.95 * pappus);
    expect(volume).toBeLessThan(1.01 * pappus);
    // And within 2 % of mesh3's own torusKnot of the same parameters, which
    // differs only in the frame (rotation-minimising vs three's).
    const own = mesh3Volume(torusKnot(1, 0.4, 2, 3, N, M));
    expectClose(volume, own, 0.02 * own);
    expect(normaliseMesh(mesh).report.flipped).toBe(false);
  });

  it('reads a normalised integer position attribute as the floats it encodes', () => {
    // Int8 normalised: 127 ↦ 1.0, 0 ↦ 0. The unit tetrahedron, volume 1/6.
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Int8BufferAttribute([0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127], 3, true));
    geometry.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    const mesh = fromBufferGeometry(geometry);
    expect(mesh.positions.length).toBe(4);
    expect(mesh.triangles.length).toBe(4);
    expectClose(mesh3Volume(mesh), 1 / 6, 1e-12);
    expect(validateMesh3(mesh).closed).toBe(true);
  });

  it('throws for a geometry without a position attribute', () => {
    expect(() => fromBufferGeometry(new BufferGeometry())).toThrow(/position/);
  });
});

// ---- sceneToMesh3 -----------------------------------------------------------------

describe('sceneToMesh3 (world transforms, mirrors and instances)', () => {
  it('applies world matrices, flips mirrored parts back to outward, expands instances and skips invisible meshes', () => {
    const root = new Group();
    root.position.set(1, 2, 3);
    // A translated, rotated cube: volume unchanged (rigid motion).
    const moved = new Mesh(new BoxGeometry(2, 2, 2));
    moved.position.set(5, 0, 0);
    moved.rotation.set(0.3, -0.7, 1.1);
    root.add(moved);
    // A mirrored cube (scale −1 in x, determinant −1): its winding reverses in
    // world space, so the triangles must be flipped back; volume +8, not −8.
    const mirrored = new Mesh(new BoxGeometry(2, 2, 2));
    mirrored.position.set(-5, 0, 0);
    mirrored.scale.set(-1, 1, 1);
    root.add(mirrored);
    // Two instances of a cube scaled by 1/2 (volume 1 each).
    const instanced = new InstancedMesh(new BoxGeometry(2, 2, 2), undefined, 2);
    instanced.setMatrixAt(0, new Matrix4().makeScale(0.5, 0.5, 0.5).setPosition(0, 10, 0));
    instanced.setMatrixAt(1, new Matrix4().makeScale(0.5, 0.5, 0.5).setPosition(0, -10, 0));
    root.add(instanced);
    // An invisible cube is not part of the model.
    const hidden = new Mesh(new BoxGeometry(2, 2, 2));
    hidden.visible = false;
    root.add(hidden);

    const mesh = sceneToMesh3(root);
    expect(mesh.positions.length).toBe(8 * 4);
    expect(mesh.triangles.length).toBe(12 * 4);
    // Four disjoint closed outward cubes: 8 + 8 + 1 + 1. Rotation and
    // translation are computed in Float64 via Matrix4 (double) on Float32
    // input coordinates, so 1e-9 is generous.
    expectClose(mesh3Volume(mesh), 18, 1e-9);
    const v = validateMesh3(mesh);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.euler).toBe(8);
    // The root's own translation was applied: the moved cube's centroid is at (1+5, 2, 3).
    const moving = mesh.positions.slice(0, 8);
    const centroid = moving.reduce((acc, p): Vec3 => [acc[0] + p[0] / 8, acc[1] + p[1] / 8, acc[2] + p[2] / 8], [0, 0, 0]);
    expectClose(centroid[0], 6, 1e-9);
    expectClose(centroid[1], 2, 1e-9);
    expectClose(centroid[2], 3, 1e-9);
  });
});

// ---- normaliseMesh ----------------------------------------------------------------

describe('normaliseMesh (MATH.md §12: weld, centre, scale, validate, orient)', () => {
  const tetra: Mesh3 = {
    positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
  };

  it('puts the bounding-box centre at the origin to 1e-12 and makes the bounding radius 1 to a few ulps', () => {
    // The unit tetrahedron has bbox centre (1/2, 1/2, 1/2) and all four
    // vertices at distance √(3/4) from it, so every vertex lands on the unit
    // sphere. In exact arithmetic the centre is 0 and the radius 1; the only
    // error is the rounding of (p − c)·(1/ρ) per coordinate, a few 1e-16.
    for (const input of [tetra, box(2, 3, 5), fromBufferGeometry(new TorusKnotGeometry(1, 0.3, 40, 6, 2, 3))]) {
      const { mesh, report } = normaliseMesh(input);
      const c = bboxCentre(mesh);
      expect(Math.hypot(c[0], c[1], c[2])).toBeLessThanOrEqual(1e-12);
      const { centre, radius } = boundingSphere(mesh);
      expect(Math.hypot(centre[0], centre[1], centre[2])).toBeLessThanOrEqual(1e-12);
      expectClose(radius, 1, 1e-14);
      // The radius about the origin equals the bounding radius, and no vertex exceeds 1.
      expect(Math.max(...mesh.positions.map((p) => length3(p)))).toBeLessThanOrEqual(1 + 1e-14);
      expect(report.scale).toBeGreaterThan(0);
    }
    const t = normaliseMesh(tetra);
    expectClose(t.report.scale, 1 / Math.sqrt(0.75), 1e-15);
    // All four vertices are exactly on the unit sphere for this input.
    for (const p of t.mesh.positions) expectClose(length3(p), 1, 1e-14);
    expectClose(t.report.volume, (1 / 6) / 0.75 ** 1.5, 1e-14);
    expect(t.report.flipped).toBe(false);
  });

  it('is idempotent: normalising the normalised model changes nothing (scale 1, same vertices and triangles)', () => {
    for (const input of [tetra, box(2, 3, 5), fromBufferGeometry(new SphereGeometry(3, 12, 6))]) {
      const once = normaliseMesh(input);
      const twice = normaliseMesh(once.mesh);
      expect(twice.mesh.triangles).toEqual(once.mesh.triangles);
      expect(twice.mesh.positions.length).toBe(once.mesh.positions.length);
      once.mesh.positions.forEach((p, i) => {
        for (let k = 0; k < 3; k++) expectClose(twice.mesh.positions[i][k], p[k], 1e-15);
      });
      expectClose(twice.report.scale, 1, 1e-15);
      expect(twice.report.flipped).toBe(false);
      expectClose(twice.report.volume, once.report.volume, 1e-14);
      expect(twice.report.closed).toBe(once.report.closed);
      expect(twice.report.boundaryEdges).toBe(once.report.boundaryEdges);
    }
  });

  it('is invariant under translation and uniform scaling of the input (same normalised model, scale divided accordingly)', () => {
    const base = normaliseMesh(tetra);
    const s = 1e4;
    const d: Vec3 = [1e3, -2e3, 5e2];
    const moved: Mesh3 = {
      positions: tetra.positions.map((p): Vec3 => [p[0] * s + d[0], p[1] * s + d[1], p[2] * s + d[2]]),
      triangles: tetra.triangles,
    };
    const other = normaliseMesh(moved);
    // Coordinates up to ~1e4 with ~1e-16 relative rounding give ~1e-12
    // absolute error before scaling by 1/ρ ≈ 1e-4: far below 1e-9.
    other.mesh.positions.forEach((p, i) => {
      for (let k = 0; k < 3; k++) expectClose(p[k], base.mesh.positions[i][k], 1e-9);
    });
    expectClose(other.report.scale, base.report.scale / s, 1e-15 * base.report.scale / s);
    expectClose(other.report.volume, base.report.volume, 1e-9);
  });

  it('does not modify its input', () => {
    const input = flipMesh3(box(2, 2, 2));
    const snapshot = JSON.stringify(input);
    normaliseMesh(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('reverses an inside-out closed model: flipped true, positive volume 8/(3√3), outward triangles', () => {
    // box(2,2,2) has corners at distance √3, so the normalised cube has
    // half-side 1/√3 and volume 8/(3√3) ≈ 1.5396 (§12: a negative signed
    // volume means inside out, and the triangles are reversed).
    const { mesh, report } = normaliseMesh(flipMesh3(box(2, 2, 2)));
    expect(report.flipped).toBe(true);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expectClose(report.volume, CUBE_VOL, 1e-14);
    expectClose(mesh3Volume(mesh), CUBE_VOL, 1e-14);
    // Every face normal points away from the centre (outward for a convex solid).
    for (const [a, b, c] of mesh.triangles) {
      const p = mesh.positions[a];
      const q = mesh.positions[b];
      const r = mesh.positions[c];
      const n: Vec3 = [
        (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
        (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
      ];
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0);
    }
    // The already-outward cube is left alone.
    const plain = normaliseMesh(box(2, 2, 2));
    expect(plain.report.flipped).toBe(false);
    expectClose(plain.report.volume, CUBE_VOL, 1e-14);
    expectClose(plain.report.scale, A, 1e-16);
  });

  it('an open model (cube missing one triangle) reports 3 boundary edges, not closed, consistent, and the flux volume 22/(9√3)', () => {
    // Removing one of the 12 triangles leaves its three edges in a single
    // triangle each: boundaryEdges = 3. All 8 vertices are still used (the
    // other triangle of that face uses three of them, neighbouring faces the
    // rest), so the bbox centre and radius are those of the full cube.
    // Flux: each triangle of the outward cube of side 2 contributes 2/3 to the
    // divergence-theorem sum (8 over 12 congruent pieces, p·n = 1 on every
    // face), so the open surface has 8 − 2/3 = 22/3, and scaling by (1/√3)³
    // gives 22/(9√3) ≈ 1.4113. Positive, so §12's heuristic leaves it alone.
    const open: Mesh3 = { positions: box(2, 2, 2).positions, triangles: box(2, 2, 2).triangles.slice(1) };
    const { mesh, report } = normaliseMesh(open);
    expect(report.closed).toBe(false);
    expect(report.consistent).toBe(true);
    expect(report.boundaryEdges).toBe(3);
    expect(report.triangles).toBe(11);
    expect(report.flipped).toBe(false);
    expectClose(report.volume, 22 / (9 * Math.sqrt(3)), 1e-13);
    expectClose(mesh3Volume(mesh), 22 / (9 * Math.sqrt(3)), 1e-13);
    expect(mesh.positions.length).toBe(8);
    // The report agrees with an independent validation of the output.
    const v = validateMesh3(mesh);
    expect(v.closed).toBe(report.closed);
    expect(v.consistent).toBe(report.consistent);
    expect(v.boundaryEdges).toBe(report.boundaryEdges);
    expect(closednessText(report)).toMatch(/open \(3 boundary edges; slices are open surfaces\)/);
  });

  it('applies the flip heuristic to an inside-out open model (negative flux): §12 says the same rule is applied', () => {
    // Inside-out cube missing one triangle: flux −22/3 → reversed, reported
    // volume +22/(9√3) and the output's flux positive.
    const flipped = flipMesh3(box(2, 2, 2));
    const open: Mesh3 = { positions: flipped.positions, triangles: flipped.triangles.slice(1) };
    const { mesh, report } = normaliseMesh(open);
    expect(report.flipped).toBe(true);
    expect(report.closed).toBe(false);
    expect(report.boundaryEdges).toBe(3);
    expectClose(report.volume, 22 / (9 * Math.sqrt(3)), 1e-13);
    expect(mesh3Volume(mesh)).toBeGreaterThan(0);
    expect(describeReport('x', report)).toMatch(/winding reversed/);
    expect(describeReport('x', report)).not.toMatch(/volume/); // volume is shown for solids only
  });

  it('a single triangle is open with 3 boundary edges and a flux of exactly zero (the bbox centre lies in its plane)', () => {
    const tri: Mesh3 = { positions: [[0, 0, 0], [2, 0, 0], [0, 3, 0]], triangles: [[0, 1, 2]] };
    const { report } = normaliseMesh(tri);
    expect(report.closed).toBe(false);
    expect(report.boundaryEdges).toBe(3);
    expect(report.triangles).toBe(1);
    // v₀·(v₁×v₂) with all three vertices in a plane through the origin is 0.
    expect(Math.abs(report.volume)).toBeLessThanOrEqual(1e-15);
  });

  it('a closed but inconsistently oriented model is reported closed and not consistent, and is not a solid', () => {
    // One triangle of the cube reversed: every edge still has two triangles
    // (closed), but the three edges of that triangle are traversed twice in
    // the same direction. Flux 8 − 2·(2/3) = 20/3 > 0, so not flipped.
    const m = box(2, 2, 2);
    const [a, b, c] = m.triangles[0];
    m.triangles[0] = [a, c, b];
    const { report } = normaliseMesh(m);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(false);
    expect(report.boundaryEdges).toBe(0);
    expect(report.flipped).toBe(false);
    expectClose(report.volume, (20 / 3) / 3 ** 1.5, 1e-13);
    expect(closednessText(report)).toMatch(/inconsistently oriented/);
    expect(() => registerImportedShape('Inconsistent', normaliseMesh(m).mesh, 'spin', report)).toThrow(/closed/);
  });

  it('welds vertices closer than WELD_TOLERANCE × bounding radius and keeps those farther apart, at any model scale', () => {
    // Each cube corner lies on three faces, so it has three copies, the copy
    // of face f displaced by spacing·f along x. Greedy weld to the first
    // representative: with spacing = tol/12 the farthest copy of a corner is
    // at most 5·tol/12 < tol away and all three merge; with spacing = 2·tol
    // no two copies are within tol (and distinct corners are ≥ 2 apart), so
    // nothing merges and each face keeps its own four vertices: 24 vertices,
    // every face edge in one triangle (24 boundary edges), the 6 face
    // diagonals shared.
    for (const scale of [1, 1e6, 1e-6]) {
      const tol = WELD_TOLERANCE * Math.sqrt(3); // radius of the cube (±1)³ about its centre
      const welded = normaliseMesh(scaleAll(splitCube(tol / 12), scale));
      expect(welded.mesh.positions.length).toBe(8);
      expect(welded.report.closed).toBe(true);
      expect(welded.report.triangles).toBe(12);
      expectClose(welded.report.volume, CUBE_VOL, 1e-5); // the 5e-7 displacement moves the volume by ~1e-6
      const loose = normaliseMesh(scaleAll(splitCube(2 * tol), scale));
      expect(loose.mesh.positions.length).toBe(24);
      expect(loose.report.closed).toBe(false);
      expect(loose.report.boundaryEdges).toBe(24);
      expect(loose.report.triangles).toBe(12);
    }
  });

  it('two cubes touching along a face weld into a non-manifold model: not closed, no boundary edges, volume 2, not a solid', () => {
    // box(1,1,1) moved to x ∈ [−1, 0] and to x ∈ [0, 1]: the shared face's
    // four corners coincide and weld, so its 4 edges, and its diagonal (both
    // boxes split that face from (0,−,−) to (0,+,+)), each belong to four
    // triangles: 5 non-manifold edges, 0 boundary edges, closed false. The
    // flux through the two coincident, oppositely oriented faces cancels, so
    // the signed volume is 1 + 1 = 2 (positive: not flipped). The bbox is
    // [−1, 1] × [−½, ½]², centre 0, radius √(1 + ¼ + ¼) = √1.5.
    const left = box(1, 1, 1);
    const right = box(1, 1, 1);
    const both: Mesh3 = {
      positions: [
        ...left.positions.map((p): Vec3 => [p[0] - 0.5, p[1], p[2]]),
        ...right.positions.map((p): Vec3 => [p[0] + 0.5, p[1], p[2]]),
      ],
      triangles: [...left.triangles, ...right.triangles.map((t): Triangle => [t[0] + 8, t[1] + 8, t[2] + 8])],
    };
    const { mesh, report } = normaliseMesh(both);
    expect(mesh.positions.length).toBe(12);
    expect(report.triangles).toBe(24);
    expect(report.closed).toBe(false);
    expect(report.boundaryEdges).toBe(0);
    expect(report.flipped).toBe(false);
    expectClose(report.scale, 1 / Math.sqrt(1.5), 1e-15);
    expectClose(report.volume, 2 / 1.5 ** 1.5, 1e-14);
    expect(validateMesh3(mesh).nonManifoldEdges).toBe(5);
    expect(closednessText(report)).toMatch(/more than two triangles/);
    expect(() => registerImportedShape('Twins', mesh, 'spin', report)).toThrow(/closed/);
    const shape = registerImportedShape('Twins', mesh, 'extrude', report).create() as ExtrudedSolid;
    expect(shape.caps).toBe(false);
    // The lateral slice at w = 0 is both cubes' surfaces subdivided: 4 · 24
    // triangles, no exception, and the shared face is still non-manifold.
    const a = analyseSlice(shape.slice(hyperplaneW(0)));
    expect(a.triangles).toBe(96);
    expect(a.boundaryEdges).toBe(0);
    expect(a.nonManifoldEdges).toBeGreaterThan(0);
  });

  it('an open hemisphere from three.js (thetaLength π/2) is reported open with W boundary edges and is not flipped (positive flux)', () => {
    // SphereGeometry(1, 8, 4, 0, 2π, 0, π/2): rows iy = 0..4 at θ = iy·π/8,
    // the pole row fans (W triangles) and rows 1..3 give 2W each: 7W = 56
    // triangles, V = 1 + 4W = 33 after welding, the equator ring's W = 8
    // edges are boundary edges, Euler 33 − 88 + 56 = 1 (a disc). The bbox
    // centre is at (0, ½, 0) on the axis (y ∈ [0, 1], x and z symmetric for
    // even W); on the unit sphere (p − c)·n = 1 − ½ cos θ_y ≥ ½ > 0, so the
    // flux is positive and §12's heuristic keeps the winding.
    const W = 8;
    const H = 4;
    const mesh = fromBufferGeometry(new SphereGeometry(1, W, H, 0, 2 * Math.PI, 0, Math.PI / 2));
    expect(mesh.positions.length).toBe(1 + H * W);
    expect(mesh.triangles.length).toBe(7 * W);
    const { report } = normaliseMesh(mesh);
    expect(report.closed).toBe(false);
    expect(report.consistent).toBe(true);
    expect(report.boundaryEdges).toBe(W);
    expect(report.flipped).toBe(false);
    expect(report.volume).toBeGreaterThan(0);
    expect(closednessText(report)).toMatch(/open \(8 boundary edges/);
    expect(validateMesh3(mesh).euler).toBe(1);
  });

  it('a 24-vertex box from three.js (exact duplicates) normalises to the closed 8-vertex cube', () => {
    const { mesh, report } = normaliseMesh(fromBufferGeometry(new BoxGeometry(4, 4, 4)));
    expect(mesh.positions.length).toBe(8);
    expect(report.closed).toBe(true);
    expectClose(report.scale, 1 / Math.sqrt(12), 1e-16);
    expectClose(report.volume, CUBE_VOL, 1e-14);
  });

  it('rejects empty, all-degenerate, coincident and non-finite input with an Error', () => {
    expect(() => normaliseMesh({ positions: [], triangles: [] })).toThrow(/no triangles/);
    expect(() => normaliseMesh({ positions: [[0, 0, 0], [1, 1, 1]], triangles: [] })).toThrow(/no triangles/);
    // Only repeated-index triangles: nothing survives the weld.
    expect(() => normaliseMesh({ positions: [[0, 0, 0], [1, 0, 0]], triangles: [[0, 0, 1], [1, 1, 0]] })).toThrow(/after welding/);
    // All vertices coincide: radius 0.
    expect(() => normaliseMesh({ positions: [[2, 2, 2], [2, 2, 2], [2, 2, 2]], triangles: [[0, 1, 2]] })).toThrow(/degenerate/);
    // Non-finite coordinates.
    expect(() => normaliseMesh({ positions: [[0, 0, 0], [1, 0, 0], [0, NaN, 0]], triangles: [[0, 1, 2]] })).toThrow(/degenerate/);
    expect(() => normaliseMesh({ positions: [[0, 0, 0], [Infinity, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] })).toThrow(/degenerate/);
  });
});

/** Scale every coordinate of a mesh (positive factor, winding unchanged). */
function scaleAll(mesh: Mesh3, s: number): Mesh3 {
  return { positions: mesh.positions.map((p): Vec3 => [p[0] * s, p[1] * s, p[2] * s]), triangles: mesh.triangles };
}

// ---- registerImportedShape ----------------------------------------------------------

describe('registerImportedShape (registry entry, extrude with and without caps, spin)', () => {
  const closedCube = normaliseMesh(parseObj(cubeObjText()));
  const openCube = normaliseMesh({ positions: box(2, 2, 2).positions, triangles: box(2, 2, 2).triangles.slice(1) });
  const h = IMPORT_EXTRUDE_HALF_HEIGHT;

  it('ids carry the import prefix, the slug of the name and the lifting suffix; re-registering replaces the entry', () => {
    const first = registerImportedShape('My Model.v2', closedCube.mesh, 'extrude', closedCube.report);
    expect(first.id).toBe(`${IMPORT_ID_PREFIX}my-model-v2-extrude`);
    expect(first.id.startsWith('import:')).toBe(true);
    expect(first.group).toBe('Imported');
    expect(first.label).toBe('My Model.v2 (extruded)');
    expect(first.description).toMatch(/12 triangles/);
    expect(first.description).toMatch(/closed/);
    const second = registerImportedShape('My Model.v2', closedCube.mesh, 'extrude', closedCube.report);
    expect(second.id).toBe(first.id);
    expect(listShapes().filter((e) => e.id === first.id)).toHaveLength(1);
    expect(getShape(first.id)).toBe(second);
    expect(getShape(first.id)).not.toBe(first);
    // A different lifting of the same model is a separate entry.
    const spun = registerImportedShape('My Model.v2', closedCube.mesh, 'spin', closedCube.report);
    expect(spun.id).toBe(`${IMPORT_ID_PREFIX}my-model-v2-spin`);
    expect(spun.label).toBe('My Model.v2 (spun)');
    expect(listShapes().filter((e) => e.id.startsWith(`${IMPORT_ID_PREFIX}my-model-v2-`))).toHaveLength(2);
  });

  it('slugs are lowercase ASCII of at most 40 characters without edge dashes, "model" when nothing is left', () => {
    expect(registerImportedShape('Ünïcödé  Model', closedCube.mesh, 'extrude', closedCube.report).id).toBe('import:unicode-model-extrude');
    expect(registerImportedShape('###', closedCube.mesh, 'extrude', closedCube.report).id).toBe('import:model-extrude');
    expect(registerImportedShape('a'.repeat(50), closedCube.mesh, 'extrude', closedCube.report).id).toBe(`import:${'a'.repeat(40)}-extrude`);
    // 'a-' × 30 is 60 characters; the first 40 end in '-', which is trimmed.
    expect(registerImportedShape('a-'.repeat(30), closedCube.mesh, 'extrude', closedCube.report).id).toBe(`import:${'a-'.repeat(19)}a-extrude`);
    expect(registerImportedShape('--lead and trail--', closedCube.mesh, 'extrude', closedCube.report).id).toBe('import:lead-and-trail-extrude');
  });

  it('a closed model is extruded with caps into the prism S × [−1/2, 1/2]; the slice at w = 0 is S (midpoint-subdivided) and closed', () => {
    const entry = registerImportedShape('Cube', closedCube.mesh, 'extrude', closedCube.report);
    const shape = entry.create();
    expect(shape).toBeInstanceOf(ExtrudedSolid);
    const prism = shape as ExtrudedSolid;
    expect(prism.caps).toBe(true);
    expect(prism.halfHeight).toBe(h);
    expect(shape.kind).toBe('lifted');
    expect(shape.wRange()).toEqual([-h, h]);
    // Every vertex is (v, ±h) with |v| ≤ 1, so the radius is √(1 + h²).
    expectClose(shape.radius(), Math.hypot(1, h), 1e-15);
    // The lateral complex is 3 tets per triangle, closed except its two ends:
    // the boundary faces are the 12 bottom and 12 top triangles.
    const tv = validateTetComplex(prism.complex.positions, prism.complex.tets);
    expect(prism.complex.tets.length).toBe(36);
    expect(tv.boundaryFaces).toBe(24);
    expect(tv.inconsistentFaces).toBe(0);
    expect(tv.nonManifoldFaces).toBe(0);

    // At w = c with |c| < h each prism is cut by a plane parallel to its
    // bases: its tets (a0 b0 c0 c1), (a0 b0 c1 b1), (a0 b1 c1 a1) have 1, 2
    // and 3 positive corners and emit 1 + 2 + 1 = 4 triangles, the midpoint
    // subdivision of the triangle. The caps are parallel and contribute
    // nothing. So the slice is M subdivided: 4·12 = 48 triangles, closed,
    // volume vol(S) = 8/(3√3). Output is Float32, hence 1e-6 relative.
    for (const c of [0, 0.25, -0.4]) {
      const slice = shape.slice(hyperplaneW(c));
      expect(triangleCount(slice)).toBe(48);
      const a = analyseSlice(slice);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.triangles).toBe(48);
      expect(a.euler).toBe(2);
      expectClose(a.volume, CUBE_VOL, 1e-6 * CUBE_VOL);
      expectClose(a.volume, closedCube.report.volume, 1e-6 * CUBE_VOL);
      // §10: every slice vertex came from w = c.
      for (let i = 0; i < slice.sourceW.length; i++) expectClose(slice.sourceW[i], c, 1e-6);
    }
    // §6 limit from below through the import path: at w = +h the slice is the
    // top copy of S (every tet has its top vertices on H, counted positive);
    // at w = −h all vertices are positive and nothing is emitted.
    const top = analyseSlice(shape.slice(hyperplaneW(h)));
    expect(top.closed).toBe(true);
    expectClose(top.volume, CUBE_VOL, 1e-6 * CUBE_VOL);
    expect(top.triangles).toBe(12);
    expect(triangleCount(shape.slice(hyperplaneW(-h)))).toBe(0);
  });

  it('a tilted hyperplane through the extruded cube gives the closed-form sheared slab volume (§9.1), closed after welding', () => {
    // n = (0, 0, s, c₀) with s = c₀ = 1/√2, offset c. A point (q, w) of the
    // prism lies on H iff w = (c − s z)/c₀, so the slice is the part of S with
    // w ∈ [−h, h], i.e. z ∈ [(c − c₀h)/s, (c + c₀h)/s] ∩ [−A, A], mapped by
    // q ↦ (q, (c − s z)/c₀), which stretches z by √(1 + s²/c₀²) = 1/c₀ (the
    // chart is an isometry of H, so chart volume = this volume). Hence
    // V = (1/c₀) · (2A)² · |slab ∩ [−A, A]|. Both caps are cut at c = 0 (the
    // slab ±h lies inside |z| ≤ A); at c = 0.1 the upper plane leaves the cube.
    const shape = registerImportedShape('Cube', closedCube.mesh, 'extrude', closedCube.report).create();
    const s = Math.SQRT1_2;
    for (const c of [0, 0.1]) {
      const lo = Math.max(-A, (c - s * h) / s);
      const hi = Math.min(A, (c + s * h) / s);
      const expected = (1 / s) * (2 * A) ** 2 * (hi - lo);
      const slice = shape.slice(hyperplane([0, 0, 1, 1], c));
      const a = analyseSlice(slice);
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(2);
      expectClose(a.volume, expected, 1e-5 * expected);
      // §10 bookkeeping: sourceW of each vertex is the w of its 4D point,
      // recovered by uncharting the chart coordinates (Float32: 1e-6).
      const hp = hyperplane([0, 0, 1, 1], c);
      for (let i = 0; i < slice.sourceW.length; i++) {
        const p = unchart(hp, vertexAt(slice, i));
        expectClose(slice.sourceW[i], p[3], 2e-6);
        expect(Math.abs(p[3])).toBeLessThanOrEqual(h + 2e-6);
      }
    }
  });

  it('random hyperplanes: slices of the extruded cube are closed with positive volume, and Cavalieri recovers vol(S)·2h (§7)', () => {
    // vol₄(S × [−h, h]) = vol₃(S) · 2h = CUBE_VOL · 1. The midpoint rule with
    // 400 steps over [−R, R] on the continuous piecewise-cubic A(c) has an
    // error far below 1e-3 relative (kinks contribute O(dc²)); a missing or
    // misoriented cap would be an O(1) error.
    const shape = registerImportedShape('Cube', closedCube.mesh, 'extrude', closedCube.report).create();
    const rng = mulberry32(0x5eed);
    for (let k = 0; k < 4; k++) {
      const n = randomUnit4(rng);
      for (const c of [-0.37, 0.05, 0.31]) {
        const a = analyseSlice(shape.slice(hyperplane(n, c)));
        expect(a.closed, `n=${n} c=${c}`).toBe(true);
        expect(a.consistent).toBe(true);
        expect(a.volume).toBeGreaterThan(0);
      }
      expectClose(sliceVolumeIntegral(shape, n, 400), CUBE_VOL, 1e-3 * CUBE_VOL);
    }
    // The e_w direction: A(c) is the step CUBE_VOL · 1[|c| < h], and the
    // midpoint rule error is at most dc · CUBE_VOL with dc = 2R/400 ≈ 0.0056.
    expectClose(sliceVolumeIntegral(shape, [0, 0, 0, 1], 400), CUBE_VOL, 0.006 * CUBE_VOL);
  });

  it('an inside-out import, once normalised, extrudes to a shape whose slices have positive volume', () => {
    const insideOut = normaliseMesh(flipMesh3(fromBufferGeometry(new SphereGeometry(2, 12, 6))));
    expect(insideOut.report.flipped).toBe(true);
    const shape = registerImportedShape('Inside out', insideOut.mesh, 'extrude', insideOut.report).create();
    const mid = analyseSlice(shape.slice(hyperplaneW(0)));
    expect(mid.closed).toBe(true);
    expectClose(mid.volume, insideOut.report.volume, 1e-5 * insideOut.report.volume);
    const tilted = analyseSlice(shape.slice(hyperplane([0.2, -0.3, 0.5, 0.8], 0.1)));
    expect(tilted.closed).toBe(true);
    expect(tilted.volume).toBeGreaterThan(0);
  });

  it('an open model is extruded without caps: slices have boundary edges but raise no exception, with 4T lateral triangles at w = c', () => {
    const entry = registerImportedShape('Open cube', openCube.mesh, 'extrude', openCube.report);
    expect(entry.description).toMatch(/open \(3 boundary edges; slices are open surfaces\)/);
    const shape = entry.create();
    expect(shape).toBeInstanceOf(ExtrudedSolid);
    expect((shape as ExtrudedSolid).caps).toBe(false);
    // 11 triangles → 33 lateral tets; at w = c every prism gives 4 triangles
    // (see the closed case): 44, none degenerate. The hole's three edges are
    // each split at the midpoint, so the welded slice has 6 boundary edges and
    // is otherwise consistent. V − E + F for a disc is 1.
    for (const c of [0, 0.25]) {
      const slice = shape.slice(hyperplaneW(c));
      expect(triangleCount(slice)).toBe(44);
      const a = analyseSlice(slice);
      expect(a.closed).toBe(false);
      expect(a.boundaryEdges).toBe(6);
      expect(a.nonManifoldEdges).toBe(0);
      expect(a.consistent).toBe(true);
      expect(a.triangles).toBe(44);
      expect(a.euler).toBe(1);
    }
    // Tilted hyperplanes: no caps, so the slice is open along the two cap
    // levels as well as the hole; it must still be produced.
    const rng = mulberry32(42);
    for (let k = 0; k < 3; k++) {
      const n = randomUnit4(rng);
      const slice = shape.slice(hyperplane(n, 0.13));
      expect(triangleCount(slice)).toBeGreaterThan(0);
      const a = analyseSlice(slice);
      expect(a.boundaryEdges).toBeGreaterThan(0);
      expect(a.closed).toBe(false);
      expect(a.nonManifoldEdges).toBe(0);
      expect(a.consistent).toBe(true);
    }
    // A plane that misses the lateral surface entirely gives an empty slice, not an error.
    expect(triangleCount(shape.slice(hyperplaneW(0.75)))).toBe(0);
  });

  it('spin is refused for an open model with a message that explains why', () => {
    expect(() => registerImportedShape('Open cube', openCube.mesh, 'spin', openCube.report)).toThrow(/closed/);
    expect(() => registerImportedShape('Open cube', openCube.mesh, 'spin', openCube.report)).toThrow(/extrude/);
    // The refused registration must not leave a dangling entry.
    expect(getShape(`${IMPORT_ID_PREFIX}open-cube-spin`)).toBeUndefined();
  });

  it('the spin lifting path builds: the normalised cube is clipped to z ≥ 0 and spun in 48 steps with the Pappus hypervolume', () => {
    // The normalised cube [−A, A]³ crosses z = 0, so §9.2 clips it to the
    // half-cube [−A, A]² × [0, A]. Pappus: vol₄ = 2π ∫_S z dV with
    // ∫ z dV = (2A)² · A²/2 = 2A⁴ = 2/9, and the discrete construction gives
    // exactly (N/2π) sin(2π/N) times that: (2/9) · N sin(2π/N). The clipped
    // mesh (§9.4) is the top face (2 triangles), four side rectangles of 3
    // triangles each (of a side face's two triangles one keeps a single
    // vertex and gives one piece, the other keeps two and gives a quad), and
    // the cap in z = 0: its section loop has 8 points, the 4 corners and the
    // crossings of the 4 side-face diagonals, which a watertight cap must
    // use, so the 2 earcut triangles are split into 2 + 4 = 6. Total 20; spin
    // drops the 6 cap triangles (they lie in z = 0) and spins 14.
    const entry = registerImportedShape('Cube', closedCube.mesh, 'spin', closedCube.report);
    expect(entry.id).toBe(`${IMPORT_ID_PREFIX}cube-spin`);
    const shape = entry.create();
    expect(shape).toBeInstanceOf(SpunSolid);
    const spun = shape as SpunSolid;
    expect(spun.clipped).toBe(true);
    expect(spun.steps).toBe(IMPORT_SPIN_STEPS);
    expect(spun.steps).toBe(48);
    // §9.2's w = 0 twins and wRange are exact only for N divisible by 4.
    expect(IMPORT_SPIN_STEPS % 4).toBe(0);
    expect(spun.mesh.triangles.length).toBe(20);
    expect(spun.mesh.positions.length).toBe(12); // 4 top corners, 4 cut corners, 4 diagonal crossings
    expect(spun.mesh.triangles.filter(([a, b, c]) => [a, b, c].every((v) => spun.mesh.positions[v][2] <= 1e-12)).length).toBe(6);
    // The clipped half-cube has volume (2A)² · A = 4A³, half the cube.
    expectClose(mesh3Volume(spun.mesh), 4 * A ** 3, 1e-14);
    expect(validateMesh3(spun.mesh).closed).toBe(true);
    const N = spun.steps;
    const expected = (2 / 9) * N * Math.sin((2 * Math.PI) / N);
    expectClose(spun.hypervolume(), expected, 1e-12 * expected);
    expect(validateTetComplex(spun.complex.positions, spun.complex.tets, { allowDegenerate: true }).ok).toBe(true);
    // The highest point is at z = A, so wRange is [−A, A]; the farthest
    // vertices are the top corners of the cube at distance 1.
    expect(spun.wRange()[0]).toBeCloseTo(-A, 15);
    expect(spun.wRange()[1]).toBeCloseTo(A, 15);
    expectClose(spun.radius(), 1, 1e-14);
  });

  it('the spun import slices: at w = 0 the mirror pair rebuilds the full cube; at w = 0.3 the slab lies between the 48-gon bounds', () => {
    const spun = registerImportedShape('Cube', closedCube.mesh, 'spin', closedCube.report).create() as SpunSolid;
    const N = spun.steps;
    // §9.2: at c = 0 the slice is S_clipped with its mirror image in z = 0,
    // which for the half-cube is the whole cube, volume 8A³. N is divisible
    // by 4 so the steps k = 0 and N/2 lie exactly in w = 0 and the N-gon gauge
    // of (ζ, 0) is |ζ| exactly. The hyperplane passes through vertices, so
    // §6 asks for closedness only after dropping zero-area triangles and
    // merging coincident vertices (analyseSlice does both).
    const mid = analyseSlice(spun.slice(hyperplaneW(0)));
    expect(mid.closed).toBe(true);
    expect(mid.consistent).toBe(true);
    expectClose(mid.volume, CUBE_VOL, 1e-5 * CUBE_VOL);
    // At w = c the slice is {(x, y, ζ) : ‖(ζ, c)‖_N ≤ A} × [−A, A]², where
    // ‖·‖_N is the gauge of the regular N-gon of circumradius 1 inscribed in
    // the unit circle: ‖v‖ ≤ ‖v‖_N ≤ ‖v‖ / cos(π/N). So the slab half-
    // thickness lies between √(A² cos²(π/N) − c²) and √(A² − c²).
    const c = 0.3;
    const lower = (2 * A) ** 2 * 2 * Math.sqrt(A * A * Math.cos(Math.PI / N) ** 2 - c * c);
    const upper = (2 * A) ** 2 * 2 * Math.sqrt(A * A - c * c);
    const a = analyseSlice(spun.slice(hyperplaneW(c)));
    expect(a.closed).toBe(true);
    expect(a.consistent).toBe(true);
    expect(a.volume).toBeGreaterThanOrEqual(lower * (1 - 1e-6));
    expect(a.volume).toBeLessThanOrEqual(upper * (1 + 1e-6));
    // Beyond the greatest height A nothing is left (§9.2: the twins vanish).
    expect(triangleCount(spun.slice(hyperplaneW(A + 1e-3)))).toBe(0);
    // Cavalieri along e_w recovers the discrete hypervolume (§7). A(c) behaves
    // like √(A² − c²) at the ends, so the midpoint rule converges as dc^1.5:
    // with 400 steps over [−1, 1] that is ~1e-4 relative; 1e-3 is safe.
    expectClose(sliceVolumeIntegral(spun, [0, 0, 0, 1], 400), spun.hypervolume(), 1e-3 * spun.hypervolume());
    // A generic tilted hyperplane gives a closed slice of positive volume.
    const tilted = analyseSlice(spun.slice(hyperplane(randomUnit4(mulberry32(7)), 0.1)));
    expect(tilted.closed).toBe(true);
    expect(tilted.volume).toBeGreaterThan(0);
  });

  it('a spun three.js sphere (clipped to its upper half) has the Pappus hypervolume of its clipped mesh', () => {
    // For any closed mesh, spin's hypervolume is exactly (N/2π) sin(2π/N) ·
    // 2π ∫_S z dV over the clipped solid. ∫ z dV is computed here directly
    // by the divergence theorem with F = (0, 0, z²/2), div F = z:
    // ∫ z dV = ∮ (z²/2) n_z dA. On a flat triangle n_z is constant and z is
    // linear, and ∫ z² dA = (A/6)(z_a² + z_b² + z_c² + z_a z_b + z_b z_c + z_c z_a)
    // (exact quadrature for quadratics), so the triangle contributes
    // (n_z A / 2) · S / 6 with S that sum. Check on the unit cube [0,1]³:
    // only the top face has n_z ≠ 0, A = 1, S = 6: (1/2)(6/6) = 1/2 = ∫ z dV.
    const sphere = normaliseMesh(fromBufferGeometry(new SphereGeometry(1, 12, 6)));
    const spun = registerImportedShape('Sphere', sphere.mesh, 'spin', sphere.report).create() as SpunSolid;
    expect(spun.clipped).toBe(true);
    let moment = 0;
    for (const [i, j, k] of spun.mesh.triangles) {
      const a = spun.mesh.positions[i];
      const b = spun.mesh.positions[j];
      const c = spun.mesh.positions[k];
      const nzA = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; // n_z A
      const S = a[2] ** 2 + b[2] ** 2 + c[2] ** 2 + a[2] * b[2] + b[2] * c[2] + c[2] * a[2];
      moment += (nzA / 2) * (S / 6);
    }
    expect(moment).toBeGreaterThan(0);
    const N = spun.steps;
    const expected = N * Math.sin((2 * Math.PI) / N) * moment;
    expectClose(spun.hypervolume(), expected, 1e-10 * expected);
    const mid = analyseSlice(spun.slice(hyperplaneW(0.05)));
    expect(mid.closed).toBe(true);
    expect(mid.volume).toBeGreaterThan(0);
  });

  it('hyperplanes through cap-level vertices are watertight (§6 symbolic perturbation) and the slice volume is continuous there', () => {
    // A corner (±A, ±A, ±A, ±h) of the prism lies on H when c = n · corner.
    // §6: vertices on H count as positive, so the output is still closed
    // after cleaning. A(c) is continuous, with |A'| of order 2 here (probed
    // numerically; it is bounded by the cross-sectional extent), so moving
    // the offset by 1e-4 changes the volume by ~2e-4 at most; 2e-3 leaves
    // room for the Float32 output (~3e-7).
    const shape = registerImportedShape('Cube', closedCube.mesh, 'extrude', closedCube.report).create();
    const dirs: Vec4[] = [[1, 2, 3, 4], [0.3, -0.5, 0.7, 0.4], [0, 0, 1, 1]];
    const corners: Vec4[] = [[-A, A, -A, h], [A, -A, A, -h], [A, A, -A, h]];
    for (const dir of dirs) {
      const l = Math.hypot(...dir);
      const n: Vec4 = [dir[0] / l, dir[1] / l, dir[2] / l, dir[3] / l];
      for (const v of corners) {
        const c = n[0] * v[0] + n[1] * v[1] + n[2] * v[2] + n[3] * v[3];
        const at = analyseSlice(shape.slice(hyperplane(n, c)));
        const near = analyseSlice(shape.slice(hyperplane(n, c - 1e-4)));
        expect(at.closed, `n=${n} corner=${v}`).toBe(true);
        expect(at.consistent).toBe(true);
        expect(near.closed).toBe(true);
        expectClose(at.volume, near.volume, 2e-3);
        // These corners are interior to the offset range for these directions.
        expect(at.volume).toBeGreaterThan(0.1);
      }
      // Supporting vertex: for a direction with all components positive the
      // maximum of n·p over the prism is at (A, A, A, h); §6 says H touching a
      // vertex gives only zero-area triangles and the cleaned output is empty.
      if (n.every((x) => x > 0)) {
        const top = n[0] * A + n[1] * A + n[2] * A + n[3] * h;
        const sup = analyseSlice(shape.slice(hyperplane(n, top)));
        expect(sup.triangles).toBe(0);
        expect(sup.volume).toBe(0);
      }
    }
  });

  it('the projection structure of the extruded import (§9.1): 2V vertices, 2E + V edges, 2T + E faces', () => {
    // Cube: V = 8, E = 18 (12 edges + 6 face diagonals), T = 12. Edges of M at
    // both levels plus one vertical per vertex: 36 + 8 = 44. Faces: triangles
    // at both levels plus one quad per edge: 24 + 18 = 42.
    const shape = registerImportedShape('Cube', closedCube.mesh, 'extrude', closedCube.report).create();
    const wire = shape.wire();
    expect(wire).not.toBeNull();
    expect(wire!.positions.length).toBe(16);
    expect(wire!.edges.length).toBe(44);
    expect(wire!.faces.length).toBe(42);
    expect(wire!.faces.filter((f) => f.length === 4)).toHaveLength(18);
    expect(wire!.faces.filter((f) => f.length === 3)).toHaveLength(24);
    // Every vertex is at w = ±h.
    for (const p of wire!.positions) expect(Math.abs(Math.abs(p[3]) - h)).toBeLessThanOrEqual(1e-15);
  });

  it('a closed but flat (zero-volume, double-sided) model is accepted as a solid; spinning it fails somewhere in the chain', () => {
    // A triangle with its mirror copy: every edge is in two triangles with
    // opposite directions, so it is closed and consistent, with volume
    // exactly 0 (all vertices in the plane z = 0 through the bbox centre).
    // §9.2 has nothing to spin (M \ F is empty), and spin's constructor says
    // so. The registration itself does not refuse it, so the throw happens
    // in create() rather than in registerImportedShape; either must throw.
    const flat: Mesh3 = { positions: [[0, 0, 0], [2, 0, 0], [0, 3, 0]], triangles: [[0, 1, 2], [0, 2, 1]] };
    const { mesh, report } = normaliseMesh(flat);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expect(report.volume).toBe(0);
    expect(report.flipped).toBe(false);
    expect(() => registerImportedShape('Flat', mesh, 'spin', report).create()).toThrow(/nothing to spin|closed/);
    // Extruding it is fine: a doubled flat slab with zero slice volume and no exception.
    const prism = registerImportedShape('Flat', mesh, 'extrude', report).create();
    expect(analyseSlice(prism.slice(hyperplaneW(0))).volume).toBe(0);
  });

  it('describeReport states size, closedness, volume (solids only), reversal and scale', () => {
    const line = describeReport('Cube', closedCube.report);
    expect(line).toMatch(/^Cube: 12 triangles, closed, volume 1\.54 \(bounding radius 1\), scaled by 0\.577\.$/);
    const openLine = describeReport('Open', openCube.report);
    expect(openLine).toMatch(/11 triangles, open \(3 boundary edges; slices are open surfaces\), scaled by 0\.577\./);
    const fake: ImportReport = { ...closedCube.report, closed: true, consistent: false };
    expect(closednessText(fake)).toMatch(/inconsistently oriented/);
    const nonManifold: ImportReport = { ...closedCube.report, closed: false, boundaryEdges: 0 };
    expect(closednessText(nonManifold)).toMatch(/more than two triangles/);
  });
});

// ---- An imported torus: caps with holes -----------------------------------------------

describe('imported torus (three.js TorusGeometry): caps with holes, §9.1 nesting parity through the import path', () => {
  // TorusGeometry(radius R, tube r, radialSegments n, tubularSegments m):
  // vertex (i ≤ m, j ≤ n) at ((R + r cos v) cos u, (R + r cos v) sin u, r sin v),
  // u = 2πi/m, v = 2πj/n, the same points as mesh3's torus(R, r, m, n). Both
  // seams are duplicated: (m+1)(n+1) raw vertices weld to mn, 2mn triangles,
  // Euler 0. The quads are planar trapezoids (parallel chords of two
  // circles about the z axis), so the volume does not depend on the diagonal:
  // V = 2π²Rr² · (m/2π) sin(2π/m) · (n/2π) sin(2π/n).
  const m = 24;
  const n = 8;
  const R = 1;
  const r = 0.4;
  const raw = fromBufferGeometry(new TorusGeometry(R, r, n, m));
  const exactVolume = 2 * Math.PI ** 2 * R * r * r * (m / (2 * Math.PI)) * Math.sin((2 * Math.PI) / m) * (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);

  it('welds to a closed torus with the surface-of-revolution volume', () => {
    expect(raw.positions.length).toBe(m * n);
    expect(raw.triangles.length).toBe(2 * m * n);
    const v = validateMesh3(raw);
    expect(v.closed && v.consistent).toBe(true);
    expect(v.euler).toBe(0);
    expectClose(mesh3Volume(raw), exactVolume, 1e-6 * exactVolume);
    expectClose(mesh3Volume(torus(R, r, m, n)), exactVolume, 1e-13);
  });

  // Normalised: the bbox is [−1.4, 1.4]² × [−0.4, 0.4] (u = 0 and v = 0 are
  // sampled, so the extremes are exact), centre 0, bounding radius 1.4 at the
  // outer equator. R and r scale by 1/1.4.
  const normalised = normaliseMesh(raw);
  const Rn = R / 1.4;
  const rn = r / 1.4;
  const h = IMPORT_EXTRUDE_HALF_HEIGHT;

  it('normalises with scale 1/1.4 and volume scaled by its cube', () => {
    expectClose(normalised.report.scale, 1 / 1.4, 1e-6);
    expectClose(normalised.report.volume, exactVolume / 1.4 ** 3, 1e-6);
    expect(normalised.report.closed).toBe(true);
    expect(normalised.report.flipped).toBe(false);
  });

  it('a steep z-tilt cuts both caps in annuli (outer loop + hole): the slice is closed with the closed-form sheared-annulus volume', () => {
    // n = (0, 0, s, c₀), s = sin 80°, c₀ = cos 80°. As for the cube, the slice
    // is {q ∈ S : z ∈ [za, zb]} stretched by 1/c₀, with za = (c − c₀h)/s,
    // zb = (c + c₀h)/s; the slab half-width c₀h/s ≈ 0.088 is less than
    // rn/√2 ≈ 0.202, so both cap planes cut the tube between its v = 0 and
    // v = ±45° vertices, where the polygonal meridian is linear:
    // ρ_out(z) = Rn + rn − |z|(√2 − 1), ρ_in(z) = Rn − rn + |z|(√2 − 1), and
    // the solid of revolution with m steps has cross-section area
    // (m/2) sin(2π/m) (ρ_out² − ρ_in²) = (m/2) sin(2π/m) · 4Rn (rn − |z|(√2 − 1)).
    // Each cap section is an annulus whose inner loop must be classified as
    // a hole (nesting parity): filling it would break closedness and add
    // volume. Float32 output: 1e-6 relative.
    const shape = registerImportedShape('Torus', normalised.mesh, 'extrude', normalised.report).create();
    const alpha = (80 * Math.PI) / 180;
    const s = Math.sin(alpha);
    const c0 = Math.cos(alpha);
    const F = (z: number): number => 4 * Rn * (rn * z - (Math.sign(z) * (Math.SQRT2 - 1) * z * z) / 2); // ∫ 4Rn(rn − |z|(√2−1)) dz
    for (const c of [0, 0.05]) {
      const za = (c - c0 * h) / s;
      const zb = (c + c0 * h) / s;
      expect(Math.max(Math.abs(za), Math.abs(zb))).toBeLessThan(rn / Math.SQRT2);
      const expected = ((m / 2) * Math.sin((2 * Math.PI) / m) * (F(zb) - F(za))) / c0;
      const a = analyseSlice(shape.slice(hyperplane([0, 0, s, c0], c)));
      expect(a.closed).toBe(true);
      expect(a.consistent).toBe(true);
      expect(a.euler).toBe(0); // the slice is a (sheared, truncated) solid torus
      expectClose(a.volume, expected, 1e-6 * expected);
    }
  });

  it('the slice at w = 0 is the torus itself and random-direction Cavalieri integrals recover its volume (§7)', () => {
    const shape = registerImportedShape('Torus', normalised.mesh, 'extrude', normalised.report).create();
    const mid = analyseSlice(shape.slice(hyperplaneW(0)));
    expect(mid.closed).toBe(true);
    expect(mid.euler).toBe(0);
    expectClose(mid.volume, normalised.report.volume, 1e-6 * normalised.report.volume);
    // vol₄ = vol₃(S) · 2h = vol₃(S). Midpoint rule, 400 steps: A(c) is
    // continuous and piecewise smooth, error well below 1e-4 relative; a cap
    // with a filled hole would be an O(1) error.
    const rng = mulberry32(0xc0ffee);
    for (let k = 0; k < 3; k++) {
      const dir = randomUnit4(rng);
      expectClose(sliceVolumeIntegral(shape, dir, 400), normalised.report.volume, 1e-4 * normalised.report.volume);
    }
  });
});
