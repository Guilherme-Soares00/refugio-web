import { h, label, withSubmissionLock } from './ui.mjs';

const field = (name, label, options = {}) => ({ name, label, required: true, ...options });
const text = (name, label, maxLength) => field(name, label, { maxLength });
const select = (name, label, options) => field(name, label, { options });
const point = [
  text('codigoPublico', 'Código público', 7),
  text('nome', 'Nome do ponto', 110),
  text('logradouro', 'Logradouro', 120),
  text('numero', 'Número', 12),
  text('bairro', 'Bairro', 80),
  text('cidade', 'Cidade', 80),
  field('uf', 'UF', { minLength: 2, maxLength: 2 }),
  text('horarioTexto', 'Horário de funcionamento', 80),
  select('status', 'Status', ['ATIVO', 'INATIVO']),
];
const pointId = field('pontoId', 'ID do ponto', { type: 'number', min: 1, step: 1, convert: Number });
const resource = [
  pointId,
  select('tipo', 'Tipo de recurso', ['AGUA', 'SOMBRA', 'ASSENTO', 'ACESSIBILIDADE']),
  field('disponivel', 'Disponibilidade', {
    options: [
      ['true', 'Disponível'],
      ['false', 'Indisponível'],
    ],
    convert: (value) => value === 'true' || value === true,
  }),
];
const schemas = {
  ponto: point.map((item) =>
    item.name === 'codigoPublico' ? { ...item, pattern: 'REF-[0-9]{3}', placeholder: 'REF-123' } : item,
  ),
  pontoUpdate: point.filter((item) => item.name !== 'codigoPublico'),
  recurso: resource,
  ocorrencia: [
    pointId,
    select('categoria', 'Categoria', ['SEM_AGUA', 'SEM_SOMBRA', 'ACESSO_BLOQUEADO', 'OUTRO']),
    field('descricao', 'O que aconteceu?', { type: 'textarea', minLength: 10, maxLength: 500, wide: true }),
  ],
  medicao: [
    pointId,
    field('temperaturaC', 'Temperatura (°C)', { type: 'number', min: 0, max: 60, step: 0.1, convert: Number }),
    field('umidadePct', 'Umidade (%)', { type: 'number', min: 0, max: 100, step: 0.1, convert: Number }),
    select('origem', 'Origem da leitura', ['ARDUINO', 'SIMULADA']),
    field('medidaEm', 'Data e hora local da medição', {
      type: 'datetime-local',
      convert: (value) => new Date(value).toISOString(),
    }),
  ],
  status: [select('status', 'Próximo status', ['EM_ANALISE', 'RESOLVIDA'])],
  login: [
    field('email', 'E-mail', { type: 'email', maxLength: 120, autocomplete: 'username' }),
    field('senha', 'Senha', { type: 'password', autocomplete: 'current-password' }),
  ],
  cadastro: [
    text('nome', 'Seu nome', 90),
    field('email', 'E-mail', { type: 'email', maxLength: 120, autocomplete: 'username' }),
    field('senha', 'Crie uma senha', { type: 'password', autocomplete: 'new-password' }),
  ],
};

export function fieldsFor(kind) {
  if (!schemas[kind]) throw new Error('Formulário desconhecido.');
  return schemas[kind];
}

let formSequence = 0;

export function makeForm(kind, { values = {}, submitText = 'Salvar', onSubmit, extraFields = [] } = {}) {
  const formId = `form-${++formSequence}`;
  const form = h('form', { className: 'data-form' });
  const grid = h('fieldset', { className: 'form-grid' });
  const message = h('p', { className: 'form-message', role: 'alert', tabIndex: -1 });
  for (const item of [...extraFields, ...fieldsFor(kind)]) {
    const id = `${formId}-${item.name}`;
    const input = h(item.options ? 'select' : item.type === 'textarea' ? 'textarea' : 'input', {
      id,
      name: item.name,
      required: item.required !== false,
    });
    if (item.options) {
      for (const option of item.options) {
        const [value, text] = Array.isArray(option) ? option : [option, label(option)];
        input.append(h('option', { value }, text));
      }
    } else {
      for (const key of [
        'type',
        'min',
        'max',
        'step',
        'minLength',
        'maxLength',
        'pattern',
        'placeholder',
        'autocomplete',
      ]) {
        if (item[key] !== undefined) input.setAttribute(key, item[key]);
      }
    }
    if (values[item.name] !== undefined && values[item.name] !== null) input.value = String(values[item.name]);
    grid.append(
      h('div', { className: item.wide ? 'field wide' : 'field' }, h('label', { for: id }, item.label), input),
    );
  }
  const submit = h('button', { type: 'submit', className: 'button primary' }, submitText);
  grid.append(h('div', { className: 'form-actions wide' }, submit));
  form.append(grid, message);
  const run = withSubmissionLock(
    async () => {
      message.textContent = '';
      try {
        const values = Object.fromEntries(new FormData(form));
        if (values.senha && (values.senha.length < 8 || new TextEncoder().encode(values.senha).length > 72))
          throw new Error('A senha deve ter no mínimo 8 caracteres e no máximo 72 bytes UTF-8.');
        await onSubmit(payloadFor(kind, values), values);
      } catch (error) {
        if (error.name === 'AbortError') return;
        message.textContent = error.message || 'Não foi possível concluir a operação.';
        message.focus();
      }
    },
    (busy) => {
      submit.disabled = busy;
      submit.textContent = busy ? 'Aguarde…' : submitText;
      form.setAttribute('aria-busy', String(busy));
    },
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.reportValidity()) void run();
  });
  return form;
}

export function payloadFor(kind, values) {
  return Object.fromEntries(
    fieldsFor(kind).map((item) => [item.name, item.convert ? item.convert(values[item.name]) : values[item.name]]),
  );
}
