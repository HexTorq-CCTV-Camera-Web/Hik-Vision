import { RecordingStore, RecordingError } from './lib/recordings.mjs';
import { randomUUID } from 'node:crypto';
import { sdkReady, providerStatus, providerConnectionId } from './lib/provider-state.mjs';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Vault, VaultError } from './lib/vault.mjs';
import { Accounts, AccountError } from './lib/accounts.mjs';
import { readBrowserSession, BrowserError } from './lib/browser-session.mjs';
import { createHikClient, HikError } from './lib/hik-connect.mjs';
import { signInPersonal, PortalError } from './lib/personal-client.mjs';
import { NativeLive, LiveError } from './lib/live.mjs';
import { closeReceiverPools } from './lib/pool-runner.mjs';
import { installedDesktopToken, validateSdkAccess, DesktopSdkError } from './lib/desktop-sdk.mjs';
import { acquireInstance } from './lib/instance.mjs';
import { PreviewCache } from './lib/previews.mjs';
import { Viewer, slotNumber } from './lib/viewer.mjs';
import { cleanPreferences } from './lib/preferences.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const localHost = value => ['localhost', '127.0.0.1', '[::1]'].includes(value);
const tokenFrom = req => /(?:^|;\s*)hik_product=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
const json = (res, status, body) => { if (res.headersSent) { res.destroy(); return; } res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req, limit = 16384) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > limit) throw new AccountError('The request is too large.', 413); }
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new AccountError('The request must contain a JSON object.'); }
}

