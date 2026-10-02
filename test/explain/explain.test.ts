import { describe, expect, it } from 'vitest';
import { getExplainer, listExplainers, mountExplainer, TIERS } from '../../src/explain/index';
import { SHAPE_IDS } from '../../src/app/registry';
import { ROTATION_PLANES } from '../../src/math/rotation';

// Topic ids required by the comment at the top of src/explain/index.ts.
const EXPECTED_IDS = [
  ...Object.values(SHAPE_IDS),
  'view:projection', 'view:slice', 'view:overlay',
  ...ROTATION_PLANES.map((p) => `rotation:${p}`),
  'lift:extrude', 'color', 'intro',
].sort();

const ALLOWED_TAGS = new Set(['h3', 'p', 'ul', 'li', 'code', 'em', 'strong']);

describe('explainer content', () => {
  it('covers exactly the required topic ids', () => {
    expect(listExplainers().map((e) => e.id).sort()).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) expect(getExplainer(id)?.id).toBe(id);
    expect(getExplainer('nope')).toBeUndefined();
  });

  it('has a non-empty title and three non-empty tiers per topic, using only the allowed elements', () => {
    for (const e of listExplainers()) {
      expect(e.title.trim().length).toBeGreaterThan(0);
      for (const tier of TIERS) {
        const html = e.tiers[tier];
        expect(html.trim().length, `${e.id}/${tier}`).toBeGreaterThan(0);
        const tags = Array.from(html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[\s>]/g), (m) => m[1].toLowerCase());
        const bad = tags.filter((t) => !ALLOWED_TAGS.has(t));
        expect(bad, `${e.id}/${tier} uses ${bad.join(',')}`).toEqual([]);
        // Every tier cites MATH.md by section number in an HTML comment.
        expect(html, `${e.id}/${tier} cites MATH.md`).toMatch(/<!--[^>]*MATH\.md §\d/);
        // Fragment has no unbalanced <p>.
        expect((html.match(/<p[\s>]/g) ?? []).length).toBe((html.match(/<\/p>/g) ?? []).length);
      }
    }
  });

  it('plain-words tiers are 2 to 4 short paragraphs, plus the view note on shapes', () => {
    const shapeIds = new Set<string>(Object.values(SHAPE_IDS));
    for (const e of listExplainers()) {
      const paragraphs = (e.tiers.eli5.match(/<p[\s>]/g) ?? []).length - (shapeIds.has(e.id) ? 1 : 0);
      expect(paragraphs, `${e.id} eli5 paragraphs`).toBeGreaterThanOrEqual(2);
      expect(paragraphs, `${e.id} eli5 paragraphs`).toBeLessThanOrEqual(4);
      // No jargon: hyperplane / tetrahedral complex / matrix / orthonormal.
      expect(e.tiers.eli5, `${e.id} eli5 jargon`).not.toMatch(/hyperplane|orthonormal|matrix|isometry|affine/i);
    }
  });

  it('every shape topic ends each tier with a one-line note naming the best view', () => {
    for (const id of Object.values(SHAPE_IDS)) {
      const e = getExplainer(id);
      expect(e).toBeDefined();
      for (const tier of TIERS) {
        const html = e!.tiers[tier];
        expect(html.trimEnd().endsWith('</p>')).toBe(true);
        const note = html.slice(html.lastIndexOf('<p class="explainer-view-note">'));
        expect(note).toMatch(/Best seen in the <strong>(projection|slice|overlay)<\/strong> view:/);
        expect(note.split('\n').length).toBe(1);
      }
    }
    // Non-shape topics carry no view note.
    expect(getExplainer('intro')!.tiers.eli5).not.toContain('explainer-view-note');
    expect(getExplainer('rotation:XW')!.tiers.math).not.toContain('explainer-view-note');
  });

  it('states the catalogue numbers of MATH.md §8 and the required facts', () => {
    const t = getExplainer(SHAPE_IDS.tesseract)!;
    // §8 table row for the tesseract: V 16, E 32, F 24, C 8, hypervolume 16.
    expect(t.tiers.intermediate).toMatch(/16 vertices, 32 edges, 24 square faces, 8 cubic cells/);
    // §8.4 diagonal sequence and volumes.
    expect(t.tiers.intermediate).toMatch(/point, tetrahedron, truncated tetrahedron, regular octahedron/);
    expect(t.tiers.intermediate).toContain('32/3');
    expect(t.tiers.intermediate).toContain('8√2');
    // §3.2 scales for d = 3.
    expect(t.tiers.intermediate).toContain('3/2');
    expect(t.tiers.intermediate).toContain('3/4');
    // §8.5 ball slice radius.
    expect(getExplainer(SHAPE_IDS.hypersphere)!.tiers.intermediate).toContain('√(R² − c²)');
    expect(getExplainer(SHAPE_IDS.hypersphere)!.tiers.intermediate).toContain('π² R^4 / 2');
    // Overlay scale d/(d − c) (§3.2) in the intermediate and math tiers.
    expect(getExplainer('view:overlay')!.tiers.intermediate).toContain('d/(d − c)');
    expect(getExplainer('view:overlay')!.tiers.math).toContain('d/(d − c)');
    // §2.1 commuting pairs appear in every rotation topic.
    for (const p of ROTATION_PLANES) {
      const r = getExplainer(`rotation:${p}`)!;
      expect(r.tiers.intermediate).toMatch(/XY<\/code> with <code>ZW/);
      expect(r.tiers.math).toContain('cos θ');
      expect(r.tiers.math).toContain('R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY');
    }
    // §8.2: no closed-form hypervolume for the 600- and 120-cell.
    for (const id of [SHAPE_IDS.cell600, SHAPE_IDS.cell120]) {
      const e = getExplainer(id)!;
      for (const tier of TIERS) expect(e.tiers[tier]).not.toMatch(/4-volume (is|=) [^<]*[0-9]/);
      expect(e.tiers.intermediate).toMatch(/no closed-form hypervolume/);
    }
    // §9: no canonical 4D version of the human form or the mug.
    expect(getExplainer(SHAPE_IDS.human)!.tiers.intermediate).toMatch(/no canonical 4D version/);
    expect(getExplainer(SHAPE_IDS.mug)!.tiers.intermediate).toMatch(/No canonical 4D mug/);
    // Hopf: circles filling S^3, every pair linked, nested tori.
    const h = getExplainer(SHAPE_IDS.hopf)!;
    expect(h.tiers.eli5).toMatch(/filled completely with circles/);
    expect(h.tiers.eli5).toMatch(/linked/);
    expect(h.tiers.eli5).toMatch(/nested doughnut/);
    expect(h.tiers.intermediate).toMatch(/every two are linked once/);
    expect(h.tiers.intermediate).toMatch(/nested tori/);
  });

  it('quotes numbers that agree with MATH.md', () => {
    // §8: 5-cell hypervolume √5/96 · a^4 with a = 2√2 (§8.1) is 2√5/3.
    expect((Math.sqrt(5) / 96) * (2 * Math.SQRT2) ** 4).toBeCloseTo((2 * Math.sqrt(5)) / 3, 12);
    expect(getExplainer(SHAPE_IDS.cell5)!.tiers.intermediate).toContain('2√5/3');
    // §8.1: apex-to-base distance equals the base edge 2√2.
    expect(Math.sqrt(3 + (5 / Math.sqrt(5)) ** 2)).toBeCloseTo(2 * Math.SQRT2, 12);
    // 16-cell: octahedron slices (4/3)(1 − |c|)^3 integrate to the §8 hypervolume 2/3
    // (exact antiderivative: 2 · (4/3) · 1/4); midpoint rule with 2000 steps has
    // error O(h^2) ≈ 1e-6, hence 5 decimals.
    let v = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const c = -1 + ((i + 0.5) * 2) / n;
      v += (4 / 3) * (1 - Math.abs(c)) ** 3 * (2 / n);
    }
    expect(v).toBeCloseTo(2 / 3, 5);
    // 24-cell central slice: cube 8 minus eight corner tets of volume 1/6 = 20/3.
    expect(8 - 8 / 6).toBeCloseTo(20 / 3, 12);
    expect(getExplainer(SHAPE_IDS.cell24)!.tiers.intermediate).toContain('20/3');
    // §8.5: ∫ (4/3)π(R²−c²)^{3/2} dc over [−R, R] = π²R⁴/2 (R = 1); midpoint rule,
    // integrand is C^1 with bounded second derivative away from ±1 and the
    // endpoint behaviour (1−c²)^{3/2} is tame, so 2000 steps give 5 decimals.
    let b = 0;
    for (let i = 0; i < n; i++) {
      const c = -1 + ((i + 0.5) * 2) / n;
      b += (4 / 3) * Math.PI * (1 - c * c) ** 1.5 * (2 / n);
    }
    expect(b).toBeCloseTo(Math.PI ** 2 / 2, 5);
  });
});

