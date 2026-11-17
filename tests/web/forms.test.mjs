import test from 'node:test';
import assert from 'node:assert/strict';
import { payloadFor, fieldsFor, makeForm } from '../../web/forms.mjs';

test('formulário nativo associa rótulos e mantém false no recurso editado', () => {
  const nodes = [];
  globalThis.document = {
    createElement: (tag) => {
      const node = {
        tagName: tag,
        children: [],
        attributes: {},
        value: '',
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        append(...items) {
          this.children.push(...items);
        },
        addEventListener() {},
      };
      nodes.push(node);
      return node;
    },
  };
  const form = makeForm('recurso', {
    values: { pontoId: 2, tipo: 'AGUA', disponivel: false },
    submitText: 'Salvar',
    onSubmit: async () => {},
  });
  assert.equal(form.tagName, 'form');
  assert.equal(nodes.find((node) => node.attributes.name === 'disponivel').value, 'false');
  assert.ok(nodes.filter((node) => node.tagName === 'label').every((node) => node.attributes.for));
  delete globalThis.document;
});

test('formulários geram exatamente os DTOs de criação e atualização', () => {
  const point = {
    codigoPublico: 'REF-123',
    nome: 'Praça',
    logradouro: 'Rua',
    numero: '1',
    bairro: 'Centro',
    cidade: 'São Paulo',
    uf: 'SP',
    horarioTexto: '08h às 18h',
    status: 'ATIVO',
    id: '77',
  };
  assert.deepEqual(payloadFor('ponto', point), {
    codigoPublico: 'REF-123',
    nome: 'Praça',
    logradouro: 'Rua',
    numero: '1',
    bairro: 'Centro',
    cidade: 'São Paulo',
    uf: 'SP',
    horarioTexto: '08h às 18h',
    status: 'ATIVO',
  });
  const updated = payloadFor('pontoUpdate', point);
  assert.equal('codigoPublico' in updated, false);
  assert.equal('id' in updated, false);
  assert.deepEqual(payloadFor('recurso', { pontoId: '2', tipo: 'AGUA', disponivel: 'false' }), {
    pontoId: 2,
    tipo: 'AGUA',
    disponivel: false,
  });
  assert.deepEqual(
    payloadFor('ocorrencia', {
      pontoId: '2',
      categoria: 'OUTRO',
      descricao: 'Descrição válida',
      usuarioId: '99',
      prioridade: 'ALTA',
    }),
    { pontoId: 2, categoria: 'OUTRO', descricao: 'Descrição válida' },
  );
  assert.deepEqual(
    payloadFor('medicao', {
      pontoId: '2',
      temperaturaC: '31.5',
      umidadePct: '55.5',
      origem: 'ARDUINO',
      medidaEm: '2026-11-17T15:00:00Z',
    }),
    { pontoId: 2, temperaturaC: 31.5, umidadePct: 55.5, origem: 'ARDUINO', medidaEm: '2026-11-17T15:00:00.000Z' },
  );
  assert.deepEqual(payloadFor('status', { status: 'EM_ANALISE', id: '9' }), { status: 'EM_ANALISE' });
  assert.equal(
    fieldsFor('pontoUpdate').some((field) => field.name === 'codigoPublico'),
    false,
  );
});
