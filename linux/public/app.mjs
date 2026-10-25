import { AdaptiveStreams, adaptiveQuality } from './adaptive.mjs';
import { connectionFeedback } from './connection-feedback.mjs';
import { loading } from './loading.mjs';
import { requestApi } from './api.mjs';
import { CameraAudio } from './audio.mjs';
import { Tile, element } from './tile.mjs';
import { createTileControls, updateTileControls } from './tile-controls.mjs';
import { cameraKey, recorderGrid, retryableStreamError } from './view-model.mjs';
import { BufferedRotation, rotationPages } from './rotation.mjs';
import { PreviewLoader } from './preview-loader.mjs';
import { CameraLibrary } from './library.mjs';
import { snapshot, ClipRecorder } from './recording.mjs';
const $ = id => document.getElementById(id) || selected?.controls?.[id];
const defaultPreferences = () => ({ grid: 4, volume: 0.7, favourites: [], groups: {}, layouts: [], groupFit: 'fit' });
let connectionId, accountId = null, connectionGeneration = 0, preferenceReload = Promise.resolve(), statusSync, recoveryTimer, authorizationState = 'disconnected';
let connected = false, sdkConnected = false, busy = false, devices = [], cameras = [], selected, expanded = null, source, audioSource, preferenceTimer;
let preferences = { grid: 4, volume: 0.7, favourites: [], groups: {}, layouts: [], groupFit: 'fit' }, audioWanted = false, talkSource = null, audioGeneration = 0;
let activeRecorderId = null, recorderRequest = 0, recorderStop = Promise.resolve();
let gridCleanup = Promise.resolve();
let rotationCleanup = Promise.resolve(), maxStreams = 32, warmAudio = null, talk = null, saveQueue = Promise.resolve(), batch = 0, deviceRefresh, errorCheck;
const tiles = [], clips = [];

let adaptive = null, adaptiveScheduled = false, resumeRotation = false, adaptiveSignature = '';
function adaptiveContext() {
  const fullscreenTile = document.fullscreenElement?.classList.contains('camera-tile') ? Number(document.fullscreenElement.dataset.slot) : null;
  return { enabled: connected && sdkConnected, live: Boolean(recorderRoute() && !$('recorder-view-page').hidden), hidden: document.hidden,
    focusedId: fullscreenTile ?? expanded, grid: preferences.grid, selectedId: selected?.id, audioWanted,
    warmIds: new Set(rotation.running ? tiles.slice(preferences.grid).filter(tile => tile.wanted || tile.busy || tile.adaptivePaused).map(tile => tile.id) : []) };
}
function requestAdaptive() {
  if (!adaptive || adaptiveScheduled) return;
  adaptiveScheduled = true;
  queueMicrotask(() => {
    adaptiveScheduled = false; const context = adaptiveContext();
    if ((context.hidden || !context.live) && rotation.running) { resumeRotation = true; void stopRotation({ adaptivePause: true }); }
    else if (!context.hidden && context.live && context.enabled && context.focusedId === null && resumeRotation && !rotation.running) { resumeRotation = false; void startRotation(); }
    const current = adaptiveContext();
    const signature = JSON.stringify([connectionGeneration, current.enabled, current.live, current.hidden, current.focusedId, current.grid, current.selectedId, current.audioWanted, [...current.warmIds], tiles.map(tile => [tile.id, tile.camera?.key, tile.quality, tile.qualityMode, tile.wanted, tile.adaptivePaused, tile.recorder?.active, tile.generation])]);
    if (signature === adaptiveSignature) return; adaptiveSignature = signature;
    void adaptive.reconcile().catch(error => { if (error.code !== 'account-changed') notice(error.message); });
  });
}
function adaptiveStatus(context) {
  const recordings = tiles.filter(tile => tile.recorder?.active).length;
  const manual = visible().some(tile => tile.camera && tile.qualityMode !== 'auto');
  const focus = tiles.find(tile => tile.id === context.focusedId) || visible()[0];
  const focusQuality = focus?.recorder?.active ? focus.quality : adaptiveQuality(focus || {}, context);
  $('adaptive-status').textContent = !context.live || context.hidden ? recordings ? 'Background / recordings kept connected' : context.audioWanted ? 'Background / selected audio on SD' : 'Background cameras paused' : context.focusedId !== null ? `Adaptive / focused camera ${focusQuality.toUpperCase()}` : context.grid === 1 ? `Adaptive / single camera ${focusQuality.toUpperCase()}` : 'Adaptive / grid cameras SD';
  if (context.live && manual) $('adaptive-status').textContent += ' / manual quality overrides';
  if (context.live && recordings) $('adaptive-status').textContent += ' / recording quality kept';
}

