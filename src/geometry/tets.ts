import type { Tet, Vec4 } from '../math/types';
import { cross4, det4, dot4, length4, sub4 } from '../math/vec';

/** Unnormalised outward normal cross4(b−a, c−a, d−a) of a tet. MATH.md §5.1 */
export function tetNormal(positions: readonly Vec4[], t: Tet): Vec4 {
  const a = positions[t[0]];
  return cross4(sub4(positions[t[1]], a), sub4(positions[t[2]], a), sub4(positions[t[3]], a));
}

/** Six times the 3-volume of a tet (|cross4| of its edge vectors). */
export const tetVolume6 = (positions: readonly Vec4[], t: Tet): number => length4(tetNormal(positions, t));

/**
 * Return a copy of tets with each one oriented so its normal points away from
 * the interior point `o`. Valid for star-shaped solids. MATH.md §5.1
 */
export function orientTetsOutward(positions: readonly Vec4[], tets: readonly Tet[], o: Vec4): Tet[] {
  return tets.map((t) => {
    const n = tetNormal(positions, t);
    const toA = sub4(positions[t[0]], o);
    return dot4(n, toA) < 0 ? [t[0], t[2], t[1], t[3]] : [t[0], t[1], t[2], t[3]];
  });
}

/**
 * 4-volume of a star-shaped solid from its boundary tets, as the sum of cone
 * volumes |det[a−o; b−o; c−o; d−o]| / 24. MATH.md §7
 */
export function hypervolumeByCones(positions: readonly Vec4[], tets: readonly Tet[], o: Vec4 = [0, 0, 0, 0]): number {
  let v = 0;
  for (const t of tets) {
    v += Math.abs(det4(
      sub4(positions[t[0]], o), sub4(positions[t[1]], o),
      sub4(positions[t[2]], o), sub4(positions[t[3]], o),
    ));
  }
  return v / 24;
}

/**
 * Signed version: positive when every tet is outward oriented with respect to
 * o. Equals hypervolumeByCones for a correctly oriented complex.
 */
export function signedHypervolume(positions: readonly Vec4[], tets: readonly Tet[], o: Vec4 = [0, 0, 0, 0]): number {
  let v = 0;
  for (const t of tets) {
    v += det4(
      sub4(positions[t[0]], o), sub4(positions[t[1]], o),
      sub4(positions[t[2]], o), sub4(positions[t[3]], o),
    );
  }
  return v / 24;
}

export interface TetValidation {
  ok: boolean;
  errors: string[];
  tetCount: number;
  faceCount: number;
  boundaryFaces: number;
  nonManifoldFaces: number;
  inconsistentFaces: number;
  degenerateTets: number;
}

/**
 * The oriented boundary faces of tet (a,b,c,d): (b,c,d), (a,d,c), (a,b,d),
 * (a,c,b). Two tets sharing a face induce opposite cyclic orders on it iff the
 * complex is consistently oriented.
 */
export function tetFaces(t: Tet): [number, number, number][] {
  const [a, b, c, d] = t;
  return [[b, c, d], [a, d, c], [a, b, d], [a, c, b]];
}

function canonicalCycle(f: [number, number, number]): [number, number, number] {
  // Rotate so the smallest index is first, preserving cyclic order.
  const [a, b, c] = f;
  if (a <= b && a <= c) return [a, b, c];
  if (b <= a && b <= c) return [b, c, a];
  return [c, a, b];
}

/**
 * Check closedness, consistent orientation and degeneracy. MATH.md §5.2
 * `allowDegenerate` permits zero-volume tets (documented per shape).
 */
export function validateTetComplex(
  positions: readonly Vec4[],
  tets: readonly Tet[],
  opts: { allowDegenerate?: boolean; degenerateTol?: number } = {},
): TetValidation {
  const errors: string[] = [];
  const faceMap = new Map<string, { cycles: string[] }>();
  let degenerateTets = 0;
  let scale = 0;
  for (const p of positions) scale = Math.max(scale, length4(p));
  const tol = (opts.degenerateTol ?? 1e-9) * Math.max(scale, 1) ** 3;

  tets.forEach((t, ti) => {
    for (const idx of t) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= positions.length) {
        errors.push(`tet ${ti} has out-of-range vertex ${idx}`);
      }
    }
    if (new Set(t).size !== 4) errors.push(`tet ${ti} repeats a vertex`);
    if (tetVolume6(positions, t) <= tol) degenerateTets++;
    for (const f of tetFaces(t)) {
      const cyc = canonicalCycle(f);
      const key = [...f].sort((x, y) => x - y).join(',');
      const entry = faceMap.get(key) ?? { cycles: [] };
      entry.cycles.push(cyc.join(','));
      faceMap.set(key, entry);
    }
  });

  let boundaryFaces = 0;
  let nonManifoldFaces = 0;
  let inconsistentFaces = 0;
  for (const [key, { cycles }] of faceMap) {
    if (cycles.length === 1) boundaryFaces++;
    else if (cycles.length > 2) nonManifoldFaces++;
    else if (cycles[0] === cycles[1]) {
      inconsistentFaces++;
      if (inconsistentFaces <= 5) errors.push(`face ${key} has the same orientation in both tets`);
    }
  }
  if (boundaryFaces) errors.push(`${boundaryFaces} faces belong to only one tet (boundary not closed)`);
  if (nonManifoldFaces) errors.push(`${nonManifoldFaces} faces belong to more than two tets`);
  if (inconsistentFaces) errors.push(`${inconsistentFaces} faces are inconsistently oriented`);
  if (degenerateTets && !opts.allowDegenerate) errors.push(`${degenerateTets} degenerate tets`);

  return {
    ok: errors.length === 0,
    errors,
    tetCount: tets.length,
    faceCount: faceMap.size,
    boundaryFaces,
    nonManifoldFaces,
    inconsistentFaces,
    degenerateTets,
  };
}

/**
 * Cone a convex cell from an apex: for each face polygon (vertex cycle) emit
 * fan tets (apex, f0, fk, fk+1). The apex is appended to `positions`; returns
 * its index and the new tets (not yet oriented; see orientTetsOutward).
 */
export function coneTetrahedralize(positions: Vec4[], facePolygons: readonly number[][], apex: Vec4): { apexIndex: number; tets: Tet[] } {
  const apexIndex = positions.length;
  positions.push(apex);
  const tets: Tet[] = [];
  for (const poly of facePolygons) {
    for (let k = 1; k + 1 < poly.length; k++) tets.push([apexIndex, poly[0], poly[k], poly[k + 1]]);
  }
  return { apexIndex, tets };
}
