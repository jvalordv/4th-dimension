import type { Hyperplane, Tet, TriMesh3, Vec3, Vec4 } from '../math/types';
import { chart, signedDistance } from '../math/hyperplane';
import { cross3, dot3, lerp4, sub3 } from '../math/vec';
import { tetNormal } from './tets';

/**
 * Marching tetrahedra: slice an outward-oriented tet complex by a hyperplane,
 * returning an outward-oriented triangle mesh in chart coordinates. Vertices
 * are not shared between triangles; use weldVertices if needed. MATH.md §6
 *
 * Vertices exactly on the hyperplane count as positive (s ≥ 0). This equals
 * slicing at offset − ε: the result is the limit from below. For the
 * tesseract [-1,1]^4 at w = +1 that is the cube; at w = −1 it is empty.
 */
export function sliceTets(positions: readonly Vec4[], tets: readonly Tet[], h: Hyperplane): TriMesh3 {
  const s = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i++) s[i] = signedDistance(h, positions[i]);

  const out: number[] = [];
  const outW: number[] = [];
  let triCount = 0;

  const crossing = (i: number, j: number): Vec4 => {
    const t = s[i] / (s[i] - s[j]);
    return lerp4(positions[i], positions[j], t);
  };

  const emit = (p0: Vec4, p1: Vec4, p2: Vec4, n3: Vec3): void => {
    const q0 = chart(h, p0);
    const q1 = chart(h, p1);
    const q2 = chart(h, p2);
    const flip = dot3(cross3(sub3(q1, q0), sub3(q2, q0)), n3) < 0;
    const a = q0;
    const b = flip ? q2 : q1;
    const c = flip ? q1 : q2;
    const wb = flip ? p2[3] : p1[3];
    const wc = flip ? p1[3] : p2[3];
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    outW.push(p0[3], wb, wc);
    triCount++;
  };

  for (const t of tets) {
    const pos: number[] = [];
    const neg: number[] = [];
    for (const idx of t) (s[idx] >= 0 ? pos : neg).push(idx);
    if (pos.length === 0 || pos.length === 4) continue;

    // Outward normal projected into h, in chart coordinates: u_k · N (u_k ⊥ n).
    const n4 = tetNormal(positions, t);
    const n3 = chart(h, n4);
    if (dot3(n3, n3) === 0) continue; // tet parallel to h: degenerate slice

    if (pos.length === 2) {
      const [a, b] = pos;
      const [c, d] = neg;
      const ac = crossing(a, c);
      const ad = crossing(a, d);
      const bd = crossing(b, d);
      const bc = crossing(b, c);
      emit(ac, ad, bd, n3);
      emit(ac, bd, bc, n3);
    } else {
      const single = pos.length === 1 ? pos[0] : neg[0];
      const others = pos.length === 1 ? neg : pos;
      emit(crossing(single, others[0]), crossing(single, others[1]), crossing(single, others[2]), n3);
    }
  }

  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions: Float32Array.from(out), indices, sourceW: Float32Array.from(outW) };
}
