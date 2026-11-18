import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { createWebServer } from '../server.mjs';

async function fixture(t, setup = async () => {}) {
  const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'refugio-web-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'web'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html lang="pt-BR"><title>Refúgio</title></html>');
  await writeFile(join(root, 'web', 'app.mjs'), 'export const pronto = true;');
  await writeFile(join(root, '.env'), 'NAO_PUBLICAR');
  await setup(root);
  const server = createWebServer({ root, apiUrl: 'http://127.0.0.1:8080' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('serve index e módulos locais sem publicar arquivos privados', async t => {
  const origin = await fixture(t);
  const index = await fetch(origin);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /Refúgio/);
  const script = await fetch(origin + '/web/app.mjs');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of ['/.env', '/server.mjs', '/package.json', '/web/ausente.mjs']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  assert.equal((await fetch(origin)).headers.get('x-content-type-options'), 'nosniff');
});

test('serve fonte local WOFF2 sem permitir extensões arbitrárias', async t => {
  const origin = await fixture(t, async root => {
    await mkdir(join(root, 'web', 'assets', 'fonts'), { recursive: true });
    await writeFile(join(root, 'web', 'assets', 'fonts', 'roboto-latin.woff2'), Buffer.from('wOF2'));
    await writeFile(join(root, 'web', 'arquivo.bin'), 'privado');
  });
  const font = await fetch(origin + '/web/assets/fonts/roboto-latin.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(await font.text(), 'wOF2');
  assert.equal((await fetch(origin + '/web/arquivo.bin')).status, 404);
});

function rawRequest(origin, path, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(origin, { path, ...options }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

test('bloqueia traversal codificado antes de resolver arquivos estáticos', async t => {
  const origin = await fixture(t, root => writeFile(join(root, 'server.mjs'), 'CODIGO_PRIVADO'));
  for (const path of ['/server.mjs', '/web/..%2fserver.mjs', '/web/%2e%2e%2fserver.mjs',
    '/web/../server.mjs', '/web/%2e%2e/server.mjs', '/web/../web/app.mjs']) {
    const response = await rawRequest(origin, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /CODIGO_PRIVADO/);
  }
});

test('destino canônico dos assets fica dentro de web, mesmo com symlinks', async t => {
  const outside = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'refugio-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.mjs'), 'SEGREDO_EXTERNO');
  const paths = ['/web/root/server.mjs', '/web/outside/secret.mjs', '/web/linked/secret.mjs'];
  const origin = await fixture(t, async root => {
    await writeFile(join(root, 'server.mjs'), 'CODIGO_PRIVADO');
    await symlink(root, join(root, 'web', 'root'), 'junction');
    await symlink(outside, join(root, 'web', 'outside'), 'junction');
    await mkdir(join(root, 'web', 'local'));
    await writeFile(join(root, 'web', 'local', 'app.mjs'), 'export const pronto = true;');
    await symlink(join(root, 'web', 'local'), join(root, 'web', 'allowed'), 'junction');
    await mkdir(join(root, 'web-private'));
    await writeFile(join(root, 'web-private', 'secret.mjs'), 'SEGREDO_PREFIXO');
    await symlink(join(root, 'web-private'), join(root, 'web', 'linked'), 'junction');
    try {
      await symlink(join(root, 'server.mjs'), join(root, 'web', 'root.mjs'), 'file');
      await symlink(join(outside, 'secret.mjs'), join(root, 'web', 'outside.mjs'), 'file');
      paths.push('/web/root.mjs', '/web/outside.mjs');
    } catch (cause) {
      if (process.platform !== 'win32' || cause.code !== 'EPERM') throw cause;
      t.diagnostic('Windows não permite symlink de arquivo neste processo; escapes exercitados por junctions reais.');
    }
  });
  for (const path of paths) {
    const response = await rawRequest(origin, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /CODIGO_PRIVADO|SEGREDO/);
  }
  assert.equal((await rawRequest(origin, '/web/allowed/app.mjs')).status, 200);
  assert.equal((await rawRequest(origin, '/index.html')).status, 200);
});

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return 'http://127.0.0.1:' + server.address().port;
}

test('proxy preserva método, corpo, JWT e Host para links HAL na origem web', async t => {
  const captured = [];
  const upstream = await listen(t, createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    captured.push({ method: request.method, url: request.url, host: request.headers.host,
      authorization: request.headers.authorization, cookie: request.headers.cookie, body });
    response.writeHead(201, { 'Content-Type': 'application/hal+json', 'Location': `http://${request.headers.host}/api/pontos/42` });
    response.end(JSON.stringify({ id: 42, _links: { self: { href: `http://${request.headers.host}/api/pontos/42` } } }));
  }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream }));
  const response = await fetch(origin + '/api/pontos?size=6', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-de-teste', Cookie: 'privado=nao-encaminhar' },
    body: JSON.stringify({ nome: 'Ponto de teste' }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), origin + '/api/pontos/42');
  assert.equal((await response.json())._links.self.href, origin + '/api/pontos/42');
  assert.equal(captured[0].method, 'POST');
  assert.equal(captured[0].url, '/api/pontos?size=6');
  assert.equal(captured[0].host, new URL(origin).host);
  assert.equal(captured[0].authorization, 'Bearer token-de-teste');
  assert.equal(captured[0].cookie, undefined);
  assert.deepEqual(JSON.parse(captured[0].body), { nome: 'Ponto de teste' });
});

