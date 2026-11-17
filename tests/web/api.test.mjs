import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, readCollection, createSession } from '../../web/api.mjs';

test('consulta pública envia Accept HAL sem Authorization', async () => {
  let called;
  const api = createClient({
    origin: 'http://localhost:8080',
    fetcher: async (...args) => {
      called = args;
      return new Response('{"page":{"number":0}}', { headers: { 'Content-Type': 'application/hal+json' } });
    },
  });
  assert.deepEqual(await api.request('/api/pontos'), { page: { number: 0 } });
  assert.equal(called[0], 'http://localhost:8080/api/pontos');
  assert.match(called[1].headers.Accept, /hal/);
  assert.equal(called[1].headers.Authorization, undefined);
});

test('DELETE 204 não tenta interpretar JSON', async () => {
  let options;
  const api = createClient({
    origin: 'http://localhost',
    fetcher: async (url, init) => {
      options = init;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await api.request('/api/pontos/1', { method: 'DELETE' }), null);
  assert.equal(options.method, 'DELETE');
});

test('erros HTTP padronizados conservam status, mensagem e path', async () => {
  for (const status of [400, 401, 403, 404, 409, 500]) {
    const api = createClient({
      origin: 'http://localhost',
      fetcher: async () =>
        new Response(JSON.stringify({ status, mensagem: 'Operação rejeitada', path: '/api/pontos' }), { status }),
    });
    await assert.rejects(
      api.request('/api/pontos'),
      (error) =>
        error.status === status &&
        error.message === `HTTP ${status}: Operação rejeitada` &&
        error.path === '/api/pontos',
    );
  }
});

test('Authorization só em chamada autenticada e 401 só invalida seu token original', async () => {
  let token = 'session-a';
  let invalidated = 0;
  const calls = [];
  const api = createClient({
    origin: 'http://localhost',
    getToken: () => token,
    onUnauthorized: () => invalidated++,
    fetcher: async (url, init) => {
      calls.push(init);
      return new Response('{"mensagem":"Inválido"}', { status: 401 });
    },
  });
  await assert.rejects(api.request('/api/auth/login'));
  assert.equal(invalidated, 0);
  await assert.rejects(api.request('/api/ocorrencias/minhas', { auth: true }));
  assert.equal(calls[1].headers.Authorization, 'Bearer session-a');
  assert.equal(invalidated, 1);
  token = null;
  await assert.rejects(api.request('/api/ocorrencias/minhas', { auth: true }), /Entre/);
  assert.equal(calls.length, 2);
});

test('links externos, credenciais na URL e redirecionamentos não vazam token', async () => {
  const calls = [];
  const api = createClient({
    origin: 'http://localhost:8080',
    getToken: () => 'secret-session',
    fetcher: async (url, init) => {
      calls.push(init);
      return new Response('{}');
    },
  });
  for (const link of [
    'https://evil.test/api',
    '//evil.test/api',
    'http://localhost:8080.evil.test/',
    'javascript:alert(1)',
    'http://user:pass@localhost:8080/api',
  ]) {
    await assert.rejects(api.request(link, { auth: true }), /origem/);
  }
  assert.equal(calls.length, 0);
  await api.request('http://localhost:8080/api/pontos', { auth: true });
  assert.equal(calls[0].redirect, 'error');
});

test('payload JSON e AbortSignal são enviados sem transformar campos', async () => {
  let init;
  const controller = new AbortController();
  const payload = { pontoId: 2, disponivel: false, tipo: 'AGUA' };
  const api = createClient({
    origin: 'http://localhost',
    fetcher: async (url, options) => {
      init = options;
      return new Response('{}');
    },
  });
  await api.request('/api/recursos', { method: 'POST', body: payload, signal: controller.signal });
  assert.deepEqual(JSON.parse(init.body), payload);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.signal, controller.signal);
});

test('sessão lê sub e exp reais, limita expiresIn e limpa ao expirar sem persistência', () => {
  let now = 100000;
  const session = createSession(() => now);
  const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  session.set({ accessToken: jwt({ sub: '12', exp: 150 }), tipo: 'Bearer', expiresIn: 20 });
  assert.equal(session.userId(), '12');
  assert.equal(session.expiresAt(), 120000);
  assert.ok(session.token());
  now = 120000;
  assert.equal(session.token(), null);
  assert.equal(session.userId(), null);
  assert.throws(() => session.set({ accessToken: 'bad', expiresIn: 20 }), /inválid/);
  assert.throws(() => session.set({ accessToken: jwt({ sub: '12', exp: 110 }), expiresIn: 20 }), /expir/);
});

test('401 atrasado de sessão anterior não encerra a nova sessão', async () => {
  let token = 'old';
  let finish;
  let resets = 0;
  const api = createClient({
    origin: 'http://localhost',
    getToken: () => token,
    onUnauthorized: () => resets++,
    fetcher: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = api.request('/api/ocorrencias/minhas', { auth: true });
  token = 'new';
  finish(new Response('{}', { status: 401 }));
  await assert.rejects(pending);
  assert.equal(resets, 0);
});

test('falha de rede apresenta orientação em português sem perder cancelamento', async () => {
  const api = createClient({
    origin: 'http://localhost',
    fetcher: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(api.request('/api/pontos'), /Não foi possível conectar/);
  const aborted = createClient({
    origin: 'http://localhost',
    fetcher: async () => {
      throw new DOMException('cancelled', 'AbortError');
    },
  });
  await assert.rejects(aborted.request('/api/pontos'), (error) => error.name === 'AbortError');
});

test('HAL vazio e coleções nomeadas preservam paginação e links', () => {
  assert.deepEqual(readCollection({}, 'pontos').items, []);
  for (const key of ['pontos', 'medicoes', 'ocorrencias', 'recursos']) {
    const data = readCollection(
      {
        _embedded: { [key]: [{ id: 7 }] },
        page: { number: 1, totalPages: 3, totalElements: 14 },
        _links: { next: { href: '/api/pontos?page=2' } },
      },
      key,
    );
    assert.equal(data.items[0].id, 7);
    assert.equal(data.page.number, 1);
    assert.equal(data.links.next.href, '/api/pontos?page=2');
  }
});
