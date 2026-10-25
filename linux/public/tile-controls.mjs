import { supportsSmooth } from './smooth.mjs';
import { element } from './tile.mjs';

const paths = {
  'zoom-out': '<path d="M5 12h14"/>', 'zoom-in': '<path d="M5 12h14M12 5v14"/>',
  'zoom-reset': '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',
  snapshot: '<path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="4"/>',
  'record-clip': '<circle cx="12" cy="12" r="7"/>',
  'audio-toggle': '<path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8"/>',
  fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
function iconButton(name, label) {
  const button = element('button', 'camera-tool'); button.type = 'button';
  button.title = label; button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  return button;
}
export function createTileControls(tile, actions) {
  const refs = tile.controls = {};
  const root = element('div', 'tile-controls'); root.setAttribute('aria-label', 'Camera controls');
  const settings = element('div', 'tile-settings');
  for (const [name, label, options] of [
    ['delivery', 'Playback', [['smooth', 'Smooth'], ['mjpeg', 'Compatibility']]],
    ['quality', 'Quality', [['auto', 'Auto'], ['hd', 'HD / Main'], ['sd', 'SD / Substream']]],
    ['picture-fit', 'Picture sizing', [['fit', 'Fit'], ['fill', 'Fill'], ['original', 'Original size']]]
  ]) {
    const select = refs[name] = element('select'); select.setAttribute('aria-label', label); select.title = label;
    for (const [value, text] of options) { const option = new Option(text, value); if (name === 'delivery' && value === 'smooth' && !supportsSmooth()) { option.disabled = true; option.textContent = 'Smooth unavailable'; } select.add(option); }
    select.onchange = () => { const value = select.value; actions.select(tile); actions.change(name, value); };
    settings.append(select);
  }
  const dock = element('div', 'tile-dock');
  for (const [name, label] of [['zoom-out', 'Zoom out'], ['zoom-in', 'Zoom in'], ['zoom-reset', 'Reset zoom'], ['snapshot', 'Snapshot'], ['record-clip', 'Record clip'], ['audio-toggle', 'Listen to this camera'], ['fullscreen', 'Fullscreen']]) {
    const button = refs[name] = iconButton(name, label);
    button.onclick = () => { const wasSelected = tile.el.classList.contains('selected'); actions.select(tile); actions.action(name, wasSelected); };
    dock.append(button);
    if (name === 'zoom-out') { refs['zoom-level'] = element('output', 'tile-zoom-level', '1.0\u00d7'); refs['zoom-level'].setAttribute('aria-label', 'Zoom level'); dock.append(refs['zoom-level']); }
  }
  const more = refs.more = iconButton('more', 'Volume, talk and camera help'); more.setAttribute('aria-expanded', 'false');
  const panel = element('div', 'tile-audio-panel'); panel.id = `camera-tools-${tile.id}`; panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Audio and camera help');
  refs.panel = panel; more.setAttribute('aria-controls', panel.id);
  const heading = element('strong', '', 'Camera audio');
  const volumeLabel = element('label', 'tile-volume-label', 'Volume'); const volume = refs.volume = element('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = '70';
  volume.setAttribute('aria-label', 'Camera volume'); volumeLabel.append(volume);
  volume.oninput = () => { const value = volume.value; actions.select(tile); actions.change('volume', value); };
  const talk = refs['push-talk'] = element('button', 'camera-talk', 'Hold to talk \u00b7 PC mic'); talk.type = 'button'; talk.title = 'Uses the receiver microphone. Requires a supported camera speaker.';
  talk.onpointerdown = event => { event.preventDefault(); actions.select(tile); talk.setPointerCapture(event.pointerId); actions.startTalk(); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) talk.addEventListener(event, actions.stopTalk);
  talk.onkeydown = event => { if (['Space', 'Enter'].includes(event.code) && !event.repeat) { event.preventDefault(); actions.select(tile); actions.startTalk(); } };
  talk.onkeyup = event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); actions.stopTalk(); } };
  const help = element('p', '', 'Wheel to zoom; drag to pan. Sound follows the selected camera. Clips include the full picture and available camera audio.');
  panel.append(heading, volumeLabel, talk, help);
  const positionPanel = () => {
    const box = more.getBoundingClientRect(); const width = Math.min(280, window.innerWidth - 24);
    panel.style.width = `${width}px`; panel.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(box.top - panel.offsetHeight - 8, window.innerHeight - panel.offsetHeight - 12))}px`;
  };
  more.onclick = () => { actions.select(tile); if (panel.matches(':popover-open')) panel.hidePopover(); else { panel.showPopover(); positionPanel(); } };
  panel.addEventListener('toggle', () => { const open = panel.matches(':popover-open'); more.setAttribute('aria-expanded', String(open)); tile.el.classList.toggle('controls-open', open); if (!open && tile.el.classList.contains('selected')) actions.stopTalk(); });
  for (const node of [root, panel]) {
    node.addEventListener('click', event => event.stopPropagation());
    node.addEventListener('pointerdown', event => event.stopPropagation());
    node.addEventListener('wheel', event => event.stopPropagation());
  }
  const reposition = () => { if (panel.matches(':popover-open')) positionPanel(); };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  dock.append(more); root.append(settings, dock); tile.el.append(root, panel);
}
export function updateTileControls(tile, { selected, audioWanted, volume, talkSource }) {
  const refs = tile.controls; if (!refs) return;
  const live = tile.state === 'playing' && tile.hasFrame;
  tile.el.classList.toggle('has-camera', Boolean(tile.camera));
  refs.quality.value = tile.qualityMode || 'auto'; refs.quality.options[0].textContent = `Auto / ${(tile.quality || 'sd').toUpperCase()}`; refs.delivery.value = tile.delivery; refs['picture-fit'].value = tile.fit;
  refs['zoom-level'].textContent = `${tile.zoom.scale.toFixed(1)}\u00d7`;
  for (const name of ['zoom-in', 'zoom-out', 'zoom-reset', 'snapshot', 'record-clip', 'fullscreen']) refs[name].disabled = !live;
  for (const name of ['quality', 'delivery', 'picture-fit', 'more']) refs[name].disabled = !tile.camera;
  const recording = Boolean(tile.recorder?.active);
  refs['record-clip'].classList.toggle('recording', recording); refs['record-clip'].title = recording ? 'Stop recording' : 'Record clip'; refs['record-clip'].setAttribute('aria-label', refs['record-clip'].title); refs['record-clip'].setAttribute('aria-pressed', String(recording));
  tile.recordIndicator.hidden = !recording;
  const listening = selected && audioWanted;
  refs['audio-toggle'].disabled = tile.state !== 'playing' || ['unavailable', 'error'].includes(tile.status?.audioState);
  refs['audio-toggle'].title = listening ? 'Mute camera' : 'Listen to this camera'; refs['audio-toggle'].setAttribute('aria-label', refs['audio-toggle'].title); refs['audio-toggle'].setAttribute('aria-pressed', String(listening));
  refs.volume.value = String(Math.round(volume * 100));
  refs['push-talk'].disabled = !live || !tile.status?.talkSupported || talkSource !== 'windows-pc-microphone';
}