test('proxy conserva 204 e erros JSON sem transformar respostas de negócio em sucesso', async t => {
  const upstream = await listen(t, createServer((request, response) => {
    const status = Number(new URL(request.url, 'http://localhost').searchParams.get('status'));
    response.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': 'nao=publicar' });
    response.end(status === 204 ? undefined : JSON.stringify({ status, mensagem: 'Erro controlado de teste' }));
  }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream }));
  for (const status of [204, 400, 401, 403, 404, 409, 500]) {
    const response = await fetch(origin + '/api/pontos?status=' + status, { method: 'PATCH' });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (status === 204) assert.equal(await response.text(), '');
    else assert.equal((await response.json()).status, status);
  }
  assert.equal((await fetch(origin + '/actuator/env')).status, 404);
  assert.equal((await fetch(origin + '/.git/config')).status, 404);
});

test('falha da API retorna 502 sem detalhes internos', async t => {
  const unavailable = createServer();
  const api = await listen(t, unavailable);
  await new Promise(resolve => unavailable.close(resolve));
  const origin = await listen(t, createWebServer({ apiUrl: api }));
  const response = await fetch(origin + '/api/pontos');
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /API_BASE_URL/);
  assert.doesNotMatch(text, /ECONNREFUSED|stack|127\.0\.0\.1/);
});

test('proxy limita tempo de espera e tamanho de corpo', async t => {
  const upstream = await listen(t, createServer(() => {}));
  const origin = await listen(t, createWebServer({ apiUrl: upstream, timeoutMs: 30 }));
  const delayed = await fetch(origin + '/api/pontos');
  assert.equal(delayed.status, 504);
  const large = await fetch(origin + '/api/pontos', { method: 'POST', body: 'a'.repeat(1024 * 1024 + 1) });
  assert.equal(large.status, 413);
});

test('deadline encerra resposta contínua e cancela upstream após os headers', async t => {
  let closed;
  let upstreamFinished = false;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const upstream = await listen(t, createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('inicio');
    const interval = setInterval(() => response.write('.'), 15);
    const end = setTimeout(() => { upstreamFinished = true; response.end('fim'); }, 180);
    response.on('close', () => { clearInterval(interval); clearTimeout(end); closed(); });
  }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream, timeoutMs: 40 }));
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(origin + '/api/pontos', response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', () => {});
      response.on('close', () => resolve({ status: response.statusCode, complete: response.complete, body }));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(result.status, 200);
  assert.equal(result.complete, false, 'o fluxo deve ser interrompido, sem enviar outro status');
  assert.match(result.body, /^inicio/);
  assert.doesNotMatch(result.body, /fim|504|mensagem/);
  await upstreamClosed;
  assert.equal(upstreamFinished, false, 'o upstream deve ser cancelado, não apenas a conexão com o cliente');
});

