/**
 * Adversarial review of the core: src/math/{vec,mat4,rotation,projection,
 * hyperplane}.ts and src/geometry/{tets,slice,trimesh,shape}.ts against
 * docs/MATH.md. Every expectation below is derived in its comment from the
 * specification or from a hand computation; nothing is read back from the
 * implementation. Reference quantities (determinants, areas, cyclic orders)
 * are recomputed here by independent means.
 *
 * Defects found by this review have been fixed in the code; the tests that
 * exposed them are kept here as regression tests.
 */
import { describe, expect, it } from 'vitest';
import type { Hyperplane, Mat4, Tet, TriMesh3, Vec3, Vec4 } from '../../src/math/types';
import {
  centroid4, cross3, cross4, det4, dist4, dot3, dot4, length3, length4, normalize4, scale4, sub3, sub4,
} from '../../src/math/vec';
import { apply4, approxEqualMat4, determinant4, identity4, mul4, orthogonalityError, transpose4 } from '../../src/math/mat4';
import {
  compositeRotation, doubleRotation, PLANE_AXES, rotation, ROTATION_PLANES, rotationInAxes, zeroAngles,
} from '../../src/math/rotation';
import { project, projectOrthographic, projectPerspective, projectStereographic } from '../../src/math/projection';
import {
  chart, chartBasis, hyperplane, hyperplaneFromRotation, hyperplaneW, signedDistance, unchart,
} from '../../src/math/hyperplane';
import {
  hypervolumeByCones, orientTetsOutward, signedHypervolume, tetFaces, tetNormal, validateTetComplex,
} from '../../src/geometry/tets';
import { sliceTets } from '../../src/geometry/slice';
import {
  analyseSlice, checkClosedOriented, dropDegenerateTriangles, signedVolume, triangleCount, weldVertices,
} from '../../src/geometry/trimesh';
import { sliceVolumeIntegral, TetShape } from '../../src/geometry/shape';
import { tesseractFixture } from '../core/tesseract-fixture';

// ---------------------------------------------------------------------------
// Helpers independent of the code under test
// ---------------------------------------------------------------------------

/** mulberry32 PRNG so failures reproduce exactly. */
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
const randVec4 = (r: () => number, s = 1): Vec4 => [s * (r() - 0.5), s * (r() - 0.5), s * (r() - 0.5), s * (r() - 0.5)];
const randUnit4 = (r: () => number): Vec4 => normalize4(randVec4(r));
const E4: readonly Vec4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

/** All permutations of 0..n-1. */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) { out.push(prefix); return; }
    rest.forEach((v, i) => rec([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}
/** Sign of a permutation by inversion count. */
function permSign(p: readonly number[]): number {
  let inv = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inv++;
  return inv % 2 === 0 ? 1 : -1;
}
/** Leibniz determinant of the 4×4 matrix with the given rows (24 terms). */
function detLeibniz(rows: readonly Vec4[]): number {
  let d = 0;
  for (const p of permutations(4)) {
    let term = permSign(p);
    for (let r = 0; r < 4; r++) term *= rows[r][p[r]];
    d += term;
  }
  return d;
}

/** Row-major matrix with the given columns. */
function fromColumns(c0: Vec4, c1: Vec4, c2: Vec4, c3: Vec4): Mat4 {
  const m = new Array<number>(16);
  const cols = [c0, c1, c2, c3];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = cols[c][r];
  return m;
}

const vertex3 = (m: TriMesh3, i: number): Vec3 => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
function triangles(m: TriMesh3): [Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3][] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    out.push([vertex3(m, m.indices[t]), vertex3(m, m.indices[t + 1]), vertex3(m, m.indices[t + 2])]);
  }
  return out;
}
const triNormal = ([a, b, c]: [Vec3, Vec3, Vec3]): Vec3 => cross3(sub3(b, a), sub3(c, a));
const triArea = (t: [Vec3, Vec3, Vec3]): number => length3(triNormal(t)) / 2;
/** Multiset of vertex positions rounded to `digits`, sorted, for set comparison. */
function vertexKeys(m: TriMesh3, digits = 5): string[] {
  const keys: string[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    keys.push([0, 1, 2].map((k) => (m.positions[3 * i + k] + 0).toFixed(digits).replace('-0.00000', '0.00000')).join(','));
  }
  return keys.sort();
}
/** Multiset of oriented triangles (as cyclically-canonical rounded point triples). */
function triangleKeys(m: TriMesh3, digits = 4): string[] {
  const key = (p: Vec3): string => p.map((v) => (v + 0).toFixed(digits).replace(/^-(0\.0+)$/, '$1')).join(',');
  return triangles(m).map((t) => {
    const ks = t.map(key);
    // rotate so the lexicographically smallest key is first (preserves orientation)
    let best = 0;
    for (let i = 1; i < 3; i++) if (ks[i] < ks[best]) best = i;
    return [ks[best], ks[(best + 1) % 3], ks[(best + 2) % 3]].join(' | ');
  }).sort();
}
function translateMesh(m: TriMesh3, t: Vec3): TriMesh3 {
  const positions = Float32Array.from(m.positions);
  for (let i = 0; i < positions.length; i += 3) { positions[i] += t[0]; positions[i + 1] += t[1]; positions[i + 2] += t[2]; }
  return { positions, indices: m.indices, sourceW: m.sourceW };
}
function meshFrom(points: Vec3[], tris: number[][]): TriMesh3 {
  return {
    positions: Float32Array.from(points.flat()),
    indices: Uint32Array.from(tris.flat()),
    sourceW: new Float32Array(points.length),
  };
}

/** Canonical cyclic rotation of a triple (smallest first). */
function cyc(f: readonly [number, number, number]): string {
  const [a, b, c] = f;
  const rot = a <= b && a <= c ? [a, b, c] : b <= a && b <= c ? [b, c, a] : [c, a, b];
  return rot.join(',');
}
/** For every unordered face of a tet list: the induced cycles, keyed by sorted triple. */
function faceCycles(tets: readonly Tet[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of tets) {
    for (const f of tetFaces(t)) {
      const key = [...f].sort((x, y) => x - y).join(',');
      const list = map.get(key) ?? [];
      list.push(cyc(f));
      map.set(key, list);
    }
  }
  return map;
}

/** The 5-cell of MATH.md §8.1 as 5 outward tets on its 5 vertices. */
function fiveCell(): { positions: Vec4[]; tets: Tet[] } {
  const s5 = Math.sqrt(5);
  const positions: Vec4[] = [
    [1, 1, 1, -1 / s5], [1, -1, -1, -1 / s5], [-1, 1, -1, -1 / s5], [-1, -1, 1, -1 / s5], [0, 0, 0, 4 / s5],
  ];
  const raw: Tet[] = [[1, 2, 3, 4], [0, 2, 3, 4], [0, 1, 3, 4], [0, 1, 2, 4], [0, 1, 2, 3]];
  return { positions, tets: orientTetsOutward(positions, raw, [0, 0, 0, 0]) };
}

// ---------------------------------------------------------------------------
// 1. Rotations (§2)
// ---------------------------------------------------------------------------

