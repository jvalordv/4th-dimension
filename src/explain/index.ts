/**
 * Explainer API. Content lives in ./content, the panel in ./panel. Topic ids:
 * shape ids from src/app/registry (SHAPE_IDS), plus
 *   'view:projection' | 'view:slice' | 'view:overlay'
 *   'rotation:XY' | 'rotation:XZ' | 'rotation:XW' | 'rotation:YZ' | 'rotation:YW' | 'rotation:ZW'
 *   'lift:extrude' | 'lift:spin' | 'sdf' | 'import' | 'xr' | 'color' | 'intro'
 * Flatland mode (MATH.md §11):
 *   'flat:intro' | 'flat:projection' | 'flat:slice' | 'flat:rotation'
 *   'flat:cube' | 'flat:tetrahedron' | 'flat:octahedron' | 'flat:ball' | 'flat:torus' | 'flat:cylinder' | 'flat:human'
 */

/** Flatland shape ids, fixed so the Flatland module and the explainers agree. */
export const FLAT_SHAPE_IDS = ['cube', 'tetrahedron', 'octahedron', 'ball', 'torus', 'cylinder', 'human'] as const;
export type FlatShapeId = (typeof FLAT_SHAPE_IDS)[number];
export const FLAT_TOPICS = ['intro', 'projection', 'slice', 'rotation', ...FLAT_SHAPE_IDS] as const;
export type Tier = 'eli5' | 'intermediate' | 'math';

export const TIERS: readonly Tier[] = ['eli5', 'intermediate', 'math'];

export const TIER_LABELS: Record<Tier, string> = {
  eli5: 'Plain words',
  intermediate: 'Some background',
  math: 'The math',
};

export interface Explainer {
  id: string;
  title: string;
  /** HTML fragments (trusted, authored in this repo). */
  tiers: Record<Tier, string>;
}

export interface ExplainerPanel {
  show(id: string | null): void;
  setTier(tier: Tier): void;
  getTier(): Tier;
}

export { getExplainer, listExplainers } from './content';
export { mountExplainer } from './panel';
