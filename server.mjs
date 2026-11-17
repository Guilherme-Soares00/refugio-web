import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function error(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ status, mensagem: message }));
}

function apiPath(path) {
  return path === '/api' || path.startsWith('/api/')
    || ['/actuator/health', '/actuator/info', '/actuator/metrics', '/swagger-ui.html', '/v3/api-docs'].includes(path)
    || path.startsWith('/actuator/metrics/') || path.startsWith('/swagger-ui/') || path.startsWith('/v3/api-docs/');
}

async function proxy(request, response, upstream, timeoutMs) {
  let remote;
  let stopReading = () => {};
  const cancel = () => { stopReading(); remote?.destroy(); };
  const deadline = setTimeout(() => {
    cancel();
    if (!response.headersSent && !response.destroyed) error(response, 504, 'A API demorou para responder. Tente novamente.');
    else if (!response.writableEnded) response.destroy();
  }, timeoutMs);
  response.once('finish', () => { clearTimeout(deadline); stopReading(); });
  response.once('close', () => {
    clearTimeout(deadline);
    if (!response.writableFinished) cancel();
  });
  const aborted = () => { clearTimeout(deadline); cancel(); response.destroy(); };
  request.once('aborted', aborted);
  request.once('error', aborted);
  const body = await new Promise(resolveBody => {
    const chunks = [];
    let length = 0;
    const done = body => {
      request.off('data', data);
      request.off('end', end);
      stopReading = () => {};
      resolveBody(body);
    };
    const data = chunk => {
      length += chunk.length;
      if (length > 1024 * 1024) {
        done(null);
        error(response, 413, 'Corpo da requisição excede 1 MiB');
      } else chunks.push(chunk);
    };
    const end = () => done(Buffer.concat(chunks));
    stopReading = () => done(null);
    request.on('data', data);
    request.once('end', end);
  });
  if (body === null || response.destroyed || response.writableEnded) return;
  const headers = { host: request.headers.host };
  for (const name of ['authorization', 'content-type', 'accept', 'origin']) {
    if (request.headers[name]) headers[name] = request.headers[name];
  }
  if (body.length) headers['content-length'] = body.length;
  const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  remote = send({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
    method: request.method, path: request.url, headers }, received => {
    const outgoing = { ...received.headers, 'cache-control': 'no-store' };
    delete outgoing['set-cookie'];
    delete outgoing.connection;
    response.writeHead(received.statusCode, outgoing);
    received.pipe(response);
    received.on('error', () => response.destroy());
  });
  remote.on('error', () => {
    if (!response.headersSent && !response.destroyed && !response.writableEnded) error(response, 502, 'Não foi possível conectar à API. Inicie o backend e confira API_BASE_URL.');
    else if (!response.writableEnded) response.destroy();
  });
  remote.end(body);
}

export function createWebServer({ root = directory, apiUrl = process.env.API_BASE_URL || 'http://localhost:8080', timeoutMs = 15000 } = {}) {
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password
      || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('API_BASE_URL deve ser uma origem HTTP ou HTTPS, sem credenciais ou caminho');
  }
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (!request.url.startsWith('/') || request.url.startsWith('//')) return error(response, 400, 'Caminho inválido');
      const path = decodeURIComponent(request.url.split(/[?#]/, 1)[0]);
      if (path.split('/').includes('..')) return error(response, 404, 'Arquivo não encontrado');
      if (path.includes('\\') || path.includes('\0')) return error(response, 400, 'Caminho inválido');
      if (apiPath(path)) return await proxy(request, response, upstream, timeoutMs);
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return error(response, 405, 'Método não permitido');
      }
      const asset = path === '/' || path === '/index.html' ? 'index.html' : path.slice(1);
      if (asset !== 'index.html' && !asset.startsWith('web/')) return error(response, 404, 'Arquivo não encontrado');
      const type = types[extname(asset)];
      if (!type) return error(response, 404, 'Arquivo não encontrado');
      const base = await realpath(root);
      const file = await realpath(resolve(base, asset));
      if (asset === 'index.html' ? file !== resolve(base, 'index.html')
        : !file.startsWith(resolve(base, 'web') + sep)) return error(response, 404, 'Arquivo não encontrado');
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (cause) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(cause.code)) return error(response, 404, 'Arquivo não encontrado');
      if (cause instanceof URIError) return error(response, 400, 'Caminho inválido');
      error(response, 500, 'Não foi possível atender à requisição');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve estar entre 1 e 65535');
  const server = createWebServer();
  server.on('error', cause => {
    console.error(cause.code === 'EADDRINUSE' ? 'Porta ocupada. Pare o servidor anterior ou configure PORT.' : 'Não foi possível iniciar o servidor web.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Refúgio web: http://localhost:${port}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
