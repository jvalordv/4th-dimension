import type { Explainer } from './index';

// Placeholder until the content module is written.
const EXPLAINERS: Explainer[] = [];

export const getExplainer = (id: string): Explainer | undefined => EXPLAINERS.find((e) => e.id === id);
export const listExplainers = (): Explainer[] => EXPLAINERS.slice();
