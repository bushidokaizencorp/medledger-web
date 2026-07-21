'use strict';
// Tiny API client with auth + a friendly error surface.
const API = (() => {
  const token = () => sessionStorage.getItem('access_token');
  async function req(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/pages/login.html'; throw new Error('unauth'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    patch: (p, b) => req('PATCH', p, b),
    user: () => JSON.parse(sessionStorage.getItem('user') || '{}'),
  };
})();
