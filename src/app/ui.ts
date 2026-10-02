/**
 * Control panel (lil-gui), keyboard shortcuts, title overlay, colour legend,
 * status line, help overlay and the explainer tier buttons. Every user
 * interaction that changes the shape, the view mode or a rotation slider also
 * tells the explainer which topic to show.
 */
import GUI, { type Controller } from 'lil-gui';
import type { ExplainerPanel, Tier } from '../explain';
import { TIERS, TIER_LABELS } from '../explain';
import { isHyperPlane, ROTATION_PLANES } from '../math/rotation';
import { gradientCSS } from './colors';
import { listShapes, type ShapeGroup } from './registry';
import {
  ANIMATION_PRESETS,
  PROJECTION_KINDS,
  VIEW_MODES,
  type ProjectionKind,
  type StateStore,
  type ViewMode,
} from './state';

export interface UIElements {
  /** Container for the lil-gui panel. */
  gui: HTMLElement;
  /** Title overlay: app name, shape label and description. */
  title: HTMLElement;
  /** Colour legend. */
  legend: HTMLElement;
  /** Status line: slice offset and the six angles. */
  status: HTMLElement;
  /** Container for the explainer tier buttons. */
  tiers: HTMLElement;
  /** Help overlay root; toggled with the `hidden` class. */
  help: HTMLElement;
}

export interface UI {
  readonly gui: GUI;
  /** Per-frame refresh of the status line (writes only when the text changed). */
  update(): void;
  toggleHelp(show?: boolean): void;
  dispose(): void;
}

const GROUP_ORDER: readonly ShapeGroup[] = ['Regular polytopes', 'Curved solids', 'Lifted 3D objects', 'Figures'];

const degrees = (rad: number): string => {
  const d = (rad * 180) / Math.PI;
  const s = Math.abs(d) < 0.5 ? '0' : d.toFixed(0);
  return `${s}°`;
};

