/**
 * Entry point: registers shapes, builds the state store, the Three.js viewer,
 * the explainer panel and the control UI, then runs the frame loop.
 */
import './style.css';
import './app/shapes';
import { mountExplainer } from './explain';
import { advanceAnimation } from './app/animation';
import { StateStore } from './app/state';
import { mountUI } from './app/ui';
import { Viewer } from './render/viewer';

function must<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`index.html is missing #${id}`);
  return e as T;
}

const store = new StateStore();
const viewer = new Viewer(must('viewport'));
const panel = mountExplainer(must('explainer-body'));
const ui = mountUI(store, panel, {
  gui: must('gui'),
  title: must('title'),
  legend: must('legend'),
  status: must('status'),
  tiers: must('tiers'),
  help: must('help'),
});

viewer.start((dt) => {
  const { state } = store;
  if (state.animation.playing) advanceAnimation(state, dt, store.radius);
  viewer.render(state, store.shape);
  ui.update();
});
