/**
 * Colour encoding of the fourth coordinate. MATH.md §10: colour is data, not
 * decoration. In the projection view a vertex is coloured by its w after
 * rotation and before projection; in the slice view by the w of the source
 * 4D point before rotation. Both go through one fixed two-ended gradient with
 * w = 0 at the midpoint and the object's w extent at the ends.
 */

/** sRGB colour with channels in [0, 1]. */
export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const rgb8 = (r: number, g: number, b: number): RGB => ({ r: r / 255, g: g / 255, b: b / 255 });

/**
 * Cool-to-warm diverging stops, uniformly spaced over t ∈ [0, 1]: cool blue
 * for negative w, near-white at w = 0, warm orange-red for positive w. The
 * stops are chosen for legibility on a dark background with additive
 * blending (both ends are luminous); the midpoint is near-white so a slice
 * drawn from the object's w = 0 material reads as neutral.
 */
export const GRADIENT_STOPS: readonly RGB[] = [
  rgb8(56, 132, 255),
  rgb8(120, 200, 255),
  rgb8(240, 240, 248),
  rgb8(255, 190, 110),
  rgb8(255, 88, 48),
];

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Piecewise-linear interpolation of GRADIENT_STOPS at t ∈ [0, 1] (clamped).
 * t = 0 is the cool end, t = 1/2 the midpoint stop, t = 1 the warm end.
 */
export function gradient(t: number): RGB {
  const segments = GRADIENT_STOPS.length - 1;
  const x = clamp01(t) * segments;
  const i = Math.min(Math.floor(x), segments - 1);
  const f = x - i;
  const a = GRADIENT_STOPS[i];
  const b = GRADIENT_STOPS[i + 1];
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
}

/** Maps w to a gradient parameter t and to a colour. */
export interface WColorScale {
  /** w drawn at the cool end (t = 0). */
  readonly min: number;
  /** w drawn at the warm end (t = 1). */
  readonly max: number;
  /** Gradient parameter: 0.5 at w = 0, 0 at `min`, 1 at `max`, clamped outside. */
  t(w: number): number;
  color(w: number): RGB;
}

/**
 * Scale over a w range [min, max] with w = 0 fixed at the midpoint and the
 * range ends at the gradient ends (§10). For a symmetric range this is the
 * linear map t = 1/2 + w / (2 wMax). For an asymmetric range (e.g. the 5-cell,
 * w ∈ [−1/√5, 4/√5]) each side is scaled by its own extent so that both ends
 * of the object still reach the ends of the gradient. A side with no extent
 * (min ≥ 0 or max ≤ 0) borrows the other side's, so t stays monotone.
 */
export function wColorScale(range: readonly [number, number]): WColorScale {
  const [min, max] = range;
  const negExtent = min < 0 ? -min : max > 0 ? max : 1;
  const posExtent = max > 0 ? max : min < 0 ? -min : 1;
  const t = (w: number): number =>
    w < 0 ? 0.5 - 0.5 * clamp01(-w / negExtent) : 0.5 + 0.5 * clamp01(w / posExtent);
  return { min, max, t, color: (w) => gradient(t(w)) };
}

/**
 * Symmetric scale over [−wMax, wMax]. In the projection view wMax is the
 * shape's radius: after any rotation |w| ≤ |p| ≤ radius, so the gradient
 * covers every w a vertex can take (§10, §2.1 rotations preserve length).
 */
export const symmetricWScale = (wMax: number): WColorScale => wColorScale([-Math.abs(wMax), Math.abs(wMax)]);

/**
 * Write rgb triplets for each w in `ws` into `out` starting at `outOffset`
 * (floats, 3 per entry). Returns `out`.
 */
export function writeWColors(ws: ArrayLike<number>, scale: WColorScale, out: Float32Array, outOffset = 0): Float32Array {
  let o = outOffset;
  for (let i = 0; i < ws.length; i++) {
    const c = scale.color(ws[i]);
    out[o++] = c.r;
    out[o++] = c.g;
    out[o++] = c.b;
  }
  return out;
}

const toHex = (c: RGB): string =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

/** CSS `linear-gradient` of the stops, cool on the left, for the legend. */
export function gradientCSS(): string {
  const n = GRADIENT_STOPS.length - 1;
  const parts = GRADIENT_STOPS.map((c, i) => `${toHex(c)} ${((100 * i) / n).toFixed(1)}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
