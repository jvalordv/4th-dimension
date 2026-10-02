import type { ExplainerPanel, Tier } from './index';
import { getExplainer } from './content';

// Placeholder until the panel module is written.
export function mountExplainer(container: HTMLElement): ExplainerPanel {
  let tier: Tier = 'eli5';
  let current: string | null = null;
  const render = (): void => {
    const e = current ? getExplainer(current) : undefined;
    container.innerHTML = e ? `<h2>${e.title}</h2>${e.tiers[tier]}` : '';
  };
  return {
    show(id) { current = id; render(); },
    setTier(t) { tier = t; render(); },
    getTier: () => tier,
  };
}