describe('1. rotationInAxes and the composite order (§2.1, §2.2)', () => {
  it('positive theta turns e_i toward e_j for all 12 ordered axis pairs, including i > j', () => {
    const th = 0.37;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        const m = rotationInAxes(i as 0 | 1 | 2 | 3, j as 0 | 1 | 2 | 3, th);
        // §2.1: R e_i = cos θ e_i + sin θ e_j; e_j goes to −sin θ e_i + cos θ e_j.
        const ri = apply4(m, E4[i]);
        const rj = apply4(m, E4[j]);
        for (let k = 0; k < 4; k++) {
          const expI = k === i ? Math.cos(th) : k === j ? Math.sin(th) : 0;
          const expJ = k === i ? -Math.sin(th) : k === j ? Math.cos(th) : 0;
          expect(ri[k]).toBeCloseTo(expI, 14);
          expect(rj[k]).toBeCloseTo(expJ, 14);
        }
        // complementary plane fixed, SO(4)
        for (let k = 0; k < 4; k++) if (k !== i && k !== j) expect(apply4(m, E4[k])).toEqual(E4[k]);
        expect(orthogonalityError(m)).toBeLessThan(1e-15);
        expect(determinant4(m)).toBeCloseTo(1, 14);
      }
    }
  });

  it('R_ji(θ) = R_ij(−θ) = R_ij(θ)ᵀ (the i > j branch is the inverse of the i < j one)', () => {
    for (const plane of ROTATION_PLANES) {
      const [i, j] = PLANE_AXES[plane];
      const a = rotationInAxes(i, j, 1.1);
      const b = rotationInAxes(j, i, 1.1);
      expect(approxEqualMat4(mul4(a, b), identity4(), 1e-15)).toBe(true);
      expect(approxEqualMat4(b, transpose4(a), 1e-15)).toBe(true);
      expect(approxEqualMat4(b, rotationInAxes(i, j, -1.1), 1e-15)).toBe(true);
    }
  });

  it('rotation(plane) uses the canonical (i<j) axis pair of each plane', () => {
    const expected: Record<string, [number, number]> = { XY: [0, 1], XZ: [0, 2], XW: [0, 3], YZ: [1, 2], YW: [1, 3], ZW: [2, 3] };
    for (const plane of ROTATION_PLANES) {
      expect(PLANE_AXES[plane]).toEqual(expected[plane]);
      const [i, j] = expected[plane];
      expect(approxEqualMat4(rotation(plane, 0.9), rotationInAxes(i as 0, j as 1, 0.9), 0)).toBe(true);
    }
  });

  it('composite is exactly R_ZW·R_YW·R_YZ·R_XW·R_XZ·R_XY with six generic angles, and not the reverse', () => {
    const angles = { XY: 0.31, XZ: -0.72, XW: 1.13, YZ: 0.57, YW: -1.9, ZW: 2.4 };
    const R = (p: keyof typeof angles): Mat4 => rotation(p, angles[p]);
    const expected = mul4(R('ZW'), mul4(R('YW'), mul4(R('YZ'), mul4(R('XW'), mul4(R('XZ'), R('XY'))))));
    const reversed = mul4(R('XY'), mul4(R('XZ'), mul4(R('XW'), mul4(R('YZ'), mul4(R('YW'), R('ZW'))))));
    const m = compositeRotation(angles);
    expect(approxEqualMat4(m, expected, 1e-14)).toBe(true);
    expect(approxEqualMat4(m, reversed, 1e-6)).toBe(false);
    // Applying to a vector: XY acts first.
    const v: Vec4 = [0.3, -0.2, 0.9, 0.4];
    let w = v;
    for (const p of ROTATION_PLANES) w = apply4(R(p), w);
    apply4(m, v).forEach((x, k) => expect(x).toBeCloseTo(w[k], 13));
    // Skipping zero angles must not change the product.
    const sparse = { ...zeroAngles(), XZ: 0.4, YW: -0.8 };
    expect(approxEqualMat4(compositeRotation(sparse), mul4(rotation('YW', -0.8), rotation('XZ', 0.4)), 1e-15)).toBe(true);
  });

  it('isoclinic double rotation turns every vector by the same angle; non-isoclinic does not (§2.3)', () => {
    const r = mulberry32(11);
    for (const [a, b] of [[0.6, 0.6], [0.6, -0.6]]) {
      const m = doubleRotation(a, b);
      for (let i = 0; i < 10; i++) {
        const v = randVec4(r, 3);
        // v · D v = (x²+y²) cos a + (z²+w²) cos b = |v|² cos a when cos a = cos b.
        expect(dot4(v, apply4(m, v))).toBeCloseTo(dot4(v, v) * Math.cos(a), 12);
      }
    }
    const m = doubleRotation(0.6, 1.4);
    expect(dot4(E4[0], apply4(m, E4[0]))).toBeCloseTo(Math.cos(0.6), 14);
    expect(dot4(E4[2], apply4(m, E4[2]))).toBeCloseTo(Math.cos(1.4), 14);
  });
});

// ---------------------------------------------------------------------------
// 2. cross4 and det4 (§5.1)
// ---------------------------------------------------------------------------

