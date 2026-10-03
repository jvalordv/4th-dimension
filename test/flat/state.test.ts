import { describe, expect, it } from 'vitest';
import { triangleWave, wrapAngle } from '../../src/app/animation';
import { defaultProjectionDistance } from '../../src/app/state';
import {
  advanceFlat, clampOffset, createFlatState, defaultEyeDistance, FLAT_PRESETS, FLAT_PROJECTION_KINDS,
  FLAT_VIEW_MODES, flatModeTopic, resetFlat, type FlatPreset, type FlatState,
} from '../../src/flat/state';

/*
 * advanceFlat does a handful of float64 additions and one sin/triangle-wave evaluation, so results match the
 * closed forms below to a few ulps; 1e-12 is far above that and far below any logic error.
 */
const TOL = 1e-12;

const make = (preset: FlatPreset, speed = 0.6): FlatState => {
  const s = createFlatState('cube', 2);
  s.animation.preset = preset;
  s.animation.speed = speed;
  return s;
};

describe('createFlatState', () => {
  it('starts at zero angles, perspective at the default eye distance, projection view, tumbling', () => {
    const s = createFlatState('ball', 1);
    expect(s.shapeId).toBe('ball');
    expect(s.angles).toEqual({ XY: 0, XZ: 0, YZ: 0 });
    expect(s.sliceOffset).toBe(0);
    expect(s.viewMode).toBe('projection');
    expect(s.projection).toEqual({ kind: 'perspective', distance: defaultEyeDistance(1) });
    expect(s.animation).toEqual({ preset: 'tumble', speed: 0.6, playing: true, phase: 0 });
  });

  it('uses the 4D default eye distance max(3, 2.5 R)', () => {
    expect(defaultEyeDistance(1)).toBe(3);
    expect(defaultEyeDistance(2)).toBe(5);
    expect(defaultEyeDistance(Math.sqrt(3))).toBe(defaultProjectionDistance(Math.sqrt(3)));
  });

  it('offers exactly the presets, modes and projections of the spec', () => {
    expect([...FLAT_PRESETS]).toEqual(['none', 'spin', 'tumble', 'pass-through']);
    expect([...FLAT_VIEW_MODES]).toEqual(['projection', 'slice', 'overlay']);
    expect([...FLAT_PROJECTION_KINDS]).toEqual(['perspective', 'orthographic']);
  });
});

describe('advanceFlat', () => {
  it('none leaves everything alone, as does dt = 0', () => {
    const s = make('none');
    advanceFlat(s, 1, 2);
    expect(s.angles).toEqual({ XY: 0, XZ: 0, YZ: 0 });
    expect(s.sliceOffset).toBe(0);
    expect(s.animation.phase).toBe(0);
    const t = make('spin');
    advanceFlat(t, 0, 2);
    expect(t.angles.XY).toBe(0);
  });

  it('spin turns XY by ω dt and nothing else', () => {
    const s = make('spin', 0.6);
    advanceFlat(s, 0.5, 2);
    expect(Math.abs(s.angles.XY - 0.3)).toBeLessThanOrEqual(TOL);
    expect(s.angles.XZ).toBe(0);
    expect(s.angles.YZ).toBe(0);
    expect(s.sliceOffset).toBe(0);
    expect(Math.abs(s.animation.phase - 0.3)).toBeLessThanOrEqual(TOL);
  });

  it('tumble turns XZ by ω dt and sets the offset to 0.3 R sin(t)', () => {
    const s = make('tumble', 0.6);
    advanceFlat(s, 0.5, 2);
    expect(Math.abs(s.angles.XZ - 0.3)).toBeLessThanOrEqual(TOL);
    expect(s.angles.XY).toBe(0);
    // t = 0.3, R = 2: 0.3 · 2 · sin 0.3.
    expect(Math.abs(s.sliceOffset - 0.6 * Math.sin(0.3))).toBeLessThanOrEqual(TOL);
    advanceFlat(s, 0.5, 2);
    expect(Math.abs(s.sliceOffset - 0.6 * Math.sin(0.6))).toBeLessThanOrEqual(TOL);
  });

  it('pass-through sweeps the offset as R times the triangle wave of the phase', () => {
    const s = make('pass-through', 1);
    // phase π/2: the triangle wave is 1 → offset R; phase 3π/2: −1 → −R; phase π: 0.
    advanceFlat(s, Math.PI / 2, 2);
    expect(Math.abs(s.sliceOffset - 2)).toBeLessThanOrEqual(TOL);
    advanceFlat(s, Math.PI / 2, 2);
    expect(Math.abs(s.sliceOffset)).toBeLessThanOrEqual(TOL);
    advanceFlat(s, Math.PI / 2, 2);
    expect(Math.abs(s.sliceOffset + 2)).toBeLessThanOrEqual(TOL);
    expect(s.sliceOffset).toBe(2 * triangleWave(s.animation.phase));
    // Angles untouched.
    expect(s.angles).toEqual({ XY: 0, XZ: 0, YZ: 0 });
  });

  it('keeps angles wrapped in (−π, π]', () => {
    const s = make('spin', 1);
    s.angles.XY = 3.0;
    advanceFlat(s, 0.5, 2);
    expect(Math.abs(s.angles.XY - wrapAngle(3.5))).toBeLessThanOrEqual(TOL);
    expect(s.angles.XY).toBeLessThanOrEqual(Math.PI);
    expect(s.angles.XY).toBeGreaterThan(-Math.PI);
  });

  it('the offset stays within [−R, R] for pass-through and [−0.3 R, 0.3 R] for tumble', () => {
    const a = make('pass-through', 2.7);
    const b = make('tumble', 2.7);
    for (let i = 0; i < 500; i++) {
      advanceFlat(a, 0.016, 2);
      advanceFlat(b, 0.016, 2);
      expect(Math.abs(a.sliceOffset)).toBeLessThanOrEqual(2 + TOL);
      expect(Math.abs(b.sliceOffset)).toBeLessThanOrEqual(0.6 + TOL);
    }
  });
});

describe('resetFlat, clampOffset, flatModeTopic', () => {
  it('reset zeroes the angles, the offset and the phase and keeps the rest', () => {
    const s = make('spin');
    s.angles.XY = 1;
    s.angles.XZ = -2;
    s.angles.YZ = 0.5;
    s.sliceOffset = 0.7;
    s.animation.phase = 4;
    s.viewMode = 'slice';
    resetFlat(s);
    expect(s.angles).toEqual({ XY: 0, XZ: 0, YZ: 0 });
    expect(s.sliceOffset).toBe(0);
    expect(s.animation.phase).toBe(0);
    expect(s.viewMode).toBe('slice');
    expect(s.animation.preset).toBe('spin');
  });

  it('clamps the offset into [−R, R]', () => {
    expect(clampOffset(3, 2)).toBe(2);
    expect(clampOffset(-3, 2)).toBe(-2);
    expect(clampOffset(0.5, 2)).toBe(0.5);
  });

  it('maps view modes to the explainer topics (overlay shows the slice topic)', () => {
    expect(flatModeTopic('projection')).toBe('flat:projection');
    expect(flatModeTopic('slice')).toBe('flat:slice');
    expect(flatModeTopic('overlay')).toBe('flat:slice');
  });
});
