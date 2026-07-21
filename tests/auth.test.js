import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app;
beforeAll(async () => {
  const mod = await import('../src/app.js');
  app = mod.createApp();
});

const LOGIN = { email: 'admin@bushidokaizen.co.zw', password: 'ChangeMe123!' };

describe('auth', () => {
  it('health and readiness respond', async () => {
    expect((await request(app).get('/healthz')).status).toBe(200);
    const r = await request(app).get('/readyz');
    expect(r.body.ok).toBe(true);
  });

  it('logs in with valid credentials', async () => {
    const r = await request(app).post('/api/auth/login').send(LOGIN);
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe('bearer');
    expect(r.body.user.role).toBe('ADMIN');
    expect(r.headers['set-cookie'].join()).toMatch(/HttpOnly/i);
  });

  it('rejects a wrong password without revealing the account exists', async () => {
    const wrong = await request(app).post('/api/auth/login')
      .send({ email: LOGIN.email, password: 'nope' });
    const unknown = await request(app).post('/api/auth/login')
      .send({ email: 'ghost@nowhere.co.zw', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it('validates input shape', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });
    expect(r.status).toBe(422);
  });

  it('protects /me and accepts a bearer token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send(LOGIN);
    const me = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(LOGIN.email);
  });

  it('refreshes an access token', async () => {
    const login = await request(app).post('/api/auth/login').send(LOGIN);
    const r = await request(app).post('/api/auth/refresh')
      .send({ refresh_token: login.body.refresh_token });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTruthy();
  });

  it('revokes the refresh token on logout', async () => {
    const login = await request(app).post('/api/auth/login').send(LOGIN);
    const rt = login.body.refresh_token;
    await request(app).post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ refresh_token: rt });
    const after = await request(app).post('/api/auth/refresh').send({ refresh_token: rt });
    expect(after.status).toBe(401);
  });

  it('sets security headers and hides the framework', async () => {
    const r = await request(app).get('/healthz');
    expect(r.headers['content-security-policy']).toBeTruthy();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
