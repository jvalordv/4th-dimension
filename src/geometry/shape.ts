import type { Hyperplane, Shape4, ShapeKind, TetComplex, TriMesh3, Vec4, WireMesh4 } from '../math/types';
import { hyperplane } from '../math/hyperplane';
import { length4, normalize4 } from '../math/vec';
import { sliceTets } from './slice';
import { signedVolume } from './trimesh';

/** A Shape4 backed by a tet complex, optionally with a wire structure. */
export class TetShape implements Shape4 {
  private readonly r: number;
  private readonly wr: [number, number];

  constructor(
    public readonly name: string,
    public readonly kind: ShapeKind,
    public readonly complex: TetComplex,
    private readonly wireMesh: WireMesh4 | null,
  ) {
    let r = 0;
    let wmin = Infinity;
    let wmax = -Infinity;
    for (const p of complex.positions) {
      r = Math.max(r, length4(p));
      wmin = Math.min(wmin, p[3]);
      wmax = Math.max(wmax, p[3]);
    }
    this.r = r;
    this.wr = [wmin, wmax];
  }

  wire(): WireMesh4 | null { return this.wireMesh; }
  slice(h: Hyperplane): TriMesh3 { return sliceTets(this.complex.positions, this.complex.tets, h); }
  radius(): number { return this.r; }
  wRange(): [number, number] { return this.wr; }
}

/**
 * ∫ A(c) dc over c ∈ [−R, R] by the midpoint rule, where A(c) is the signed
 * volume of the slice at offset c along unit direction n. Equals the 4-volume
 * for a correct shape and slicer. MATH.md §7
 */
export function sliceVolumeIntegral(shape: Shape4, direction: Vec4, steps = 200, radius = shape.radius()): number {
  const n = normalize4(direction);
  const dc = (2 * radius) / steps;
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const c = -radius + (i + 0.5) * dc;
    total += signedVolume(shape.slice(hyperplane(n, c)));
  }
  return total * dc;
}
