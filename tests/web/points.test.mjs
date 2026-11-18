import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoints } from '../../web/points.mjs';
import { h, latestOnly } from '../../web/ui.mjs';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  get textContent() {
    return this.children.map((child) => child instanceof Element ? child.textContent : String(child)).join('');
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (parent) => {
      for (const child of parent.children) {
        if (!(child instanceof Element)) continue;
        if (selector.startsWith('#') ? child.attributes.id === selector.slice(1) : child.className.split(' ').includes(selector.slice(1))) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  async click() {
    await this.listeners.click?.({ preventDefault() {} });
  }
}

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise(setImmediate);
};

function fixture(t) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const view = new Element('main');
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => view.querySelector(selector),
    querySelectorAll: (selector) => view.querySelectorAll(selector),
  };
  globalThis.fetch = () => { throw new Error('Rede proibida neste teste.'); };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const state = {
    filters: { bairro: 'Centro', status: 'ATIVO', tipoRecurso: '', sort: 'nome,desc' },
    pointUrl: '/api/pontos/busca?page=2&size=6&bairro=Centro&status=ATIVO&sort=nome,desc',
    selectedId: 1,
    requestedId: null,
    authVersion: 0,
    page: 'points',
    point: null,
  };
  const points = [1, 2].map((id) => ({
    id,
    nome: `Ponto ${id}`,
    codigoPublico: `REF-${id}`,
    bairro: 'Centro',
    status: 'ATIVO',
    horarioTexto: '08h–18h',
    logradouro: 'Rua Central',
    numero: String(id),
    cidade: 'São Paulo',
    uf: 'SP',
    _links: { self: { href: `/api/pontos/${id}` }, recursos: { href: `/api/pontos/${id}/recursos` } },
  }));
  const resources = new Map([
    [1, [{ id: 11, pontoId: 1, tipo: 'AGUA', disponivel: true }]],
    [2, [{ id: 22, pontoId: 2, tipo: 'SOMBRA', disponivel: true }]],
  ]);
  let listItems = points;
  const calls = [];
  const failures = [];
  const pending = [];
  let intercept;
  let beforeDelete;
  const collection = (key, items) => ({ _embedded: { [key]: structuredClone(items) } });
  const api = {
    async request(url, options = {}) {
      const call = { url, ...options, method: options.method ?? 'GET' };
      calls.push(call);
      const override = intercept?.(call);
      if (override !== undefined) return override;
      if (call.method === 'DELETE' && url === '/api/recursos/11') {
        await beforeDelete?.();
        resources.set(1, []);
        return null;
      }
      assert.equal(call.method, 'GET');
      if (url.startsWith('/api/pontos/busca?')) return {
        ...collection('pontos', listItems),
        page: { number: 2, totalPages: 4, totalElements: 20 },
        _links: { next: { href: '/api/pontos/busca?page=3&size=6' } },
      };
      const resourceMatch = url.match(/^\/api\/pontos\/(\d+)\/recursos$/);
      if (resourceMatch) return collection('recursos', resources.get(Number(resourceMatch[1])));
      if (/^\/api\/pontos\/\d+\/medicoes\?/.test(url)) return collection('medicoes', []);
      const point = points.find((item) => item._links.self.href === url);
      if (point) return structuredClone(point);
      throw new Error(`Chamada inesperada: ${url}`);
    },
  };
  const gates = { list: latestOnly(), detail: latestOnly(), history: latestOnly() };
  const action = (title, callback, className = 'button') => h('button', { className, onClick: callback }, title);
  const context = {
    view, api, state, gates,
    session: { token: () => 'test-session' },
    manager: () => true,
    action,
    text: (value, className = '') => h('p', { className }, value),
    row: (...children) => h('div', { className: 'actions' }, ...children),
    badge: (value) => h('span', {}, value),
    empty: (...values) => h('div', {}, values),
    loading: (target, value) => {
      target.setAttribute('aria-busy', 'true');
      target.replaceChildren(value);
    },
    fail: (target, error) => { failures.push(error); target.replaceChildren(error.message); },
    pager: (data, navigate) => h('nav', { className: 'pager' }, action('Próxima', () => navigate(data.links.next.href))),
    edit: () => assert.fail('Edição não esperada.'),
    remove: async (url, title, after) => { await api.request(url, { method: 'DELETE', auth: true }); await after(); },
    positiveId: (id) => id,
    showAuth: () => assert.fail('Autenticação não esperada.'),
    flash: () => {},
  };
  const app = createPoints(context);
  const card = (id) => view.querySelectorAll('.point-card').find((node) => node.dataset.id === String(id));
  const detail = () => view.querySelector('#point-detail');
  const deleteResource = () => detail().querySelectorAll('.button').find((node) => node.textContent === 'Excluir').click();
  const defer = (match) => {
    intercept = (call) => {
      if (!match(call)) return;
      const snapshot = collection('recursos', resources.get(1));
      return new Promise((resolve, reject) => pending.push({ call, resolve: (value = snapshot) => resolve(value), reject }));
    };
  };
  return {
    ...app, state, gates, calls, failures, pending, view, card, detail, deleteResource, defer,
    releaseIntercept: () => { intercept = undefined; },
    beforeDelete: (callback) => { beforeDelete = callback; },
    showPoints: (ids) => { listItems = points.filter((point) => ids.includes(point.id)); },
  };
}