let listened = new CameraAudio({ onChange: () => controls(), onError: message => notice(message) });
const library = new CameraLibrary($('devices'), { recorder: id => void openRecorder(id), camera: camera => void focusCamera(camera), favourite: toggleFavourite });
const previewLoader = new PreviewLoader({
  load: camera => api(`/api/previews/frame?deviceId=${encodeURIComponent(camera.device.id)}&channel=${camera.channel}`),
  apply: (key, value) => library.preview(key, value), state: (key, state) => library.previewState(key, state),
  enabled: () => connected && sdkConnected && !document.hidden && !recorderRoute() && !['#/settings', '#/recordings'].includes(location.hash) && !recorderRoute()
});
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
let connectionFailure = null;
function showConnectionFailure(error) {
  const issue = connectionFeedback(error, { browserOnline: navigator.onLine });
  if (!['server', 'provider'].includes(issue.kind)) return; connectionFailure = error;
  $('connection-banner').hidden = false; $('connection-banner').dataset.kind = issue.kind; $('connection-title').textContent = issue.title; $('connection-detail').textContent = issue.detail;
}
function clearConnectionFailure(kind) { if (!$('connection-banner').hidden && (!kind || $('connection-banner').dataset.kind === kind)) { if (connectionFailure?.message && $('notice').textContent === connectionFailure.message) notice(''); $('connection-banner').hidden = true; connectionFailure = null; } }
function tileFailure(tile, error) { const issue = connectionFeedback(error, { recorderStatus: tile.camera?.device.status, browserOnline: navigator.onLine }); tile.message(issue.state, issue.title, issue); return issue; }
function log(type, detail = '') { console.info(`[Camera] ${new Date().toISOString()} ${type}`, detail); }
async function api(route, method = 'GET', data, expected = connectionId) {
  const generation = connectionGeneration;
  try {
    const result = await requestApi(route, method, { body: data, connectionId: expected });
    if (route === '/api/status') clearConnectionFailure('server');
    if (route === '/api/devices') clearConnectionFailure();
    if (generation !== connectionGeneration) { const error = new Error('The camera account changed. Please try again.'); error.code = 'account-changed'; error.status = 409; throw error; }
    return result;
  } catch (error) {
    if (['server-unreachable', 'server-timeout', 'server-error', 'server-response-error', 'browser-offline', 'provider-unavailable', 'provider-timeout', 'provider-response-error', 'provider-access-denied'].includes(error.code) && !route.startsWith('/api/recordings')) showConnectionFailure(error);
    if (['provider-auth-required', 'playback-auth-required', 'account-changed'].includes(error.code)) {
      clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => { if (!busy) void syncProviderStatus(); }, 200);
    }
    throw error;
  }
}
function resetAccountView() {
  adaptive?.cancel(); connectionGeneration++; batch++; recorderRequest++; clearTimeout(preferenceTimer);
  stopRotation({ localOnly: true }); source?.close(); source = null; audioSource?.close(); audioSource = null;
  listened.stop(); audioGeneration++; audioWanted = false; previewLoader.clear(); library.clear();
  for (const tile of tiles) { void stopTile(tile, false); tile.clear(); }
  devices = []; cameras = []; activeRecorderId = null; expanded = null; $('library-refresh-status').hidden = true; document.querySelector('.library-overview').dataset.stale = 'false';
  preferences = defaultPreferences(); $('camera-search').value = ''; $('camera-filter').value = '';
  $('recorder-loading').hidden = true; $('camera-grid').hidden = false; renderCameras(); renderGrid(); renderLayouts();
}
async function syncProviderStatus() {
  if (statusSync) return statusSync;
  statusSync = (async () => {
    const before = connectionId;
    try {
      connection(await api('/api/status'));
      $('nav-account').classList.remove('connection-check-failed');
      if (connected && before !== connectionId) { await preferenceReload; await refreshDevices(false); ensureEvents(); if (recorderRoute()) await restorePage(); }
    } catch (error) { if (error.code !== 'account-changed') { $('nav-account').classList.add('connection-check-failed'); log('connection-check', error.message); } }
  })();
  try { await statusSync; } finally { statusSync = null; }
}
function visible() { return tiles.slice(0, preferences.grid); }
function recorderRoute() {
  const match = location.hash.match(/^#\/recorder\/([^/]+)$/);
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}
function renderPage(device = null) {
  const recordings = location.hash === '#/recordings', settings = location.hash === '#/settings';
  $('clip-panel').hidden = !recordings; $('settings-page').hidden = !settings;
  $('workspace-nav').hidden = false;
  for (const [id, current] of [['nav-cameras', !recordings && !settings], ['nav-recordings', recordings], ['nav-settings', settings]]) { if (current) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  const cameraHref = activeRecorderId ? '#/recorder/' + encodeURIComponent(activeRecorderId) : '#/';
  $('nav-cameras').href = cameraHref; $('recordings-open-cameras').href = cameraHref;
  $('recorder-library-page').hidden = recordings || settings || Boolean(device);
  $('recorder-view-page').hidden = recordings || settings || !device;
  document.body.classList.toggle('recorder-view', Boolean(device));
  requestAdaptive();
  document.title = settings ? 'Settings / Camera workspace' : recordings ? 'Recordings / Camera workspace' : device ? `${device.name} / Live cameras` : 'Hikvision / Linux viewer';
  if (device) {
    $('recorder-page-title').textContent = device.name;
    $('recorder-page-summary').textContent = `${device.channels.length} cameras${device.source === 'shared' ? ' / Shared access' : ''}`;
    $('recorder-page-status').textContent = device.status === 'online' ? 'Online' : device.status === 'offline' ? 'Offline' : 'Unknown';
    $('recorder-page-status').className = 'badge' + (device.status === 'online' ? ' connected' : '');
  }
}
async function restorePage() {
  if (location.hash === '#/settings') { renderPage(); for (const video of $('clips').querySelectorAll('video')) video.pause(); window.scrollTo(0, 0); $('settings-title').focus({ preventScroll: true }); await loadStoredClips(); return; }
  if (location.hash === '#/recordings') { renderPage(); renderClips(); for (const tile of tiles) if (tile.controls?.panel.matches(':popover-open')) tile.controls.panel.hidePopover(); window.scrollTo(0, 0); $('recordings-title').focus({ preventScroll: true }); await loadStoredClips(); return; }
  for (const video of $('clips').querySelectorAll('video')) video.pause();
  const id = recorderRoute();
  if (id && connected) {
    const device = devices.find(device => device.id === id);
    if (!device) { renderPage(); notice('This recorder is unavailable. Refresh your camera library.'); return; }
    if (activeRecorderId === id && visible().some(tile => tile.camera?.device.id === id)) renderPage(device);
    else await openRecorder(id);
    return;
  }
  renderPage(); $('recorder-loading').hidden = true; $('camera-grid').hidden = false; $('camera-grid').setAttribute('aria-busy', 'false');
  recorderRequest++; expanded = null; void stopRotation({ adaptivePause: true });
  $('camera-filter').value = ''; renderCameras(); renderGrid(); requestAdaptive();
}
window.addEventListener('hashchange', () => void restorePage());

function persist() {
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => {
    const value = structuredClone(preferences), owner = connectionId, generation = connectionGeneration;
    saveQueue = saveQueue.catch(() => {}).then(() => { if (generation === connectionGeneration) return api('/api/preferences', 'POST', value, owner); }).catch(() => notice('Viewer settings could not be saved. Try saving again.'));
  }, 300);
}
function organizationFeedback(message = '') { $('organization-feedback').textContent = message; $('organization-feedback').hidden = !message; }
function layoutSelection() {
  const value = $('saved-layouts').value, layout = value === '' ? null : preferences.layouts[Number(value)];
  $('load-layout').disabled = !layout; $('delete-layout').disabled = !layout;
  $('layout-description').textContent = layout ? `${layout.cameras.filter(Boolean).length} cameras / ${layout.grid} tiles` : preferences.layouts.length ? 'Choose a layout to open or delete.' : 'Save a view above to return to it later.';
}
function renderLayouts() {
  const previous = $('saved-layouts').value; $('saved-layouts').replaceChildren(new Option(preferences.layouts.length ? 'Choose a saved layout' : 'No saved layouts yet', ''));
  preferences.layouts.forEach((layout, index) => $('saved-layouts').add(new Option(layout.name, String(index))));
  $('saved-layouts').value = preferences.layouts[Number(previous)] && previous !== '' ? previous : '';
  $('layout-count').textContent = `${preferences.layouts.length} saved`; layoutSelection();
}
$('saved-layouts').onchange = () => { organizationFeedback(); layoutSelection(); };

function renderGrid() {
  $('camera-grid').dataset.count = preferences.grid; $('camera-grid').classList.toggle('expanded', expanded !== null);
  for (const [position, tile] of tiles.entries()) {
    tile.el.hidden = position >= preferences.grid || expanded !== null && tile.id !== expanded || Boolean(activeRecorderId && !tile.camera);
    if (tile.el.hidden && tile.controls?.panel.matches(':popover-open')) tile.controls.panel.hidePopover();
    tile.el.classList.toggle('selected', tile === selected); tile.expand.textContent = expanded === tile.id ? '↙' : '⛶';
    $('camera-grid').append(tile.el); tile.applyPicture();
  }
  $('layout-size').value = String(preferences.grid); controls();
  $('back-to-grid').hidden = expanded === null;
  $('back-to-grid').textContent = `\u2190 Back to ${visible().filter(tile => tile.camera).length} cameras`;
}
function select(tile) {
  if (selected === tile) { library.select(tile.camera?.key); return; }
  stopTalk(); selected = tile; library.select(tile.camera?.key); listened.stop(); audioGeneration++;
  for (const item of tiles) { item.el.classList.toggle('selected', item === tile); if (item !== tile && item.controls?.panel.matches(':popover-open')) item.controls.panel.hidePopover(); }
  controls(); void listenSelected();
}
function controls() {
  if (!selected) return;
  const recorder = devices.find(device => device.id === activeRecorderId);
  if (recorder && recorderRoute() === recorder.id) renderPage(recorder);
  $('viewer-title').textContent = expanded === null && recorder ? recorder.name : selected.camera ? `${selected.camera.device.name} / ${selected.camera.name}` : 'Select a camera';
  $('group-status').textContent = recorder ? `${visible().filter(tile => tile.camera).length} cameras \u00b7 ${visible().filter(tile => tile.state === 'playing').length} live` : '';
  $('live-badge').textContent = `${preferences.grid} tile${preferences.grid > 1 ? 's' : ''}`;
  for (const tile of tiles) updateTileControls(tile, { selected: tile === selected, audioWanted, volume: preferences.volume, talkSource });
  $('organization-camera-name').textContent = selected.camera?.name || 'No camera selected';
  $('organization-recorder-name').textContent = selected.camera?.device.name || 'Select a tile to manage this camera.';
  $('set-camera-group').disabled = !selected.camera;
  $('favourite-selected').setAttribute('aria-pressed', String(Boolean(selected.camera && preferences.favourites.includes(selected.camera.key))));
  $('favourite-selected').disabled = !selected.camera; $('camera-group-name').disabled = !selected.camera;
  if ($('camera-group-name').dataset.camera !== (selected.camera?.key || '')) { $('camera-group-name').dataset.camera = selected.camera?.key || ''; $('camera-group-name').value = preferences.groups[selected.camera?.key] || ''; }
  $('favourite-selected').textContent = selected.camera && preferences.favourites.includes(selected.camera.key) ? '★ Favourite' : '☆ Favourite';
  $('start-all').disabled = !connected || !sdkConnected; $('stop-all').disabled = !connected; requestAdaptive();
}
function connection(status) {
  const changed = connectionId !== undefined && status.connectionId !== undefined && connectionId !== status.connectionId;
  const switched = changed && accountId !== status.accountId;
  if (changed || status.authorizationState === 'reconnect-required' && connected) {
    resetAccountView();
    if (switched && recorderRoute()) history.replaceState(null, '', '#/');
  }
  connectionId = status.connectionId ?? null; accountId = status.accountId ?? null;
  authorizationState = status.authorizationState || (status.connected ? status.sdkConnected ? 'ready' : 'playback-required' : 'disconnected');
  if (changed && status.connected) {
    const generation = connectionGeneration;
    preferenceReload = api('/api/preferences').then(value => { if (generation !== connectionGeneration) return; preferences = { ...defaultPreferences(), ...value }; renderLayouts(); renderGrid(); $('group-picture-fit').value = preferences.groupFit; }).catch(error => { if (generation === connectionGeneration) notice(error.message); });
  }
  const recovery = authorizationState === 'reconnect-required' || authorizationState === 'playback-required';
  $('account-recovery').hidden = !recovery; $('nav-account').dataset.recovery = String(recovery);
  $('recovery-title').textContent = authorizationState === 'reconnect-required' ? 'Your Hik-Connect sign-in expired' : 'Camera playback needs authorization';
  $('recovery-description').textContent = authorizationState === 'reconnect-required' ? 'Sign in again to reconnect your cameras. Your viewer login and saved camera layouts are kept.' : 'Your camera account is connected, but its playback authorization is missing or expired. Cameras will not keep retrying until playback access is restored.';
  $('recovery-detail').hidden = authorizationState !== 'playback-required';
  $('recovery-detail').textContent = status.playbackRecovery === 'installed-client' ? 'Sign into the matching Hik-Connect account in iVMS on this PC, then check playback access here.' : 'This Linux viewer cannot currently create a new playback authorization from a web ID and password. A valid playback authorization for this account is required; signing into the web account alone does not create it.';
  $('recovery-playback').hidden = authorizationState !== 'playback-required' || status.playbackRecovery !== 'installed-client';
  if (!status.sdkConnected && sdkConnected && status.connected) {
    stopRotation(); for (const tile of tiles) if (tile.camera) { void stopTile(tile, false); tileFailure(tile, { code: 'playback-auth-required' }); }
  }

  if (Number.isInteger(status.maxStreams)) maxStreams = status.maxStreams;
  connected = Boolean(status.connected); sdkConnected = Boolean(status.sdkConnected); if ('talkSource' in status) talkSource = status.talkSource;
  $('workspace-nav').hidden = false; $('nav-account').hidden = false; $('nav-account-status').textContent = authorizationState === 'reconnect-required' ? 'Reconnect needed' : authorizationState === 'playback-required' ? 'Playback needed' : connected ? 'Connected' : 'Not connected'; $('nav-account').dataset.connected = String(connected);
  $('connection-badge').textContent = authorizationState === 'reconnect-required' ? 'Reconnect needed' : connected ? 'Connected' : 'Not connected'; $('connection-badge').className = 'badge' + (connected ? ' connected' : '');
  $('connect-label').textContent = 'Sign in to Hik-Connect'; $('connect-description').textContent = connected ? 'Reconnect or use another account' : 'Connect your recorders and cameras'; $('account-empty').hidden = connected; $('account-playback').hidden = !connected; $('profile-initial').textContent = (status.user?.email || status.user?.username || 'H').charAt(0).toUpperCase(); $('disconnect').hidden = !status.connectionId;
  $('account').hidden = !status.user; $('account-name').textContent = status.user?.email || status.user?.username || 'Hik-Connect account'; $('account-region').textContent = status.user?.country || '';
  $('playback-title').textContent = sdkConnected ? 'Playback access saved' : 'Video authorization needed'; $('account-playback').dataset.ready = String(sdkConnected);
  $('playback-auth').textContent = connected ? sdkConnected ? 'Checked when a camera starts.' : 'Sign-in alone has not enabled video.' : '';
  if (!connected) { renderPage(); stopRotation({ localOnly: true }); recorderRequest++; activeRecorderId = null; previewLoader.clear(); library.clear(); source?.close(); source = null; audioSource?.close(); audioSource = null; for (const tile of tiles) stopTile(tile, false); devices = []; cameras = []; renderCameras(); }
  setBusy(busy); controls();
}
function setBusy(value) { busy = value; $('connect').disabled = value; $('disconnect').disabled = value; $('provider-submit').disabled = value; $('provider-account').disabled = value; $('provider-password').disabled = value; $('provider-form').setAttribute('aria-busy', String(value)); $('provider-submit').textContent = value ? 'Signing in…' : 'Sign in'; $('refresh').disabled = value || !connected; }
function filteredCameras() {
  const search = $('camera-search').value.trim().toLocaleLowerCase(), group = $('camera-filter').value;
  return cameras.filter(camera => (!search || `${camera.device.name} ${camera.name} ${preferences.groups[camera.key] || ''}`.toLocaleLowerCase().includes(search)) &&
    (!group || group === 'favourites' && preferences.favourites.includes(camera.key) || group.startsWith('recorder:') && camera.device.id === group.slice(9) || group.startsWith('group:') && preferences.groups[camera.key] === group.slice(6)));
}
let libraryLoading = false;
function renderCameras() {
  const previous = $('camera-filter').value;
  $('camera-filter').replaceChildren(new Option('All cameras', ''), new Option('Favourites', 'favourites'));
  for (const device of devices) $('camera-filter').add(new Option(device.name, 'recorder:' + device.id));
  for (const group of [...new Set(Object.values(preferences.groups).filter(Boolean))].sort()) $('camera-filter').add(new Option(group, 'group:' + group));
  if ([...$('camera-filter').options].some(option => option.value === previous)) $('camera-filter').value = previous;
  const onlineCount = devices.filter(device => device.status === 'online').length;
  $('library-online').textContent = `${onlineCount} online`; $('library-offline').textContent = `${devices.filter(device => device.status === 'offline').length} offline`;
  const filtered = filteredCameras(), showAllRecorders = !$('camera-search').value && (!$('camera-filter').value || $('camera-filter').value.startsWith('recorder:')); $('devices').replaceChildren();
  const hasResults = Boolean(filtered.length || showAllRecorders && devices.length);
  $('device-count').textContent = `${devices.length} recorders / ${cameras.length} cameras`; $('devices').hidden = !hasResults; $('device-empty').hidden = hasResults || libraryLoading;
  $('empty-title').textContent = !connected ? 'Connect your Hik-Connect account.' : cameras.length ? 'No cameras match this filter.' : 'No camera channels are available.';
  $('empty-detail').textContent = !connected ? 'Your saved connection and shared cameras will appear here.' : 'Refresh the device list or change the search and group.';
  library.render(devices, filtered, preferences.favourites, activeRecorderId, Boolean($('camera-search').value || ['favourites'].includes($('camera-filter').value) || $('camera-filter').value.startsWith('group:')), showAllRecorders); library.select(selected?.camera?.key); previewLoader.sync(cameras);
}
function toggleFavourite(key) { preferences.favourites = preferences.favourites.includes(key) ? preferences.favourites.filter(value => value !== key) : [...preferences.favourites, key]; persist(); renderCameras(); controls(); }
async function openRecorder(id, focusKey = null) {
  const device = devices.find(device => device.id === id); if (!device) return;
  if (activeRecorderId === id && visible().some(tile => tile.camera?.device.id === id)) {
    const route = '#/recorder/' + encodeURIComponent(id); if (location.hash !== route) history.pushState(null, '', route);
    const focus = focusKey ? visible().find(tile => tile.camera?.key === focusKey) : null;
    expanded = focus?.id ?? null; if (focus) select(focus); renderPage(device); renderGrid(); window.scrollTo(0, 0); requestAdaptive(); return;
  }
  const request = ++recorderRequest, delivery = selected.delivery;
  const route = '#/recorder/' + encodeURIComponent(id);
  if (location.hash !== route) history.pushState(null, '', route);
  renderPage(device); $('recorder-loading').hidden = false; $('recorder-loading').querySelector('span').textContent = `Preparing ${device.name} cameras...`; $('camera-grid').hidden = true; $('camera-grid').setAttribute('aria-busy', 'true');
  try {
  window.scrollTo(0, 0); $('recorder-page-title').focus({ preventScroll: true });
  batch++; stopRotation();
  $('camera-search').value = ''; $('camera-filter').value = 'recorder:' + id; renderCameras();
  // Serialize the stop barrier; old startup requests are cancelled before the
  // new recorder is assigned. Do not serialize slow camera connections.
  recorderStop = recorderStop.catch(() => {}).then(async () => { await gridCleanup; if (request === recorderRequest) await stopAll(false); });
  await recorderStop; if (request !== recorderRequest || !connected) return;
  activeRecorderId = id;
  const pool = cameras.filter(camera => camera.device.id === id), layout = recorderGrid(pool.length);
  preferences.grid = layout.grid; expanded = null;
  for (const tile of tiles) tile.clear();
  pool.slice(0, layout.count).forEach((camera, index) => {
    const tile = tiles[index]; tile.delivery = delivery; tile.assign(camera, layout.count === 1 ? 'hd' : 'sd'); tile.fit = preferences.groupFit;
    tile.message('connecting', 'Waiting to connect...');
    if (device.status === 'offline') tileFailure(tile, { code: 'recorder-offline' });
  });
  const focus = focusKey ? visible().find(tile => tile.camera?.key === focusKey) : null;
  select(focus || tiles[0]); if (focus) expanded = focus.id;
  renderGrid(); renderCameras(); persist();
  if (pool.length > 16) notice(`Showing the first 16 of ${pool.length} channels.`);
  else notice(device.status === 'offline' ? `${device.name} is offline.` : '');
  if (device.status !== 'offline' && layout.count) {
    if (!sdkConnected) { for (const tile of visible()) if (tile.camera) tileFailure(tile, { code: 'playback-auth-required' }); }
    else void startAll(false);
  }
  log('recorder', `${device.name}: ${layout.count} channels assigned automatically`);
  } finally { if (request === recorderRequest) { $('recorder-loading').hidden = true; $('camera-grid').hidden = false; $('camera-grid').setAttribute('aria-busy', 'false'); } }
}
async function focusCamera(camera) {
  stopRotation();
  const tile = visible().find(tile => tile.camera?.key === camera.key);
  if (tile && activeRecorderId === camera.device.id) {
    const route = '#/recorder/' + encodeURIComponent(camera.device.id);
    if (location.hash !== route) history.pushState(null, '', route);
    renderPage(camera.device); select(tile); expanded = tile.id; renderGrid(); window.scrollTo(0, 0); return;
  }
  await openRecorder(camera.device.id, camera.key);
}
async function refreshDevices(show = true) {
  if (!connected) return false; if (deviceRefresh) return deviceRefresh;
  const finishLoading = show ? loading('Refreshing recorders...') : () => {};
  if (show) { setBusy(true); libraryLoading = true; $('library-loading').hidden = false; $('recorder-library-page').setAttribute('aria-busy', 'true'); $('device-empty').hidden = true; $('refresh').textContent = 'Refreshing...'; $('recorder-refresh').textContent = 'Refreshing...'; $('recorder-refresh').disabled = true; }
  deviceRefresh = (async () => {
  try {
    connection(await api('/api/status'));
    await preferenceReload;
    if (!connected) return false;
    const generation = connectionGeneration, result = await api('/api/devices'); if (generation !== connectionGeneration) return false; devices = result.devices;
    cameras = devices.flatMap(device => (device.channels || []).map(channel => ({ device, deviceId: device.id, channel: channel.number, name: channel.name, key: cameraKey({ deviceId: device.id, channel: channel.number }) })));
    for (const tile of tiles) if (tile.camera) { const current = cameras.find(camera => camera.key === tile.camera.key); if (current) tile.camera = current; else { void stopTile(tile, false); tileFailure(tile, { code: 'channel-unavailable' }); } }
    $('library-refresh-status').hidden = true; document.querySelector('.library-overview').dataset.stale = 'false'; renderCameras(); $('last-checked').textContent = 'Checked ' + new Date(result.checkedAt).toLocaleTimeString();
    if (show) log('devices', `${devices.length} recorders, ${cameras.length} camera channels`); return true;
  } catch (error) { if ([401,409].includes(error.status)) { try { connection(await api('/api/status')); } catch (error) { for (const tile of tiles) if (tile.wanted) tileFailure(tile, error); } } $('library-refresh-status').hidden = false; $('library-refresh-status').textContent = devices.length ? 'Refresh failed / showing last checked devices' : 'Could not load camera status'; document.querySelector('.library-overview').dataset.stale = String(Boolean(devices.length)); if (show) notice(error.message); return false; }
  finally { finishLoading(); if (show) { libraryLoading = false; $('library-loading').hidden = true; $('recorder-library-page').setAttribute('aria-busy', 'false'); $('refresh').textContent = 'Refresh'; $('recorder-refresh').textContent = 'Refresh status'; $('recorder-refresh').disabled = false; setBusy(false); renderCameras(); } }
  })();
  try { return await deviceRefresh; } finally { deviceRefresh = null; }
}
function ensureEvents() {
  if (source || !connected) return;
  source = new EventSource('/api/live/events?audio=separate&connection=' + encodeURIComponent(connectionId || ''));
  source.addEventListener('frame', event => { try { const packet = JSON.parse(event.data); tiles.find(tile => tile.id === packet.slot)?.frame(packet); } catch {} });
  audioSource = new EventSource('/api/live/audio-events?connection=' + encodeURIComponent(connectionId || ''));
  audioSource.addEventListener('audio', event => { try {
    const packet = JSON.parse(event.data), tile = tiles.find(tile => tile.id === packet.slot);
    if (!tile?.camera || tile.camera.device.id !== packet.deviceId || tile.camera.channel !== packet.channel) return;
    if (tile === selected && audioWanted && listened.enabled) listened.play(packet);
    if (warmAudio?.slot === tile.id && audioWanted) warmAudio.player.play(packet);
    if (tile?.recorder?.active) tile.recorder.audio?.play(packet);
  } catch {} });
  audioSource.onopen = () => void updateAudioFocus();
  source.addEventListener('states', event => {
    let states; try { states = JSON.parse(event.data); } catch { return; }
    for (const tile of tiles) {
      if (!tile.wanted || tile.busy) continue;
      const status = states.find(status => status.slot === tile.id);
      if (status?.state === 'playing') {
        if (status.deviceId !== tile.camera?.device.id || status.channel !== tile.camera?.channel) continue;
        const stats = status.videoStats;
        tile.status = status; tile.retry.reset(); tile.message('playing', `${status.codec || 'Video'} · ${status.width} × ${status.height} · ${tile.quality.toUpperCase()}${stats ? ` · ${stats.outputFps} fps · ~${stats.videoKBps} KB/s video` : ''}`);
      } else queueRetry(tile, { message: status?.error || 'Video connection interrupted.', code: status?.errorCode || 'stream-interrupted' });
    }
    controls();
  });
  source.onerror = () => {
    stopTalk(); for (const tile of tiles) if (tile.wanted) { tile.smooth.reset(); tileFailure(tile, { code: 'stream-interrupted', message: 'The video connection was interrupted. Checking the server connection...' }); }
    if (!errorCheck) errorCheck = setTimeout(async () => { errorCheck = null; try { connection(await api('/api/status')); } catch (error) { for (const tile of tiles) if (tile.wanted) tileFailure(tile, error); } }, 2000);
  };
  source.onopen = () => { clearConnectionFailure('server'); clearTimeout(errorCheck); errorCheck = null; void updateAudioFocus(); if (audioWanted && !listened.enabled) void listenSelected(); };
}
async function assign(tile, camera, quality, choose = true, valid = () => true, qualityMode) {
  if (!tile || !camera || !connected) return;
  quality ||= adaptiveQuality({ id: tile.id, qualityMode: tile.camera?.key === camera.key ? tile.qualityMode : 'auto' }, adaptiveContext());
  if (choose && activeRecorderId && activeRecorderId !== camera.device.id) { activeRecorderId = null; renderCameras(); }
  const stopping = stopTile(tile), generation = tile.generation;
  await stopping; if (generation !== tile.generation || !valid()) return;
  tile.assign(camera, quality); if (qualityMode) tile.qualityMode = qualityMode; if (choose) select(tile); controls();
  if (!sdkConnected) {
    try { connection(await api('/api/status')); }
    catch (error) { notice(error.message); return; }
    if (generation !== tile.generation || !valid() || !connected) return;
  }
  if (!sdkConnected) { tileFailure(tile, { code: 'playback-auth-required' }); return; }
  tile.wanted = true; ensureEvents(); await startTile(tile);
}
async function startTile(tile) {
  if (!tile.wanted || tile.busy || !connected || !sdkConnected) return;
  const generation = tile.generation; tile.busy = true; tile.busyGeneration = generation; tile.retry.stop(); tile.message('connecting', 'Connecting to camera…');
  tile.smooth.reset();
  try {
    if (tile.camera.device.status === 'offline') throw Object.assign(new Error('Hik-Connect reports this recorder offline.'), { code: 'recorder-offline', status: 409 });
    const status = await api('/api/live/start', 'POST', { slot: tile.id, deviceId: tile.camera.device.id, channel: tile.camera.channel, quality: tile.quality, delivery: tile.delivery });
    if (generation !== tile.generation || !tile.wanted) return;
    tile.status = status; tile.retry.reset(); tile.message('playing', `${status.codec || 'Video'} · ${tile.quality.toUpperCase()}`);
    if (selected === tile && audioWanted) await listenSelected();
    else if (warmAudio?.slot === tile.id) await updateAudioFocus();
  } catch (error) {
    if (generation === tile.generation && tile.wanted) {
      const issue = connectionFeedback(error, { recorderStatus: tile.camera?.device.status, browserOnline: navigator.onLine });
      if (!issue.retry || !retryableStreamError(error)) { tile.wanted = false; tileFailure(tile, error); }
      else queueRetry(tile, error);
    }
  } finally { if (tile.busyGeneration === generation) { tile.busy = false; tile.busyGeneration = null; } controls(); }
}
function queueRetry(tile, error) {
  if (!tile.wanted || !connected || !sdkConnected) return;
  tile.recorder?.stop(); if (tile === selected) listened.stop();
  const issue = tileFailure(tile, error);
  if (!issue.retry) { tile.wanted = false; tile.retry.stop(); return; }
  const delay = tile.retry.queue(async () => {
    if (!tile.wanted) return;
    if (!navigator.onLine) { queueRetry(tile, { code: 'browser-offline' }); return; }
    const refreshed = await refreshDevices(false); if (!tile.wanted || !connected || !sdkConnected) return;
    if (!refreshed && connectionFailure) { queueRetry(tile, connectionFailure); return; }
    await startTile(tile);
  });
  if (delay) tile.retryAt = Date.now() + delay;
  if (tile.retryAt) tile.footer.textContent = `${issue.title}. Retrying in ${Math.max(1, Math.ceil((tile.retryAt - Date.now()) / 1000))}s.`;
}
async function recoverTile(tile, action) {
  if (!tile.camera) return;
  if (action === 'reauthorize') { $('connect').click(); return; }
  if (action === 'viewer-sign-in') { location.reload(); return; }
  if (action === 'playback') { await syncProviderStatus(); if (connected && sdkConnected && tile.camera) { tile.wanted = true; ensureEvents(); await startTile(tile); } else if (!$('account-recovery').hidden) $('account-recovery').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  tile.feedbackAction.disabled = true; const key = tile.camera.key, generation = tile.generation;
  try {
    await syncProviderStatus();
    if (connectionFailure && connectionFeedback(connectionFailure).kind === 'server') { tileFailure(tile, connectionFailure); return; }
    if (!connected || !sdkConnected) { tileFailure(tile, { code: connected ? 'playback-auth-required' : 'provider-auth-required' }); return; }
    if ((action === 'refresh' || connectionFailure) && !await refreshDevices()) { if (connectionFailure) tileFailure(tile, connectionFailure); return; }
    if (tile.generation !== generation || tile.camera?.key !== key) return;
    if (action === 'sd') { tile.qualityMode = 'sd'; await assign(tile, tile.camera, 'sd'); return; }
    tile.retry.reset(); tile.wanted = true; ensureEvents(); await startTile(tile);
  } finally { tile.feedbackAction.disabled = false; }
}

async function stopTile(tile, send = true, { adaptivePause = false } = {}) {
  const owner = connectionId;
  if (!adaptivePause) tile.adaptivePaused = false;
  tile.busy = false; tile.busyGeneration = null;
  const focused = tile === selected || tile.recorder?.active || warmAudio?.slot === tile.id;
  tile.generation++; tile.wanted = false; tile.retry.reset(); tile.recorder?.stop();
  tile.smooth.reset();
  if (tile === selected) { stopTalk(); listened.stop(); audioGeneration++; }
  tile.hasFrame = false; tile.image.removeAttribute('src'); tile.message('stopped', tile.camera ? 'Stopped. Click Start all to resume assigned cameras.' : 'Choose a camera for this tile.');
  if (send && connected) { tile.stopBarrier = (tile.stopBarrier || Promise.resolve()).catch(() => {}).then(async () => { if (owner === connectionId) { try { await api('/api/live/stop', 'POST', { slot: tile.id }, owner); } catch {} } }); await tile.stopBarrier; }
  if (focused) void updateAudioFocus();
}
async function stopAll(cancelRecorder = true) { if (cancelRecorder) { recorderRequest++; $('recorder-loading').hidden = true; $('camera-grid').hidden = false; $('camera-grid').setAttribute('aria-busy', 'false'); } batch++; await stopRotation(); for (const tile of tiles) void stopTile(tile, false); if (connected) { try { await api('/api/live/stop-all', 'POST'); } catch (error) { notice(error.message); } } }
async function concurrent(items, callback) { const queue = [...items]; await Promise.all([0,1].map(async () => { while (queue.length) await callback(queue.shift()); })); }
async function startAll(fillEmpty = true) {
  if (!connected || !sdkConnected) return;
  batch++; ensureEvents();
  const pool = filteredCameras().filter(camera => camera.device.status === 'online' && !visible().some(tile => tile.camera?.key === camera.key)); let index = 0;
  for (const tile of visible()) {
    if (!tile.camera && fillEmpty && index < pool.length) tile.assign(pool[index++], preferences.grid === 1 ? 'hd' : 'sd');
    if (!tile.camera || tile.wanted) continue;
    tile.adaptivePaused = true;
    tile.message('connecting', 'Preparing camera playback...');
  }
  await adaptive.reconcile();
}

async function updateAudioFocus() {
  if (!connected || !source) return;
  const ids = tiles.filter(tile => tile.recorder?.active && tile.recorder.audio?.enabled).map(tile => tile.id);
  if (audioWanted && selected?.state === 'playing') ids.push(selected.id);
  if (audioWanted && warmAudio && ids.length < 5) ids.push(warmAudio.slot);
  try { await api('/api/live/audio-focus', 'POST', { slots: [...new Set(ids)] }); } catch {}
}
async function listenSelected() {
  const generation = ++audioGeneration; listened.stop();
  if (!audioWanted || !selected || selected.state !== 'playing' || talk) { void updateAudioFocus(); return; }
  try { listened.setVolume(preferences.volume); await listened.start({ external: true, bufferDelay: selected.delivery === 'smooth' ? 0.9 : 0.2 }); if (generation !== audioGeneration) return; await updateAudioFocus(); }
  catch (error) { notice(error.message); }
}
function clearWarmAudio() { warmAudio?.player.stop(); warmAudio = null; }
async function warmSelectedAudio(stage) {
  clearWarmAudio();
  const entry = stage[Math.min(visible().indexOf(selected), stage.length - 1)];
  if (!audioWanted || !entry || tiles.filter(tile => tile.recorder?.active).length >= 4) return;
  const candidate = warmAudio = { slot: entry.tile.id, player: new CameraAudio() };
  candidate.player.setVolume(0);
  try {
    await candidate.player.start({ external: true, bufferDelay: entry.delivery === 'smooth' ? 0.9 : 0.2 });
    if (warmAudio !== candidate) { candidate.player.stop(); return; }
    await updateAudioFocus();
  } catch { if (warmAudio === candidate) clearWarmAudio(); }
}
const rotation = new BufferedRotation({
  prepare: async (page, valid) => {
    await rotationCleanup;
    if (!valid()) return [];
    const hidden = tiles.slice(preferences.grid), available = [...hidden];
    const stage = page.map((camera, index) => {
      const model = visible()[index], quality = model ? adaptiveQuality(model, { focusedId: null, grid: preferences.grid }) : preferences.grid === 1 ? 'hd' : 'sd', delivery = model?.delivery || selected.delivery;
      let tile = available.find(tile => tile.camera?.key === camera.key && tile.quality === quality && tile.delivery === delivery);
      tile ||= available[0]; available.splice(available.indexOf(tile), 1);
      return { tile, camera, quality, delivery, qualityMode: model?.qualityMode || 'auto' };
    });
    const unused = available.filter(tile => tile.wanted || tile.camera);
    for (const tile of unused) { void stopTile(tile, false); tile.clear(); }
    if (unused.length) await api('/api/live/stop-slots', 'POST', { slots: unused.map(tile => tile.id) });
    if (!valid()) return stage;
    void concurrent(stage, async entry => {
      if (!valid()) return;
      const { tile, camera, quality, delivery } = entry;
      tile.fit = preferences.groupFit;
      if (tile.camera?.key === camera.key && tile.quality === quality && tile.delivery === delivery && tile.wanted) return;
      tile.delivery = delivery;
      await assign(tile, camera, quality, false, valid, entry.qualityMode);
    }).catch(error => { if (valid()) notice(error.message); });
    void warmSelectedAudio(stage);
    return stage;
  },
  ready: ({ tile, camera, quality, delivery }) => tile.camera?.key === camera.key && tile.quality === quality && tile.delivery === delivery && tile.wanted && tile.state === 'playing' && tile.hasFrame && Date.now() - tile.lastFrame < 3000 && (delivery !== 'smooth' || !tile.smooth.fallback || tile.smooth.fallback.video?.readyState >= 3 && !tile.smooth.fallback.video.paused),
  swap: stage => {
    const old = visible(), position = Math.max(0, old.indexOf(selected)), incoming = stage.map(entry => entry.tile);
    stopTalk(); for (const tile of old) tile.recorder?.stop();
    const rest = tiles.filter(tile => !incoming.includes(tile));
    // A short final batch gets genuinely empty slots, never old page pictures.
    const blanks = rest.filter(tile => !old.includes(tile)).slice(0, preferences.grid - incoming.length);
    for (const tile of blanks) tile.clear();
    const front = [...incoming, ...blanks];
    tiles.splice(0, tiles.length, ...front, ...rest.filter(tile => !blanks.includes(tile)));
    selected = incoming[Math.min(position, incoming.length - 1)]; expanded = null;
    listened.stop(); audioGeneration++;
    if (audioWanted && warmAudio?.slot === selected.id && warmAudio.player.enabled && warmAudio.player.packets) {
      listened = warmAudio.player; warmAudio = null; listened.onChange = () => controls(); listened.onError = notice; listened.setVolume(preferences.volume);
    } else { clearWarmAudio(); void listenSelected(); }
    library.select(selected.camera?.key); renderGrid(); void updateAudioFocus(); log('rotation', `${incoming.length} preloaded cameras shown`);
  },
  report: status => {
    $('rotation-status').textContent = status.phase === 'error' ? status.message : status.phase === 'ready' ? `Next ${status.total} cameras ready \u00b7 switching in ${Math.ceil(status.remaining / 1000)}s` : `${status.phase === 'waiting' ? 'Waiting for' : 'Preparing'} next cameras \u00b7 ${status.ready}/${status.total} ready`;
    if (status.phase === 'error') { notice(status.message); queueMicrotask(() => void stopRotation()); }
  }
});
function stopRotation({ localOnly = false, adaptivePause = false } = {}) {
  if (!adaptivePause) resumeRotation = false;
  const owner = connectionId;
  rotation.stop(); clearWarmAudio(); void updateAudioFocus();
  $('cycle-toggle').textContent = 'Start rotation'; $('cycle-toggle').setAttribute('aria-pressed', 'false'); $('rotation-status').textContent = '';
  const hidden = tiles.slice(preferences.grid), ids = hidden.filter(tile => tile.wanted || tile.busy || tile.camera).map(tile => tile.id);
  for (const tile of hidden) { void stopTile(tile, false); tile.clear(); }
  rotationCleanup = rotationCleanup.catch(() => {}).then(async () => { if (!localOnly && connected && ids.length) await api('/api/live/stop-slots', 'POST', { slots: ids }, owner); }).catch(error => notice(error.message));
  return rotationCleanup;
}
async function startRotation() {
  await stopRotation(); const generation = rotation.generation;
  if (!connected || !sdkConnected) { notice('Connect account and playback access first.'); return; }
  await refreshDevices(false); if (generation !== rotation.generation) return;
  const pages = rotationPages(filteredCameras().filter(camera => camera.device.status === 'online'), preferences.grid);
  if (pages.length < 2) { notice('These cameras fit in one grid. Choose a smaller grid or a larger camera group to rotate.'); return; }
  const required = Math.max(visible().filter(tile => tile.wanted).length, ...pages.map(page => page.length)) + Math.max(...pages.map(page => page.length));
  if (required > maxStreams) { notice(`Preloading this grid needs up to ${required} connections. Choose a smaller grid or increase MAX_LIVE_STREAMS (currently ${maxStreams}).`); return; }
  const current = pages.findIndex(page => page.length === visible().filter(tile => tile.camera).length && page.every((camera, index) => visible()[index]?.camera?.key === camera.key));
  expanded = null; renderGrid(); notice('');
  $('cycle-toggle').textContent = 'Stop rotation'; $('cycle-toggle').setAttribute('aria-pressed', 'true');
  rotation.start(pages, current, Number($('cycle-seconds').value) * 1000);
}
function expand(tile) { stopRotation(); expanded = expanded === tile.id ? null : tile.id; select(tile); renderGrid(); }
async function resizeGrid(count, startAdded = true) {
  if (![1,4,9,16].includes(count)) return;
  const request = ++recorderRequest, owner = connectionId; batch++;
  const previousCount = preferences.grid, stoppingRotation = stopRotation();
  expanded = null; preferences.grid = count;
  $('recorder-loading').hidden = true; $('camera-grid').hidden = false; $('camera-grid').setAttribute('aria-busy', 'false');
  const hidden = tiles.slice(count).filter(tile => tile.wanted || tile.busy || tile.state === 'playing');
  const ids = hidden.map(tile => tile.id);
  for (const tile of hidden) void stopTile(tile, false);
  const added = [];
  if (activeRecorderId && startAdded) {
    const pool = cameras.filter(camera => camera.device.id === activeRecorderId);
    const used = new Set(visible().filter(tile => tile.camera).map(tile => tile.camera.key));
    for (const tile of visible()) {
      if (!tile.camera) {
        const camera = pool.find(camera => !used.has(camera.key));
        if (camera) { used.add(camera.key); tile.assign(camera, 'sd'); tile.fit = preferences.groupFit; }
      }
      if (tile.camera && (tiles.indexOf(tile) >= previousCount || tile.state === 'connecting' && !tile.wanted)) added.push(tile);
    }
  }
  if (!visible().includes(selected)) select(tiles[0]);
  renderGrid(); persist();
  for (const tile of added) { if (tile.camera.device.status === 'offline') tileFailure(tile, { code: 'recorder-offline' }); else if (!sdkConnected) tileFailure(tile, { code: 'playback-auth-required' }); else tile.message('connecting', 'Waiting to connect...'); }
  gridCleanup = gridCleanup.catch(() => {}).then(async () => {
    await stoppingRotation;
    if (connected && owner === connectionId && ids.length) await api('/api/live/stop-slots', 'POST', { slots: ids }, owner);
  }).catch(error => notice(error.message));
  await gridCleanup;
  if (request !== recorderRequest || !connected || !sdkConnected || !startAdded) return;
  ensureEvents();
  for (const tile of added) {
    if (request !== recorderRequest || !visible().includes(tile) || tile.camera?.device.status === 'offline') continue;
    tile.adaptivePaused = true;
  }
  await adaptive.reconcile();
}

async function recordSelected() {
  const tile = selected;
  if (tile.recorder?.active) { tile.recorder.stop(); controls(); renderClips(); return; }
  if (tiles.filter(tile => tile.recorder?.active).length >= 4 || clips.filter(clip => !clip.saved).length >= 12 || clips.reduce((sum, clip) => sum + (clip.blob?.size || 0), 0) > 256 * 1024 * 1024) { notice('Download or remove saved clips before starting more recordings. Up to four clips can record at once.'); return; }
  const recordingCamera = tile.camera;
  const recorder = tile.recorder = new ClipRecorder({
    onComplete: (blob, meta) => { const clip = { id: recordingId(), blob, size: blob.size, meta, url: URL.createObjectURL(blob), cameraName: recordingCamera.name, recorderName: recordingCamera.device.name, createdAt: Date.now(), saved: false }; clips.push(clip); renderClips(); controls(); void updateAudioFocus(); void saveClip(clip); },
    onError: notice,
    onBytes: () => { if (clips.reduce((sum, clip) => sum + (clip.blob?.size || 0), 0) + tiles.reduce((sum, tile) => sum + (tile.recorder?.active ? tile.recorder.bytes : 0), 0) > 256 * 1024 * 1024) { for (const item of tiles) item.recorder?.stop(); notice('Recording storage limit reached. Download or remove the saved clips to continue.'); } }
  });
  try {
    await recorder.start(tile.image, tile.width, tile.height, tile.camera.name, tile.status?.audioState === 'available');
    await updateAudioFocus(); controls(); renderClips(); toast('Recording started.', { action: () => { location.hash = '#/recordings'; } }); log('recording', 'Clip recording started.');
  } catch (error) { notice(error.message); tile.recorder = null; controls(); }
}

let storageSummary = null, recordingsLoaded = false, recordingsRequest, storageRevision = 0, storageDirty = false;
function storageSize(bytes) { if (!Number.isFinite(bytes)) return '--'; return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function renderStorage(value) {
  if (!value) return; storageSummary = value;
  const percentage = Math.min(100, value.usedBytes / value.maxBytes * 100);
  $('storage-used').textContent = storageSize(value.usedBytes); $('storage-limit').textContent = storageSize(value.maxBytes);
  $('storage-clips').textContent = `${value.clipCount} saved recording${value.clipCount === 1 ? '' : 's'}`;
  $('storage-available').textContent = `${storageSize(value.availableBytes)} available within your limit`;
  $('storage-retention').textContent = ({1:'1 day',7:'7 days',30:'1 month',90:'3 months'})[value.retentionDays];
  $('storage-meter-label').textContent = `${storageSize(value.usedBytes)} of ${storageSize(value.maxBytes)} occupied`;
  $('storage-percentage').textContent = `${percentage.toFixed(1)}%`; $('storage-meter').value = percentage;
  $('storage-cleanup-time').textContent = value.lastCleanupAt ? 'Last cleanup ' + new Date(value.lastCleanupAt).toLocaleString() : 'Automatic cleanup runs every minute.';
  if (!storageDirty) {
    const radio = document.querySelector(`input[name=retention][value="${value.retentionDays}"]`); if (radio) radio.checked = true;
    $('storage-limit-input').value = String(value.maxBytes / 1073741824);
  }
  $('storage-save').disabled = false;
}
function storedClip(value) { return { ...value, meta: { name: value.name, duration: value.duration, audio: value.audio }, saved: true }; }
async function loadStoredClips() {
  if (recordingsRequest) return recordingsRequest;
  $('recordings-loading').hidden = false; $('storage-loading').hidden = false;
  if (!recordingsLoaded) $('recordings-empty').hidden = true;
  const revision = storageRevision;
  recordingsRequest = (async () => {
    try {
      const result = await api('/api/recordings');
      if (revision !== storageRevision) return;
      const pending = clips.filter(clip => !clip.saved), ids = new Set(pending.map(clip => clip.id)), existing = new Map(clips.map(clip => [clip.id, clip]));
      const saved = result.clips.filter(clip => !ids.has(clip.id)).map(value => { const previous = existing.get(value.id); return previous ? Object.assign(previous, storedClip(value)) : storedClip(value); });
      clips.splice(0, clips.length, ...saved, ...pending);
      recordingsLoaded = true; renderStorage(result.storage); renderClips(); $('storage-error').hidden = true; $('recordings-error').hidden = true;
    } catch (error) {
      $('storage-error').textContent = error.message; $('storage-error').hidden = false;
      $('recordings-error').textContent = 'Saved recordings could not be loaded. ' + error.message; $('recordings-error').hidden = false;
    } finally { $('recordings-loading').hidden = true; $('storage-loading').hidden = true; }
  })();
  try { await recordingsRequest; } finally { recordingsRequest = null; }
}
function recordingId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function saveClip(clip) {
  if (clip.saved || clip.uploading) return;
  clip.uploading = true; clip.saveError = ''; renderClips();
  try {
    const metadata = { cameraName: clip.cameraName, recorderName: clip.recorderName, duration: clip.meta.duration, audio: clip.meta.audio };
    const response = await fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': clip.blob.type, 'X-Hik-Local': '1', 'X-Recording-Id': clip.id, 'X-Recording-Meta': encodeURIComponent(JSON.stringify(metadata)) }, body: clip.blob, signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    if (!response.ok) { if (result.code === 'viewer-auth-required') window.dispatchEvent(new Event('viewer-auth-required')); throw new Error(result.error || 'Recording upload failed.'); }
    if ($('notice').textContent.startsWith('Recording was not saved to server.')) notice('');
    const oldUrl = clip.url; Object.assign(clip, storedClip(result.clip)); clip.blob = null; storageRevision++; renderStorage(result.storage);
    renderClips(); URL.revokeObjectURL(oldUrl);
    toast(result.removed ? `Recording saved. ${result.removed} older clip(s) cleaned up.` : 'Recording saved to server.', { action: () => { location.hash = '#/recordings'; } });
    if (result.removed) void loadStoredClips();
  } catch (error) {
    clip.saveError = error.name === 'TimeoutError' ? 'Saving timed out. Retry or download the clip before leaving.' : error.message;
    notice('Recording was not saved to server. ' + clip.saveError); toast('Recording not saved. Keep this tab open and retry.', { action: () => { location.hash = '#/recordings'; } });
  } finally { clip.uploading = false; renderClips(); }
}
function updateClipState(card, clip) {
  const status = card.querySelector('.recording-save-state'), retry = card.querySelector('.recording-retry'), remove = card.querySelector('.recording-remove');
  status.textContent = clip.saved ? 'Saved to server' : clip.uploading ? 'Saving to server... Keep this tab open.' : clip.saveError || 'Waiting to save...';
  status.classList.toggle('unsaved', !clip.saved); retry.hidden = clip.saved || clip.uploading;
  remove.disabled = Boolean(clip.uploading || clip.deleting); remove.textContent = clip.saved ? 'Delete' : 'Remove';
}
function setupRecordingSettings() {
  $('storage-save').disabled = true;
  $('storage-settings-form').oninput = () => { storageDirty = true; $('storage-feedback').hidden = true; };
  $('storage-refresh').onclick = async () => { $('storage-refresh').disabled = true; try { await loadStoredClips(); } finally { $('storage-refresh').disabled = false; } };
  $('storage-settings-form').onsubmit = async event => {
    event.preventDefault(); const button = $('storage-save'), finish = loading('Saving recording settings...'); button.disabled = true; button.textContent = 'Saving...';
    try {
      const retentionDays = Number(document.querySelector('input[name=retention]:checked').value), maxBytes = Math.round(Number($('storage-limit-input').value) * 1073741824);
      const result = await api('/api/recordings/settings', 'POST', { retentionDays, maxBytes }); storageRevision++; storageDirty = false; renderStorage(result.storage);
      $('storage-feedback').textContent = result.removed ? `Settings saved. ${result.removed} recording(s) removed by your cleanup policy.` : 'Recording storage settings saved.'; $('storage-feedback').hidden = false;
      toast('Recording storage settings saved.'); await loadStoredClips();
    } catch (error) { $('storage-error').textContent = error.message; $('storage-error').hidden = false; }
    finally { button.disabled = false; button.textContent = 'Save storage settings'; finish(); }
  };
}

function clipDuration(ms) { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function clipSize(bytes) { return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function toast(message, { action, label = 'View recordings' } = {}) {
  const node = element('div', 'camera-toast'), icon = element('span', 'toast-icon', '\u2713'), text = element('span', 'toast-message', message);
  const close = element('button', 'toast-close', '\u00d7'); close.type = 'button'; close.setAttribute('aria-label', 'Dismiss notification');
  let timer; const dismiss = () => { clearTimeout(timer); node.remove(); };
  node.append(icon, text);
  if (action) { const button = element('button', 'toast-action', label); button.type = 'button'; button.onclick = () => { action(); dismiss(); }; node.append(button); }
  close.onclick = dismiss; node.append(close); $('toast-region').append(node);
  const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, 8000); }; node.onmouseenter = node.onfocusin = () => clearTimeout(timer); node.onmouseleave = node.onfocusout = arm; arm();
  while ($('toast-region').children.length > 3) $('toast-region').firstElementChild.remove();
}
function renderClips() {
  const recordings = location.hash === '#/recordings'; $('clip-panel').hidden = !recordings;
  const active = tiles.filter(tile => tile.recorder?.active), count = clips.length + active.length;
  $('nav-recordings-count').textContent = String(count); $('nav-recordings-count').hidden = !count;
  $('recordings-total').textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'} / ${active.length} recording`;
  $('recordings-size').textContent = clips.length ? `${storageSize(clips.reduce((sum, clip) => sum + (clip.blob?.size || clip.size || 0), 0))} total` : '';
  $('recordings-empty').hidden = !recordingsLoaded || Boolean(clips.length || active.length);
  $('recordings-active-section').hidden = !active.length; $('recordings-active-count').textContent = String(active.length); $('recordings-active').replaceChildren();
  for (const tile of active) {
    const card = element('article', 'active-recording'), info = element('div'); info.append(element('strong', '', tile.camera?.name || 'Camera'), element('small', '', tile.camera?.device.name || ''));
    const status = element('span', 'recording-live-label', 'Recording'), stop = element('button', 'recording-stop', 'Stop & save'); stop.type = 'button';
    stop.onclick = () => { stop.disabled = true; stop.textContent = 'Finishing...'; tile.recorder.stop(); controls(); };
    card.append(status, info, stop); $('recordings-active').append(card);
  }
  // Keep existing video elements while metadata and navigation update.
  const existing = new Map([...$('clips').children].map(node => [node.dataset.clip, node]));
  for (const clip of [...clips].reverse()) {
    if (existing.has(clip.url)) { const card = existing.get(clip.url); updateClipState(card, clip); $('clips').append(card); existing.delete(clip.url); continue; }
    const card = element('article', 'recording-card'); card.dataset.clip = clip.url;
    const video = element('video', 'recording-preview'); video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.src = clip.url; video.setAttribute('aria-label', `Preview ${clip.cameraName || 'camera recording'}`);
    const body = element('div', 'recording-card-body'), title = element('h3', '', clip.cameraName || 'Camera recording'), subtitle = element('p', 'recording-camera', clip.recorderName || 'Live camera');
    const details = element('div', 'recording-metadata'); details.append(element('span', '', clipDuration(clip.meta.duration)), element('span', '', clipSize((clip.blob?.size || clip.size || 0))), element('span', '', clip.meta.audio ? 'Video + audio' : 'Video only'));
    const date = element('p', 'recording-date', new Date(clip.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
    const actions = element('div', 'recording-actions'), link = element('a', 'recording-download', 'Download clip'); link.href = clip.downloadUrl || clip.url; link.download = clip.meta.name; link.onclick = () => toast('Clip download requested.');
    const remove = element('button', 'recording-remove', 'Remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${clip.cameraName || 'camera'} clip`);
    remove.onclick = async () => {
      if (clip.deleting) return; clip.deleting = true; remove.disabled = true; video.pause();
      try { if (clip.saved) { const result = await api(`/api/recordings/${clip.id}/delete`, 'POST'); storageRevision++; renderStorage(result.storage); }
        video.removeAttribute('src'); video.load(); if (!clip.saved) URL.revokeObjectURL(clip.url); const index = clips.findIndex(item => item.id === clip.id); if (index >= 0) clips.splice(index, 1); card.remove(); renderClips(); toast(clip.saved ? 'Recording deleted from server.' : 'Unsaved clip removed.');
      } catch (error) { clip.deleting = false; notice(error.message); remove.disabled = false; }
    };
    const saveState = element('p', 'recording-save-state'), retry = element('button', 'recording-retry', 'Retry save'); retry.type = 'button'; retry.onclick = () => void saveClip(clip); actions.append(link, retry, remove); body.append(title, subtitle, details, date, saveState, actions); card.append(video, body); $('clips').append(card); updateClipState(card, clip);
  }
  for (const node of existing.values()) { node.querySelector('video')?.pause(); node.remove(); }
}

function stopTalk() {
  if (!talk) return; const current = talk; talk = null; clearInterval(current.heartbeat); clearTimeout(current.limit);
  $('push-talk').classList.remove('talking'); $('push-talk').textContent = 'Hold to talk · PC mic';
  void api('/api/live/talk/stop', 'POST', { slot: current.slot }).catch(() => {}); if (audioWanted) void listenSelected();
}
function startTalk() {
  if (talk || $('push-talk').disabled) return;
  const current = talk = { slot: selected.id }; listened.stop();
  $('push-talk').classList.add('talking'); $('push-talk').textContent = 'Connecting microphone…';
  current.heartbeat = setInterval(() => api('/api/live/talk/heartbeat', 'POST', { slot: current.slot }).then(status => { if (['stopped','error'].includes(status.state)) stopTalk(); }).catch(() => stopTalk()), 400);
  current.limit = setTimeout(stopTalk, 30000);
  void api('/api/live/talk/start', 'POST', { slot: current.slot }).then(() => { if (talk === current) $('push-talk').textContent = 'Talking · release to stop'; }).catch(error => { if (talk === current) { stopTalk(); notice(error.message); } });
}
for (let id = 0; id < 32; id++) tiles.push(new Tile(id, {
  select, recover: recoverTile, stop: tile => { stopRotation(); void stopTile(tile); }, expand,
  changed: tile => { if (tile === selected) controls(); else updateTileControls(tile, { selected: false, audioWanted, volume: preferences.volume, talkSource }); },
  playbackError: tile => { if (tile.wanted && tile.delivery === 'smooth') { tile.delivery = 'mjpeg'; notice('Smooth decoding is unavailable for this browser. Using Compatibility playback.'); void assign(tile, tile.camera, tile.quality, false); } },
  frame: tile => { tile.recorder?.draw(); if (Date.now() - (library.previews.get(tile.camera?.key)?.at || 0) >= 300000) library.capture(tiles); },
  drop: (target, data) => {
    stopRotation();
    if (data.kind === 'camera') { const camera = cameras.find(camera => camera.key === data.key); if (camera) void assign(target, camera); }
    else if (data.kind === 'tile') { const index = tiles.findIndex(tile => tile.id === data.id), other = tiles.indexOf(target); if (index >= 0 && index < preferences.grid) { [tiles[index], tiles[other]] = [tiles[other], tiles[index]]; renderGrid(); } }
  }
}));
selected = tiles[0];
$('layout-size').onchange = () => void resizeGrid(Number($('layout-size').value));
$('camera-search').oninput = () => { stopRotation(); renderCameras(); };
$('camera-filter').onchange = () => { stopRotation(); const filter = $('camera-filter').value; if (filter.startsWith('recorder:')) void openRecorder(filter.slice(9)); else renderCameras(); };
$('back-to-grid').onclick = () => { expanded = null; renderGrid(); requestAdaptive(); };
$('group-picture-fit').onchange = () => { preferences.groupFit = $('group-picture-fit').value; for (const tile of visible()) { tile.fit = preferences.groupFit; tile.zoom.reset(); tile.applyPicture(); } controls(); persist(); };
$('start-all').onclick = () => { stopRotation(); void startAll(); }; $('stop-all').onclick = () => void stopAll();
for (const tile of tiles) createTileControls(tile, {
  select,
  change: (name, value) => {
    if (name === 'quality') { stopRotation(); tile.qualityMode = value; if (tile.camera) { if (value === 'auto') { tile.adaptivePaused = tile.adaptivePaused || !tile.wanted; requestAdaptive(); } else void assign(tile, tile.camera, value); } }
    if (name === 'delivery') { stopRotation(); tile.delivery = value; if (tile.camera) void assign(tile, tile.camera, tile.quality); }
    if (name === 'picture-fit') { tile.fit = value; tile.zoom.reset(); tile.applyPicture(); }
    if (name === 'volume') { preferences.volume = Number(value) / 100; listened.setVolume(preferences.volume); persist(); }
    controls();
  },
  action: (name, wasSelected) => {
    if (name === 'zoom-in') tile.zoom.zoom(tile.zoom.scale * 1.25);
    if (name === 'zoom-out') tile.zoom.zoom(tile.zoom.scale / 1.25);
    if (name === 'zoom-reset') tile.zoom.reset();
    if (name.startsWith('zoom-')) tile.applyPicture();
    if (name === 'snapshot') void snapshot(tile.image, tile.width, tile.height, tile.camera.name).catch(error => notice(error.message));
    if (name === 'record-clip') void recordSelected();
    if (name === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void tile.el.requestFullscreen().catch(() => notice('Fullscreen is unavailable.')); }
    if (name === 'audio-toggle') { clearWarmAudio(); audioWanted = !(audioWanted && wasSelected); void listenSelected(); }
    controls();
  },
  startTalk, stopTalk
});
$('favourite-selected').onclick = () => { if (selected.camera) toggleFavourite(selected.camera.key); };
$('set-camera-group').onclick = () => { if (!selected.camera) return; const name = $('camera-group-name').value.trim().slice(0, 50); if (name) preferences.groups[selected.camera.key] = name; else delete preferences.groups[selected.camera.key]; persist(); renderCameras(); organizationFeedback(name ? `Camera added to ${name}.` : 'Camera removed from its group.'); };
$('save-layout').onclick = () => {
  const name = $('layout-name').value.trim().slice(0,50); if (!name) { organizationFeedback('Enter a name for this layout.'); $('layout-name').focus(); return; }
  const layout = { name, grid: preferences.grid, cameras: visible().map(tile => tile.camera ? { deviceId: tile.camera.device.id, channel: tile.camera.channel, quality: tile.quality, qualityMode: tile.qualityMode, fit: tile.fit } : null) };
  const index = preferences.layouts.findIndex(layout => layout.name === name);
  if (index >= 0) preferences.layouts[index] = layout; else if (preferences.layouts.length < 12) preferences.layouts.push(layout); else { notice('Remove a saved layout before adding another.'); return; }
  persist(); renderLayouts(); $('saved-layouts').value = String(preferences.layouts.findIndex(layout => layout.name === name)); layoutSelection(); organizationFeedback(index >= 0 ? `Updated ${name}.` : `Saved ${name}.`);
};
$('load-layout').onclick = async () => {
  const layout = preferences.layouts[Number($('saved-layouts').value)]; if ($('saved-layouts').value === '' || !layout) return;
  const finishLoading = loading('Opening saved layout...'); $('load-layout').disabled = true;
  try {
  recorderRequest++; activeRecorderId = null; await stopAll(); await resizeGrid(layout.grid, false); renderCameras();
  for (const [index, ref] of layout.cameras.entries()) { const tile = tiles[index]; tile.clear(); if (!ref) continue; const camera = cameras.find(camera => camera.device.id === ref.deviceId && camera.channel === ref.channel); if (camera) { tile.assign(camera, ref.quality); tile.qualityMode = ref.qualityMode || 'auto'; tile.fit = ref.fit; } else tile.message('stopped', 'Saved camera is no longer available to this account.'); }
  renderGrid(); await startAll(false); organizationFeedback(`Opened ${layout.name}.`);
  } catch (error) { organizationFeedback(error.message); } finally { finishLoading(); layoutSelection(); }
};
$('delete-layout').onclick = () => { const index = Number($('saved-layouts').value); if ($('saved-layouts').value !== '') { const [removed] = preferences.layouts.splice(index, 1); $('saved-layouts').value = ''; persist(); renderLayouts(); organizationFeedback(`Deleted ${removed.name}. The current view is unchanged.`); } };
$('cycle-toggle').onclick = () => { if (rotation.running) void stopRotation(); else void startRotation(); };
$('cycle-seconds').onchange = () => { if (rotation.running) void startRotation(); };
window.addEventListener('blur', stopTalk);
window.addEventListener('focus', () => { if (!busy) void syncProviderStatus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTalk(); if (!audioWanted) listened.stop(); } requestAdaptive(); });
document.addEventListener('fullscreenchange', requestAdaptive);
window.addEventListener('beforeunload', event => { if (tiles.some(tile => tile.recorder?.active) || clips.some(clip => !clip.saved)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { stopTalk(); listened.stop(); source?.close(); audioSource?.close(); if (connected) fetch('/api/live/stop-all', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1' }, body: '{}' }).catch(() => {}); });
async function link(route, data) { const finishLoading = loading('Updating account connection...'); setBusy(true); notice(''); try { connection(await api(route, 'POST', data)); await refreshDevices(); ensureEvents(); } catch (error) { notice(error.message); } finally { finishLoading(); setBusy(false); } }
function providerNotice(message = '') { $('provider-notice').textContent = message; $('provider-notice').hidden = !message; }
$('connect').onclick = () => {
  $('nav-account').open = false; providerNotice(); $('provider-account').value = accountId ? $('account-name').textContent : ''; $('provider-title').textContent = authorizationState === 'reconnect-required' ? 'Reconnect your cameras.' : 'Connect your cameras.';
  $('provider-dialog').showModal();
};
$('nav-account').addEventListener('toggle', () => {
  if (!$('nav-account').open) { $('current-password').value = ''; $('new-password').value = ''; $('nav-password-details').open = false; }
});
document.addEventListener('click', event => { if (!$('nav-account').contains(event.target)) $('nav-account').open = false; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('nav-account').open) { $('nav-account').open = false; $('nav-account').querySelector('summary').focus(); }
});
$('provider-dialog').addEventListener('close', () => $('nav-account').querySelector('summary').focus());
$('provider-close').onclick = () => $('provider-dialog').close();
$('provider-dialog').addEventListener('close', () => {
  $('provider-password').value = ''; $('provider-password').type = 'password'; $('provider-show-password').textContent = 'Show'; $('provider-show-password').setAttribute('aria-pressed', 'false');
});
$('provider-dialog').onclick = event => {
  const box = $('provider-dialog').getBoundingClientRect();
  if (event.target === $('provider-dialog') && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) $('provider-dialog').close();
};
$('provider-show-password').onclick = () => {
  const show = $('provider-password').type === 'password'; $('provider-password').type = show ? 'text' : 'password';
  $('provider-show-password').textContent = show ? 'Hide' : 'Show'; $('provider-show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); $('provider-show-password').setAttribute('aria-pressed', String(show));
};
$('disconnect').onclick = async () => { await stopAll(); await link('/api/disconnect'); if (!connected) { $('provider-dialog').close(); $('nav-account').open = false; } else providerNotice($('notice').textContent); };
$('provider-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const finishLoading = loading('Signing in to Hik-Connect...');
  const input = { account: $('provider-account').value.trim(), password: $('provider-password').value };
  $('provider-password').value = ''; providerNotice(); setBusy(true); notice('');
  try {
    const status = await api('/api/connect/personal', 'POST', input); connection(status);
    if (status.sdkConnected) { $('provider-dialog').close(); toast('Camera account connected.'); }
    else providerNotice('Account connected. Camera playback still needs separate authorization for this account. Signing in here alone does not renew playback access.');
    await preferenceReload; await refreshDevices(); ensureEvents(); if (recorderRoute()) await restorePage();
  } catch (error) { providerNotice(error.message); }
  finally { delete input.password; finishLoading(); setBusy(false); }
};
$('recovery-sign-in').onclick = () => $('connect').click();
$('recovery-check').onclick = async () => { const button = $('recovery-check'); button.disabled = true; const finish = loading('Checking account connection...'); try { await syncProviderStatus(); if (connected) await refreshDevices(); } finally { button.disabled = false; finish(); } };
$('recovery-playback').onclick = async () => {
  if (busy) return; setBusy(true); const finish = loading('Checking playback authorization...');
  try { connection(await api('/api/connect/desktop', 'POST')); await preferenceReload; await refreshDevices(); ensureEvents(); toast('Playback authorization connected.'); }
  catch (error) { notice(error.message); } finally { setBusy(false); finish(); }
};
$('refresh').onclick = () => void refreshDevices();
$('recorder-refresh').onclick = () => void refreshDevices();
$('recorder-fullscreen').onclick = () => {
  const grid = $('camera-grid');
  if (document.fullscreenElement) void document.exitFullscreen();
  else void grid.requestFullscreen().catch(() => notice('Fullscreen is unavailable.'));
};
adaptive = new AdaptiveStreams({
  tiles: () => tiles, context: adaptiveContext, report: adaptiveStatus,
  suspend: (tile, reason) => {
    tile.adaptivePaused = true;
    const stopping = stopTile(tile, true, { adaptivePause: true });
    tile.message('paused', reason === 'quality-change' ? 'Preparing adaptive quality...' : reason === 'hidden-camera' ? 'Paused while another camera is enlarged.' : 'Paused to save bandwidth. Resumes when you return.');
    return stopping;
  },
  resume: async (tile, quality, valid) => {
    const generation = tile.generation; await tile.stopBarrier;
    if (!valid() || generation !== tile.generation || !connected || !sdkConnected) return;
    if (tile.quality !== quality) { const mode = tile.qualityMode; tile.assign(tile.camera, quality); tile.qualityMode = mode; }
    tile.adaptivePaused = false; tile.wanted = true; ensureEvents(); await startTile(tile);
  },
  error: error => { if (error.code !== 'account-changed') notice(error.message); }
});

setupRecordingSettings();
try {
  const stored = await api('/api/preferences'); preferences = { ...preferences, ...stored }; $('volume').value = String(preferences.volume * 100); $('group-picture-fit').value = preferences.groupFit;
  connection(await api('/api/status')); renderGrid(); renderLayouts(); renderClips(); renderPage(); await loadStoredClips();
  if (connected) { await refreshDevices(); ensureEvents(); if (recorderRoute() || ['#/recordings', '#/settings'].includes(location.hash)) await restorePage(); }
} catch (error) { renderGrid(); notice(error.message); }
setInterval(() => { if (!document.hidden) library.capture(tiles); }, 5000);
setInterval(() => { if (!document.hidden && connected && !busy) void refreshDevices(false); }, 30000);

setInterval(() => void previewLoader.pump(), 15000);

setInterval(() => { if (!document.hidden && !busy) void syncProviderStatus(); }, 15000);
window.addEventListener('online', () => { if (!busy) void syncProviderStatus(); });

setInterval(() => { if (!document.hidden && ['#/settings', '#/recordings'].includes(location.hash)) void loadStoredClips(); }, 30000);

$('connection-check').onclick = async () => {
  const button = $('connection-check'), finish = loading('Checking connection...'); button.disabled = true;
  try { await syncProviderStatus(); if (connected && (!connectionFailure || connectionFeedback(connectionFailure).kind !== 'server')) await refreshDevices(); }
  finally { button.disabled = false; finish(); }
};
window.addEventListener('offline', () => {
  const error = { code: 'browser-offline' }; showConnectionFailure(error);
  for (const tile of tiles) if (tile.wanted) tileFailure(tile, error);
});
