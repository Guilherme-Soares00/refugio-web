import { createClient, createSession } from './api.mjs';
import { createPoints } from './points.mjs';
import { createWorkspace } from './workspace.mjs';
import { makeForm } from './forms.mjs';
import { h, label, latestOnly, withSubmissionLock } from './ui.mjs';

const view = document.querySelector('#view');
const dialog = document.querySelector('#editor');
const dialogBody = document.querySelector('#dialog-body');
const session = createSession();
const editorGate = latestOnly();
const gates = {
  list: latestOnly(),
  detail: latestOnly(),
  history: latestOnly(),
  section: latestOnly(),
  diagnostics: latestOnly(),
};
const state = {
  role: null,
  authVersion: 0,
  point: null,
  selectedId: null,
  requestedId: null,
  pointUrl: '/api/pontos?page=0&size=6&sort=nome,asc',
  filters: { bairro: '', status: 'ATIVO', tipoRecurso: '', sort: 'nome,asc' },
  timer: null,
};
const api = createClient({
  getToken: session.token,
  onUnauthorized: () => logout('Sua sessão não é mais válida. Entre novamente.'),
});
const currentRoute = () =>
  ['pontos', 'ocorrencias', 'gestao', 'diagnostico'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'pontos';
const manager = () => Boolean(session.token()) && state.role === 'GESTOR';
const text = (value, className = 'muted') => h('p', { className }, value);
const row = (...children) => h('div', { className: 'actions' }, children);
const badge = (value) =>
  h(
    'span',
    { className: `badge ${value === 'ATIVO' || value === 'RESOLVIDA' ? 'positive' : 'neutral'}` },
    label(value),
  );
const positiveId = (value) => {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error('Informe um ID inteiro positivo.');
  return String(value);
};
const idField = { name: 'registroId', label: 'ID da ocorrência', type: 'number', min: 1, step: 1 };

function flash(message, error = false) {
  const feedback = document.querySelector('#feedback');
  feedback.textContent = message;
  feedback.className = message ? `feedback ${error ? 'error' : 'success'}` : '';
  feedback.setAttribute('role', error ? 'alert' : 'status');
}

function action(title, callback, className = 'button secondary') {
  const button = h('button', { type: 'button', className }, title);
  const run = withSubmissionLock(
    async () => {
      try {
        await callback();
      } catch (error) {
        if (error.name !== 'AbortError') flash(error.message || 'Não foi possível concluir a operação.', true);
      }
    },
    (busy) => {
      button.disabled = busy;
    },
  );
  button.addEventListener('click', () => {
    void run();
  });
  return button;
}

function heading(title, subtitle, actions = []) {
  return h(
    'div',
    { className: 'page-heading' },
    h('div', {}, h('p', { className: 'eyebrow' }, 'REFÚGIO / REDE LOCAL'), h('h1', {}, title), text(subtitle)),
    row(actions),
  );
}

function empty(title, description, actions = []) {
  return h(
    'div',
    { className: 'empty' },
    h('span', { className: 'empty-mark', 'aria-hidden': 'true' }, '○'),
    h('h3', {}, title),
    text(description),
    row(actions),
  );
}

function loading(target, message = 'Carregando…') {
  target.replaceChildren(h('p', { className: 'loading', role: 'status' }, message));
  target.setAttribute('aria-busy', 'true');
}

function fail(target, error, retry) {
  target.setAttribute('aria-busy', 'false');
  target.replaceChildren(
    h(
      'div',
      { className: 'inline-error', role: 'alert' },
      h('h3', {}, 'Não foi possível carregar'),
      text(error.message),
      action('Tentar novamente', retry),
    ),
  );
}

function pager(data, callback) {
  const controls = [];
  for (const [relation, title] of [
    ['prev', '← Anterior'],
    ['next', 'Próxima →'],
  ]) {
    if (data.links[relation]?.href)
      controls.push(action(title, () => callback(data.links[relation].href), 'button subtle'));
  }
  const pageText = data.page.totalPages
    ? `Página ${data.page.number + 1} de ${data.page.totalPages} · ${data.page.totalElements} registros`
    : '0 registros';
  return h('div', { className: 'pagination', 'aria-label': 'Paginação' }, h('span', {}, pageText), row(controls));
}

function openDialog(title, ...children) {
  const ticket = editorGate.begin();
  document.querySelector('#dialog-title').textContent = title;
  dialogBody.replaceChildren(...children);
  if (!dialog.open) dialog.showModal();
  return ticket;
}

function closeDialog() {
  editorGate.cancel();
  dialog.close();
  dialogBody.replaceChildren();
}
function cancelRequests() {
  Object.values(gates).forEach((gate) => gate.cancel());
}

function identity() {
  document.querySelector('#identity').textContent = session.token()
    ? `${state.role === 'GESTOR' ? 'Gestor' : state.role === 'CIDADAO' ? 'Cidadão' : 'Autenticado'} · ID ${session.userId()}`
    : 'Acesso público';
  document.querySelector('#account-button').textContent = session.token() ? 'Sair' : 'Entrar';
}

function logout(message = 'Você saiu da sua conta.') {
  session.clear();
  state.role = null;
  state.authVersion++;
  clearTimeout(state.timer);
  cancelRequests();
  closeDialog();
  identity();
  render();
  flash(message);
}

async function startSession(response) {
  session.set(response);
  const version = ++state.authVersion;
  state.role = null;
  cancelRequests();
  try {
    await api.request('/actuator/metrics', { auth: true });
    if (version === state.authVersion) state.role = 'GESTOR';
  } catch (error) {
    if (version !== state.authVersion) return;
    if (error.status === 403) state.role = 'CIDADAO';
    else if (error.status === 401) return;
    else flash(`Acesso realizado, mas a verificação do perfil falhou: ${error.message}`, true);
  }
  if (version !== state.authVersion || !session.token()) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(
    () => logout('Sua sessão expirou. Entre novamente para continuar.'),
    Math.min(session.expiresAt() - Date.now(), 2147483647),
  );
  closeDialog();
  identity();
  render();
  if (state.role) flash('Acesso realizado. Sua sessão fica somente nesta aba.');
}

function showAuth(kind = 'login', email = '') {
  let ticket;
  const form = makeForm(kind, {
    values: { email },
    submitText: kind === 'login' ? 'Entrar na conta' : 'Criar conta de cidadão',
    onSubmit: async (payload) => {
      const version = state.authVersion;
      const response = await api.request(`/api/auth/${kind === 'login' ? 'login' : 'cadastro'}`, {
        method: 'POST',
        body: payload,
        signal: ticket.signal,
      });
      if (!ticket.current() || version !== state.authVersion) return;
      if (kind === 'login') await startSession(response);
      else {
        showAuth('login', payload.email);
        flash('Cadastro concluído. Entre com seu e-mail e senha.');
      }
    },
  });
  ticket = openDialog(
    kind === 'login' ? 'Entrar no Refúgio' : 'Criar sua conta',
    text(
      kind === 'login'
        ? 'Use sua conta para registrar ocorrências ou gerenciar a rede.'
        : 'O cadastro público cria um perfil de cidadão.',
    ),
    form,
    text('Senha: mínimo de 8 caracteres e máximo de 72 bytes UTF-8.', 'hint'),
    row(
      action(kind === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta', () =>
        showAuth(kind === 'login' ? 'cadastro' : 'login'),
      ),
    ),
  );
  if (kind === 'login')
    dialogBody.append(
      h(
        'details',
        { className: 'demo-access' },
        h('summary', {}, 'E-mails do ambiente demonstrativo'),
        text('A senha deve ser informada por você.'),
        row(
          action('Preencher e-mail cidadão', () => {
            form.elements.email.value = 'cidadao01@example.test';
          }),
          action('Preencher e-mail gestor', () => {
            form.elements.email.value = 'gestor09@example.test';
          }),
        ),
      ),
    );
}

function requireAccount(title, description, needsManager = false) {
  if (session.token() && (!needsManager || manager())) return false;
  view.replaceChildren(
    heading(title, description),
    empty(
      needsManager ? 'Área de gestão' : 'Entre para continuar',
      needsManager
        ? 'Esta área exige uma conta com permissão de gestor. O cadastro público não concede esse perfil.'
        : 'Suas ocorrências são visíveis somente para sua conta.',
      [
        action(
          session.token() ? 'Trocar de conta' : 'Entrar na conta',
          () => {
            if (session.token()) logout();
            showAuth();
          },
          'button primary',
        ),
      ],
    ),
  );
  return true;
}

async function mutation(path, method, body) {
  const version = state.authVersion;
  if (!session.token()) throw new Error('Entre novamente para continuar.');
  const result = await api.request(path, { method, body, auth: true });
  if (version !== state.authVersion) throw new DOMException('Sessão alterada', 'AbortError');
  return result;
}

function edit(kind, title, path, values = {}, method = 'POST', after) {
  const version = state.authVersion;
  const ticket = openDialog(
    title,
    makeForm(kind, {
      values,
      onSubmit: async (payload) => {
        if (version !== state.authVersion) throw new Error('A sessão mudou. Abra o formulário novamente.');
        const result = await mutation(path, method, payload);
        if (ticket.current()) closeDialog();
        flash(result?.id ? `Registro #${result.id} criado com sucesso.` : 'Alterações salvas com sucesso.');
        if (after) await after(result);
        else {
          if (currentRoute() === 'pontos') state.requestedId = state.selectedId;
          render();
        }
      },
    }),
  );
}

async function remove(path, title, after) {
  if (!window.confirm(`Excluir ${title}? Esta ação não pode ser desfeita.`)) return;
  await mutation(path, 'DELETE');
  flash('Registro excluído com sucesso.');
  await after();
}

const context = {
  view,
  api,
  state,
  gates,
  session,
  manager,
  action,
  heading,
  text,
  row,
  badge,
  empty,
  loading,
  fail,
  pager,
  edit,
  remove,
  positiveId,
  showAuth,
  mutation,
  requireAccount,
  flash,
  idField,
};
const { pointsPage } = createPoints(context);
const { occurrencesPage, managementPage, diagnosticsPage } = createWorkspace(context);

function render() {
  cancelRequests();
  identity();
  const route = currentRoute();
  document.querySelectorAll('[data-view]').forEach((link) => {
    if (link.dataset.view === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  view.setAttribute(
    'aria-label',
    {
      pontos: 'Pontos de alívio térmico',
      ocorrencias: 'Minhas ocorrências',
      gestao: 'Gestão da rede',
      diagnostico: 'Diagnóstico do serviço',
    }[route],
  );
  ({ pontos: pointsPage, ocorrencias: occurrencesPage, gestao: managementPage, diagnostico: diagnosticsPage })[route]();
}

document.querySelector('#account-button').addEventListener('click', () => (session.token() ? logout() : showAuth()));
document.querySelector('#close-dialog').addEventListener('click', closeDialog);
dialog.addEventListener('close', () => {
  if (!dialog.open) {
    editorGate.cancel();
    dialogBody.replaceChildren();
  }
});
window.addEventListener('hashchange', () => {
  closeDialog();
  render();
});
window.addEventListener('focus', () => {
  if (state.role && !session.token()) logout('Sua sessão expirou. Entre novamente.');
});
render();
