import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, base), 'utf8');

test('identidade visual usa os tokens, Roboto local e marca do Mobile', async () => {
  const css = await read('web/styles.css');
  const html = await read('index.html');
  for (const color of ['#145c56', '#f5f7f2', '#183e38', '#171f1b', '#526561', '#39775c', '#e0ede5', '#dde6df', '#945f28']) {
    assert.ok(css.includes(color), `Token Mobile ausente: ${color}`);
  }
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*'Roboto'/s);
  assert.match(css, /url\(['"]?\/web\/assets\/fonts\/roboto-latin\.woff2/);
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /--radius:\s*18px/);
  assert.match(css, /--control-radius:\s*12px/);
  assert.match(html, /src="\/web\/assets\/icons\/wb_shade.svg"/);
  assert.doesNotMatch(html, />r\.<|REDE DE ALÍVIO/);
  assert.match(html, /data-view="pontos"[^>]*>Explorar</);
});

test('explorar mantém hierarquia Mobile e disponibilidade real em cards e detalhe', async () => {
  const points = await read('web/points.mjs');
  assert.match(points, /Uma pausa perto do seu caminho\./);
  assert.match(points, /Veja os recursos de cada ponto antes de sair\./);
  assert.match(points, /card-neighborhood[\s\S]*point\.bairro[\s\S]*h\('h3', \{\}, point\.nome\)/);
  assert.match(points, /card-meta[\s\S]*point\.codigoPublico[\s\S]*point\.horarioTexto/);
  assert.match(points, /Ver detalhes →/);
  assert.match(points, /detail-symbol/);
  assert.match(points, /O que você encontra/);
  assert.match(points, /Última medição/);
  assert.match(points, /status-icon \$\{resource\.disponivel \? 'available' : 'unavailable'\}/);
  assert.match(points, /card-resources/);
  assert.doesNotMatch(points, /Favoritos|filter-nome|filter-codigo/);
  assert.match(points, /tabIndex: -1/);
  assert.match(points, /matchMedia\('\(max-width: 860px\)'\)/);
  assert.match(points, /focus\(\{ preventScroll: true \}\)/);
  assert.match(points, /window\.scrollTo/);
});

test('temperatura preserva valor real com formato brasileiro do Mobile', async () => {
  const ui = await import('../../web/ui.mjs');
  assert.equal(typeof ui.formatTemperature, 'function');
  assert.equal(ui.formatTemperature(28.7), '28,7 °C');
  assert.equal(ui.formatTemperature(32), '32,0 °C');
  assert.equal(ui.formatTemperature(-1.2), '-1,2 °C');
});
