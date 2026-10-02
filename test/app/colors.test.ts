import { describe, expect, it } from 'vitest';
import {
  GRADIENT_STOPS,
  gradient,
  gradientCSS,
  symmetricWScale,
  wColorScale,
  writeWColors,
  type RGB,
} from '../../src/app/colors';

const expectRGB = (got: RGB, want: RGB, digits = 12): void => {
  expect(got.r).toBeCloseTo(want.r, digits);
  expect(got.g).toBeCloseTo(want.g, digits);
  expect(got.b).toBeCloseTo(want.b, digits);
};

describe('gradient (MATH.md §10: fixed two-ended gradient)', () => {
  it('hits the stops exactly at t = 0, 1/2, 1 and clamps outside [0, 1]', () => {
    const last = GRADIENT_STOPS.length - 1;
    expectRGB(gradient(0), GRADIENT_STOPS[0]);
    expectRGB(gradient(1), GRADIENT_STOPS[last]);
    // Five stops are uniformly spaced, so t = 1/2 lands on the middle stop (index 2).
    expect(GRADIENT_STOPS.length).toBe(5);
    expectRGB(gradient(0.5), GRADIENT_STOPS[2]);
    expectRGB(gradient(-3), GRADIENT_STOPS[0]);
    expectRGB(gradient(7), GRADIENT_STOPS[last]);
  });
  it('interpolates linearly between consecutive stops', () => {
    // t = 1/8 is halfway between stop 0 (t = 0) and stop 1 (t = 1/4).
    const a = GRADIENT_STOPS[0];
    const b = GRADIENT_STOPS[1];
    expectRGB(gradient(1 / 8), { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2 });
  });
  it('is cool at the negative end and warm at the positive end', () => {
    const cool = GRADIENT_STOPS[0];
    const warm = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
    expect(cool.b).toBeGreaterThan(cool.r);
    expect(warm.r).toBeGreaterThan(warm.b);
  });
});

describe('w colour scale (MATH.md §10: w = 0 at the midpoint, w extent at the ends)', () => {
  it('symmetric range: t = 1/2 + w / (2 wMax), clamped', () => {
    const s = symmetricWScale(2);
    expect(s.min).toBe(-2);
    expect(s.max).toBe(2);
    expect(s.t(0)).toBe(0.5);
    expect(s.t(2)).toBe(1);
    expect(s.t(-2)).toBe(0);
    expect(s.t(1)).toBeCloseTo(0.75, 12);
    expect(s.t(-1)).toBeCloseTo(0.25, 12);
    expect(s.t(5)).toBe(1);
    expect(s.t(-5)).toBe(0);
    expectRGB(s.color(1), gradient(0.75));
    // wColorScale on the same range is the same map.
    const s2 = wColorScale([-2, 2]);
    for (const w of [-2, -0.7, 0, 0.3, 2]) expect(s2.t(w)).toBeCloseTo(s.t(w), 12);
  });
  it('asymmetric range (5-cell, w ∈ [−1/√5, 4/√5], §8.1): both ends reach the gradient ends', () => {
    const s = wColorScale([-1 / Math.sqrt(5), 4 / Math.sqrt(5)]);
    expect(s.t(-1 / Math.sqrt(5))).toBeCloseTo(0, 12);
    expect(s.t(0)).toBe(0.5);
    expect(s.t(4 / Math.sqrt(5))).toBeCloseTo(1, 12);
    // Halfway up the positive side.
    expect(s.t(2 / Math.sqrt(5))).toBeCloseTo(0.75, 12);
    // Halfway down the negative side.
    expect(s.t(-0.5 / Math.sqrt(5))).toBeCloseTo(0.25, 12);
  });
  it('one-sided range borrows the other side\'s extent and stays monotone', () => {
    const s = wColorScale([0, 1]);
    expect(s.t(1)).toBe(1);
    expect(s.t(0)).toBe(0.5);
    expect(s.t(-0.5)).toBeCloseTo(0.25, 12);
    let prev = -Infinity;
    for (let w = -1.5; w <= 1.5; w += 0.1) {
      const t = s.t(w);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it('writeWColors writes rgb triplets at the offset', () => {
    const s = symmetricWScale(1);
    const out = new Float32Array(9).fill(-1);
    writeWColors([1, -1], s, out, 3);
    expect(out[0]).toBe(-1);
    const warm = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
    const cool = GRADIENT_STOPS[0];
    expect(out[3]).toBeCloseTo(warm.r, 6);
    expect(out[4]).toBeCloseTo(warm.g, 6);
    expect(out[5]).toBeCloseTo(warm.b, 6);
    expect(out[6]).toBeCloseTo(cool.r, 6);
    expect(out[8]).toBeCloseTo(cool.b, 6);
  });
  it('gradientCSS lists every stop, cool on the left', () => {
    const css = gradientCSS();
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    // (56, 132, 255) = #3884ff is the cool end; (255, 88, 48) = #ff5830 the warm end.
    expect(css).toContain('#3884ff 0.0%');
    expect(css).toContain('#ff5830 100.0%');
    expect(css.match(/#[0-9a-f]{6}/g)?.length).toBe(GRADIENT_STOPS.length);
  });
});