export function createApp({ accounts, connectBrowser = readBrowserSession, hik = createHikClient(),
  connectPersonal = signInPersonal, publicOrigin = null, debugUrl = process.env.CHROME_DEBUG_URL,
  desktopToken = installedDesktopToken, verifySdk = validateSdkAccess,
  maxStreams = 32, recordings = null,
  createLive = (credentials, device, channel, quality, options) => new NativeLive(credentials, device, channel, quality, options) } = {}) {
  if (!accounts) throw new Error('An encrypted account store is required.');
  if (!Number.isInteger(maxStreams) || maxStreams < 1 || maxStreams > 64) throw new Error('Invalid stream limit.');
  if (publicOrigin) {
    const configured = new URL(publicOrigin);
    if (configured.origin !== publicOrigin || configured.protocol !== 'https:' && !(configured.protocol === 'http:' && process.env.HIK_ALLOW_HTTP_PILOT === '1')) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  }
  const runtime = new Map(), attempts = new Map();
  const previews = new PreviewCache(), previewLives = new Set();
  let connecting = false;
  let talkOwner = null;
  const stopAll = () => { previews.clear(); for (const live of previewLives) live.stop(); previewLives.clear(); for (const state of runtime.values()) state.close(); runtime.clear(); talkOwner = null; };
  const cookie = (res, token) => res.setHeader('Set-Cookie', `hik_product=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 30 * 86400 : 0}${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`);
  const authorize = token => { if (!accounts.authorize(token)) throw new AccountError('Sign in to the viewer first.', 401); };
  const throttle = req => {
    const key = req.socket.remoteAddress || 'local', now = Date.now();
    let entry = attempts.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 60000 }; attempts.set(key, entry); }
    if (++entry.count > 5) throw new AccountError('Too many sign-in attempts. Wait one minute and try again.', 429);
  };
  async function link(token, credentials) {
    authorize(token);
    if (!credentials?.sessionId || !['https://www.hik-connect.com', 'https://iindia.hik-connect.com'].includes(credentials.origin)) throw new AccountError('The account connection was not recognized.', 502);
    const previous = accounts.provider();
    const sameAccount = previous?.accountUserId && previous.accountUserId === credentials.accountUserId;
    const retained = sameAccount && sdkReady(previous) ? { sdkAccessToken: previous.sdkAccessToken, sdkExpiresAt: previous.sdkExpiresAt,
      sdkSource: previous.sdkSource, sdkValidatedAt: previous.sdkValidatedAt } : {};
    // Persist only adapter-approved credential fields, never raw login responses.
    const value = { ...retained, sessionId: credentials.sessionId, origin: credentials.origin,
      accountUserId: credentials.accountUserId || '', user: credentials.user || {},
      ...(credentials.sdkAccessToken ? { sdkAccessToken: credentials.sdkAccessToken, sdkExpiresAt: credentials.sdkExpiresAt } : {}),
      connectionRevision: randomUUID(), connectedAt: Date.now(), needsReconnect: false };
    await accounts.switchProvider(value); stopAll(); return providerStatus(value);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '', requestOrigin = 'http://' + host;
      const hostname = new URL(requestOrigin).hostname;
      if (!(localHost(hostname) || publicOrigin && new URL(publicOrigin).host === host)) throw new AccountError('Host is not allowed.', 403);
      const expectedOrigin = publicOrigin || requestOrigin;
      if (req.headers.origin && req.headers.origin !== expectedOrigin || req.headers['sec-fetch-site'] === 'cross-site') throw new AccountError('Origin is not allowed.', 403);
      const url = new URL(req.url, requestOrigin);
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
        const target = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!target.startsWith(path.resolve(publicDir) + path.sep)) return json(res, 404, { error: 'Not found.' });
        try { const bytes = await readFile(target); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); return res.end(req.method === 'HEAD' ? undefined : bytes); }
        catch { return json(res, 404, { error: 'Not found.' }); }
      }
      if (req.method === 'POST' && (req.headers['x-hik-local'] !== '1' || !(req.headers['content-type']?.startsWith('application/json') || url.pathname === '/api/recordings' && /^video\/(webm|mp4)(?:;|$)/.test(req.headers['content-type'] || '')))) throw new AccountError('Use the viewer controls to perform this action.', 403);
      const token = tokenFrom(req), authentication = accounts.authorize(token);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, app: 'hikvision-linux-pilot', version: '0.1.0-pilot' });
      if (req.method === 'GET' && url.pathname === '/api/auth/status') return json(res, 200, { setupRequired: accounts.setupRequired, authenticated: Boolean(authentication), username: authentication ? accounts.state.owner.username : null });
      if (req.method === 'POST' && ['/api/auth/setup', '/api/auth/login'].includes(url.pathname)) {
        throttle(req);
        if (url.pathname.endsWith('/setup') && (!localHost(hostname) || publicOrigin)) throw new AccountError('Create the viewer owner locally before enabling remote hosting.', 403);
        const input = await body(req);
        let issued;
        try { issued = await (url.pathname.endsWith('/setup') ? accounts.setup(input.username, input.password) : accounts.login(input.username, input.password)); }
        finally { delete input.password; }
        cookie(res, issued); return json(res, 200, { authenticated: true });
      }
      authorize(token);
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        runtime.get(token)?.close(); runtime.delete(token); await accounts.logout(token); cookie(res, ''); return json(res, 200, { authenticated: false });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/password') {
        const input = await body(req);
        let issued;
        try { issued = await accounts.changePassword(token, input.currentPassword, input.newPassword); }
        finally { delete input.currentPassword; delete input.newPassword; }
        stopAll(); cookie(res, issued); return json(res, 200, { changed: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { ...providerStatus(accounts.provider()), maxStreams, playbackRecovery: process.platform === 'win32' ? 'installed-client' : 'external-authorization', talkSource: null });
      // Recordings belong to the authenticated viewer workspace, independent of
      // whether its current Hik-Connect grant is online or expired.
      if (url.pathname === '/api/recordings' || url.pathname.startsWith('/api/recordings/')) {
        if (!recordings) throw new RecordingError('Persistent recording storage is not configured.', 503);
        if (req.method === 'GET' && ['/api/recordings', '/api/recordings/storage'].includes(url.pathname)) return json(res, 200, await recordings.list());
        if (req.method === 'POST' && url.pathname === '/api/recordings/settings') return json(res, 200, await recordings.settings(await body(req)));
        if (req.method === 'POST' && url.pathname === '/api/recordings') {
          let metadata;
          try { const raw = req.headers['x-recording-meta']; if (typeof raw !== 'string' || raw.length > 4096) throw new Error(); metadata = JSON.parse(decodeURIComponent(raw)); } catch { throw new RecordingError('Invalid recording details.'); }
          const length = req.headers['content-length'] === undefined ? undefined : Number(req.headers['content-length']);
          const result = await recordings.ingest(req, { type: req.headers['content-type'], metadata, id: req.headers['x-recording-id'], contentLength: length });
          authorize(token); return json(res, 201, result);
        }
        const match = url.pathname.match(/^\/api\/recordings\/([a-f0-9-]{36})\/(video|delete)$/i);
        if (match && ['GET', 'HEAD'].includes(req.method) && match[2] === 'video') return await recordings.serve(req, res, match[1], url.searchParams.get('download') === '1');
        if (match && req.method === 'POST' && match[2] === 'delete') return json(res, 200, await recordings.remove(match[1]));
        throw new RecordingError('Recording not found.', 404);
      }
      const requestedConnection = req.headers['x-hik-connection'] || (['/api/live/events', '/api/live/audio-events'].includes(url.pathname) ? url.searchParams.get('connection') : null);
      if (requestedConnection && !['/api/status'].includes(url.pathname) && !url.pathname.startsWith('/api/auth/') && requestedConnection !== (providerConnectionId(accounts.provider()) || 'none')) throw new AccountError('The camera account changed. Refresh and try again.', 409, 'account-changed');
      if (url.pathname === '/api/preferences') {
        if (req.method === 'GET') return json(res, 200, accounts.preferences());
        if (req.method === 'POST') {
          let preferences; try { preferences = cleanPreferences(await body(req, 131072)); } catch (error) { throw new AccountError(error.message || 'Invalid viewer settings.'); }
          await accounts.savePreferences(preferences, requestedConnection); return json(res, 200, preferences);
        }
      }
      if (req.method === 'POST' && ['/api/connect/browser', '/api/connect/personal'].includes(url.pathname)) {
        if (connecting) throw new AccountError('An account connection is already in progress.', 409, 'account-change-in-progress');
        connecting = true;
        try {
          let credentials;
          if (url.pathname.endsWith('/browser')) credentials = await connectBrowser({ debugUrl });
          else {
            throttle(req);
            const input = await body(req);
            try {
              const result = await connectPersonal(input);
              if (!result.credentials) return json(res, 409, { error: 'Hik-Connect regional sign-in could not be completed. Try again later.', region: result.origin });
              credentials = result.credentials;
            } finally { delete input.password; delete input.imageCode; }
          }
          return json(res, 200, await link(token, credentials));
        } finally { connecting = false; }
      }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        if (connecting) throw new AccountError('Wait for the account sign-in to finish before disconnecting.', 409, 'account-change-in-progress');
        await accounts.switchProvider(null); stopAll(); return json(res, 200, providerStatus(null));
      }
      const provider = accounts.provider();
      if (!provider?.sessionId || provider.needsReconnect) throw new AccountError('Sign in to Hik-Connect to reconnect your cameras. Your viewer account is still signed in.', 409, 'provider-auth-required');
      if (req.method === 'POST' && url.pathname === '/api/connect/desktop') {
        if (connecting) throw new AccountError('An account connection is already in progress.', 409, 'account-change-in-progress');
        connecting = true;
        try {
          const sharing = await hik.sharing(provider);
          const device = sharing.devices?.find(device => device.serial && device.channels?.length);
          if (!device) throw new DesktopSdkError('A shared device and channel are required to verify the installed playback sign-in.');
          const sdkAccessToken = await desktopToken();
          const result = await verifySdk(sdkAccessToken, device, device.channels[0].number);
          authorize(token);
          if (accounts.provider()?.sessionId !== provider.sessionId) throw new AccountError('The linked account changed. Try again.', 409);
          const updated = { ...provider, sdkAccessToken, sdkSource: 'installed-client', sdkValidatedAt: result.validatedAt, sdkExpiresAt: null };
          await accounts.updateProvider(providerConnectionId(provider), () => updated); stopAll();
          return json(res, 200, providerStatus(updated));
        } finally { connecting = false; }
      }
      let state = runtime.get(token);
      if (!state) { state = new Viewer(); runtime.set(token, state); }
      if (req.method === 'GET' && url.pathname === '/api/devices') {
        try {
          const [devices, sharing] = await Promise.all([hik.devices(provider), hik.sharing(provider)]);
          authorize(token);
          if (providerConnectionId(accounts.provider()) !== providerConnectionId(provider) || runtime.get(token) !== state) throw new AccountError('The camera account changed. Refresh and try again.', 409, 'account-changed');
          state.devices = [...devices, ...(sharing.devices || [])];
          return json(res, 200, { devices: state.devices, sharing, checkedAt: new Date().toISOString(), playbackReady: sdkReady(provider) });
        } catch (error) {
          if (error instanceof HikError && error.status === 401) {
            const current = accounts.provider();
            if (providerConnectionId(current) === providerConnectionId(provider)) { await accounts.updateProvider(providerConnectionId(provider), value => ({ ...value, needsReconnect: true })); stopAll(); }
            throw new AccountError('Hik-Connect sign-in expired. Sign in again to reconnect your cameras. Your viewer session is still active.', 409, 'provider-auth-required');
          }
          throw error;
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/previews/frame') {
        const deviceId = url.searchParams.get('deviceId'), channel = Number(url.searchParams.get('channel'));
        const device = state.devices?.find(device => device.id === deviceId);
        if (!device?.channels?.some(item => item.number === channel)) throw new AccountError('This camera channel is unavailable to this account. Refresh the library and check sharing permissions.', 403, 'channel-unavailable');
        if (!sdkReady(provider)) throw new AccountError('Playback authorization is missing or expired. Reauthorize playback for this account.', 409, 'playback-auth-required');
        if (device.status !== 'online') throw new AccountError('Hik-Connect reports this recorder offline. Check its power and internet connection.', 409, 'recorder-offline');
        if (provider.origin !== 'https://iindia.hik-connect.com' && !(provider.sdkSource === 'installed-client' && provider.sdkValidatedAt)) throw new AccountError('Verify India playback access using your iVMS sign-in.', 409);
        const key = `${deviceId}:${channel}`;
        const image = await previews.get(key, async () => {
          authorize(token);
          if (accounts.provider()?.sessionId !== provider.sessionId) throw new AccountError('Account changed.', 409, 'account-changed');
          const slots = [...runtime.values()].flatMap(viewer => [...viewer.slots.values()]);
          const existing = slots.find(slot => slot.live?.deviceId === deviceId && slot.live?.channel === channel && ['connecting', 'playing'].includes(slot.live.state) && slot.live.preview)?.live;
          if (existing) return existing.preview();
          const active = slots.filter(slot => slot.starting || slot.live && !['stopped','failed'].includes(slot.live.state)).length;
          if (active + previewLives.size >= maxStreams) throw new AccountError('Previews are waiting for an available connection.', 409);
          const live = createLive(provider, device, channel, 'sd', { delivery: 'mjpeg', previewOnly: true }); previewLives.add(live);
          try { return await live.preview(); }
          finally { live.stop(); previewLives.delete(live); }
        });
        authorize(token);
        if (accounts.provider()?.sessionId !== provider.sessionId) throw new AccountError('Account changed.', 409, 'account-changed');
        return json(res, 200, image);
      }
      if (req.method === 'GET' && url.pathname === '/api/live/events') return state.subscribe(res, { separateAudio: url.searchParams.get('audio') === 'separate' });
      if (req.method === 'GET' && url.pathname === '/api/live/audio-events') return state.subscribeAudioEvents(res);
      if (req.method === 'POST' && url.pathname === '/api/live/audio-focus') {
        const input = await body(req);
        if (!Array.isArray(input.slots) || input.slots.length > 5) throw new AccountError('Select at most five audio feeds.');
        let ids; try { ids = input.slots.map(slotNumber); } catch { throw new AccountError('Invalid audio tile.'); }
        state.focusAudio(ids); return json(res, 200, { slots: ids });
      }
      let slot;
      try { slot = state.slot(slotNumber(url.searchParams.get('slot') ?? 0)); } catch { throw new AccountError('Choose a stream slot from 1 to 32.'); }
      if (req.method === 'GET' && url.pathname === '/api/live/status') return json(res, 200, url.searchParams.has('all') ? state.states() : slot.live?.status() || { state: 'stopped' });
      if (req.method === 'GET' && ['/api/live/video', '/api/live/audio'].includes(url.pathname)) {
        if (!slot.live) throw new AccountError('Start a camera first.', 409);
        return url.pathname.endsWith('/audio') ? slot.live.subscribeAudio(res) : slot.live.subscribe(res);
      }
      if (req.method === 'POST' && url.pathname === '/api/live/stop-all') { state.stopAll(); return json(res, 200, { state: 'stopped' }); }
      if (req.method === 'POST' && url.pathname === '/api/live/stop-slots') {
        const input = await body(req);
        if (!Array.isArray(input.slots) || input.slots.length > 32) throw new AccountError('Invalid camera selection.');
        let ids; try { ids = input.slots.map(slotNumber); } catch { throw new AccountError('Invalid camera selection.'); }
        for (const id of ids) state.stop(id);
        return json(res, 200, { state: 'stopped' });
      }
      if (req.method === 'POST' && url.pathname === '/api/live/stop') {
        const input = await body(req); let id; try { id = slotNumber(input.slot ?? 0); } catch { throw new AccountError('Invalid tile.'); }
        state.stop(id); return json(res, 200, { state: 'stopped' });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/live/talk/')) {
        if (publicOrigin) throw new AccountError('This build uses the Windows PC microphone. Remote browser microphone forwarding is not available.', 409);
        const input = await body(req); let id; try { id = slotNumber(input.slot ?? 0); } catch { throw new AccountError('Invalid tile.'); }
        const live = state.slot(id).live;
        if (!live || live.state !== 'playing') throw new AccountError('Start a camera first.', 409);
        if (url.pathname.endsWith('/start')) {
          if (talkOwner && ['connecting', 'talking', 'stopping'].includes(talkOwner.live.talkState)) throw new AccountError('Another camera is already using two-way audio.', 409);
          if (!live.startTalk) throw new AccountError('Two-way audio is unavailable.', 409);
          talkOwner = { token, id, live };
          try { await live.startTalk(); return json(res, 200, { state: 'talking', source: 'windows-pc-microphone' }); }
          catch (error) { if (talkOwner?.live === live) talkOwner = null; throw error; }
        }
        if (talkOwner?.token !== token || talkOwner.id !== id) throw new AccountError('No talk session is active for this tile.', 409);
        if (url.pathname.endsWith('/heartbeat')) live.keepTalkAlive();
        else if (url.pathname.endsWith('/stop')) live.stopTalk();
        else throw new AccountError('Unknown talk action.');
        return json(res, 200, { state: live.talkState });
      }
      if (req.method === 'POST' && url.pathname === '/api/live/start') {
        if (!sdkReady(provider)) throw new AccountError('Playback authorization is missing or expired. Reauthorize playback for this account.', 409, 'playback-auth-required');
        const selection = await body(req);
        if (providerConnectionId(accounts.provider()) !== providerConnectionId(provider) || runtime.get(token) !== state) throw new AccountError('Account changed.', 409, 'account-changed');
        const device = state.devices?.find(device => device.id === selection.deviceId);
        try { slot = state.slot(slotNumber(selection.slot ?? 0)); } catch { throw new AccountError('Invalid tile.'); }
        if (slot.starting) throw new AccountError('This tile is already connecting.', 409);
        if (!device?.channels?.some(channel => channel.number === selection.channel)) throw new AccountError('This channel is unavailable to the connected account. Refresh the library and check sharing permissions.', 403, 'channel-unavailable');
        if (device.status === 'offline') throw new AccountError('Hik-Connect reports this recorder offline. Check its power and internet connection.', 409, 'recorder-offline');
        // The global web portal can route an India account's device requests.
        // A separately verified installed-client grant proves SDK access; the
        // website hostname alone must not reject that playback authorization.
        if (provider.origin !== 'https://iindia.hik-connect.com' && !(provider.sdkSource === 'installed-client' && provider.sdkValidatedAt)) throw new AccountError('Verify India playback access using your iVMS sign-in.', 409);
        if (!['hd', 'sd'].includes(selection.quality)) throw new AccountError('Choose HD or SD.');
        const delivery = selection.delivery ?? 'mjpeg';
        if (!['mjpeg', 'smooth'].includes(delivery)) throw new AccountError('Choose Smooth or Compatibility playback.');
        // Watching a camera takes priority over a short background snapshot.
        for (const live of previewLives) live.stop(); previewLives.clear();
        const active = [...runtime.values()].flatMap(viewer => [...viewer.slots.values()]).filter(value => value !== slot && (value.starting || value.live && !['stopped', 'failed'].includes(value.live.state))).length;
        if (active >= maxStreams) throw new AccountError('The server stream limit is reached. Stop another camera first.', 409, 'stream-limit');
        state.stop(slot.id); slot.starting = true; const generation = slot.generation;
        try {
          const live = slot.live = createLive(provider, device, selection.channel, selection.quality, { delivery }); state.attach(slot);
          const status = await live.ready; authorize(token);
          if (slot.generation !== generation || accounts.provider()?.sessionId !== provider.sessionId) { live.stop(); throw new AccountError('Camera selection changed.', 409); }
          return json(res, 200, { slot: slot.id, ...status });
        } finally { slot.starting = false; }
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) {
      const known = [AccountError, BrowserError, HikError, PortalError, LiveError, VaultError, DesktopSdkError, RecordingError].some(Type => error instanceof Type);
      const status = known ? error.status || 502 : 500;
      json(res, status, { error: known ? error.message : 'The request could not be completed. Check the Linux server and retry.',
        ...(error instanceof AccountError && status === 401 ? { code: 'viewer-auth-required' } : error.code && typeof error.code === 'string' ? { code: error.code } : !known ? { code: 'server-error' } : {}),
        ...(error instanceof PortalError && Number.isFinite(error.code) ? { providerCode: error.code } : {}) });
    }
  });
  const recordingCleanup = recordings ? setInterval(() => { void recordings.cleanup().catch(() => console.warn('Recording cleanup could not finish. Check local storage.')); }, 60000) : null;
  recordingCleanup?.unref();
  const reap = setInterval(() => {
    for (const [token, state] of runtime) if (!accounts.authorize(token)) { state.close(); runtime.delete(token); }
    for (const [key, entry] of attempts) if (entry.until <= Date.now()) attempts.delete(key);
  }, 15000);
  reap.unref();
  server.on('close', () => { clearInterval(recordingCleanup); clearInterval(reap); stopAll(); closeReceiverPools(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let instance;
  try {
    if (process.platform !== 'linux') throw new Error('This pilot requires Linux.');
    const directory = process.env.HIK_PRODUCT_DATA_DIR || '/home/mohan/cam/data';
    instance = await acquireInstance(directory);
    const accounts = await Accounts.open(new Vault(directory));
    const recordings = await new RecordingStore(path.join(directory, 'recordings')).open();
    const server = createApp({ accounts, recordings, publicOrigin: process.env.PUBLIC_ORIGIN || null, maxStreams: Number(process.env.MAX_LIVE_STREAMS || 32) });
    const port = Number(process.env.PORT || 21000);
    server.on('error', error => { instance.close(); console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'The Linux viewer could not start.'); process.exitCode = 1; });
    server.on('close', () => instance.close());
    server.listen(port, process.env.HIK_LISTEN_HOST || '127.0.0.1', () => console.log(`Hikvision Linux pilot: ${process.env.PUBLIC_ORIGIN || 'http://localhost:' + port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
  } catch (error) { instance?.close(); console.error(error instanceof VaultError || error instanceof AccountError ? error.message : 'The Linux viewer could not initialize. Check Linux account-file permissions and the data directory.'); process.exitCode = 1; }
}
