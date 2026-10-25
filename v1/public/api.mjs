export async function requestApi(route, method = 'GET', { request = fetch, onUnauthorized = () => {}, body } = {}) {
  let response;
  try {
    response = await request(route, { method, cache: 'no-store', signal: AbortSignal.timeout(50000),
      ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1' }, body: JSON.stringify(body || {}) } : {}) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new Error('The local server took too long to respond. Check Chrome for a connection approval prompt, then try again.');
    throw new Error('Cannot reach the local Hikvision server. Run npm start in hikvision/v1, then reload http://localhost:8003/ and connect again.');
  }
  if (response.status === 401) onUnauthorized();
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The local server returned an unexpected response. Reload this page and check that the Hikvision server is running on this port.'); }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
