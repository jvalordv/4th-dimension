import { describe, expect, it } from 'vitest';
import { advanceAnimation, triangleWave, wrapAngle } from '../../src/app/animation';
import { createState, type AnimationPreset } from '../../src/app/state';
import { approxEqualMat4, apply4 } from '../../src/math/mat4';
import { compositeRotation, rotation, zeroAngles } from '../../src/math/rotation';
import { dot4, normalize4 } from '../../src/math/vec';
import type { Vec4 } from '../../src/math/types';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const randUnit4 = (r: () => number): Vec4 => normalize4([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

const stateWith = (preset: AnimationPreset, speed: number) => {
  const s = createState('tesseract', 2);
  s.animation.preset = preset;
  s.animation.speed = speed;
  s.animation.playing = true;
  return s;
};

describe('wrapAngle', () => {
  it('maps into (−π, π] and is the identity there', () => {
    expect(wrapAngle(0.5)).toBe(0.5);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-7.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
  });
  it('never changes the rotation: R(θ) = R(wrap θ) by the addition law (MATH.md §2.1)', () => {
    for (const theta of [4, -4, 10.3, 2 * Math.PI, 100]) {
      expect(approxEqualMat4(rotation('XW', theta), rotation('XW', wrapAngle(theta)), 1e-9)).toBe(true);
    }
  });
});

describe('triangleWave', () => {
  it('has period 2π, amplitude 1 and the phase of sin', () => {
    expect(triangleWave(0)).toBeCloseTo(0, 12);
    expect(triangleWave(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(triangleWave(Math.PI)).toBeCloseTo(0, 12);
    expect(triangleWave(1.5 * Math.PI)).toBeCloseTo(-1, 12);
    expect(triangleWave(2 * Math.PI)).toBeCloseTo(0, 12);
    // Linear: a quarter of the way to the peak is half the amplitude.
    expect(triangleWave(Math.PI / 4)).toBeCloseTo(0.5, 12);
    expect(triangleWave(-Math.PI / 4)).toBeCloseTo(-0.5, 12);
    for (let phi = -20; phi <= 20; phi += 0.37) {
      expect(Math.abs(triangleWave(phi))).toBeLessThanOrEqual(1 + 1e-12);
      expect(triangleWave(phi + 2 * Math.PI)).toBeCloseTo(triangleWave(phi), 10);
    }
  });
});

describe('advanceAnimation presets', () => {
  it("'none' leaves the state untouched", () => {
    const s = stateWith('none', 1);
    s.angles.XY = 0.4;
    s.sliceOffset = 0.2;
    advanceAnimation(s, 0.5, 2);
    expect(s.angles.XY).toBe(0.4);
    expect(s.sliceOffset).toBe(0.2);
    expect(s.animation.phase).toBe(0);
  });
  it('double-rotation: XY += ω dt, ZW += 0.7 ω dt', () => {
    const s = stateWith('double-rotation', 1);
    advanceAnimation(s, 0.5, 2);
    expect(s.angles.XY).toBeCloseTo(0.5, 12);
    expect(s.angles.ZW).toBeCloseTo(0.35, 12);
    for (const p of ['XZ', 'XW', 'YZ', 'YW'] as const) expect(s.angles[p]).toBe(0);
    expect(s.sliceOffset).toBe(0);
    expect(s.animation.phase).toBeCloseTo(0.5, 12);
  });
  it('speed scales the step: ω = 2, dt = 1/4 equals ω = 1, dt = 1/2', () => {
    const a = stateWith('double-rotation', 2);
    const b = stateWith('double-rotation', 1);
    advanceAnimation(a, 0.25, 2);
    advanceAnimation(b, 0.5, 2);
    expect(a.angles.XY).toBeCloseTo(b.angles.XY, 12);
    expect(a.angles.ZW).toBeCloseTo(b.angles.ZW, 12);
  });
  it('isoclinic: XY and ZW advance equally and the composite turns every vector by α (MATH.md §2.3)', () => {
    const s = stateWith('isoclinic', 1.2);
    advanceAnimation(s, 0.5, 2);
    const alpha = 0.6; // 1.2 · 0.5
    expect(s.angles.XY).toBeCloseTo(alpha, 12);
    expect(s.angles.ZW).toBeCloseTo(alpha, 12);
    const m = compositeRotation(s.angles);
    const r = rng(11);
    for (let i = 0; i < 20; i++) {
      const v = randUnit4(r);
      expect(dot4(v, apply4(m, v))).toBeCloseTo(Math.cos(alpha), 12);
    }
  });
  it('pass-through: slice offset follows a triangle wave between −R and R', () => {
    const R = 2;
    const s = stateWith('pass-through', 1);
    advanceAnimation(s, Math.PI / 2, R); // phase π/2: peak
    expect(s.sliceOffset).toBeCloseTo(R, 12);
    advanceAnimation(s, Math.PI, R); // phase 3π/2: trough
    expect(s.sliceOffset).toBeCloseTo(-R, 12);
    advanceAnimation(s, Math.PI / 2, R); // phase 2π: back to 0
    expect(s.sliceOffset).toBeCloseTo(0, 12);
    expect(s.angles).toEqual(zeroAngles());
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      advanceAnimation(s, r() * 0.3, R);
      expect(Math.abs(s.sliceOffset)).toBeLessThanOrEqual(R + 1e-12);
    }
  });
  it('tumble: XW += ω dt and offset = 0.3 R sin(t)', () => {
    const R = 2;
    const s = stateWith('tumble', 1);
    advanceAnimation(s, Math.PI / 6, R);
    expect(s.angles.XW).toBeCloseTo(Math.PI / 6, 12);
    // 0.3 · 2 · sin(π/6) = 0.6 · 1/2 = 0.3
    expect(s.sliceOffset).toBeCloseTo(0.3, 12);
    expect(s.angles.XY).toBe(0);
  });
  it('keeps angles wrapped without changing the rotation', () => {
    const s = stateWith('double-rotation', 1);
    s.angles.XY = Math.PI - 0.1;
    advanceAnimation(s, 0.2, 2);
    expect(s.angles.XY).toBeCloseTo(-Math.PI + 0.1, 12);
    const unwrapped = compositeRotation({ ...zeroAngles(), XY: Math.PI + 0.1, ZW: 0.14 });
    expect(approxEqualMat4(compositeRotation(s.angles), unwrapped, 1e-9)).toBe(true);
  });
});
