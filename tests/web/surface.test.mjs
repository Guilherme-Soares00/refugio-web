import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../../', import.meta.url);

test('entrada web local oferece navegação, avisos e módulos sem dependências externas', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8');
  assert.match(html, /lang="pt-BR"/);
  assert.match(html, /href="\/web\/styles.css"/);
  assert.match(html, /type="module" src="\/web\/app.mjs"/);
  for (const name of ['Pontos', 'Minhas ocorrências', 'Gestão', 'Diagnóstico']) assert.ok(html.includes(name));
  assert.match(html, /role="status"/);
  assert.match(html, /<dialog/);
  assert.match(html, /<noscript\s*>/);
  assert.doesNotMatch(html, /https?:\/\//);
  const app = await readFile(new URL('web/app.mjs', base), 'utf8');
  assert.doesNotMatch(app, /innerHTML|localStorage|sessionStorage/);
  assert.match(app, /window.confirm/);
  const css = await readFile(new URL('web/styles.css', base), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media/);
});