describe('explainer panel', () => {
  // Minimal stand-in for an HTMLElement: the panel uses innerHTML, classList and scrollTop only.
  function fakeContainer(): HTMLElement & { classes: Set<string> } {
    const classes = new Set<string>();
    const el = {
      innerHTML: '',
      scrollTop: 7,
      classes,
      classList: { add: (c: string) => { classes.add(c); } },
    };
    return el as unknown as HTMLElement & { classes: Set<string> };
  }

  it('shows intro by default and on show(null), switches tiers, and falls back for unknown ids', () => {
    const el = fakeContainer();
    const panel = mountExplainer(el);
    expect(el.classes.has('explainer-content')).toBe(true);
    expect(panel.getTier()).toBe('eli5');
    expect(el.innerHTML).toContain('Seeing the fourth dimension');
    expect(el.innerHTML).toContain('explainer-tier-eli5');
    expect(el.scrollTop).toBe(0);

    panel.show('tesseract');
    expect(el.innerHTML).toContain('<h2 class="explainer-title">Tesseract</h2>');
    expect(el.innerHTML).toContain('explainer-view-note');

    panel.setTier('math');
    expect(panel.getTier()).toBe('math');
    expect(el.innerHTML).toContain('explainer-tier-math');
    expect(el.innerHTML).toContain('[−1, 1]^4');

    panel.show(null);
    expect(el.innerHTML).toContain('Seeing the fourth dimension');
    expect(el.innerHTML).toContain('explainer-tier-math');

    panel.show('no:such-topic');
    expect(el.innerHTML).toContain('No explainer has been written');
    expect(el.innerHTML).toContain('no:such-topic');
  });

  it('does not re-render when topic and tier are unchanged', () => {
    const el = fakeContainer();
    const panel = mountExplainer(el);
    panel.show('rotation:XW');
    el.scrollTop = 42;
    panel.show('rotation:XW');
    expect(el.scrollTop).toBe(42);
    panel.setTier('eli5');
    expect(el.scrollTop).toBe(42);
    panel.setTier('intermediate');
    expect(el.scrollTop).toBe(0);
  });
});
