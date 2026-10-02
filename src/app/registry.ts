import type { Shape4 } from '../math/types';

export type ShapeGroup =
  | 'Regular polytopes'
  | 'Curved solids'
  | 'Lifted 3D objects'
  | 'Spun 3D objects'
  | 'Smooth forms (SDF)'
  | 'Figures'
  | 'Imported';

export interface ShapeEntry {
  /** Stable id, also the explainer topic id. */
  id: string;
  label: string;
  group: ShapeGroup;
  /** One sentence shown under the picker. */
  description: string;
  /** Build the shape (may be expensive; the viewer caches instances). */
  create: () => Shape4;
  /** Suggested perspective eye distance; default derives from radius. */
  projectionDistance?: number;
  /**
   * Projection to switch to when this shape is selected (figures on the unit
   * 3-sphere want stereographic). Shapes without one revert a stereographic
   * view to perspective, since stereographic normalises every point to S³.
   */
  defaultProjection?: 'perspective' | 'orthographic' | 'stereographic';
}

const entries = new Map<string, ShapeEntry>();

export function registerShape(entry: ShapeEntry): void {
  if (entries.has(entry.id)) throw new Error(`registerShape: duplicate id ${entry.id}`);
  entries.set(entry.id, entry);
}

export const listShapes = (): ShapeEntry[] => Array.from(entries.values());
export const getShape = (id: string): ShapeEntry | undefined => entries.get(id);

/** Canonical ids, fixed so explainer content and the registry agree. */
export const SHAPE_IDS = {
  tesseract: 'tesseract',
  cell5: 'cell5',
  cell16: 'cell16',
  cell24: 'cell24',
  cell120: 'cell120',
  cell600: 'cell600',
  hypersphere: 'hypersphere',
  duocylinder: 'duocylinder',
  hopf: 'hopf',
  spherinder: 'spherinder',
  cubinder: 'cubinder',
  torusPrism: 'torus-prism',
  knotPrism: 'knot-prism',
  human: 'human',
  mug: 'mug',
  spunBall: 'spun-ball',
  spunHalfBall: 'spun-half-ball',
  spunCube: 'spun-cube',
  spunHuman: 'spun-human',
  sdfSpheritorus: 'sdf-spheritorus',
  sdfTorisphere: 'sdf-torisphere',
  sdfTiger: 'sdf-tiger',
  sdfDitorus: 'sdf-ditorus',
  sdfCreature: 'sdf-creature',
} as const;

/** Prefix of ids given to models the user imports (MATH.md §12). */
export const IMPORT_ID_PREFIX = 'import:';

/** Remove a shape (used when an imported model is replaced). */
export function unregisterShape(id: string): boolean {
  return entries.delete(id);
}
