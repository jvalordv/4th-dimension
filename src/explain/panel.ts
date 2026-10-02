/**
 * Explainer panel: renders one topic's title and the HTML of the current tier
 * into a container. `show(null)` shows the 'intro' topic. The UI calls `show`
 * on every slider tick, so rendering is skipped when neither the topic nor
 * the tier changed (this also keeps the reader's scroll position).
 */
import './explain.css';
import type { ExplainerPanel, Tier } from './index';
import { getExplainer } from './content';

const DEFAULT_TOPIC = 'intro';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mountExplainer(container: HTMLElement): ExplainerPanel {
  let tier: Tier = 'eli5';
  let current: string = DEFAULT_TOPIC;
  let rendered: string | null = null;
  container.classList.add('explainer-content');

  const render = (): void => {
    const key = `${tier}\u0000${current}`;
    if (key === rendered) return;
    rendered = key;
    const e = getExplainer(current);
    container.innerHTML = e
      ? `<h2 class="explainer-title">${escapeHtml(e.title)}</h2>` +
        `<div class="explainer-tier explainer-tier-${tier}">${e.tiers[tier]}</div>`
      : `<h2 class="explainer-title">${escapeHtml(current)}</h2>` +
        `<p class="explainer-missing">No explainer has been written for this topic yet.</p>`;
    container.scrollTop = 0;
  };

  render();
  return {
    show(id: string | null): void {
      current = id ?? DEFAULT_TOPIC;
      render();
    },
    setTier(t: Tier): void {
      tier = t;
      render();
    },
    getTier: (): Tier => tier,
  };
}
