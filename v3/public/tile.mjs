import { Zoom, Retry, pictureSize } from './view-model.mjs';
import { SmoothPlayer } from './smooth.mjs';
export function element(tag, className = '', text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
export class Tile {
  constructor(id, callbacks) {
    this.id = id; this.callbacks = callbacks; this.zoom = new Zoom(); this.retry = new Retry(); this.fit = 'fit'; this.qualityMode = 'auto'; this.adaptivePaused = false; this.generation = 0; this.wanted = false; this.state = 'stopped';
    this.el = element('article', 'camera-tile'); this.el.dataset.slot = id; this.el.tabIndex = 0; this.el.setAttribute('aria-description', 'Click to select. Double-click the picture or use Expand camera to enlarge.');
    const header = element('header', 'tile-header');
    this.grip = element('span', 'tile-grip', '⠿'); this.grip.draggable = true; this.grip.title = 'Drag to reorder';
    this.title = element('strong', '', `Tile ${id + 1}`); this.badge = element('span', 'badge', 'Empty');
    this.expand = element('button', 'tile-action', '⛶'); this.expand.title = 'Expand camera'; this.expand.setAttribute('aria-label', 'Expand camera');
    this.close = element('button', 'tile-action', '■'); this.close.title = 'Stop camera'; this.close.setAttribute('aria-label', 'Stop camera');
    this.recordIndicator = element('span', 'record-indicator', 'REC'); this.recordIndicator.hidden = true;
    header.append(this.grip, this.title, this.recordIndicator, this.badge, this.expand, this.close);
    this.delivery = globalThis.VideoDecoder ? 'smooth' : 'mjpeg';
    this.viewport = element('div', 'tile-viewport'); this.jpegImage = element('img', 'tile-image'); this.jpegImage.alt = 'Live camera picture'; this.jpegImage.draggable = false; this.jpegImage.hidden = true;
    this.canvas = element('canvas', 'tile-image'); this.canvas.hidden = true; this.canvas.setAttribute('aria-label', 'Live camera picture');
    Object.defineProperty(this, 'image', { get: () => this.delivery === 'smooth' ? this.canvas : this.jpegImage });
    this.smooth = new SmoothPlayer(this.canvas, () => {
      if (!this.wanted) return;
      const first = !this.hasFrame; this.hasFrame = true; this.canvas.hidden = false; this.jpegImage.hidden = true; this.placeholder.hidden = true; this.feedback.hidden = true; this.el.classList.remove('has-issue'); this.spinner.hidden = true; this.el.setAttribute('aria-busy', 'false');
      this.paintedFrames = (this.paintedFrames || 0) + 1; this.canvas.dataset.frames = this.paintedFrames;
      if (first) { this.applyPicture(); callbacks.changed(this); } callbacks.frame?.(this);
    }, () => callbacks.playbackError?.(this));
    this.spinner = element('i', 'loading-spinner tile-spinner'); this.spinner.hidden = true; this.spinner.setAttribute('aria-hidden', 'true');
    this.placeholder = element('p', 'tile-placeholder', 'Select this tile, then choose a camera.');
    this.feedback = element('div', 'tile-feedback'); this.feedback.hidden = true; this.feedback.setAttribute('role', 'status');
    this.feedbackTitle = element('strong'); this.feedbackDetail = element('p'); this.feedbackAction = element('button', 'tile-feedback-action'); this.feedbackAction.type = 'button';
    this.feedbackAction.onclick = event => { event.stopPropagation(); callbacks.select(this); void callbacks.recover?.(this, this.issue?.action); };
    this.feedback.addEventListener('dblclick', event => event.stopPropagation());
    this.feedback.append(this.feedbackTitle, this.feedbackDetail, this.feedbackAction);
    this.viewport.append(this.jpegImage, this.canvas, this.spinner, this.placeholder, this.feedback);
    this.footer = element('div', 'tile-footer', 'No camera selected'); this.el.append(header, this.viewport, this.footer);
    this.el.onclick = () => callbacks.select(this);
    this.el.ondblclick = event => {
      if (this.camera && this.zoom.scale <= 1 && !event.target.closest('button,input,select,.tile-grip,.tile-controls,.tile-audio-panel')) { callbacks.select(this); callbacks.expand(this); }
    };
    this.el.onkeydown = event => { if (event.target === this.el && ['Enter', ' '].includes(event.key)) { event.preventDefault(); callbacks.select(this); } };
    this.expand.onclick = event => { event.stopPropagation(); callbacks.select(this); callbacks.expand(this); };
    this.close.onclick = event => { event.stopPropagation(); callbacks.stop(this); };
    this.grip.ondragstart = event => { event.dataTransfer.setData('application/json', JSON.stringify({ kind: 'tile', id })); event.dataTransfer.effectAllowed = 'move'; };
    this.el.ondragover = event => { event.preventDefault(); this.el.classList.add('drop-target'); };
    this.el.ondragleave = () => this.el.classList.remove('drop-target');
    this.el.ondrop = event => { event.preventDefault(); this.el.classList.remove('drop-target'); let value; try { value = JSON.parse(event.dataTransfer.getData('application/json')); } catch { return; } callbacks.drop(this, value); };
    this.jpegImage.onload = () => { if (!this.wanted || this.delivery !== 'mjpeg') return; this.hasFrame = true; this.jpegImage.hidden = false; this.canvas.hidden = true; this.placeholder.hidden = true; this.feedback.hidden = true; this.el.classList.remove('has-issue'); this.spinner.hidden = true; this.el.setAttribute('aria-busy', 'false'); this.applyPicture(); callbacks.frame?.(this); callbacks.changed(this); };
    this.viewport.addEventListener('wheel', event => {
      if (!this.hasFrame) return; event.preventDefault(); callbacks.select(this);
      const box = this.viewport.getBoundingClientRect(); this.zoom.zoom(this.zoom.scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2); this.applyPicture(); callbacks.changed(this);
    }, { passive: false });
    this.viewport.onpointerdown = event => {
      callbacks.select(this); if (this.zoom.scale <= 1 || event.button !== 0) return;
      event.preventDefault(); this.viewport.setPointerCapture(event.pointerId); this.drag = { x: event.clientX, y: event.clientY, px: this.zoom.x, py: this.zoom.y };
    };
    this.viewport.onpointermove = event => { if (!this.drag) return; this.zoom.x = this.drag.px + event.clientX - this.drag.x; this.zoom.y = this.drag.py + event.clientY - this.drag.y; this.applyPicture(); };
    this.viewport.onpointerup = this.viewport.onpointercancel = this.viewport.onlostpointercapture = () => { this.drag = null; };
    this.observer = new ResizeObserver(() => this.applyPicture()); this.observer.observe(this.viewport);
  }
  assign(camera, quality = 'sd') { if (this.camera?.key !== camera.key) this.qualityMode = 'auto'; this.adaptivePaused = false; this.smooth.reset(); this.camera = camera; this.quality = quality; this.zoom.reset(); this.title.textContent = `${camera.device.name} / ${camera.name}`; this.jpegImage.hidden = this.canvas.hidden = true; this.hasFrame = false; }
  clear() { this.adaptivePaused = false; this.qualityMode = 'auto'; this.smooth.reset(); this.camera = null; this.zoom.reset(); this.hasFrame = false; this.image.removeAttribute('src'); this.title.textContent = `Tile ${this.id + 1}`; this.message('stopped', 'Choose a camera for this tile.'); }
  message(state, text, issue = null) {
    this.issue = issue; this.feedback.hidden = !issue; this.el.classList.toggle('has-issue', Boolean(issue)); this.el.dataset.issue = issue?.kind || '';
    if (issue) { this.feedbackTitle.textContent = issue.title; this.feedbackDetail.textContent = issue.detail; this.feedbackAction.textContent = issue.actionLabel; this.feedbackAction.hidden = !issue.action; }
    const waiting = state === 'connecting' || state === 'retrying' || state === 'playing' && !this.hasFrame;
    this.spinner.hidden = !waiting; this.el.setAttribute('aria-busy', String(waiting));
    if (waiting) { this.placeholder.textContent = state === 'playing' ? 'Buffering live video...' : text; this.placeholder.hidden = false; }
    this.state = state; this.badge.textContent = state === 'playing' ? 'Live' : state === 'connecting' ? 'Connecting' : state === 'retrying' ? 'Retrying' : state === 'offline' ? 'Offline' : state === 'paused' ? 'Paused' : state === 'unavailable' ? 'Unavailable' : state === 'authorization' ? 'Reconnect' : state === 'server-error' ? 'Server issue' : state === 'provider-error' ? 'Cloud issue' : state === 'failed' ? 'Error' : 'Stopped';
    this.badge.className = 'badge' + (state === 'playing' ? ' connected' : '');
    this.el.classList.toggle('is-live', state === 'playing'); this.footer.textContent = text;
    if (state !== 'playing') { this.placeholder.textContent = text; this.placeholder.hidden = false; this.image.hidden = true; }
    if (issue) { this.placeholder.hidden = true; this.feedback.hidden = false; this.spinner.hidden = true; this.el.setAttribute('aria-busy', 'false'); }
    this.callbacks.changed(this);
  }
  frame(packet) {
    if (!this.wanted || !this.camera || packet.deviceId !== this.camera.device.id || packet.channel !== this.camera.channel || packet.quality !== this.quality) return;
    if (packet.h264) {
      if (this.delivery !== 'smooth') return;
      const resized = this.width !== (packet.displayWidth || packet.width) || this.height !== packet.height;
      this.width = packet.displayWidth || packet.width; this.height = packet.height;
      if (resized) this.applyPicture();
      this.smooth.push(packet); this.lastFrame = Date.now(); return;
    }
    if (this.delivery !== 'mjpeg') return;
    if (typeof packet.jpeg !== 'string' || packet.jpeg.length > 6_000_000) return;
    this.width = packet.displayWidth || packet.width; this.height = packet.height; this.image.src = 'data:image/jpeg;base64,' + packet.jpeg;
    this.lastFrame = Date.now();
  }
  applyPicture() {
    if (!this.width || !this.height) return;
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    if (!w || !h) return;
    const size = pictureSize(this.width, this.height, w, h, this.fit);
    this.zoom.clamp(size.width, size.height, w, h);
    this.image.style.width = size.width + 'px'; this.image.style.height = size.height + 'px';
    this.image.style.transform = `translate(-50%,-50%) translate(${this.zoom.x}px,${this.zoom.y}px) scale(${this.zoom.scale})`;
    this.viewport.style.touchAction = this.zoom.scale > 1 ? 'none' : 'pan-y'; this.viewport.classList.toggle('zoomed', this.zoom.scale > 1);
  }
}
