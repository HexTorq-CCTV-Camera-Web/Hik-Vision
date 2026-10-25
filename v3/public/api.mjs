export class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
export async function requestApi(route, method = 'GET', { request = fetch, onUnauthorized = () => {}, body, connectionId } = {}) {
  let response;
  try {
    response = await request(route, { method, cache: 'no-store', signal: AbortSignal.timeout(50000),
      headers: { ...(globalThis.__principal ? { 'X-Saas-User': globalThis.__principal.id } : {}), ...(connectionId !== undefined ? { 'X-Hik-Connection': connectionId || 'none' } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Hik-Local': '1' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
  } catch (error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('This device is offline. Check its internet connection.', 0, 'browser-offline');
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ApiError('The camera server took too long to respond.', 0, 'server-timeout');
    throw new ApiError('Cannot reach the camera server. Check the server and your network connection.', 0, 'server-unreachable');
  }
  if (response.status === 401) onUnauthorized();
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError('The camera server returned an unexpected response.', response.status, response.status >= 500 ? 'server-error' : 'server-response-error'); }
  if (!response.ok) { if (result.code === 'viewer-auth-required' && typeof window !== 'undefined') window.dispatchEvent(new Event('viewer-auth-required')); const error = new Error(result.error || 'The request could not be completed.'); error.status = response.status; error.code = result.code || (response.status >= 500 ? 'server-error' : undefined); throw error; }
  return result;
}