test('deadline começa antes do upload lento e não abre upstream após expirar', async t => {
  let calls = 0;
  const upstream = await listen(t, createServer((request, response) => { calls++; response.end('ok'); }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream, timeoutMs: 40 }));
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(origin + '/api/pontos', { method: 'POST' }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => { resolve({ status: response.statusCode, body }); request.destroy(); });
      response.on('error', reject);
    });
    const interval = setInterval(() => request.write('a'), 15);
    const end = setTimeout(() => { clearInterval(interval); request.end('fim'); }, 180);
    const cleanup = () => { clearInterval(interval); clearTimeout(end); };
    request.on('close', cleanup);
    request.on('error', reject);
    t.after(() => { cleanup(); request.destroy(); });
    request.write('inicio');
  });
  assert.equal(response.status, 504);
  assert.equal(JSON.parse(response.body).status, 504);
  assert.equal(calls, 0);
});

test('deadline do upload e da resposta usa o mesmo orçamento', async t => {
  const upstream = await listen(t, createServer((request, response) => {
    const timer = setTimeout(() => response.end('tarde'), 100);
    response.once('close', () => clearTimeout(timer));
  }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream, timeoutMs: 150 }));
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(origin + '/api/pontos', { method: 'POST' }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.write('inicio');
    const timer = setTimeout(() => request.end('fim'), 100);
    t.after(() => { clearTimeout(timer); request.destroy(); });
  });
  assert.equal(result, 504);
});

test('cliente abortado cancela upstream antes e depois dos headers', async t => {
  for (const headersSent of [false, true]) {
    await t.test(headersSent ? 'durante a resposta' : 'aguardando headers', { timeout: 500 }, async t => {
      let started;
      let closed;
      const upstreamStarted = new Promise(resolve => { started = resolve; });
      const upstreamClosed = new Promise(resolve => { closed = resolve; });
      const upstream = await listen(t, createServer((request, response) => {
        response.once('close', closed);
        if (headersSent) response.write('inicio');
        started();
      }));
      const origin = await listen(t, createWebServer({ apiUrl: upstream, timeoutMs: 3000 }));
      const request = httpRequest(origin + '/api/pontos');
      request.on('error', () => {});
      t.after(() => request.destroy());
      const received = headersSent ? once(request, 'response') : null;
      request.end();
      await upstreamStarted;
      if (received) {
        const [response] = await received;
        response.on('error', () => {});
        response.resume();
      }
      request.destroy();
      await upstreamClosed;
    });
  }
});

test('upload abortado não abre upstream nem causa erro não tratado', async t => {
  let calls = 0;
  const upstream = await listen(t, createServer((request, response) => { calls++; response.end(); }));
  const server = createWebServer({ apiUrl: upstream, timeoutMs: 40 });
  const origin = await listen(t, server);
  const incoming = once(server, 'request');
  const request = httpRequest(origin + '/api/pontos', { method: 'POST' });
  request.on('error', () => {});
  request.write('incompleto');
  const [received] = await incoming;
  const closed = once(received, 'close').catch(cause => {
    assert.equal(cause.code, 'ECONNRESET');
  });
  request.destroy();
  await closed;
  assert.equal(calls, 0);
});

test('aceita corpo exatamente no limite de 1 MiB', async t => {
  let length = 0;
  const upstream = await listen(t, createServer(async (request, response) => {
    for await (const chunk of request) length += chunk.length;
    response.end('ok');
  }));
  const origin = await listen(t, createWebServer({ apiUrl: upstream }));
  const response = await fetch(origin + '/api/pontos', { method: 'POST', body: 'a'.repeat(1024 * 1024) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.equal(length, 1024 * 1024);
});

test('configuração de upstream rejeita credenciais, caminhos e protocolos não HTTP', () => {
  for (const apiUrl of ['file:///c:/privado', 'http://usuario:senha@localhost', 'http://localhost/api', 'http://localhost/?chave=1']) {
    assert.throws(() => createWebServer({ apiUrl }), /API_BASE_URL/);
  }
});