const signed = (x: number, digits: number): string => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(digits)}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountUI(store: StateStore, panel: ExplainerPanel, els: UIElements): UI {
  const { state } = store;
  const disposers: Array<() => void> = [];

  // ---- lil-gui panel -------------------------------------------------------
  const gui = new GUI({ container: els.gui, title: 'Controls', width: 300 });

  const shapeOptions: Record<string, string> = {};
  for (const group of GROUP_ORDER) {
    for (const s of listShapes()) if (s.group === group) shapeOptions[s.label] = s.id;
  }
  for (const s of listShapes()) if (!(s.label in shapeOptions)) shapeOptions[s.label] = s.id;
  gui.add(state, 'shapeId', shapeOptions).name('Shape').listen().onChange((id: string) => {
    store.setShape(id);
    panel.show(id);
  });

  const view = gui.addFolder('View');
  view.add(state, 'viewMode', VIEW_MODES).name('Mode (1 2 3)').listen().onChange((mode: ViewMode) => {
    store.notify('viewMode');
    panel.show(`view:${mode}`);
  });
  const params = { projectionKind: state.projection.kind as ProjectionKind, distance: store.perspectiveDistance };
  view.add(params, 'projectionKind', PROJECTION_KINDS).name('Projection').onChange((kind: ProjectionKind) => {
    store.setProjectionKind(kind);
  });
  const distanceCtrl = view.add(params, 'distance', 1, 10, 0.01).name('Eye distance d').onChange((d: number) => {
    store.setPerspectiveDistance(d);
  });
  const offsetCtrl = view.add(state, 'sliceOffset', -store.radius, store.radius, 0.001).name('Slice offset c')
    .listen().onChange(() => store.notify('sliceOffset'));

  const rot = gui.addFolder('Rotation (radians)');
  for (const plane of ROTATION_PLANES) {
    rot.add(state.angles, plane, -Math.PI, Math.PI, 0.001)
      .name(isHyperPlane(plane) ? `${plane}  ·  into w` : plane)
      .listen()
      .onChange(() => {
        store.notify('angles');
        panel.show(`rotation:${plane}`);
      });
  }

  const anim = gui.addFolder('Animation');
  anim.add(state.animation, 'preset', ANIMATION_PRESETS).name('Preset').listen().onChange(() => store.notify('animation'));
  anim.add(state.animation, 'speed', 0, 3, 0.01).name('Speed ω (rad/s)').listen().onChange(() => store.notify('animation'));
  anim.add(state.animation, 'playing').name('Playing (space)').listen().onChange(() => store.notify('animation'));
  const actions = {
    reset: () => store.reset(),
    help: () => toggleHelp(),
  };
  anim.add(actions, 'reset').name('Reset angles and offset (R)');

  const display = gui.addFolder('Display');
  display.add(state, 'showFaces').name('Faces').onChange(() => store.notify('display'));
  display.add(state, 'showEdges').name('Edges').onChange(() => store.notify('display'));
  display.add(state, 'showVertices').name('Vertices').onChange(() => store.notify('display'));
  gui.add(actions, 'help').name('Help (?)');

  const syncProjectionControls = (): void => {
    params.projectionKind = state.projection.kind;
    params.distance = store.perspectiveDistance;
    const r = store.radius;
    // d must exceed every w (< radius) for the eye to be outside the shape, §3.2.
    // Bounds depend on the shape only; deriving the max from the current value
    // would move the track under the thumb while dragging and run away.
    distanceCtrl.min(Math.max(1.05 * r, 0.5)).max(Math.max(10, 6 * r));
    distanceCtrl.enable(state.projection.kind === 'perspective');
    gui.controllersRecursive().forEach((c: Controller) => c.updateDisplay());
  };

  // ---- title overlay -------------------------------------------------------
  els.title.replaceChildren();
  const h1 = el('h1', undefined, '4th-dimension');
  const shapeLabel = el('div', 'shape-label');
  const shapeGroup = el('div', 'shape-group');
  const shapeDesc = el('p', 'shape-description');
  els.title.append(h1, shapeLabel, shapeGroup, shapeDesc);
  const syncTitle = (): void => {
    const entry = store.entry;
    shapeLabel.textContent = entry.label;
    shapeGroup.textContent = entry.group;
    shapeDesc.textContent = entry.description;
  };

  // ---- legend ------------------------------------------------------------
  els.legend.replaceChildren();
  els.legend.title = 'Colour encodes the fourth coordinate w. Click for the explanation.';
  const legendRows: Array<{ root: HTMLElement; caption: HTMLElement; lo: HTMLElement; hi: HTMLElement }> = [];
  for (let i = 0; i < 2; i++) {
    const root = el('div', 'legend-row');
    const caption = el('div', 'legend-caption');
    const bar = el('div', 'legend-bar');
    bar.style.background = gradientCSS();
    const labels = el('div', 'legend-labels');
    const lo = el('span');
    const mid = el('span', undefined, 'w = 0');
    const hi = el('span');
    labels.append(lo, mid, hi);
    root.append(caption, bar, labels);
    els.legend.append(root);
    legendRows.push({ root, caption, lo, hi });
  }
  const onLegendClick = (): void => panel.show('color');
  els.legend.addEventListener('click', onLegendClick);
  disposers.push(() => els.legend.removeEventListener('click', onLegendClick));

  const syncLegend = (): void => {
    const shape = store.shape;
    const r = shape.radius();
    const [wmin, wmax] = shape.wRange();
    const rows: Array<[string, number, number]> = [];
    if (state.viewMode !== 'slice') rows.push(['wire: w after rotation', -r, r]);
    if (state.viewMode !== 'projection') rows.push(['slice: w of the source point', wmin, wmax]);
    legendRows.forEach((row, i) => {
      const data = rows[i];
      row.root.classList.toggle('hidden', !data);
      if (!data) return;
      row.caption.textContent = data[0];
      row.lo.textContent = `w = ${signed(data[1], 2)}`;
      row.hi.textContent = `w = ${signed(data[2], 2)}`;
    });
  };

  // ---- status line -------------------------------------------------------
  let lastStatus = '';
  const update = (): void => {
    const parts = ROTATION_PLANES.map((p) => `${p} ${degrees(state.angles[p])}`);
    const text = `slice w = ${signed(state.sliceOffset, 2)}   |   ${parts.join('  ')}`;
    if (text !== lastStatus) {
      lastStatus = text;
      els.status.textContent = text;
    }
  };

  // ---- explainer tiers -----------------------------------------------------
  els.tiers.replaceChildren();
  const tierButtons = new Map<Tier, HTMLButtonElement>();
  for (const tier of TIERS) {
    const b = el('button', 'tier-button', TIER_LABELS[tier]);
    b.type = 'button';
    b.addEventListener('click', () => {
      panel.setTier(tier);
      syncTiers();
    });
    tierButtons.set(tier, b);
    els.tiers.append(b);
  }
  const syncTiers = (): void => {
    const current = panel.getTier();
    for (const [tier, b] of tierButtons) b.classList.toggle('active', tier === current);
  };
  syncTiers();

  // ---- help overlay ------------------------------------------------------
  const toggleHelp = (show?: boolean): void => {
    const hidden = els.help.classList.contains('hidden');
    const next = show ?? hidden;
    els.help.classList.toggle('hidden', !next);
  };
  const onHelpClick = (ev: MouseEvent): void => {
    if (ev.target === els.help) toggleHelp(false);
  };
  els.help.addEventListener('click', onHelpClick);
  disposers.push(() => els.help.removeEventListener('click', onHelpClick));

  // ---- keyboard ----------------------------------------------------------
  const onKey = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    switch (ev.key) {
      case ' ':
        store.togglePlaying();
        break;
      case '1':
      case '2':
      case '3': {
        const mode = VIEW_MODES[Number(ev.key) - 1];
        store.setViewMode(mode);
        panel.show(`view:${mode}`);
        break;
      }
      case 'r':
      case 'R':
        store.reset();
        break;
      case '?':
        toggleHelp();
        break;
      case 'Escape':
        toggleHelp(false);
        break;
      default:
        return;
    }
    ev.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  disposers.push(() => window.removeEventListener('keydown', onKey));

  // ---- react to store changes -------------------------------------------
  disposers.push(store.subscribe((change) => {
    switch (change) {
      case 'shape': {
        const r = store.radius;
        offsetCtrl.min(-r).max(r);
        syncProjectionControls();
        syncTitle();
        syncLegend();
        break;
      }
      case 'viewMode':
        syncLegend();
        break;
      case 'projection':
        syncProjectionControls();
        break;
      default:
        break;
    }
  }));

  syncProjectionControls();
  syncTitle();
  syncLegend();
  update();
  panel.show('intro');

  return {
    gui,
    update,
    toggleHelp,
    dispose: () => {
      for (const d of disposers) d();
      gui.destroy();
    },
  };
}
