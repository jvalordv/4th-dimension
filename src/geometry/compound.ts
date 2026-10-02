/**
 * Compound shapes: a named list of Shape4 parts shown together. The parts
 * are drawn and sliced independently and simply superimposed, so where two
 * parts overlap both surfaces are present (no boolean union is computed).
 * Used for the figures of src/geometry/figures.ts, whose parts are
 * extrusions (MATH.md §9.1) of 3D primitives.
 */
import type { Edge, Hyperplane, Shape4, TriMesh3, Vec4, WireMesh4 } from '../math/types';
import { mergeMeshes } from './trimesh';

export class CompoundShape implements Shape4 {
  readonly kind = 'compound' as const;
  private wireCache: WireMesh4 | null | undefined;

  constructor(
    public readonly name: string,
    /** The parts, exposed so each can be tested and inspected on its own. */
    public readonly parts: readonly Shape4[],
  ) {}

  /**
   * Concatenation of the parts' wires with vertex indices offset by the
   * number of vertices that precede each part. Parts without a wire are
   * skipped; the result is null when no part has one.
   */
  wire(): WireMesh4 | null {
    if (this.wireCache !== undefined) return this.wireCache;
    const positions: Vec4[] = [];
    const edges: Edge[] = [];
    const faces: number[][] = [];
    let hasWire = false;
    for (const part of this.parts) {
      const w = part.wire();
      if (!w) continue;
      hasWire = true;
      const offset = positions.length;
      for (const p of w.positions) positions.push([p[0], p[1], p[2], p[3]]);
      for (const [a, b] of w.edges) edges.push([a + offset, b + offset]);
      for (const f of w.faces) faces.push(f.map((i) => i + offset));
    }
    this.wireCache = hasWire ? { positions, edges, faces } : null;
    return this.wireCache;
  }

  /** The parts' slices merged into one mesh (each part's slice is closed on its own). */
  slice(h: Hyperplane): TriMesh3 {
    return mergeMeshes(this.parts.map((p) => p.slice(h)));
  }

  /** Largest part radius: an origin-centred ball containing every part contains the compound. */
  radius(): number {
    let r = 0;
    for (const p of this.parts) r = Math.max(r, p.radius());
    return r;
  }

  /** Union of the parts' w ranges ([0, 0] for an empty compound). */
  wRange(): [number, number] {
    if (this.parts.length === 0) return [0, 0];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of this.parts) {
      const [a, b] = p.wRange();
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    return [lo, hi];
  }
}

export function compound(name: string, parts: readonly Shape4[]): CompoundShape {
  return new CompoundShape(name, parts);
}
