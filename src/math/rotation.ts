import type { Axis, Mat4, RotationAngles, RotationPlane } from './types';
import { identity4, mul4 } from './mat4';

/** The six coordinate planes in canonical order. MATH.md §2.1 */
export const ROTATION_PLANES: readonly RotationPlane[] = ['XY', 'XZ', 'XW', 'YZ', 'YW', 'ZW'];

export const PLANE_AXES: Readonly<Record<RotationPlane, readonly [Axis, Axis]>> = {
  XY: [0, 1],
  XZ: [0, 2],
  XW: [0, 3],
  YZ: [1, 2],
  YW: [1, 3],
  ZW: [2, 3],
};

/** Planes whose rotations have no 3D counterpart. */
export const isHyperPlane = (p: RotationPlane): boolean => p.includes('W');

/**
 * Rotation by theta in the (i, j) coordinate plane, i < j. Positive theta
 * turns e_i toward e_j. MATH.md §2.1
 */
export function rotationInAxes(i: Axis, j: Axis, theta: number): Mat4 {
  if (i === j) throw new Error('rotationInAxes: axes must differ');
  if (i > j) return rotationInAxes(j, i, -theta);
  const m = identity4();
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  m[i * 4 + i] = c;
  m[i * 4 + j] = -s;
  m[j * 4 + i] = s;
  m[j * 4 + j] = c;
  return m;
}

export function rotation(plane: RotationPlane, theta: number): Mat4 {
  const [i, j] = PLANE_AXES[plane];
  return rotationInAxes(i, j, theta);
}

export const zeroAngles = (): RotationAngles => ({ XY: 0, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: 0 });

/**
 * M = R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY (XY applied first). MATH.md §2.2
 */
export function compositeRotation(angles: RotationAngles): Mat4 {
  let m = identity4();
  for (const plane of ROTATION_PLANES) {
    const theta = angles[plane];
    if (theta !== 0) m = mul4(rotation(plane, theta), m);
  }
  return m;
}

/** Double rotation R_XY(alpha) · R_ZW(beta). Isoclinic when |alpha| = |beta|. MATH.md §2.3 */
export function doubleRotation(alpha: number, beta: number): Mat4 {
  return mul4(rotation('XY', alpha), rotation('ZW', beta));
}
