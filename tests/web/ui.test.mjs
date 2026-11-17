import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly, safeJson, label, formatDate, h, withSubmissionLock, selectionForPage } from '../../web/ui.mjs';

test('DOM exibe conteúdo como texto, nunca interpreta HTML recebido', () => {
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      children: [],
      attributes: {},
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      append(...items) {
        this.children.push(...items);
      },
      addEventListener() {},
    }),
  };
  const node = h('p', { className: 'message' }, '<img src=x onerror=alert(1)>');
  assert.equal(node.children[0], '<img src=x onerror=alert(1)>');
  assert.equal(node.className, 'message');
  assert.equal('innerHTML' in node, false);
  const button = h('button', {}, 'Próxima');
  const controls = h('div', {}, [[button]], [null, undefined]);
  assert.equal(controls.children.length, 1);
  assert.equal(controls.children[0], button);
  delete globalThis.document;
});

test('atributo list respeita a propriedade somente leitura do input nativo', () => {
  globalThis.document = {
    createElement: () => ({
      get list() {
        return null;
      },
      attributes: {},
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      append() {},
      addEventListener() {},
    }),
  };
  const input = h('input', { list: 'metric-options', required: true });
  assert.equal(input.attributes.list, 'metric-options');
  assert.equal(input.list, null);
  delete globalThis.document;
});

test('submits duplicados são bloqueados até finalizar inclusive após erro', async () => {
  let resolve;
  let calls = 0;
  const changes = [];
  const submit = withSubmissionLock(
    async () => {
      calls++;
      await new Promise((done) => {
        resolve = done;
      });
    },
    (busy) => changes.push(busy),
  );
  const first = submit();
  await submit();
  assert.equal(calls, 1);
  resolve();
  await first;
  assert.deepEqual(changes, [true, false]);
  const fail = withSubmissionLock(
    async () => {
      throw new Error('erro');
    },
    (busy) => changes.push(busy),
  );
  await assert.rejects(fail(), /erro/);
  assert.deepEqual(changes.slice(-2), [true, false]);
});

test('abrir ponto por ID não é sobrescrito pela primeira página da busca', () => {
  const items = [{ id: 1 }, { id: 2 }];
  assert.equal(selectionForPage(items, 2, null).id, 2);
  assert.equal(selectionForPage(items, null, 99).id, 99);
  assert.equal(selectionForPage(items, 99, null).id, 1);
  assert.equal(selectionForPage([], null, null), null);
});

test('troca de detalhe ou autenticação invalida respostas antigas', () => {
  const latest = latestOnly();
  const first = latest.begin();
  assert.equal(first.current(), true);
  const second = latest.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.current(), false);
  latest.cancel();
  assert.equal(second.current(), false);
});

test('diagnóstico omite campos sigilosos inclusive objetos aninhados e JWTs', () => {
  const json = safeJson(
    {
      status: 'UP',
      accessToken: 'hidden-token',
      nested: { Authorization: 'Bearer private', senha: 'private', JWT_SECRET: 'private', value: 'secret-current' },
      sample: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    },
    'secret-current',
  );
  assert.ok(json.includes('UP'));
  assert.ok(!json.includes('private'));
  assert.ok(!json.includes('hidden-token'));
  assert.ok(!json.includes('secret-current'));
  assert.ok(!json.includes('eyJhbGci'));
  assert.equal(label('SEM_AGUA'), 'Sem água');
  assert.equal(formatDate(null), 'Não informado');
});