test('DELETE do recurso atualiza Água no card sem reconstruir lista, filtros ou paginação', async (t) => {
  const app = fixture(t);
  app.pointsPage();
  await settle();
  const card = app.card(1);
  const otherCard = app.card(2);
  const list = app.view.querySelector('#point-list');
  const pager = list.querySelector('.pager');
  const filter = app.view.querySelector('#filter-bairro');
  const filters = { ...app.state.filters };
  const pointUrl = app.state.pointUrl;
  assert.match(card.textContent, /Água · Disponível/);
  assert.match(app.detail().textContent, /Água/);
  await app.deleteResource();
  await settle();
  assert.match(app.detail().textContent, /Nenhum recurso cadastrado para este ponto\./);
  assert.match(card.textContent, /Nenhum recurso cadastrado\./);
  assert.doesNotMatch(card.textContent, /Água/);
  assert.equal(card.querySelector('.card-resources').getAttribute('aria-busy'), 'false');
  assert.equal(app.card(1), card);
  assert.equal(app.card(2), otherCard);
  assert.match(otherCard.textContent, /Sombra · Disponível/);
  assert.equal(app.view.querySelector('#point-list'), list);
  assert.equal(list.querySelector('.pager'), pager);
  assert.equal(app.view.querySelector('#filter-bairro'), filter);
  assert.deepEqual(app.state.filters, filters);
  assert.equal(app.state.pointUrl, pointUrl);
  assert.equal(app.state.page, 'points');
  assert.equal(app.state.selectedId, 1);
  assert.equal(app.state.point.id, 1);
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.equal(otherCard.getAttribute('aria-pressed'), 'false');
  assert.equal(app.calls.filter((call) => call.url.startsWith('/api/pontos/busca?')).length, 1);
  assert.equal(app.calls.filter((call) => call.url === '/api/pontos/2/recursos').length, 1);
  assert.equal(app.calls.filter((call) => call.method === 'DELETE').length, 1);
  assert.deepEqual(app.failures, []);
});

for (const outcome of ['resposta', 'erro']) {
  test(`DELETE invalida resultado antigo (${outcome}) do resumo mesmo se a API ignorar abort`, async (t) => {
    const app = fixture(t);
    let first = true;
    app.defer((call) => {
      if (first && call.url === '/api/pontos/1/recursos') {
        first = false;
        return true;
      }
      return false;
    });
    app.pointsPage();
    await settle();
    assert.equal(app.pending.length, 1);
    const obsolete = app.pending[0];
    assert.match(app.detail().textContent, /Água/);
    assert.equal(obsolete.call.signal.aborted, false);
    await app.deleteResource();
    await settle();
    assert.equal(obsolete.call.signal.aborted, true);
    assert.match(app.card(1).textContent, /Nenhum recurso cadastrado\./);
    if (outcome === 'resposta') obsolete.resolve();
    else obsolete.reject(new Error('Falha antiga.'));
    await settle();
    assert.match(app.card(1).textContent, /Nenhum recurso cadastrado\./);
    assert.doesNotMatch(app.card(1).textContent, /Água|Não foi possível/);
    assert.equal(app.state.selectedId, 1);
    assert.deepEqual(app.failures, []);
  });
}

