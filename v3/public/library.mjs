import { element } from './tile.mjs';
import { pictureSize } from './view-model.mjs';

const paths = {
  camera: 'M14 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2ZM16 11l5-3v10l-5-3',
  recorder: 'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M16 7h2M16 17h2',
  chevron: 'm9 5 7 7-7 7', play: 'm9 5 11 7-11 7z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  offline: 'M3 3l18 18M10 7h4a2 2 0 0 1 2 2v2M16 15v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1M16 11l5-3v10l-2-1'
};
function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'library-icon ' + className);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
}
function statePill(state) {
  const pill = element('span', 'library-state ' + state); pill.append(element('i', 'status-light'), document.createTextNode(state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Unknown')); return pill;
}
export class CameraLibrary {
  constructor(container, actions) {
    this.columns = window.innerWidth <= 600 ? 2 : window.innerWidth <= 1000 ? 3 : 4;
    try { const saved = Number(localStorage.getItem('camera-preview-columns')); if (Number.isInteger(saved) && saved >= 1 && saved <= 10) this.columns = saved; } catch {}
    container.style.setProperty('--preview-columns', String(this.columns));
    this.container = container; this.actions = actions; this.previews = new Map(); this.refs = new Map(); this.recorders = new Map(); this.active = new Set(); this.previewStates = new Map(); this.expanded = new Set();
  }
  clear() { this.previews.clear(); this.refs.clear(); this.recorders.clear(); this.active.clear(); this.previewStates.clear(); this.expanded.clear(); this.selectedKey = null; this.selectedId = null; }
  preview(key, value) {
    if (typeof value?.jpeg !== 'string' || value.jpeg.length > 400000 || !Number.isFinite(value.capturedAt)) return;
    this.previews.set(key, { url: 'data:image/jpeg;base64,' + value.jpeg, at: value.capturedAt });
    if (this.previews.size > 256) this.previews.delete(this.previews.keys().next().value);
    this.update();
  }
  previewState(key, state) { this.previewStates.set(key, state); this.update(); }
  select(key) { this.selectedKey = key; this.update(); }
  render(devices, cameras, favourites, selectedId, searching, showAllRecorders = false) {
    const scrollLeft = this.container.querySelector('.recorder-strip')?.scrollLeft || 0;
    if (selectedId && selectedId !== this.selectedId) { this.expanded.clear(); this.expanded.add(selectedId); }
    this.selectedId = selectedId;
    if (searching && !cameras.some(camera => this.expanded.has(camera.device.id))) {
      this.expanded.clear(); if (cameras.length) this.expanded.add(cameras[0].device.id);
    }
    const strip = element('div', 'recorder-strip'), channelRows = element('div', 'recorder-channel-rows');
    this.container.replaceChildren(strip, channelRows); this.refs.clear(); this.recorders.clear();
    for (const device of devices) {
      const list = cameras.filter(camera => camera.device.id === device.id); if (!list.length && !showAllRecorders) continue;
      const state = ['online', 'offline'].includes(device.status) ? device.status : 'unknown', offline = state === 'offline';
      const section = element('article', 'recorder-list' + (device.id === selectedId ? ' active-recorder' : '')); section.dataset.deviceId = device.id;
      const cover = element('button', 'recorder-cover'); cover.type = 'button'; cover.dataset.deviceId = device.id;
      cover.setAttribute('aria-label', `Open all ${device.channels.length} cameras on ${device.name}, ${state}`);
      const preview = element('img', 'recorder-thumbnail'); preview.alt = ''; preview.hidden = true;
      const artwork = element('span', 'recorder-artwork'); artwork.append(icon('camera'));
      const top = element('span', 'recorder-cover-top');
      const kind = element('span', 'recorder-kind'); kind.append(icon('recorder'), document.createTextNode('RECORDER'));
      top.append(kind, statePill(state));
      const bottom = element('span', 'recorder-cover-bottom'), info = element('span', 'recorder-info');
      info.append(element('strong', '', device.name), element('small', '', `${device.channels.length} cameras${device.source === 'shared' ? ' / Shared access' : ''}`));
      const play = element('span', 'recorder-play'); play.append(icon('play'));
      bottom.append(info, play); cover.append(preview, artwork, top, bottom);
      cover.onclick = () => this.actions.recorder(device.id);
      const footer = element('div', 'recorder-card-footer'), previewState = element('small', 'recorder-preview-state', 'No preview yet');
      const toggle = element('button', 'recorder-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-label', `Show or hide ${device.name} cameras`);
      toggle.append(document.createTextNode('Channels'), icon('chevron'));
      const body = element('div', 'recorder-camera-grid'); body.id = 'library-channels-' + device.id.replace(/[^a-z0-9-]/gi, '-'); toggle.setAttribute('aria-controls', body.id);
      const panel = element('section', 'recorder-channel-panel'); panel.setAttribute('aria-label', `${device.name} cameras`);
      const heading = element('div', 'recorder-channel-heading'); heading.append(icon('camera'), element('strong', '', device.name), element('span', '', `${list.length} cameras`));
      const columnControl = element('label', 'preview-columns-control');
      const columnSlider = element('input'); columnSlider.type = 'range'; columnSlider.min = '1'; columnSlider.max = '10'; columnSlider.step = '1'; columnSlider.value = String(this.columns); columnSlider.setAttribute('aria-label', 'Camera preview columns');
      const columnValue = element('output', 'preview-columns-value', String(this.columns));
      columnControl.append(document.createTextNode('Columns'), columnSlider, columnValue);
      columnSlider.oninput = () => {
        this.columns = Math.max(1, Math.min(10, Number(columnSlider.value) || 1));
        this.container.style.setProperty('--preview-columns', String(this.columns));
        for (const input of this.container.querySelectorAll('.preview-columns-control input')) { input.value = String(this.columns); input.setAttribute('aria-valuetext', `${this.columns} columns`); }
        for (const output of this.container.querySelectorAll('.preview-columns-value')) output.textContent = String(this.columns);
        try { localStorage.setItem('camera-preview-columns', String(this.columns)); } catch {}
      };
      heading.append(columnControl); panel.append(heading);
      const setOpen = open => { panel.hidden = !open; body.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); section.classList.toggle('channels-open', open); };
      setOpen(this.expanded.has(device.id));
      toggle.onclick = () => {
        const open = body.hidden; this.expanded.clear(); if (open) this.expanded.add(device.id);
        for (const [id, ref] of this.recorders) ref.setOpen(open && id === device.id);
      };
      footer.append(previewState, toggle); section.append(cover, footer);
      panel.append(body); channelRows.append(panel);
      this.recorders.set(device.id, { image: preview, artwork, previewState, state, setOpen, cameras: device.channels.map(channel => ({ key: `${device.id}:${channel.number}` })) });
      for (const camera of list) {
        const row = element('div', 'camera-row');
        const button = element('button', 'camera-choice camera-card'); button.type = 'button'; button.dataset.cameraKey = camera.key;
        button.setAttribute('aria-label', `Open ${device.name}, ${camera.name}`); button.draggable = true;
        const thumb = element('span', 'camera-thumbnail' + (offline ? ' offline' : ''));
        const image = element('img'); image.alt = ''; image.hidden = true;
        const placeholder = element('span', 'preview-placeholder'); placeholder.append(icon(offline ? 'offline' : 'camera'));
        const channel = element('span', 'camera-channel', `CH ${String(camera.channel).padStart(2, '0')}`);
        const previewTag = element('span', 'camera-preview-tag', 'NO PREVIEW');
        thumb.append(image, placeholder, channel, previewTag);
        const caption = element('span', 'camera-caption'), status = element('small', 'camera-preview-status');
        const light = element('i', 'status-light'), stateText = element('span'); status.append(light, stateText);
        caption.append(element('strong', '', camera.name), status); button.append(thumb, caption);
        button.onclick = () => this.actions.camera(camera);
        button.ondragstart = event => { event.dataTransfer.setData('application/json', JSON.stringify({ kind: 'camera', key: camera.key })); event.dataTransfer.effectAllowed = 'copy'; };
        const favourite = favourites.includes(camera.key);
        const star = element('button', 'star-button'); star.append(icon('star')); star.type = 'button'; star.title = favourite ? 'Remove favourite' : 'Add favourite'; star.setAttribute('aria-label', `${favourite ? 'Remove' : 'Add'} favourite: ${camera.name}`); star.setAttribute('aria-pressed', String(favourite));
        star.onclick = () => this.actions.favourite(camera.key);
        row.append(button, star); body.append(row);
        this.refs.set(camera.key, { image, placeholder, status, stateText, previewTag, button, row, state, offline });
      }
      strip.append(section);
    }
    this.update(); strip.scrollLeft = scrollLeft;
  }
  update() {
    for (const [key, ref] of this.refs) {
      const preview = this.previews.get(key), live = this.active.has(key) && !ref.offline;
      ref.image.hidden = !preview; ref.placeholder.hidden = Boolean(preview);
      if (preview && ref.image.getAttribute('src') !== preview.url) ref.image.src = preview.url;
      ref.stateText.textContent = ref.offline ? 'Offline' : live ? 'Watching' : ref.state === 'online' ? 'Available' : 'Unknown';
      ref.status.dataset.state = ref.offline ? 'offline' : live ? 'live' : ref.state;
      ref.row.classList.toggle('selected-camera', key === this.selectedKey);
      ref.button.setAttribute('aria-pressed', String(key === this.selectedKey));
      ref.previewTag.textContent = this.previewStates.get(key) === 'loading' ? 'UPDATING' : preview ? ref.offline ? 'LAST SEEN' : 'SNAPSHOT' : ref.offline ? 'OFFLINE' : this.previewStates.get(key) === 'unavailable' ? 'UNAVAILABLE' : 'QUEUED'; ref.previewTag.classList.toggle('live', Boolean(preview && live));
      ref.image.title = preview ? 'Preview updated ' + new Date(preview.at).toLocaleTimeString() : '';
    }
    for (const ref of this.recorders.values()) {
      const previews = ref.cameras.map(camera => this.previews.get(camera.key)).filter(Boolean).sort((a,b) => b.at - a.at), preview = previews[0];
      const live = ref.cameras.filter(camera => this.active.has(camera.key)).length;
      ref.image.hidden = !preview; ref.artwork.hidden = Boolean(preview);
      if (preview && ref.image.getAttribute('src') !== preview.url) ref.image.src = preview.url;
      ref.previewState.textContent = ref.state === 'offline' ? preview ? 'Offline / Last preview' : 'Recorder offline' : live ? `${live} camera${live === 1 ? '' : 's'} streaming` : preview ? 'Last preview ' + new Date(preview.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Snapshots queued / Every 5 min';
    }
  }
  capture(tiles) {
    this.active.clear();
    for (const tile of tiles) {
      if (!tile.camera || !tile.hasFrame || tile.state !== 'playing' || Date.now() - tile.lastFrame > 10000) continue;
      this.active.add(tile.camera.key);
      if (Date.now() - (this.previews.get(tile.camera.key)?.at || 0) < 300000) continue;
      try {
        const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 108;
        const size = pictureSize(tile.width, tile.height, 192, 108, 'fill');
        canvas.getContext('2d').drawImage(tile.image, (192-size.width)/2, (108-size.height)/2, size.width, size.height);
        this.previews.set(tile.camera.key, { url: canvas.toDataURL('image/jpeg', 0.5), at: Date.now() });
        if (this.previews.size > 256) this.previews.delete(this.previews.keys().next().value);
      } catch { /* Keep the previous preview until a drawable frame arrives. */ }
    }
    this.update();
  }
}
