import type { Mat4, Vec4 } from './types';
import { det4 } from './vec';

export function identity4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Matrix product A·B. */
export function mul4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

export function transpose4(m: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}

/** Apply M to a column vector: (M v)_r = Σ_c m[r*4+c] v_c. */
export function apply4(m: Mat4, v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

export const row4 = (m: Mat4, r: number): Vec4 => [m[r * 4], m[r * 4 + 1], m[r * 4 + 2], m[r * 4 + 3]];
export const column4 = (m: Mat4, c: number): Vec4 => [m[c], m[4 + c], m[8 + c], m[12 + c]];

export function determinant4(m: Mat4): number {
  return det4(row4(m, 0), row4(m, 1), row4(m, 2), row4(m, 3));
}

/** Max-abs deviation of MᵀM from the identity. */
export function orthogonalityError(m: Mat4): number {
  const p = mul4(transpose4(m), m);
  let err = 0;
  for (let i = 0; i < 16; i++) {
    const target = i % 5 === 0 ? 1 : 0;
    err = Math.max(err, Math.abs(p[i] - target));
  }
  return err;
}

export function approxEqualMat4(a: Mat4, b: Mat4, tol = 1e-9): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return true;
}
