'use strict';
// Minimal login client. Talks to /api/auth/login and, on success, stores the
// token and redirects to the app shell.
(function () {
  const emailEl = document.getElementById('email');
  const passEl = document.getElementById('password');
  const btn = document.getElementById('signin');
  const errEl = document.getElementById('error');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
  }
  function clearError() {
    errEl.classList.remove('show');
  }

  async function signIn() {
    clearError();
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Sign in failed.');
        return;
      }
      // Access token also set as httpOnly cookie; keep a copy for API calls.
      sessionStorage.setItem('access_token', data.access_token);
      sessionStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/pages/app.html';
    } catch (e) {
      showError('Could not reach the server. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  btn.addEventListener('click', signIn);
  passEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') signIn();
  });
})();
