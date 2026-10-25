import { requestApi } from './api.mjs';
import { CameraAudio } from './audio.mjs';
const $ = id => document.getElementById(id);
let connected = false, busy = false;
let selected = null, liveBusy = false, pollTimer, liveActive = false;
const events = [];
const cameraAudio = new CameraAudio({
  onChange: enabled => { $('audio-toggle').textContent = enabled ? 'Mute' : 'Unmute'; $('audio-toggle').setAttribute('aria-pressed', String(enabled)); },
  onError: message => { notice(message); log('audio-error', message); }
});
function log(type, detail = '') {
  events.push({ time: new Date().toISOString(), type, detail });
  if (events.length > 100) events.shift();
  $('log').textContent = events.map(event => `${event.time.slice(11, 19)}  ${event.type}${event.detail ? '  ' + event.detail : ''}`).join('\n');
}
function notice(detail = '') { $('notice').textContent = detail; $('notice').hidden = !detail; }
async function api(route, method = 'GET', body) {
  return requestApi(route, method, { body, onUnauthorized: () => updateConnection({ connected: false }) });
}
function showStopped(detail = 'Choose a channel from an online recorder to start live video.') {
  cameraAudio.stop(); $('audio-toggle').disabled = true;
  clearTimeout(pollTimer); liveActive = false;
  $('live-video').hidden = true; $('live-video').removeAttribute('src'); $('live-placeholder').hidden = false;
  $('live-stage').classList.remove('has-video'); $('live-badge').textContent = 'Stopped'; $('live-badge').className = 'badge';
  $('live-heading').textContent = 'Live view'; $('viewer-detail').textContent = detail;
  $('live-description').textContent = detail; $('stop-live').disabled = true; $('fullscreen').disabled = true;
}
function renderLive(status) {
  const audioUnavailable = ['unavailable', 'error'].includes(status.audioState);
  $('audio-toggle').disabled = audioUnavailable || liveBusy;
  if (audioUnavailable) { cameraAudio.stop(); $('audio-toggle').textContent = status.audioState === 'error' ? 'Audio unavailable' : 'No audio stream'; }
  $('viewer-title').textContent = `${status.deviceName} · Camera ${status.channel}`;
  $('live-badge').textContent = 'Live'; $('live-badge').className = 'badge connected';
  $('live-placeholder').hidden = true; $('live-video').hidden = false; $('live-stage').classList.add('has-video');
  $('live-stage').style.setProperty('--live-ratio', `${status.displayWidth || status.width} / ${status.height}`);
  $('live-description').textContent = `Live · ${status.codec} · ${status.width} × ${status.height} · ${status.quality.toUpperCase()}`;
  $('stop-live').disabled = false; $('fullscreen').disabled = false;
  $('step-playback').classList.add('done'); $('step-playback').querySelector('.check').textContent = '✓';
  $('phase-text').textContent = 'Live video connected';
}
async function pollLive() {
  if (!liveActive) return;
  try {
    const status = await api('/api/live/status');
    if (status.state !== 'playing') { showStopped(status.error || 'Playback stopped. Select a channel to start again.'); return; }
    renderLive(status);
  } catch (error) { showStopped(error.message); return; }
  pollTimer = setTimeout(pollLive, 1500);
}
async function startLive(device, channel) {
  if (liveBusy) return;
  liveBusy = true; selected = { device, channel }; clearTimeout(pollTimer); notice('');
  showStopped('Connecting to the camera and decoding video…');
  $('viewer-title').textContent = `${device.name} · Camera ${channel.number}`; $('live-badge').textContent = 'Connecting';
  $('quality').disabled = true;
  document.querySelectorAll('.play-channel').forEach(button => { button.disabled = true; });
  log('video-start', `${device.name}, channel ${channel.number}, ${$('quality').value.toUpperCase()}`);
  try {
    const status = await api('/api/live/start', 'POST', { deviceId: device.id, channel: channel.number, quality: $('quality').value });
    liveActive = true; renderLive(status); $('live-video').src = '/api/live/video?t=' + Date.now();
    log('video-playing', `${status.codec} · ${status.width} × ${status.height}`);
    pollTimer = setTimeout(pollLive, 1500);
  } catch (error) { showStopped(error.message); notice(error.message); log('video-failed', error.message); }
  finally {
    liveBusy = false; $('quality').disabled = false;
    document.querySelectorAll('.play-channel').forEach(button => { button.disabled = button.dataset.offline === 'true'; });
  }
}
function setBusy(value) {
  busy = value;
  $('connect').disabled = busy; $('disconnect').disabled = busy; $('refresh').disabled = busy || !connected;
}
function updateConnection(status) {
  connected = status.connected;
  $('connection-badge').textContent = connected ? 'Connected' : 'Not connected';
  $('connection-badge').className = 'badge' + (connected ? ' connected' : '');
  $('connect').textContent = connected ? 'Reconnect signed-in Chrome' : 'Connect signed-in Chrome ↗';
  $('disconnect').hidden = !connected;
  $('account').hidden = !connected;
  $('account-name').textContent = status.user?.email || status.user?.username || 'Hik-Connect account';
  $('account-region').textContent = status.user?.country || 'Region provided by Hik-Connect';
  $('phase-text').textContent = connected ? 'Add or share your DVR' : 'Connect your account';
  $('step-account').classList.toggle('done', connected);
  $('step-account').querySelector('.check').textContent = connected ? '✓' : '1';
  if (!connected) {
    showStopped(); selected = null;
    $('devices').replaceChildren(); $('devices').hidden = true; $('device-empty').hidden = false;
    $('device-count').textContent = '—'; $('step-dvr').classList.remove('done'); $('step-dvr').querySelector('.check').textContent = '2';
    $('empty-title').textContent = 'Start with your Hik-Connect account.';
    $('empty-detail').textContent = 'Connect the signed-in Chrome session to load the real device list.';
    $('sharing-note').hidden = true; $('last-checked').textContent = 'Device list has not been checked.';
  }
  setBusy(busy);
}
function renderDevices(result) {
  const devices = result.devices;
  $('devices').replaceChildren(); $('devices').hidden = !devices.length;
  $('device-empty').hidden = Boolean(devices.length); $('device-count').textContent = devices.length;
  $('empty-title').textContent = 'Your account is connected. Add your DVR next.';
  $('empty-detail').textContent = 'Hik-Connect returned no owned devices. Add the recorder or have its owner share it with this account, then refresh.';
  for (const device of devices) {
    const row = document.createElement('article'); row.className = 'device';
    const info = document.createElement('div'); const name = document.createElement('h3'); name.textContent = device.name;
    const description = document.createElement('p'); description.textContent = (device.source === 'shared' ? 'Shared with you · ' : '') + (device.serial ? `Serial: ${device.serial}` : 'Device details need mapping after capture');
    info.append(name, description);
    if (device.channels?.length) {
      const details = document.createElement('details'); details.className = 'channel-details';
      const summary = document.createElement('summary'); summary.textContent = `${device.channels.length} shared camera channels`;
      const list = document.createElement('ul');
      for (const channel of device.channels) {
        const item = document.createElement('li'); const button = document.createElement('button');
        button.className = 'play-channel secondary'; button.textContent = `▶ ${channel.number} · ${channel.name}`;
        button.dataset.offline = String(device.status === 'offline'); button.disabled = device.status === 'offline' || liveBusy;
        button.onclick = () => startLive(device, channel); item.append(button); list.append(item);
      }
      details.open = device.status === 'online';
      details.append(summary, list); info.append(details);
    }
    if (device.channelError) { const hint = document.createElement('p'); hint.textContent = device.channelError; info.append(hint); }
    const state = document.createElement('span'); state.className = 'badge' + (device.status === 'online' ? ' connected' : ''); state.textContent = device.status === 'online' ? 'Online' : device.status === 'offline' ? 'Offline · Hik-Connect' : 'Status unknown';
    row.append(info, state); $('devices').append(row);
  }
  const sharingFound = result.sharing.state === 'records-found';
  $('sharing-note').hidden = !result.sharing.mappingPending;
  $('sharing-note').textContent = 'Some shared records have an unrecognized format and need inspection before they can be listed.';
  const found = devices.length || sharingFound;
  $('step-dvr').classList.toggle('done', Boolean(found)); $('step-dvr').querySelector('.check').textContent = found ? '✓' : '2';
  const allOffline = devices.length > 0 && devices.every(device => device.status === 'offline');
  if (!liveActive) $('phase-text').textContent = allOffline ? 'Shared devices are offline' : found ? 'Choose a camera channel' : 'Add or share your DVR';
  $('step-dvr').querySelector('p').textContent = found ? 'Devices are available in your Hik-Connect account.' : 'Use Hik-Connect on your phone to add the recorder or accept its shared access.';
  if (!liveActive) {
    $('viewer-title').textContent = allOffline ? 'Waiting for your devices to come online' : 'Select a camera channel';
    showStopped(allOffline ? 'Hik-Connect reports your devices offline.' : 'Choose a channel from an online recorder to start live video.');
  }
  $('last-checked').textContent = 'Checked ' + new Date(result.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  log('devices-checked', `${devices.length} device(s), including ${devices.filter(d => d.source === 'shared').length} shared`);
}
async function refresh() {
  setBusy(true); notice('');
  try { renderDevices(await api('/api/devices')); }
  catch (error) { notice(error.message); log('discovery-failed', error.message); }
  finally { setBusy(false); }
}
$('connect').onclick = async () => {
  setBusy(true); notice(''); log('connecting', 'Looking for the signed-in Hik-Connect tab in local Chrome.');
  try {
    updateConnection(await api('/api/connect/browser', 'POST'));
    log('account-connected', 'Browser session available in server memory.');
    await refresh();
  } catch (error) { notice(error.message); log('connection-failed', error.message); }
  finally { setBusy(false); }
};
$('disconnect').onclick = async () => {
  setBusy(true); notice('');
  try { updateConnection(await api('/api/disconnect', 'POST')); log('disconnected', 'Workspace session cleared.'); }
  catch (error) { notice(error.message); }
  finally { setBusy(false); }
};
$('refresh').onclick = refresh;
$('stop-live').onclick = async () => { showStopped('Playback stopped.'); try { await api('/api/live/stop', 'POST'); log('video-stopped'); } catch (error) { notice(error.message); } };
$('quality').onchange = () => { if (selected && liveActive) startLive(selected.device, selected.channel); };
$('fullscreen').onclick = () => $('live-stage').requestFullscreen().catch(() => notice('Fullscreen is unavailable.'));
$('audio-toggle').onclick = async () => {
  notice('');
  if (cameraAudio.enabled) { cameraAudio.stop(); log('audio-muted'); return; }
  try { await cameraAudio.start(); log('audio-unmuted'); }
  catch (error) { notice(error.message); log('audio-error', error.message); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden) cameraAudio.stop(); });
window.addEventListener('pagehide', () => cameraAudio.stop());
window.addEventListener('pagehide', () => { if (liveActive) fetch('/api/live/stop', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1' }, body: '{}' }).catch(() => {}); });
$('copy-log').onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify({ app: 'hikvision', version: '1.0.0', events }, null, 2)); $('copy-log').textContent = 'Copied'; setTimeout(() => { $('copy-log').textContent = 'Copy log'; }, 2000); }
  catch { notice('Select and copy the connection events manually; clipboard access is unavailable.'); }
};
try {
  updateConnection(await api('/api/status'));
  if (connected) {
    await refresh();
    const status = await api('/api/live/status');
    if (status.state === 'playing') { liveActive = true; $('quality').value = status.quality; renderLive(status); $('live-video').src = '/api/live/video?t=' + Date.now(); pollTimer = setTimeout(pollLive, 1500); }
  }
}
catch (error) { notice(error.message); }