describe('2. cross4 and det4 against a Leibniz determinant (§5.1)', () => {
  it('cross4(u,v,w)_i = det[e_i; u; v; w] for every i on random inputs', () => {
    const r = mulberry32(22);
    for (let n = 0; n < 50; n++) {
      const u = randVec4(r, 4), v = randVec4(r, 4), w = randVec4(r, 4);
      const x = cross4(u, v, w);
      for (let i = 0; i < 4; i++) expect(x[i]).toBeCloseTo(detLeibniz([E4[i], u, v, w]), 10);
      // orthogonality and positive orientation
      for (const y of [u, v, w]) expect(dot4(x, y)).toBeCloseTo(0, 10);
      expect(detLeibniz([x, u, v, w])).toBeCloseTo(dot4(x, x), 8);
      // alternating in its arguments
      const swapped = cross4(v, u, w);
      for (let i = 0; i < 4; i++) expect(swapped[i]).toBeCloseTo(-x[i], 12);
    }
  });

  it('det4(a,b,c,d) is the true determinant with rows a,b,c,d; determinant4 agrees on row-major storage', () => {
    const r = mulberry32(23);
    for (let n = 0; n < 50; n++) {
      const rows = [randVec4(r, 4), randVec4(r, 4), randVec4(r, 4), randVec4(r, 4)];
      const ref = detLeibniz(rows);
      expect(det4(rows[0], rows[1], rows[2], rows[3])).toBeCloseTo(ref, 10);
      expect(determinant4([...rows[0], ...rows[1], ...rows[2], ...rows[3]])).toBeCloseTo(ref, 10);
      // det(Mᵀ) = det(M): columns-as-rows gives the same value.
      expect(determinant4(fromColumns(rows[0], rows[1], rows[2], rows[3]))).toBeCloseTo(ref, 10);
    }
    // Exact cases: identity, a transposition, a 4-cycle (odd), a 3-cycle (even).
    expect(det4(E4[0], E4[1], E4[2], E4[3])).toBe(1);
    expect(det4(E4[1], E4[0], E4[2], E4[3])).toBe(-1);
    expect(det4(E4[1], E4[2], E4[3], E4[0])).toBe(-1);
    expect(det4(E4[0], E4[2], E4[3], E4[1])).toBe(1);
  });

  it('cross4 of basis triples has the sign of the completing permutation', () => {
    // cross4(e_a, e_b, e_c) = sign(d, a, b, c) e_d where d is the missing index.
    for (const p of permutations(4)) {
      const [d, a, b, c] = p;
      const x = cross4(E4[a], E4[b], E4[c]);
      const expected: Vec4 = [0, 0, 0, 0];
      expected[d] = permSign(p);
      for (let i = 0; i < 4; i++) expect(x[i] + 0).toBe(expected[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. chartBasis (§4)
// ---------------------------------------------------------------------------

describe('3. chartBasis is right-handed, exact at e_w, continuous near it, and robust (§4)', () => {
  /**
   * `digits` is the orthonormality tolerance. A single Gram-Schmidt pass on a
   * rejection of length ℓ ≥ 1e-6 (the skip threshold) would carry
   * cancellation error ~1e-16/ℓ; chartBasis re-orthogonalises once more, so
   * 12 digits are demanded even for deliberately near-axis normals.
   */
  const checkBasis = (n: Vec4, digits = 12): [Vec4, Vec4, Vec4] => {
    const nn = normalize4(n);
    const b = chartBasis(n);
    for (let i = 0; i < 3; i++) {
      expect(dot4(b[i], b[i])).toBeCloseTo(1, digits);
      expect(dot4(b[i], nn)).toBeCloseTo(0, digits);
      for (let j = i + 1; j < 3; j++) expect(dot4(b[i], b[j])).toBeCloseTo(0, digits);
    }
    // columns (u1,u2,u3,n) have det +1  ⇔  det of the matrix with those rows is +1
    expect(detLeibniz([b[0], b[1], b[2], nn])).toBeCloseTo(1, digits);
    expect(determinant4(fromColumns(b[0], b[1], b[2], nn))).toBeCloseTo(1, digits);
    return b;
  };

  it('is exactly (e_x, e_y, e_z) for n = e_w (bitwise, no −0 or rounding)', () => {
    const b = chartBasis([0, 0, 0, 1]);
    expect(b).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
    expect(b.flat().every((v) => Object.is(v, 0) || v === 1)).toBe(true);
    expect(hyperplane([0, 0, 0, 1], 0.3).basis).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
    expect(hyperplane([0, 0, 0, 2.5], 0.3).basis).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
  });

  it('is right-handed orthonormal for ±e_x, ±e_y, ±e_z, ±e_w and every normal with two or three zero components', () => {
    for (let k = 0; k < 4; k++) for (const s of [1, -1]) checkBasis(scale4(E4[k], s));
    const r = mulberry32(33);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const n: Vec4 = [0, 0, 0, 0];
          n[a] = sa * (0.3 + r());
          n[b] = sb * (0.3 + r());
          checkBasis(n);
          const n2: Vec4 = [0, 0, 0, 0];
          n2[a] = sa; n2[b] = sb; // equal magnitudes: the second seed is exactly killed
          checkBasis(n2);
        }
      }
    }
    // one zero component, with a seed exactly in span(n, earlier seeds)
    checkBasis([1, 1, 1, 0]);
    checkBasis([0, -1, 1, 1]);
    checkBasis([1, 0, -1, 1]);
  });

  it('is continuous near e_w: the basis differs from the identity by O(|n − e_w|)', () => {
    const r = mulberry32(34);
    for (const eps of [1e-2, 1e-4, 1e-6, 1e-8]) {
      for (let k = 0; k < 10; k++) {
        const d = randVec4(r, 2);
        d[3] = 0;
        const n = normalize4([eps * d[0], eps * d[1], eps * d[2], 1]);
        const b = checkBasis(n);
        for (let i = 0; i < 3; i++) expect(dist4(b[i], E4[i])).toBeLessThan(2 * eps * length4(d) + 1e-14);
      }
    }
  });

  it('is right-handed and well-conditioned for random normals, including nearly axis-aligned ones', () => {
    const r = mulberry32(35);
    for (let k = 0; k < 200; k++) checkBasis(randUnit4(r));
    for (let k = 0; k < 4; k++) {
      for (const eps of [1e-3, 1e-5, 2e-6, 5e-7, 1e-9]) {
        // rejection length ≈ √3·eps: kept above the 1e-6 threshold, skipped below
        const n: Vec4 = [eps, -eps, eps, eps];
        n[k] = 1;
        checkBasis(n);
        n[k] = -1;
        checkBasis(n);
      }
    }
  });

  it('unchart inverts chart on the hyperplane and chart kills the normal component', () => {
    const r = mulberry32(36);
    for (let k = 0; k < 40; k++) {
      const h = hyperplane(randVec4(r, 3), 2 * (r() - 0.5));
      const q: Vec3 = [r() - 0.5, r() - 0.5, r() - 0.5];
      const p = unchart(h, q);
      expect(signedDistance(h, p)).toBeCloseTo(0, 12);
      chart(h, p).forEach((v, i) => expect(v).toBeCloseTo(q[i], 12));
      // any point: chart(p) = chart(p + t n)
      const off = scale4(h.normal, 3.7);
      const p2: Vec4 = [p[0] + off[0], p[1] + off[1], p[2] + off[2], p[3] + off[3]];
      chart(h, p2).forEach((v, i) => expect(v).toBeCloseTo(q[i], 12));
      // chart is an isometry on H
      const q2: Vec3 = [r() - 0.5, r() - 0.5, r() - 0.5];
      expect(dist4(p, unchart(h, q2))).toBeCloseTo(length3(sub3(q, q2)), 12);
    }
    // hyperplaneW agrees with hyperplane(e_w)
    const hw = hyperplaneW(0.4);
    expect(hw.normal).toEqual([0, 0, 0, 1]);
    expect(unchart(hw, [1, 2, 3])).toEqual([1, 2, 3, 0.4]);
  });
});

// ---------------------------------------------------------------------------
// 4. hyperplaneFromRotation (§4)
// ---------------------------------------------------------------------------

describe('4. hyperplaneFromRotation reproduces the slice of the rotated shape (§4)', () => {
  const { positions, tets } = tesseractFixture();
  const randomAngles = (r: () => number) => ({
    XY: 6 * (r() - 0.5), XZ: 6 * (r() - 0.5), XW: 6 * (r() - 0.5), YZ: 6 * (r() - 0.5), YW: 6 * (r() - 0.5), ZW: 6 * (r() - 0.5),
  });

  const compare = (m: Mat4, c: number): void => {
    const rotated = positions.map((p) => apply4(m, p));
    const direct = sliceTets(rotated, tets, hyperplaneW(c));
    const h = hyperplaneFromRotation(m, c);
    const viaH = sliceTets(positions, tets, h);
    // h is a genuine chart: unit normal, orthonormal basis, det +1.
    expect(length4(h.normal)).toBeCloseTo(1, 12);
    expect(detLeibniz([h.basis[0], h.basis[1], h.basis[2], h.normal])).toBeCloseTo(1, 12);
    // Same vertex multiset, same oriented triangles, same volume.
    expect(viaH.indices.length).toBe(direct.indices.length);
    expect(vertexKeys(viaH)).toEqual(vertexKeys(direct));
    expect(triangleKeys(viaH)).toEqual(triangleKeys(direct));
    expect(signedVolume(viaH)).toBeCloseTo(signedVolume(direct), 5);
    // sourceW: the w of the 4D point in the shape's OWN frame (§10). Recover it
    // by uncharting each slice vertex and compare; for the directly rotated
    // mesh the recorded w is instead the rotated w, which differs in general.
    for (let i = 0; i < viaH.positions.length / 3; i++) {
      const p = unchart(h, vertex3(viaH, i));
      expect(viaH.sourceW[i]).toBeCloseTo(p[3], 4);
    }
  };

  it('for random composite rotations and several offsets', () => {
    const r = mulberry32(44);
    for (let k = 0; k < 8; k++) compare(compositeRotation(randomAngles(r)), 2.2 * (r() - 0.5));
  });

  it('for M = −I (= R_XY(π)·R_ZW(π)) and other rotations with negative diagonals', () => {
    const minusI = compositeRotation({ ...zeroAngles(), XY: Math.PI, ZW: Math.PI });
    for (let i = 0; i < 4; i++) expect(minusI[i * 5]).toBeCloseTo(-1, 15);
    compare(minusI, 0.35);
    compare(minusI, -0.6);
    compare(compositeRotation({ XY: Math.PI, XZ: Math.PI, XW: Math.PI, YZ: Math.PI, YW: Math.PI, ZW: Math.PI }), 0.25);
    compare(compositeRotation({ XY: 2.9, XZ: -2.8, XW: 3.0, YZ: -3.1, YW: 2.7, ZW: -2.95 }), 0.5);
    // a rotation taking e_w to −e_x: normal becomes −e_x-ish, basis contains −e_w
    compare(rotation('XW', Math.PI / 2), 0.4);
    compare(rotation('XW', -Math.PI / 2), 0.4);
  });

  it('normal is Mᵀe_w, basis is (Mᵀe_x, Mᵀe_y, Mᵀe_z), so it equals the identity chart at M = I', () => {
    const r = mulberry32(45);
    const m = compositeRotation(randomAngles(r));
    const h = hyperplaneFromRotation(m, 0.1);
    const mt = transpose4(m);
    expect(h.normal).toEqual(apply4(mt, E4[3]));
    for (let k = 0; k < 3; k++) expect(h.basis[k]).toEqual(apply4(mt, E4[k]));
    const hi = hyperplaneFromRotation(identity4(), 0.1);
    expect(hi).toEqual(hyperplaneW(0.1));
  });
});

// ---------------------------------------------------------------------------
// 5. tetFaces and induced orientation (§5.1, §5.2)
// ---------------------------------------------------------------------------

describe('5. tetFaces is the oriented boundary; adjacent outward tets induce opposite cycles (§5)', () => {
  it('tetFaces(a,b,c,d) = ∂[a,b,c,d] = [b,c,d] − [a,c,d] + [a,b,d] − [a,b,c]', () => {
    const faces = tetFaces([7, 3, 9, 5]);
    // −[a,c,d] = [a,d,c], −[a,b,c] = [a,c,b]
    expect(faces.map(cyc).sort()).toEqual([[3, 9, 5], [7, 5, 9], [7, 3, 5], [7, 9, 3]].map((f) => cyc(f as [number, number, number])).sort());
    // the face opposite vertex k carries the sign (−1)^k: check via the 4D
    // "outward from the tet" rule — (ν, face orientation) has the tet's
    // orientation, with ν pointing from the opposite vertex into the face.
    const P: Vec4[] = [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
    const t: Tet = [0, 1, 2, 3];
    const tetOrient = (u: Vec4, v: Vec4, w: Vec4): number => cross4(u, v, w)[3]; // sign within the 3-flat w = 0
    const base = tetOrient(sub4(P[1], P[0]), sub4(P[2], P[0]), sub4(P[3], P[0]));
    for (const [k, f] of tetFaces(t).entries()) {
      const opposite = P[t[k]]; // tetFaces lists the face opposite t[k] at position k
      expect(f).not.toContain(t[k]);
      const [a, b, c] = f.map((i) => P[i]);
      const nu = sub4(centroid4([a, b, c]), opposite);
      // (ν, b−a, c−a) must have the same orientation as the tet itself.
      expect(Math.sign(tetOrient(nu, sub4(b, a), sub4(c, a)))).toBe(Math.sign(base));
    }
  });

  it('tesseract fixture: every face in exactly two tets with opposite induced cycles', () => {
    const { positions, tets } = tesseractFixture();
    const map = faceCycles(tets);
    expect(map.size).toBe(96 * 4 / 2);
    for (const [, cycles] of map) {
      expect(cycles.length).toBe(2);
      expect(cycles[0]).not.toBe(cycles[1]);
    }
    for (const t of tets) expect(dot4(tetNormal(positions, t), positions[t[0]])).toBeGreaterThan(0);
    expect(validateTetComplex(positions, tets).ok).toBe(true);
  });

  it('hand-built 5-cell: 10 faces each in two tets with opposite cycles; hypervolume √5/96·(2√2)^4 = 2√5/3', () => {
    const { positions, tets } = fiveCell();
    // §8.1 facts
    for (let i = 0; i < 5; i++) {
      expect(length4(positions[i])).toBeCloseTo(4 / Math.sqrt(5), 12);
      for (let j = i + 1; j < 5; j++) expect(dist4(positions[i], positions[j])).toBeCloseTo(2 * Math.SQRT2, 12);
    }
    centroid4(positions).forEach((v) => expect(v).toBeCloseTo(0, 12));
    const map = faceCycles(tets);
    expect(map.size).toBe(10);
    for (const [, cycles] of map) {
      expect(cycles.length).toBe(2);
      expect(cycles[0]).not.toBe(cycles[1]);
    }
    const v = validateTetComplex(positions, tets);
    expect(v.errors).toEqual([]);
    expect(hypervolumeByCones(positions, tets)).toBeCloseTo(2 * Math.sqrt(5) / 3, 12);
    expect(signedHypervolume(positions, tets)).toBeCloseTo(2 * Math.sqrt(5) / 3, 12);
    // flipping one tet is detected as an inconsistent orientation on its 4 faces
    const bad: Tet[] = tets.map((t, i) => (i === 2 ? [t[0], t[2], t[1], t[3]] : t));
    const vb = validateTetComplex(positions, bad);
    expect(vb.ok).toBe(false);
    expect(vb.inconsistentFaces).toBe(4);
    // outward: N · (a − o) > 0 for every tet (§5.1) and the facet normal is −v_k (§8.3)
    tets.forEach((t) => {
      const n = normalize4(tetNormal(positions, t));
      const missing = [0, 1, 2, 3, 4].find((k) => !t.includes(k))!;
      const facetNormal = normalize4(scale4(positions[missing], -1));
      n.forEach((x, k) => expect(x).toBeCloseTo(facetNormal[k], 12));
    });
  });
});

// ---------------------------------------------------------------------------
// 6. sliceTets on a single tet (§6)
// ---------------------------------------------------------------------------

describe('6. sliceTets: quad cyclic order, orientation, sourceW, limit from below, no NaN (§6)', () => {
  // A generic (irregular, tilted) tet in R^4, outward-oriented by construction:
  // we *define* outward as the direction of its own cross4, so the mirrored
  // index order (a,c,b,d) is the same tet with the opposite outward side.
  const P: Vec4[] = [[0.1, -0.2, 0.3, 0.05], [1.3, 0.2, -0.1, 0.4], [0.2, 1.1, 0.3, -0.3], [-0.1, 0.1, 1.2, 0.5]];
  const tetA: Tet = [0, 1, 2, 3];
  const tetB: Tet = [0, 2, 1, 3];

  /** Hyperplanes (through the interior) realising every positive-set pattern. */
  function hyperplanesByPattern(): Map<string, Hyperplane> {
    const r = mulberry32(66);
    const found = new Map<string, Hyperplane>();
    const inside = centroid4(P);
    for (let k = 0; k < 20000 && found.size < 14; k++) {
      const n = randUnit4(r);
      const p: Vec4 = [inside[0] + 0.5 * (r() - 0.5), inside[1] + 0.5 * (r() - 0.5), inside[2] + 0.5 * (r() - 0.5), inside[3] + 0.5 * (r() - 0.5)];
      const h = hyperplane(n, dot4(n, p));
      const pattern = P.map((q) => (signedDistance(h, q) >= 0 ? '+' : '-')).join('');
      if (pattern === '++++' || pattern === '----') continue;
      if (!found.has(pattern)) found.set(pattern, h);
    }
    return found;
  }

  const checkSlice = (tet: Tet, h: Hyperplane, pattern: string): TriMesh3 => {
    const m = sliceTets(P, [tet], h);
    const positives = pattern.split('').filter((c) => c === '+').length;
    expect(triangleCount(m)).toBe(positives === 2 ? 2 : 1);
    const n3 = chart(h, tetNormal(P, tet));
    for (const tri of triangles(m)) {
      // outward: cross(v1−v0, v2−v0) · N_3 > 0
      expect(dot3(triNormal(tri), n3)).toBeGreaterThan(1e-9);
      // all vertices lie on h
      for (const q of tri) expect(signedDistance(h, unchart(h, q))).toBeCloseTo(0, 6);
    }
    // sourceW is the 4D w of the vertex actually emitted (follows any swap)
    for (let i = 0; i < m.positions.length / 3; i++) {
      expect(m.sourceW[i]).toBeCloseTo(unchart(h, vertex3(m, i))[3], 5);
    }
    // every emitted vertex is a crossing point of an edge joining the two classes
    const pos = [0, 1, 2, 3].filter((i) => pattern[i] === '+');
    const neg = [0, 1, 2, 3].filter((i) => pattern[i] === '-');
    const expected: Vec3[] = [];
    for (const i of pos) for (const j of neg) {
      const si = signedDistance(h, P[i]), sj = signedDistance(h, P[j]);
      const t = si / (si - sj);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      expected.push(chart(h, [P[i][0] + t * (P[j][0] - P[i][0]), P[i][1] + t * (P[j][1] - P[i][1]), P[i][2] + t * (P[j][2] - P[i][2]), P[i][3] + t * (P[j][3] - P[i][3])]));
    }
    for (let i = 0; i < m.positions.length / 3; i++) {
      const q = vertex3(m, i);
      expect(Math.min(...expected.map((e) => length3(sub3(e, q))))).toBeLessThan(1e-5);
    }
    if (positives === 2) {
      // The two triangles must tile the convex quad: shared diagonal in
      // opposite directions, 4 boundary edges, total area = hull area.
      const rep = checkClosedOriented(dropDegenerateTriangles(weldVertices(m, 1e-6)));
      expect(rep.boundaryEdges).toBe(4);
      expect(rep.edgeCount).toBe(5);
      expect(rep.nonManifoldEdges).toBe(0);
      expect(rep.inconsistentEdges).toBe(0);
      // Hull area of 4 coplanar points = area of the polygon in angular order
      // about their centroid (convex ⇒ this is the hull).
      const c: Vec3 = [0, 0, 0];
      for (const e of expected) for (let k = 0; k < 3; k++) c[k] += e[k] / 4;
      const u = normalize3((sub3(expected[0], c)));
      const nrm = normalize3(n3);
      const v = cross3(nrm, u);
      const sorted = [...expected].sort((a, b) => Math.atan2(dot3(sub3(a, c), v), dot3(sub3(a, c), u)) - Math.atan2(dot3(sub3(b, c), v), dot3(sub3(b, c), u)));
      let hull = 0;
      for (let k = 0; k < 4; k++) hull += dot3(cross3(sub3(sorted[k], c), sub3(sorted[(k + 1) % 4], c)), nrm) / 2;
      const area = triangles(m).reduce((s, t) => s + triArea(t), 0);
      expect(area).toBeCloseTo(Math.abs(hull), 6);
      expect(area).toBeGreaterThan(1e-4);
    }
    return m;
  };
  const normalize3 = (a: Vec3): Vec3 => { const l = length3(a); return [a[0] / l, a[1] / l, a[2] / l]; };

  /**
   * Whether the slicer's orientation test flips a triangle, recomputed here
   * from §6 alone: the un-flipped triangle is (ac, ad, bd) / (ac, bd, bc) with
   * (a, b) the positives in tet order, or (s·o0, s·o1, s·o2) for the single
   * vertex s; flip iff its cross product points against N_3. Used only to
   * prove both branches are exercised, never as the correctness oracle.
   */
  const predictFlips = (tet: Tet, h: Hyperplane): boolean[] => {
    const s = tet.map((i) => signedDistance(h, P[i]));
    const pos = tet.filter((_, k) => s[k] >= 0);
    const neg = tet.filter((_, k) => s[k] < 0);
    const x = (i: number, j: number): Vec3 => {
      const si = signedDistance(h, P[i]), sj = signedDistance(h, P[j]);
      const t = si / (si - sj);
      return chart(h, [P[i][0] + t * (P[j][0] - P[i][0]), P[i][1] + t * (P[j][1] - P[i][1]), P[i][2] + t * (P[j][2] - P[i][2]), P[i][3] + t * (P[j][3] - P[i][3])]);
    };
    const n3 = chart(h, tetNormal(P, tet));
    const flip = (q0: Vec3, q1: Vec3, q2: Vec3): boolean => dot3(cross3(sub3(q1, q0), sub3(q2, q0)), n3) < 0;
    if (pos.length === 2) {
      const [a, b] = pos, [c, d] = neg;
      return [flip(x(a, c), x(a, d), x(b, d)), flip(x(a, c), x(b, d), x(b, c))];
    }
    const single = pos.length === 1 ? pos[0] : neg[0];
    const others = pos.length === 1 ? neg : pos;
    return [flip(x(single, others[0]), x(single, others[1]), x(single, others[2]))];
  };

  it('all 6 two-positive patterns and all 8 one/three-positive patterns are reachable and correct for both orientations', () => {
    const byPattern = hyperplanesByPattern();
    const two = [...byPattern.keys()].filter((p) => p.split('+').length - 1 === 2);
    expect(two.sort()).toEqual(['++--', '+-+-', '+--+', '-++-', '-+-+', '--++']);
    expect(byPattern.size).toBe(14);
    let flipped = 0, unflipped = 0;
    for (const [pattern, h] of byPattern) {
      const mA = checkSlice(tetA, h, pattern);
      const mB = checkSlice(tetB, h, pattern);
      for (const t of [tetA, tetB]) for (const f of predictFlips(t, h)) (f ? flipped++ : unflipped++);
      // Same polygon, opposite outward side: same vertex set, same area, and
      // the cone volume from the origin (triangulation-independent for a
      // planar polygon) changes sign. The quad may use the other diagonal
      // because the positives are enumerated in tet order.
      expect([...new Set(vertexKeys(mA, 4))]).toEqual([...new Set(vertexKeys(mB, 4))]);
      const area = (m: TriMesh3): number => triangles(m).reduce((s, t) => s + triArea(t), 0);
      expect(area(mA)).toBeCloseTo(area(mB), 6);
      expect(signedVolume(mA)).toBeCloseTo(-signedVolume(mB), 6);
      if (pattern.split('+').length - 1 !== 2) {
        // single triangle: exact mirror image
        const rev = (m: TriMesh3): string[] => triangles(m).map((t) => triangleKeys(meshFrom([t[0], t[2], t[1]], [[0, 1, 2]]))[0]).sort();
        expect(rev(mA)).toEqual(triangleKeys(mB));
      }
    }
    // both orientation branches were exercised, for quads and single triangles
    expect(flipped).toBeGreaterThan(4);
    expect(unflipped).toBeGreaterThan(4);
    const quadFlips = two.flatMap((p) => [tetA, tetB].flatMap((t) => predictFlips(t, byPattern.get(p)!)));
    expect(quadFlips.some((f) => f)).toBe(true);
    expect(quadFlips.some((f) => !f)).toBe(true);
  });

  it('limit from below: vertices on H count as positive, along +e_w and −e_w alike', () => {
    const { positions, tets } = tesseractFixture();
    // +e_w: offset 1 is the cube at w = 1; offset −1 is empty.
    expect(analyseSlice(sliceTets(positions, tets, hyperplaneW(1))).volume).toBeCloseTo(8, 5);
    expect(sliceTets(positions, tets, hyperplaneW(-1)).indices.length).toBe(0);
    // −e_w with offset c means w = −c; the "below" side is now larger w, so
    // offset 1 (w = −1) is the cube and offset −1 (w = +1) is empty.
    expect(analyseSlice(sliceTets(positions, tets, hyperplane([0, 0, 0, -1], 1))).volume).toBeCloseTo(8, 5);
    expect(sliceTets(positions, tets, hyperplane([0, 0, 0, -1], -1)).indices.length).toBe(0);
    // Single tet: a vertex exactly on H with the rest negative gives a
    // zero-area triangle at that vertex (the limit of a shrinking triangle).
    const h = hyperplane([0, 0, 0, 1], P[3][3]); // through vertex 3 (largest w)
    expect(P.map((q) => signedDistance(h, q) >= 0)).toEqual([false, false, false, true]);
    const m = sliceTets(P, [tetA], h);
    expect(triangleCount(m)).toBe(1);
    for (let i = 0; i < 3; i++) expect(length3(sub3(vertex3(m, i), chart(h, P[3])))).toBeLessThan(1e-6);
    // ... and with the rest positive, nothing (all four positive).
    const h2 = hyperplane([0, 0, 0, 1], P[2][3]); // through vertex 2 (smallest w)
    expect(sliceTets(P, [tetA], h2).indices.length).toBe(0);
  });

  it('never produces NaN or Infinity, even with coincident vertices and vertices exactly on H', () => {
    // Two coincident vertices (indices 0 and 4), both exactly on H, with the
    // other vertices split: crossings from the on-H vertices land at t = 0.
    const Q: Vec4[] = [[0, 0, 0, 0], [1, 0, 0, 0.3], [0, 1, 0, -0.7], [0, 0, 1, 0.2], [0, 0, 0, 0]];
    const tets: Tet[] = [[0, 1, 2, 3], [4, 1, 2, 3], [0, 4, 1, 2], [0, 1, 4, 3]];
    for (const h of [hyperplaneW(0), hyperplane([1, 1, 1, 1], 0), hyperplaneW(0.3), hyperplaneW(-0.7), hyperplane([1, 0, 0, 0], 0)]) {
      const m = sliceTets(Q, tets, h);
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of m.sourceW) expect(Number.isFinite(v)).toBe(true);
      // the degenerate tets (containing both copies) have zero normal and emit nothing
    }
    const degenerate = sliceTets(Q, [[0, 4, 1, 2]], hyperplaneW(0.1));
    expect(degenerate.indices.length).toBe(0);
    // s_i = s_j across classes is impossible: t = s_i/(s_i − s_j) ∈ [0, 1] with a
    // positive denominator, so |t| ≤ 1 always; check on a near-coincident pair.
    const R: Vec4[] = [[0, 0, 0, 1e-300], [0, 0, 0, -1e-300], [1, 0, 0, 1], [0, 1, 0, 1]];
    const m = sliceTets(R, [[0, 1, 2, 3]], hyperplaneW(0));
    for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. weldVertices, checkClosedOriented, signedVolume (§6)
// ---------------------------------------------------------------------------

describe('7. weldVertices, checkClosedOriented, signedVolume', () => {
  it('merges pairs within tol even when they straddle grid cells (all 7 straddle directions)', () => {
    const tol = 1e-3;
    for (let mask = 1; mask < 8; mask++) {
      const a: Vec3 = [0, 0, 0], b: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (mask & (1 << k)) { a[k] = 0.9995 * tol; b[k] = 1.0005 * tol; } else { a[k] = 0.5 * tol; b[k] = 0.5 * tol; }
      }
      // |a − b| = 0.001·tol·√(popcount) ≤ tol, cells differ along the masked axes
      const m = weldVertices(meshFrom([a, b, [5, 5, 5]], [[0, 1, 2]]), tol);
      expect(m.positions.length / 3).toBe(2);
      expect(Array.from(m.indices)).toEqual([0, 0, 1]);
      // negative side too
      const m2 = weldVertices(meshFrom([scale3(a, -1), scale3(b, -1), [5, 5, 5]], [[0, 1, 2]]), tol);
      expect(m2.positions.length / 3).toBe(2);
    }
  });
  const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

  it('never merges two points farther than 2·tol apart, and every point is within tol of its representative', () => {
    const tol = 1e-2;
    const r = mulberry32(77);
    const pts: Vec3[] = [];
    for (let i = 0; i < 400; i++) pts.push([3 * tol * r(), 3 * tol * r(), 3 * tol * r()]);
    const tris: number[][] = [];
    for (let i = 0; i + 2 < pts.length; i += 3) tris.push([i, i + 1, i + 2]);
    const m = weldVertices(meshFrom(pts, tris), tol);
    expect(m.positions.length / 3).toBeLessThan(pts.length);
    // Recover the representative of each original index from the triangles.
    const rep = new Map<number, number>();
    tris.flat().forEach((orig, k) => rep.set(orig, m.indices[k]));
    for (const [orig, w] of rep) {
      const d = length3(sub3(pts[orig], vertex3(m, w)));
      expect(d).toBeLessThanOrEqual(tol * (1 + 1e-5));
    }
    const groups = new Map<number, number[]>();
    for (const [orig, w] of rep) groups.set(w, [...(groups.get(w) ?? []), orig]);
    for (const [, g] of groups) {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        expect(length3(sub3(pts[g[i]], pts[g[j]]))).toBeLessThanOrEqual(2 * tol * (1 + 1e-5));
      }
    }
    // Pairs farther than 2·tol: a direct check with exactly 2.01·tol separation.
    const far = weldVertices(meshFrom([[0, 0, 0], [2.01 * tol, 0, 0], [0, 1, 0]], [[0, 1, 2]]), tol);
    expect(far.positions.length / 3).toBe(3);
  });

  it('welding is greedy: a chain 0, 0.9·tol, 1.8·tol merges the middle into the first and leaves the last alone', () => {
    // Documented limitation: "within tol" is tested against representatives,
    // not transitively; clusters have diameter ≤ 2·tol, never more.
    const tol = 1e-2;
    const m = weldVertices(meshFrom([[0, 0, 0], [0.9 * tol, 0, 0], [1.8 * tol, 0, 0]], [[0, 1, 2]]), tol);
    expect(m.positions.length / 3).toBe(2);
    expect(Array.from(m.indices)).toEqual([0, 0, 1]);
  });

  it('checkClosedOriented computes Euler over referenced vertices only', () => {
    // Tetrahedron surface, outward CCW, plus two unreferenced vertices.
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [9, 9, 9], [8, 8, 8]];
    const tris = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
    const rep = checkClosedOriented(meshFrom(pts, tris));
    expect(rep.closed).toBe(true);
    expect(rep.consistent).toBe(true);
    expect(rep.edgeCount).toBe(6);
    expect(rep.euler).toBe(2);
    // One flipped triangle: 3 inconsistent edges, still closed.
    const bad = checkClosedOriented(meshFrom(pts, [[0, 1, 2], ...tris.slice(1)]));
    expect(bad.closed).toBe(true);
    expect(bad.consistent).toBe(false);
    expect(bad.inconsistentEdges).toBe(3);
    // Remove a triangle: 3 boundary edges.
    const open = checkClosedOriented(meshFrom(pts, tris.slice(1)));
    expect(open.closed).toBe(false);
    expect(open.boundaryEdges).toBe(3);
  });

  it('signedVolume is translation-invariant for a closed slice and not for an open soup', () => {
    const { positions, tets } = tesseractFixture();
    const slice = sliceTets(positions, tets, hyperplane([0.4, -0.3, 0.8, 0.5], 0.27));
    const v0 = signedVolume(slice);
    expect(v0).toBeGreaterThan(0);
    for (const t of [[1, 0, 0], [0, -2.5, 0], [3.1, 4.2, -5.3]] as Vec3[]) {
      expect(signedVolume(translateMesh(slice, t))).toBeCloseTo(v0, 3);
    }
    // the tetrahedron surface above has volume 1/6 and is invariant too
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const tris = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
    expect(signedVolume(meshFrom(pts, tris))).toBeCloseTo(1 / 6, 6);
    expect(signedVolume(translateMesh(meshFrom(pts, tris), [2, 3, 4]))).toBeCloseTo(1 / 6, 5);
    // a single triangle is not closed: its "volume" moves with translation
    const one = meshFrom(pts, [[1, 2, 3]]);
    expect(signedVolume(translateMesh(one, [2, 3, 4]))).not.toBeCloseTo(signedVolume(one), 3);
  });
});

// ---------------------------------------------------------------------------
// 8. Hypervolume and the slice integral (§7)
// ---------------------------------------------------------------------------

describe('8. hypervolumeByCones vs signedHypervolume; sliceVolumeIntegral convergence (§7)', () => {
  const { positions, tets } = tesseractFixture();
  const shape = new TetShape('tesseract', 'polytope', { positions, tets }, null);

  it('cones and signed agree on outward complexes (tesseract 16, 5-cell 2√5/3) and disagree once a tet is flipped', () => {
    expect(hypervolumeByCones(positions, tets)).toBeCloseTo(16, 10);
    expect(signedHypervolume(positions, tets)).toBeCloseTo(16, 10);
    // with an off-centre interior point too (the sum of cones is independent of o)
    expect(hypervolumeByCones(positions, tets, [0.3, -0.2, 0.5, 0.1])).toBeCloseTo(16, 10);
    expect(signedHypervolume(positions, tets, [0.3, -0.2, 0.5, 0.1])).toBeCloseTo(16, 10);
    const fc = fiveCell();
    expect(hypervolumeByCones(fc.positions, fc.tets)).toBeCloseTo(signedHypervolume(fc.positions, fc.tets), 12);
    const flipped: Tet[] = tets.map((t, i) => (i === 0 ? [t[0], t[2], t[1], t[3]] : t));
    expect(hypervolumeByCones(positions, flipped)).toBeCloseTo(16, 10);
    expect(signedHypervolume(positions, flipped)).toBeLessThan(16 - 1e-6);
  });

  it('midpoint rule along e_w is exact whenever ±1 fall on cell boundaries, and within 8·dc otherwise', () => {
    // A(c) = 8 on (−1, 1], 0 elsewhere (limit from below), R = 2, dc = 4/steps.
    for (const steps of [10, 50, 100, 200, 400]) expect(sliceVolumeIntegral(shape, [0, 0, 0, 1], steps)).toBeCloseTo(16, 9);
    for (const steps of [7, 13, 101]) {
      const dc = 4 / steps;
      expect(Math.abs(sliceVolumeIntegral(shape, [0, 0, 0, 1], steps) - 16)).toBeLessThanOrEqual(8 * dc + 1e-9);
    }
    expect(sliceVolumeIntegral(shape, [0, 0, 0, -1], 200)).toBeCloseTo(16, 9);
  });

  it('along the main diagonal the error shrinks as steps double, down to the float32 floor', () => {
    const errs = [25, 50, 100].map((s) => Math.abs(sliceVolumeIntegral(shape, [1, 1, 1, 1], s) - 16));
    expect(errs[0]).toBeGreaterThan(1e-6); // coarse grid has a visible error
    expect(errs[1]).toBeLessThan(errs[0]);
    expect(errs[2]).toBeLessThan(errs[1]);
    expect(Math.abs(sliceVolumeIntegral(shape, [1, 1, 1, 1], 400) - 16)).toBeLessThan(1e-6);
    // a generic direction converges too
    const r = mulberry32(88);
    for (let k = 0; k < 3; k++) {
      const n = randUnit4(r);
      const e1 = Math.abs(sliceVolumeIntegral(shape, n, 40) - 16);
      const e2 = Math.abs(sliceVolumeIntegral(shape, n, 320) - 16);
      expect(e2).toBeLessThan(Math.max(e1, 1e-6));
      expect(e2).toBeLessThan(1e-4);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Projections (§3)
// ---------------------------------------------------------------------------

describe('9. projection edge cases (§3)', () => {
  it('perspective: d/(d−w) scaling, w ≥ d clamps the denominator to minDenom, d ≤ 0 throws', () => {
    expect(projectPerspective([1, 1, 1, 1], 3)).toEqual([1.5, 1.5, 1.5]);
    expect(projectPerspective([1, 1, 1, -1], 3)).toEqual([0.75, 0.75, 0.75]);
    expect(projectPerspective([2, -4, 6, 0], 3)).toEqual([2, -4, 6]);
    // clamp: denominator 1e-3 ⇒ scale 3000 for w = d, w > d and w just below d
    for (const w of [3, 5, 100, 3 - 1e-4]) {
      const q = projectPerspective([1, 2, 3, w], 3);
      expect(q).toEqual([3000, 6000, 9000]);
    }
    expect(projectPerspective([1, 2, 3, 2.9], 3, 0.5)).toEqual([6, 12, 18]);
    // nearer the eye ⇒ larger, monotone in w below the clamp
    let prev = 0;
    for (let w = -5; w < 3 - 1e-3; w += 0.25) {
      const s = projectPerspective([1, 0, 0, w], 3)[0];
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(() => projectPerspective([1, 1, 1, 1], 0)).toThrow();
    expect(() => projectPerspective([1, 1, 1, 1], -2)).toThrow();
    expect(() => projectPerspective([1, 1, 1, 1], Number.NaN)).toThrow();
  });

  it('stereographic normalises its input, has |S(p)|² = (1+w)/(1−w) on S³, maps −pole to the origin, and throws on 0', () => {
    const r = mulberry32(99);
    for (let k = 0; k < 20; k++) {
      const p = randUnit4(r);
      if (p[3] > 0.99) continue;
      const q = projectStereographic(p);
      const [x, y, z, w] = p;
      expect(q[0]).toBeCloseTo(x / (1 - w), 12);
      expect(q[1]).toBeCloseTo(y / (1 - w), 12);
      expect(q[2]).toBeCloseTo(z / (1 - w), 12);
      expect(dot3(q, q)).toBeCloseTo((1 + w) / (1 - w), 10);
      const scaled = projectStereographic(scale4(p, 7.5));
      scaled.forEach((v, i) => expect(v).toBeCloseTo(q[i], 12));
    }
    expect(projectStereographic([0, 0, 0, -1])).toEqual([0, 0, 0]);
    expect(projectStereographic([0, 0, 0, -3])).toEqual([0, 0, 0]);
    expect(projectStereographic([1, 0, 0, 0])).toEqual([1, 0, 0]);
    expect(() => projectStereographic([0, 0, 0, 0])).toThrow();
  });

  it('stereographic: the pole is pushed at least as far as any nearby point, not to the origin', () => {
    // The pole has no image. The polar cap 1 − w < δ (δ = minDenom = 1e-6) is
    // clamped to the latitude w_c = 1 − δ, whose points map to radius
    // √((1+w_c)/(1−w_c)) = √((2−δ)/δ) ≈ 1414.2; a point 0.01 rad from the pole
    // maps to sin(0.01)/(1 − cos(0.01)) ≈ 200. The 16-cell and 600-cell have a
    // vertex at exactly e_w, so this is what the default rotation draws.
    const near = projectStereographic([Math.sin(0.01), 0, 0, Math.cos(0.01)]);
    const pole = projectStereographic([0, 0, 0, 1]);
    expect(length3(near)).toBeGreaterThan(100);
    expect(length3(pole)).toBeGreaterThanOrEqual(length3(near));
    expect(length3(pole)).toBeCloseTo(Math.sqrt((2 - 1e-6) / 1e-6), 6);
    // Continuous at the cap boundary, and inside the cap the point keeps its
    // own xyz direction at the boundary radius (never nearer the origin).
    const edge = projectStereographic([Math.sqrt(1 - (1 - 1e-6) ** 2), 0, 0, 1 - 1e-6]);
    expect(length3(edge)).toBeCloseTo(length3(pole), 6);
    const inside = projectStereographic([0, 3e-4, -4e-4, Math.sqrt(1 - 25e-8)]); // 1 − w ≈ 1.25e-7
    expect(length3(inside)).toBeCloseTo(length3(pole), 6);
    expect(inside[0]).toBe(0);
    expect(inside[1]).toBeGreaterThan(0);
    expect(inside[1] / inside[2]).toBeCloseTo(-0.75, 12);
    // a custom minDenom moves the cap radius accordingly
    expect(length3(projectStereographic([0, 0, 0, 1], 1e-2))).toBeCloseTo(Math.sqrt(1.99 / 0.01), 10);
  });

  it('project() dispatches to the three projections', () => {
    const p: Vec4 = [0.3, -0.6, 0.2, 0.5];
    expect(project(p, { kind: 'orthographic' })).toEqual(projectOrthographic(p));
    expect(project(p, { kind: 'orthographic' })).toEqual([0.3, -0.6, 0.2]);
    expect(project(p, { kind: 'perspective', distance: 3 })).toEqual(projectPerspective(p, 3));
    expect(project(p, { kind: 'stereographic' })).toEqual(projectStereographic(p));
  });
});

// ---------------------------------------------------------------------------
// 10. Robustness of validateTetComplex
// ---------------------------------------------------------------------------

describe('10. validateTetComplex robustness (§5.2)', () => {
  it('reports an out-of-range vertex index instead of throwing', () => {
    // A tet with a bad index has no geometry: its volume and faces are skipped
    // and the report is still returned.
    let report: ReturnType<typeof validateTetComplex> | undefined;
    expect(() => { report = validateTetComplex([[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0]], [[0, 1, 2, 7]]); }).not.toThrow();
    expect(report?.ok).toBe(false);
    expect(report?.errors).toEqual(['tet 0 has out-of-range vertex 7']);
    expect(report?.faceCount).toBe(0);
    // negative and non-integer indices are reported the same way, and the
    // good tet is still counted
    const P: Vec4[] = [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
    const bad = validateTetComplex(P, [[0, 1, 2, 3], [0, 2, 1, -1], [0, 1, 3, 1.5]]);
    expect(bad.ok).toBe(false);
    expect(bad.errors.filter((e) => e.includes('out-of-range')).length).toBe(2);
    expect(bad.tetCount).toBe(3);
    expect(bad.faceCount).toBe(4);
  });

  it('flags repeated vertices and degenerate tets, and accepts degenerate ones only when allowed', () => {
    const P: Vec4[] = [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0.5, 0.5, 0, 0]];
    const flat = validateTetComplex(P, [[0, 1, 2, 4], [0, 2, 1, 4]]); // coplanar: zero volume, closed
    expect(flat.degenerateTets).toBe(2);
    expect(flat.ok).toBe(false);
    expect(validateTetComplex(P, [[0, 1, 2, 4], [0, 2, 1, 4]], { allowDegenerate: true }).ok).toBe(true);
    const rep = validateTetComplex(P, [[0, 1, 1, 2]]);
    expect(rep.errors.some((e) => e.includes('repeats'))).toBe(true);
  });
});
