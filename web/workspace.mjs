import { readCollection } from './api.mjs';
import { makeForm } from './forms.mjs';
import { h, label, formatDate, safeJson } from './ui.mjs';

export function createWorkspace(context) {
  const {
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
    positiveId,
    mutation,
    requireAccount,
    flash,
    idField,
  } = context;
  function occurrencesPage() {
    if (requireAccount('Minhas ocorrências', 'Relatos que você registrou e o andamento de cada um.')) return;
    const list = h('div', { id: 'occurrence-list', className: 'occurrence-list' });
    view.replaceChildren(
      heading('Minhas ocorrências', 'Acompanhe seus relatos. A prioridade é calculada pelo serviço.', [
        action(
          '+ Registrar ocorrência',
          () => edit('ocorrencia', 'Registrar ocorrência', '/api/ocorrencias'),
          'button primary',
        ),
      ]),
      list,
    );
    void loadOccurrences('/api/ocorrencias/minhas?page=0&size=6&sort=abertaEm,desc');
  }

  async function loadOccurrences(url) {
    const target = document.querySelector('#occurrence-list');
    if (!target) return;
    const ticket = gates.section.begin();
    const version = state.authVersion;
    loading(target, 'Consultando suas ocorrências…');
    try {
      const data = readCollection(await api.request(url, { auth: true, signal: ticket.signal }), 'ocorrencias');
      if (!ticket.current() || version !== state.authVersion) return;
      target.setAttribute('aria-busy', 'false');
      target.replaceChildren(
        ...(data.items.length
          ? data.items.map((item) =>
              h(
                'article',
                { className: 'occurrence' },
                h(
                  'div',
                  { className: 'card-top' },
                  h('span', { className: 'code' }, `OCORRÊNCIA #${item.id} · PONTO #${item.pontoId}`),
                  badge(item.status),
                ),
                h('h2', {}, label(item.categoria)),
                text(item.descricao, 'description'),
                h(
                  'div',
                  { className: 'metadata' },
                  h('span', {}, `Prioridade ${label(item.prioridade).toLowerCase()}`),
                  h('span', {}, `Aberta em ${formatDate(item.abertaEm)}`),
                  item.resolvidaEm ? h('span', {}, `Resolvida em ${formatDate(item.resolvidaEm)}`) : null,
                ),
                text('Para atendimento pela gestão, informe o ID desta ocorrência.', 'hint'),
              ),
            )
          : [
              empty(
                'Você ainda não registrou ocorrências',
                'Selecione um ponto e relate um problema de acesso ou disponibilidade.',
                [
                  action(
                    'Explorar pontos',
                    () => {
                      location.hash = 'pontos';
                    },
                    'button primary',
                  ),
                ],
              ),
            ]),
        pager(data, loadOccurrences),
      );
    } catch (error) {
      if (ticket.current() && version === state.authVersion) fail(target, error, () => loadOccurrences(url));
    }
  }

  function managementPage() {
    if (requireAccount('Gestão da rede', 'Mantenha pontos e recursos e acompanhe os relatos recebidos.', true)) return;
    const status = makeForm('status', {
      extraFields: [idField],
      submitText: 'Atualizar ocorrência',
      onSubmit: async (payload, values) => {
        await mutation(`/api/ocorrencias/${positiveId(values.registroId)}/status`, 'PATCH', payload);
        flash(`Ocorrência #${values.registroId} atualizada para ${label(payload.status).toLowerCase()}.`);
      },
    });
    const lookupInput = h('input', {
      type: 'number',
      min: 1,
      step: 1,
      required: true,
      id: 'lookup-point',
      placeholder: 'ID do ponto',
    });
    const lookup = h(
      'form',
      { className: 'lookup-form' },
      h('label', { for: 'lookup-point' }, 'Abrir ponto pelo ID'),
      row(lookupInput, h('button', { type: 'submit', className: 'button secondary' }, 'Abrir detalhe')),
    );
    lookup.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!lookup.reportValidity()) return;
      state.requestedId = Number(lookupInput.value);
      location.hash = 'pontos';
    });
    view.replaceChildren(
      heading('Gestão da rede', 'Operações com dados reais da API. Toda alteração é autorizada pelo servidor.'),
      h(
        'div',
        { className: 'management-grid' },
        h(
          'section',
          { className: 'panel' },
          h('p', { className: 'eyebrow' }, 'CADASTRO E MANUTENÇÃO'),
          h('h2', {}, 'Pontos, recursos e leituras'),
          text(
            'Abra o detalhe de um ponto para editar, inativar ou excluir e para consultar seus recursos. Na edição de recurso, altere o ID do ponto para movimentá-lo.',
          ),
          row(
            action('+ Novo ponto', () => edit('ponto', 'Cadastrar ponto', '/api/pontos'), 'button primary'),
            action('+ Novo recurso', () => edit('recurso', 'Cadastrar recurso', '/api/recursos')),
            action('+ Nova medição', () => edit('medicao', 'Registrar medição', '/api/medicoes')),
          ),
          lookup,
          text(
            'Um ponto com histórico ou recursos vinculados não pode ser excluído. Use o status Inativo para preservar os registros.',
            'hint',
          ),
        ),
        h(
          'section',
          { className: 'panel' },
          h('p', { className: 'eyebrow' }, 'ATENDIMENTO'),
          h('h2', {}, 'Atualizar uma ocorrência'),
          text(
            'Solicite ao cidadão o ID exibido em “Minhas ocorrências”. Não há listagem global de relatos nesta API.',
          ),
          text('Fluxo permitido: Aberta → Em análise → Resolvida. Repetições e regressões retornam HTTP 409.', 'hint'),
          status,
        ),
      ),
    );
  }

  function diagnosticsPage() {
    const output = h(
      'pre',
      { className: 'json-output', tabIndex: 0, 'aria-label': 'Resposta JSON do diagnóstico' },
      'Escolha uma consulta. Apenas dados retornados pelo serviço serão exibidos.',
    );
    const status = h('p', { className: 'muted', role: 'status' });
    const metricName = h('input', {
      id: 'metric-name',
      placeholder: 'Ex.: http.server.requests',
      list: 'metric-options',
      required: true,
      maxLength: 160,
    });
    const metricOptions = h('datalist', { id: 'metric-options' });
    const query = async (path, auth = false) => {
      const ticket = gates.diagnostics.begin();
      const version = state.authVersion;
      status.textContent = 'Consultando serviço…';
      output.textContent = '';
      output.setAttribute('aria-busy', 'true');
      try {
        const data = await api.request(path, { auth, signal: ticket.signal });
        if (!ticket.current() || version !== state.authVersion) return;
        output.textContent = safeJson(data, session.token() || '');
        output.setAttribute('aria-busy', 'false');
        status.textContent = `Resposta recebida de ${path}.`;
        if (path === '/actuator/metrics' && Array.isArray(data.names))
          metricOptions.replaceChildren(...data.names.map((name) => h('option', { value: name })));
      } catch (error) {
        if (!ticket.current() || version !== state.authVersion) return;
        output.setAttribute('aria-busy', 'false');
        status.textContent = error.message;
        output.textContent = 'A consulta não retornou dados. Verifique a conexão e as permissões.';
      }
    };
    const metricForm = h(
      'form',
      { className: 'lookup-form' },
      h('label', { for: 'metric-name' }, 'Métrica individual'),
      row(
        metricName,
        h('button', { type: 'submit', className: 'button secondary', disabled: !manager() }, 'Consultar métrica'),
      ),
      metricOptions,
    );
    metricForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (metricForm.reportValidity())
        void query(`/actuator/metrics/${encodeURIComponent(metricName.value.trim())}`, true);
    });
    view.replaceChildren(
      heading(
        'Diagnóstico do serviço',
        'Saúde e informações públicas. Métricas operacionais são exclusivas da gestão.',
      ),
      h(
        'section',
        { className: 'panel diagnostics' },
        row(
          action('Consultar saúde', () => query('/actuator/health'), 'button primary'),
          action('Informações', () => query('/actuator/info')),
          manager() ? action('Listar métricas', () => query('/actuator/metrics', true)) : null,
        ),
        !manager()
          ? text(
              'Entre com uma conta de gestor para consultar métricas. Nenhuma métrica é simulada nesta tela.',
              'hint',
            )
          : null,
        metricForm,
        status,
        output,
      ),
      h(
        'section',
        { className: 'api-help' },
        h('h2', {}, 'Explore o contrato da API'),
        text('O Swagger reúne as rotas e os formatos de entrada. A sessão desta página não é enviada à documentação.'),
        h(
          'a',
          { href: '/swagger-ui/index.html', target: '_blank', rel: 'noopener', className: 'button secondary' },
          'Abrir Swagger ↗',
        ),
      ),
    );
  }

  return { occurrencesPage, managementPage, diagnosticsPage };
}
