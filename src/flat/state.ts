/**
 * Flatland viewer state and animation (MATH.md §11), the counterpart of
 * src/app/state and src/app/animation one dimension down. Plain data with no
 * DOM, so it can be tested.
 */
import type { FlatShapeId } from '../explain';
import { defaultProjectionDistance } from '../app/state';
import { triangleWave, wrapAngle } from '../app/animation';
import { FLAT_PLANES, zeroFlatAngles, type FlatAngles, type Projection2 } from './math';

export type FlatViewMode = 'projection' | 'slice' | 'overlay';
export const FLAT_VIEW_MODES: readonly FlatViewMode[] = ['projection', 'slice', 'overlay'];

export type FlatProjectionKind = Projection2['kind'];
export const FLAT_PROJECTION_KINDS: readonly FlatProjectionKind[] = ['perspective', 'orthographic'];

/**
 * 'spin' turns the object in XY, the one rotation Flatlanders have;
 * 'tumble' turns it in XZ, out of their world, while the slice offset
 * oscillates; 'pass-through' sweeps the slice offset across the object.
 * There is no double-rotation analogue: R^3 has no pair of complementary
 * planes.
 */
export type FlatPreset = 'none' | 'spin' | 'tumble' | 'pass-through';
export const FLAT_PRESETS: readonly FlatPreset[] = ['none', 'spin', 'tumble', 'pass-through'];

export interface FlatAnimation {
  preset: FlatPreset;
  /** ω in radians per second, also the rate of the phase t that drives the offset presets. */
  speed: number;
  playing: boolean;
  /** Accumulated phase t = ∫ speed dt while playing; reset puts it back to 0. */
  phase: number;
}

export interface FlatState {
  shapeId: FlatShapeId;
  /** Plane angles composed as R_YZ R_XZ R_XY (§2.2 restricted, §11). */
  angles: FlatAngles;
  projection: Projection2;
  viewMode: FlatViewMode;
  /** Offset c of the slicing plane z = c, kept in [−radius, radius]. §11 */
  sliceOffset: number;
  animation: FlatAnimation;
}

/** Default eye distance for a shape of radius R: max(3, 2.5 R), as in src/app/state (§3.2, §11). */
export const defaultEyeDistance = (radius: number): number => defaultProjectionDistance(radius);

export function createFlatState(shapeId: FlatShapeId, radius: number): FlatState {
  return {
    shapeId,
    angles: zeroFlatAngles(),
    projection: { kind: 'perspective', distance: defaultEyeDistance(radius) },
    viewMode: 'projection',
    sliceOffset: 0,
    animation: { preset: 'tumble', speed: 0.6, playing: true, phase: 0 },
  };
}

/** Clamp c into [−radius, radius]. */
export const clampOffset = (c: number, radius: number): number => Math.min(radius, Math.max(-radius, c));

/**
 * Advance `state` by dt seconds for its animation preset, with R the shape
 * radius (the extent of the slice offset) and ω = state.animation.speed:
 *
 * - spin: θ_XY += ω dt;
 * - tumble: θ_XZ += ω dt and sliceOffset = 0.3 R sin(t);
 * - pass-through: sliceOffset = R · triangleWave(t);
 *
 * where t is the accumulated phase, t += ω dt. Angles are kept wrapped in
 * (−π, π] (R_ij(θ + 2π) = R_ij(θ), §2.1).
 */
export function advanceFlat(state: FlatState, dt: number, radius: number): void {
  const anim = state.animation;
  if (anim.preset === 'none' || dt === 0) return;
  const step = anim.speed * dt;
  anim.phase += step;
  switch (anim.preset) {
    case 'spin':
      state.angles.XY += step;
      break;
    case 'tumble':
      state.angles.XZ += step;
      state.sliceOffset = 0.3 * radius * Math.sin(anim.phase);
      break;
    case 'pass-through':
      state.sliceOffset = radius * triangleWave(anim.phase);
      break;
  }
  for (const plane of FLAT_PLANES) state.angles[plane] = wrapAngle(state.angles[plane]);
}

/** Angles to zero, slice offset to 0, animation phase to 0. */
export function resetFlat(state: FlatState): void {
  for (const plane of FLAT_PLANES) state.angles[plane] = 0;
  state.sliceOffset = 0;
  state.animation.phase = 0;
}

/** Explainer topic for a view mode: 'overlay' shows the slice explainer (the one with more to say). §11 */
export const flatModeTopic = (mode: FlatViewMode): 'flat:projection' | 'flat:slice' =>
  mode === 'projection' ? 'flat:projection' : 'flat:slice';
