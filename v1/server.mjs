import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readBrowserSession, BrowserError } from './lib/browser-session.mjs';
import { createHikClient, HikError } from './lib/hik-connect.mjs';
import { NativeLive, LiveError } from './lib/live.mjs';

const publicDir = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
export function createApp({ connectBrowser = readBrowserSession, hik = createHikClient(), debugUrl = process.env.CHROME_DEBUG_URL,
  createLive = (credentials, device, channel, quality) => new NativeLive(credentials, device, channel, quality) } = {}) {
  const sessions = new Map();
  let connecting = false;
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        const target = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!target.startsWith(publicDir + path.sep)) return json(res, 404, { error: 'Not found' });
        try {
          const content = await readFile(target);
          res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
          return res.end(req.method === 'HEAD' ? undefined : content);
        } catch { return json(res, 404, { error: 'Not found' }); }
      }
      // A hostile website must not be able to make this local app read Chrome.
      const host = req.headers.host || '';
      const hostName = new URL('http://' + host).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostName)) return json(res, 403, { error: 'This development app requires localhost.' });
      if (req.headers.origin && req.headers.origin !== 'http://' + host) return json(res, 403, { error: 'Origin not allowed' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'POST' && (req.headers['x-hik-local'] !== '1' || !req.headers['content-type']?.startsWith('application/json')))
        return json(res, 403, { error: 'Use the app controls to perform this action.' });
      const sessionKey = /(?:^|;\s*)hik_local=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      let session = sessions.get(sessionKey);
      for (const [key, value] of sessions) if (Date.now() - value.touched > 8 * 3600000) { value.live?.stop(); sessions.delete(key); }
      if (sessionKey && !sessions.has(sessionKey)) session = null;
      if (session) session.touched = Date.now();
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, app: 'hikvision', version: '1.1.0', playbackReady: true });
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { connected: Boolean(session), user: session?.user || null, sdkConnected: Boolean(session?.sdkAccessToken),
        discoveryReady: true, channelsReady: false, playbackReady: true, connectionMode: 'signed-in-chrome' });
      if (req.method === 'POST' && url.pathname === '/api/connect/browser') {
        if (connecting) return json(res, 409, { error: 'A Chrome connection is already in progress.' });
        connecting = true;
        try {
          const credentials = await connectBrowser({ debugUrl });
          if (sessionKey) { session?.live?.stop(); sessions.delete(sessionKey); }
          const key = randomBytes(24).toString('hex');
          sessions.set(key, { ...credentials, touched: Date.now() });
          res.setHeader('Set-Cookie', `hik_local=${key}; HttpOnly; SameSite=Strict; Path=/`);
          return json(res, 200, { connected: true, user: credentials.user });
        } finally { connecting = false; }
      }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        if (sessionKey) { session?.live?.stop(); sessions.delete(sessionKey); }
        res.setHeader('Set-Cookie', 'hik_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(res, 200, { connected: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/devices') {
        if (!session) return json(res, 401, { error: 'Connect your signed-in Hik-Connect browser first.' });
        try {
          const [devices, sharing] = await Promise.all([hik.devices(session), hik.sharing(session)]);
          session.devices = [...devices, ...(sharing.devices || [])];
          return json(res, 200, { devices: session.devices, sharing,
            channelsReady: devices.length + (sharing.devices?.length || 0) > 0 && [...devices, ...(sharing.devices || [])].every(device => device.channelsReady),
            playbackReady: true, checkedAt: new Date().toISOString() });
        } catch (error) { if (error.status === 401) { session.live?.stop(); sessions.delete(sessionKey); } throw error; }
      }
      if (url.pathname.startsWith('/api/live/')) {
        if (!session) return json(res, 401, { error: 'Connect your signed-in Hik-Connect browser first.' });
        if (req.method === 'GET' && url.pathname === '/api/live/status') return json(res, 200, session.live?.status() || { state: 'stopped' });
        if (req.method === 'GET' && url.pathname === '/api/live/video') {
          if (!session.live) return json(res, 409, { error: 'Start a camera first.' });
          return session.live.subscribe(res);
        }
        if (req.method === 'GET' && url.pathname === '/api/live/audio') {
          if (!session.live) return json(res, 409, { error: 'Start a camera first.' });
          return session.live.subscribeAudio(res);
        }
        if (req.method === 'POST' && url.pathname === '/api/live/stop') {
          session.live?.stop(); return json(res, 200, { state: 'stopped' });
        }
        if (req.method === 'POST' && url.pathname === '/api/live/start') {
          if (session.starting) return json(res, 409, { error: 'A camera connection is already starting.' });
          let data = ''; for await (const chunk of req) { data += chunk.toString(); if (data.length > 4096) throw new LiveError('Camera request is too large.', 413); }
          let selection; try { selection = JSON.parse(data); } catch { throw new LiveError('Choose a camera channel.', 400); }
          if (!selection || typeof selection !== 'object') throw new LiveError('Choose a camera channel.', 400);
          const device = session.devices?.find(device => device.id === selection.deviceId);
          if (!device?.channels?.some(channel => channel.number === selection.channel)) throw new LiveError('Refresh devices and select a channel shared with this account.', 403);
          if (device.status === 'offline') throw new LiveError('Hik-Connect reports this recorder offline.', 409);
          if (session.origin !== 'https://iindia.hik-connect.com') throw new LiveError('Live playback is currently verified for the India portal only.', 409);
          if (!['hd', 'sd'].includes(selection.quality)) throw new LiveError('Choose HD or SD.', 400);
          session.starting = true;
          try {
            session.live?.stop();
            session.live = createLive(session, device, selection.channel, selection.quality);
            const status = await session.live.ready;
            return json(res, 200, status);
          } finally { session.starting = false; }
        }
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      // Known adapters return safe, fixed messages. Never expose CDP results,
      // cookies, raw upstream responses, or arbitrary error stacks to clients.
      const known = error instanceof BrowserError || error instanceof HikError || error instanceof LiveError;
      json(res, known ? error.status || 502 : 502, { error: known ? error.message : 'The request could not be completed. Check the local setup and retry.' });
    }
  });
  server.on('close', () => { for (const session of sessions.values()) session.live?.stop(); sessions.clear(); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('This browser-connected development app must bind to localhost.');
  const port = Number(process.env.PORT || 8003);
  const server = createApp();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another PORT in .env.` : 'The local server could not start.'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Hikvision v1: http://localhost:${port}`));
}
