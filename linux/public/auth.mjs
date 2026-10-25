import { loading } from './loading.mjs';
const finishInitialLoading = loading('Loading your workspace...');
async function action(route, data = {}) {
  const finishLoading = loading(route.endsWith('/logout') ? 'Signing out...' : route.endsWith('/password') ? 'Saving password...' : 'Signing in...');
  try {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
  } finally { finishLoading(); }
}
const $ = id => document.getElementById(id);
let status;
try {
  const response = await fetch('/api/auth/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(); status = await response.json();
} catch {
  $('auth-panel').hidden = false; $('auth-notice').textContent = 'The Linux viewer is unavailable. Check that its server is running and reload.';
}
if (status?.authenticated) {
  $('workspace').hidden = false; $('viewer-logout').hidden = false;
  window.addEventListener('viewer-auth-required', () => location.reload());
  $('viewer-logout').onclick = async () => { try { await action('/api/auth/logout'); location.reload(); } catch { $('notice').hidden = false; $('notice').textContent = 'Sign-out failed. Check the connection and try again.'; } };
  $('password-form').onsubmit = async event => {
    event.preventDefault(); const feedback = $('password-notice'); feedback.hidden = true; $('password-submit').disabled = true; $('password-submit').textContent = 'Saving...';
    try {
      await action('/api/auth/password', { currentPassword: $('current-password').value, newPassword: $('new-password').value });
      $('password-form').reset(); $('nav-password-details').open = false; feedback.textContent = 'Password updated. Other viewer sessions are signed out.'; feedback.dataset.state = 'success'; feedback.hidden = false;
    } catch (error) { feedback.textContent = error.message; feedback.dataset.state = 'error'; feedback.hidden = false; }
    finally { $('current-password').value = ''; $('new-password').value = ''; $('password-submit').disabled = false; $('password-submit').textContent = 'Save new password'; }
  };
  try { await import('./app.mjs'); } finally { finishInitialLoading(); }
} else if (status) {
  $('auth-panel').hidden = false;
  const setup = status.setupRequired;
  if (setup) {
    $('auth-title').textContent = 'Make it yours.';
    $('auth-detail').textContent = 'Create the owner account for this viewer. Use a password with at least 12 characters. This is separate from your Hik-Connect account.';
    $('auth-submit').textContent = 'Create viewer account'; $('confirm-label').hidden = false;
    $('viewer-password').minLength = 12; $('viewer-password').autocomplete = 'new-password'; $('viewer-confirm').required = true;
  }
  $('auth-form').onsubmit = async event => {
    event.preventDefault(); $('auth-notice').textContent = '';
    if (setup && $('viewer-password').value !== $('viewer-confirm').value) { $('auth-notice').textContent = 'The passwords do not match.'; return; }
    $('auth-submit').disabled = true;
    try {
      await action(setup ? '/api/auth/setup' : '/api/auth/login', { username: $('viewer-username').value.trim(), password: $('viewer-password').value });
      location.reload();
    } catch (error) { $('auth-notice').textContent = error.message; }
    finally { $('viewer-password').value = ''; $('viewer-confirm').value = ''; $('auth-submit').disabled = false; }
  };
}

finishInitialLoading();
