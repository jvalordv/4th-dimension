/**
 * Explainer API. Content lives in ./content, the panel in ./panel. Topic ids:
 * shape ids from src/app/registry (SHAPE_IDS), plus
 *   'view:projection' | 'view:slice' | 'view:overlay'
 *   'rotation:XY' | 'rotation:XZ' | 'rotation:XW' | 'rotation:YZ' | 'rotation:YW' | 'rotation:ZW'
 *   'lift:extrude' | 'color' | 'intro'
 */
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
