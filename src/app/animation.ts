/**
 * Animation presets. Each advances the viewer state by dt seconds. Angles are
 * kept wrapped in (−π, π]: R_ij(θ + 2π) = R_ij(θ) R_ij(2π) = R_ij(θ) by the
 * addition law of MATH.md §2.1, so wrapping never changes the rotation.
 */
import type { ViewerState } from './state';
import { ROTATION_PLANES } from '../math/rotation';

const TWO_PI = 2 * Math.PI;

/** Wrap θ into (−π, π]. */
export function wrapAngle(theta: number): number {
  let t = theta - TWO_PI * Math.floor((theta + Math.PI) / TWO_PI);
  // Floor rounding can leave t at −π exactly; the interval is half-open at π.
  if (t <= -Math.PI) t += TWO_PI;
  return t;
}

/**
 * Triangle wave of unit amplitude and period 2π in the phase φ:
 * 0 at φ = 0, 1 at π/2, 0 at π, −1 at 3π/2, linear in between. Same period
 * and sign as sin φ, so a pass-through at speed ω sweeps the full extent
 * once every 2π / ω seconds, like one turn of a rotation preset.
 */
export function triangleWave(phi: number): number {
  const u = phi / TWO_PI + 0.25;
  const frac = u - Math.floor(u);
  return 1 - 4 * Math.abs(frac - 0.5);
}

/**
 * Advance `state` by dt seconds for its animation preset, with R the shape
 * radius (the extent of the slice offset) and ω = state.animation.speed.
 *
 * - double-rotation: θ_XY += ω dt, θ_ZW += 0.7 ω dt (two complementary planes
 *   at different rates, MATH.md §2.3);
 * - isoclinic: θ_XY += ω dt and θ_ZW += ω dt equally, so the composite stays
 *   an isoclinic rotation D(α, α) (§2.3; XY and ZW commute, §2.1);
 * - pass-through: sliceOffset = R · triangleWave(t);
 * - tumble: θ_XW += ω dt and sliceOffset = 0.3 R sin(t);
 *
 * where t is the accumulated phase, t += ω dt while playing, so the speed
 * control governs every preset uniformly (at ω = 1, t is wall-clock time).
 */
export function advanceAnimation(state: ViewerState, dt: number, radius: number): void {
  const anim = state.animation;
  if (anim.preset === 'none' || dt === 0) return;
  const w = anim.speed;
  const step = w * dt;
  anim.phase += step;
  const a = state.angles;
  switch (anim.preset) {
    case 'double-rotation':
      a.XY += step;
      a.ZW += 0.7 * step;
      break;
    case 'isoclinic':
      a.XY += step;
      a.ZW += step;
      break;
    case 'pass-through':
      state.sliceOffset = radius * triangleWave(anim.phase);
      break;
    case 'tumble':
      a.XW += step;
      state.sliceOffset = 0.3 * radius * Math.sin(anim.phase);
      break;
  }
  for (const plane of ROTATION_PLANES) a[plane] = wrapAngle(a[plane]);
}
