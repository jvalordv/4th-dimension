/**
 * Entry point. Registers the shapes, builds the state store, the Three.js
 * viewer, the explainer panel and the control UI, mounts the Flatland app
 * (MATH.md §11) and the WebXR entry (§12 note), and runs the frame loop.
 *
 * The page has two modes, switched by the top bar: the 4D viewer and
 * Flatland, the same two views one dimension down. One mode is shown at a
 * time; the hidden one is paused (the viewer's animation loop is stopped,
 * Flatland stops its own loop in hide()). The explainer aside is shared and
 * follows whichever mode is active.
 */
import './style.css';
import './app/shapes';
import { mountExplainer } from './explain';
import { advanceAnimation } from './app/animation';
import { StateStore } from './app/state';
import { mountUI, shapeTopic } from './app/ui';
import { mountFlatland } from './flat/app';
import { projectedExtent, Viewer } from './render/viewer';
import { setupXR } from './render/xr';

type Mode = '4d' | 'flat';

/** URL fragment that opens the page in Flatland mode. */
const FLATLAND_HASH = '#flatland';

function must<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`index.html is missing #${id}`);
  return e as T;
}

const app = must('app');
const store = new StateStore();
const viewer = new Viewer(must('viewport'));
const panel = mountExplainer(must('explainer-body'));

// Flatland mounts hidden; its keys are routed through the 4D UI's hook below.
const flatland = mountFlatland(must('flatland'), panel);
let mode: Mode = '4d';

const ui = mountUI(store, panel, {
  gui: must('gui'),
  title: must('title'),
  legend: must('legend'),
  status: must('status'),
  tiers: must('tiers'),
  help: must('help'),
  importPanel: must('import'),
}, {
  interceptKey: (ev) => mode === 'flat' && flatland.handleKey(ev),
});

// ---- WebXR ------------------------------------------------------------------
// The drawing is a rigid motion plus a uniform scale of what the desktop view
// shows; the object is fitted by its drawn extent, which under perspective
// exceeds the shape's radius (§3.2, Viewer.projectedExtent).
const xr = setupXR(viewer.renderer, viewer.scene, viewer.world, {
  getRadius: () => (store.state.viewMode === 'slice' ? store.radius : projectedExtent(store.radius, store.state.projection)),
  onSelect: () => store.togglePlaying(),
});
if (xr.button) {
  // VRButton positions itself absolutely at the bottom of its parent and the
  // title overlay ignores pointer events; here it flows below the description.
  xr.button.classList.add('xr-button');
  xr.button.style.position = 'static';
  xr.button.style.pointerEvents = 'auto';
  xr.button.style.margin = '10px 0 0';
  must('title').append(xr.button);
}
store.subscribe((change) => {
  if (change === 'shape' || change === 'projection' || change === 'viewMode') xr.refit();
});

// ---- frame loop --------------------------------------------------------------
const frame = (dt: number): void => {
  const { state } = store;
  if (state.animation.playing) advanceAnimation(state, dt, store.radius);
  viewer.render(state, store.shape);
  ui.update();
};

// ---- mode switch -------------------------------------------------------------
const modeButtons: Record<Mode, HTMLButtonElement> = {
  '4d': must<HTMLButtonElement>('mode-4d'),
  flat: must<HTMLButtonElement>('mode-flat'),
};

function setMode(next: Mode): void {
  if (next === mode) return;
  mode = next;
  app.classList.toggle('mode-flat', next === 'flat');
  for (const [m, button] of Object.entries(modeButtons) as Array<[Mode, HTMLButtonElement]>) {
    button.classList.toggle('active', m === next);
    button.setAttribute('aria-pressed', String(m === next));
  }
  if (next === 'flat') {
    ui.toggleHelp(false);
    ui.toggleImport(false);
    // An immersive session drives the renderer's loop, so it is left running.
    if (!viewer.renderer.xr.isPresenting) viewer.stop();
    flatland.show();
  } else {
    flatland.hide();
    viewer.start(frame);
    panel.show(shapeTopic(store.state.shapeId));
  }
  history.replaceState(null, '', next === 'flat' ? FLATLAND_HASH : `${location.pathname}${location.search}`);
}

for (const [m, button] of Object.entries(modeButtons) as Array<[Mode, HTMLButtonElement]>) {
  button.addEventListener('click', () => setMode(m));
}
window.addEventListener('hashchange', () => setMode(location.hash === FLATLAND_HASH ? 'flat' : '4d'));

viewer.start(frame);
if (location.hash === FLATLAND_HASH) setMode('flat');