test('DELETE atrasado não retoma detalhe antigo depois de selecionar outro ponto', async (t) => {
  const app = fixture(t);
  app.pointsPage();
  await settle();
  let release;
  app.beforeDelete(() => new Promise((resolve) => { release = resolve; }));
  const deletion = app.deleteResource();
  await app.card(2).click();
  await settle();
  assert.equal(app.state.selectedId, 2);
  const selectedDetail = app.detail().children[0];
  release();
  await deletion;
  await settle();
  assert.match(app.card(1).textContent, /Nenhum recurso cadastrado\./);
  assert.equal(app.state.selectedId, 2);
  assert.equal(app.state.point.id, 2);
  assert.equal(app.detail().children[0], selectedDetail);
  assert.equal(app.card(2).getAttribute('aria-pressed'), 'true');
  assert.equal(app.calls.filter((call) => call.url === '/api/pontos/1').length, 1);
  assert.deepEqual(app.failures, []);
});

test('DELETE pendente atualiza o detalhe ao voltar ao mesmo ponto', async (t) => {
  const app = fixture(t);
  app.pointsPage();
  await settle();
  let release;
  app.beforeDelete(() => new Promise((resolve) => { release = resolve; }));
  const deletion = app.deleteResource();
  await app.card(2).click();
  await settle();
  await app.card(1).click();
  await settle();
  assert.match(app.detail().textContent, /Água/);
  release();
  await deletion;
  await settle();
  assert.equal(app.state.selectedId, 1);
  assert.match(app.card(1).textContent, /Nenhum recurso cadastrado\./);
  assert.match(app.detail().textContent, /Nenhum recurso cadastrado para este ponto\./);
  assert.doesNotMatch(app.detail().textContent, /Água/);
  assert.equal(app.calls.filter((call) => call.url.startsWith('/api/pontos/busca?')).length, 1);
  assert.deepEqual(app.failures, []);
});

test('DELETE atrasado não consulta slots da página anterior nem muda a nova seleção', async (t) => {
  const app = fixture(t);
  app.pointsPage();
  await settle();
  let release;
  app.beforeDelete(() => new Promise((resolve) => { release = resolve; }));
  const deletion = app.deleteResource();
  app.showPoints([2]);
  await app.view.querySelector('#point-list').querySelector('.pager').children[0].click();
  await settle();
  assert.equal(app.card(1), undefined);
  assert.equal(app.state.selectedId, 2);
  const resourcesBefore = app.calls.filter((call) => call.url === '/api/pontos/1/recursos').length;
  const pointUrl = app.state.pointUrl;
  release();
  await deletion;
  await settle();
  assert.equal(app.calls.filter((call) => call.url === '/api/pontos/1/recursos').length, resourcesBefore);
  assert.equal(app.state.selectedId, 2);
  assert.equal(app.state.point.id, 2);
  assert.equal(app.state.pointUrl, pointUrl);
  assert.equal(app.calls.filter((call) => call.url.startsWith('/api/pontos/busca?')).length, 2);
  assert.deepEqual(app.failures, []);
});

test('troca de página aborta consulta do resumo e ignora resposta que chega tarde', async (t) => {
  const app = fixture(t);
  let first = true;
  app.defer((call) => {
    if (first && call.url === '/api/pontos/1/recursos') {
      first = false;
      return true;
    }
    return false;
  });
  app.pointsPage();
  await settle();
  const obsolete = app.pending[0];
  const oldCard = app.card(1);
  app.showPoints([2]);
  await app.view.querySelector('#point-list').querySelector('.pager').children[0].click();
  await settle();
  assert.equal(obsolete.call.signal.aborted, true);
  obsolete.resolve();
  await settle();
  assert.match(oldCard.textContent, /Consultando recursos/);
  assert.equal(app.card(1), undefined);
  assert.match(app.card(2).textContent, /Sombra · Disponível/);
  assert.equal(app.state.selectedId, 2);
  assert.deepEqual(app.failures, []);
});

test('DELETE concluído após sair da tela não reabre pontos nem consulta card cancelado', async (t) => {
  const app = fixture(t);
  app.pointsPage();
  await settle();
  let release;
  app.beforeDelete(() => new Promise((resolve) => { release = resolve; }));
  const deletion = app.deleteResource();
  for (const gate of Object.values(app.gates)) gate.cancel();
  app.state.page = 'reports';
  const destination = new Element('section');
  app.view.replaceChildren(destination);
  const countBefore = app.calls.length;
  release();
  await deletion;
  await settle();
  assert.equal(app.calls.length, countBefore);
  assert.equal(app.state.page, 'reports');
  assert.deepEqual(app.view.children, [destination]);
  assert.deepEqual(app.failures, []);
});
