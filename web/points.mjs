import { readCollection } from './api.mjs';
import { h, label, formatDate, formatTemperature, selectionForPage, latestOnly } from './ui.mjs';

export function createPoints(context) {
  const {
    view,
    api,
    state,
    gates,
    session,
    manager,
    action,
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
    flash,
  } = context;
  const cardResourceSlots = new Map();

  function pointsPage() {
    const filters = h('form', { className: 'filters', 'aria-label': 'Filtrar pontos' });
    const bairro = h('input', {
      name: 'bairro',
      id: 'filter-bairro',
      type: 'search',
      placeholder: 'Busque por bairro',
      maxLength: 80,
      value: state.filters.bairro,
    });
    filters.append(
      h('div', { className: 'field search-field' }, h('label', { for: 'filter-bairro' }, 'Bairro'), h('div', { className: 'search-input' }, bairro)),
    );
    for (const [name, title, options] of [
      [
        'status',
        'Status',
        [
          ['ATIVO', 'Ativos'],
          ['INATIVO', 'Inativos'],
        ],
      ],
      [
        'tipoRecurso',
        'Recurso disponível',
        [
          ['', 'Qualquer recurso'],
          ['AGUA', 'Água'],
          ['SOMBRA', 'Sombra'],
          ['ASSENTO', 'Assento'],
          ['ACESSIBILIDADE', 'Acessibilidade'],
        ],
      ],
      [
        'sort',
        'Ordenar por',
        [
          ['nome,asc', 'Nome: A–Z'],
          ['nome,desc', 'Nome: Z–A'],
          ['id,desc', 'Mais recentes'],
        ],
      ],
    ]) {
      const input = h(
        'select',
        { id: `filter-${name}`, name },
        options.map(([value, text]) => h('option', { value }, text)),
      );
      input.value = state.filters[name];
      filters.append(h('div', { className: 'field' }, h('label', { for: `filter-${name}` }, title), input));
    }
    filters.append(
      h('button', { className: 'button primary', type: 'submit' }, 'Buscar'),
      action(
        'Limpar',
        () => {
          state.filters = { bairro: '', status: 'ATIVO', tipoRecurso: '', sort: 'nome,asc' };
          state.pointUrl = '/api/pontos?page=0&size=6&sort=nome,asc';
          pointsPage();
        },
        'button subtle',
      ),
    );
    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      state.filters = Object.fromEntries(new FormData(filters));
      const query = new URLSearchParams({
        page: '0',
        size: '6',
        sort: state.filters.sort,
        status: state.filters.status,
      });
      if (state.filters.bairro.trim()) query.set('bairro', state.filters.bairro.trim());
      if (state.filters.tipoRecurso) query.set('tipoRecurso', state.filters.tipoRecurso);
      void loadPoints(`/api/pontos/busca?${query}`);
    });
    const list = h('div', { id: 'point-list', className: 'point-list' });
    const detail = h('aside', { id: 'point-detail', className: 'detail-panel', tabIndex: -1, 'aria-label': 'Detalhe do ponto' });
    detail.append(empty('Conheça um ponto', 'Selecione um ponto da lista para consultar recursos e medições.'));
    view.replaceChildren(
      h(
        'div',
        { className: 'page-heading' },
        h('div', {},
          h('p', { className: 'page-title' }, 'Explorar'),
          h('h1', {}, 'Uma pausa perto do seu caminho.'),
          text('Veja os recursos de cada ponto antes de sair.'),
        ),
        manager()
          ? row(action('+ Novo ponto', () => edit('ponto', 'Cadastrar ponto', '/api/pontos'), 'button primary'))
          : null,
      ),
      filters,
      h(
        'div',
        { className: 'explore' },
        h(
          'section',
          { className: 'results', 'aria-label': 'Resultados da busca' },
          h(
            'div',
            { className: 'section-title' },
            h('h2', {}, 'Pontos de alívio térmico'),
            h('span', { className: 'muted' }, '6 por página'),
          ),
          list,
        ),
        detail,
      ),
    );
    void loadPoints(state.pointUrl);
  }

  async function loadPoints(url) {
    const target = document.querySelector('#point-list');
    if (!target) return;
    const ticket = gates.list.begin();
    cardResourceSlots.clear();
    state.pointUrl = url;
    loading(target, 'Buscando pontos da rede…');
    try {
      const data = readCollection(await api.request(url, { signal: ticket.signal }), 'pontos');
      if (!ticket.current()) return;
      target.setAttribute('aria-busy', 'false');
      const resourceSlots = [];
      const cards = data.items.map((point) => {
        const resources = h('span', { className: 'card-resources', 'aria-busy': 'true' }, 'Consultando recursos…');
        resourceSlots.push({ point, target: resources, ticket, gate: latestOnly() });
        return h(
          'button',
          {
            type: 'button',
            className: 'point-card',
            'data-id': String(point.id),
            'aria-pressed': String(point.id === state.selectedId),
            onClick: async () => {
              await selectPoint(point.id, point._links?.self?.href);
              const detailTarget = document.querySelector('#point-detail');
              if (state.selectedId === point.id && detailTarget && window.matchMedia('(max-width: 860px)').matches) {
                detailTarget.focus({ preventScroll: true });
                window.scrollTo({ top: window.scrollY + detailTarget.getBoundingClientRect().top - 20, behavior: 'instant' });
              }
            },
          },
          h(
            'span',
            { className: 'card-top' },
            h('span', { className: 'card-neighborhood' }, point.bairro),
            badge(point.status),
          ),
          h('h3', {}, point.nome),
          h('span', { className: 'card-meta' }, `${point.codigoPublico} · ${point.horarioTexto}`),
          resources,
          h('span', { className: 'card-bottom' }, h('span', { className: 'card-arrow' }, 'Ver detalhes →')),
        );
      });
      target.replaceChildren(
        ...(cards.length
          ? cards
          : [empty('Nenhum ponto encontrado', 'Tente outro bairro, status ou recurso disponível.')]),
        pager(data, loadPoints),
      );
      for (const slot of resourceSlots) {
        cardResourceSlots.set(slot.point.id, slot);
        void loadCardResources(slot);
      }
      if (!data.items.length && !state.requestedId) {
        gates.detail.cancel();
        gates.history.cancel();
        state.point = null;
        state.selectedId = null;
        document
          .querySelector('#point-detail')
          .replaceChildren(empty('Sem resultados', 'Ajuste os filtros para explorar a rede.'));
      } else {
        const selected = selectionForPage(data.items, state.selectedId, state.requestedId);
        state.requestedId = null;
        await selectPoint(selected.id, selected._links?.self?.href);
      }
    } catch (error) {
      if (ticket.current()) fail(target, error, () => loadPoints(url));
    }
  }

  async function selectPoint(id, href) {
    const target = document.querySelector('#point-detail');
    if (!target) return;
    const ticket = gates.detail.begin();
    gates.history.cancel();
    const version = state.authVersion;
    state.selectedId = id;
    state.point = null;
    document
      .querySelectorAll('.point-card')
      .forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.id === String(id))));
    loading(target, 'Abrindo detalhes do ponto…');
    try {
      const point = await api.request(href || `/api/pontos/${positiveId(id)}`, {
        auth: Boolean(session.token()),
        signal: ticket.signal,
      });
      if (!ticket.current() || version !== state.authVersion) return;
      state.point = point;
      target.setAttribute('aria-busy', 'false');
      const actions = [
        action(
          'Registrar ocorrência',
          () =>
            session.token()
              ? edit(
                  'ocorrencia',
                  `Relatar um problema · ${point.codigoPublico}`,
                  '/api/ocorrencias',
                  { pontoId: point.id },
                  'POST',
                  async (result) => {
                    flash(`Ocorrência #${result.id} registrada. Informe este ID ao gestor para acompanhamento.`);
                  },
                )
              : showAuth(),
          'button primary',
        ),
      ];
      if (manager())
        actions.push(
          action('Editar ponto', () =>
            edit('pontoUpdate', `Editar ${point.codigoPublico}`, `/api/pontos/${point.id}`, point, 'PUT'),
          ),
          action(
            'Excluir ponto',
            () =>
              remove(`/api/pontos/${point.id}`, `o ponto ${point.codigoPublico}`, async () => {
                state.selectedId = null;
                await loadPoints(state.pointUrl);
              }),
            'button danger',
          ),
        );
      const resources = h(
        'section',
        { className: 'detail-section' },
        h(
          'div',
          { className: 'section-title' },
          h('h3', {}, 'O que você encontra'),
          manager()
            ? action('+ Recurso', () => edit('recurso', 'Adicionar recurso', '/api/recursos', { pontoId: point.id }))
            : null,
        ),
      );
      const resourceList = h('div', {});
      resources.append(resourceList);
      const history = h('div', {});
      target.replaceChildren(
        h(
          'div',
          { className: 'detail-header' },
          h('p', { className: 'detail-title' }, 'Detalhes do ponto'),
          h('span', { className: 'detail-symbol', 'aria-hidden': 'true' }),
          h(
            'div',
            { className: 'card-top' },
            h('span', { className: 'code' }, `${point.codigoPublico} · ${point.bairro}`),
            badge(point.status),
          ),
          h('h2', {}, point.nome),
          text(`${point.logradouro}, ${point.numero}`),
          text(`${point.bairro} · ${point.cidade} / ${point.uf}`),
          h('div', { className: 'hours' }, h('span', {}, 'Horário informado:'), h('strong', {}, point.horarioTexto)),
          row(actions),
        ),
        resources,
        h(
          'section',
          { className: 'detail-section' },
          h(
            'div',
            { className: 'section-title' },
            h('h3', {}, 'Última medição'),
            manager()
              ? action('+ Medição', () => edit('medicao', 'Registrar medição', '/api/medicoes', { pontoId: point.id }))
              : null,
          ),
          point.ultimaMedicao
            ? h(
                'div',
                { className: 'latest-reading' },
                h('strong', {}, formatTemperature(point.ultimaMedicao.temperaturaC)),
                h('span', {}, `${point.ultimaMedicao.umidadePct}% de umidade`),
                h(
                  'span',
                  { className: 'muted' },
                  `${label(point.ultimaMedicao.origem)} · ${formatDate(point.ultimaMedicao.medidaEm)}`,
                ),
              )
            : text(point.textoSemMedicao || 'Este ponto ainda não tem medições.'),
          point.etiqueta ? text(point.etiqueta, 'hint') : null,
          h('h4', {}, 'Histórico de leituras'),
          history,
        ),
        text(
          point.avisoDados || 'Confirme as condições do local. As leituras não são um índice clínico.',
          'detail-disclaimer',
        ),
      );
      void loadResources(point, resourceList, ticket);
      void loadHistory(
        point._links?.medicoes?.href
          ? `${point._links.medicoes.href}?size=6&sort=medidaEm,desc`
          : `/api/pontos/${point.id}/medicoes?size=6&sort=medidaEm,desc`,
        history,
        ticket,
      );
    } catch (error) {
      if (ticket.current() && version === state.authVersion) fail(target, error, () => selectPoint(id, href));
    }
  }

  function resourceIcon(resource) {
    return h('span', {
      className: `status-icon ${resource.disponivel ? 'available' : 'unavailable'}`,
      'aria-hidden': 'true',
    });
  }

  async function loadCardResources({ point, target, ticket, gate }) {
    if (!ticket.current()) return;
    const resourceTicket = gate.begin();
    try {
      const data = readCollection(await api.request(
        point._links?.recursos?.href || `/api/pontos/${point.id}/recursos`,
        { signal: AbortSignal.any([ticket.signal, resourceTicket.signal]) },
      ), 'recursos');
      if (!ticket.current() || !resourceTicket.current()) return;
      target.setAttribute('aria-busy', 'false');
      target.replaceChildren(...(data.items.length
        ? data.items.map((resource) => h('span', { className: 'card-resource' },
          resourceIcon(resource),
          h('span', {}, `${label(resource.tipo)} · ${resource.disponivel ? 'Disponível' : 'Indisponível'}`),
        ))
        : [h('span', { className: 'muted' }, 'Nenhum recurso cadastrado.')]
      ));
    } catch (error) {
      if (!ticket.current() || !resourceTicket.current()) return;
      target.setAttribute('aria-busy', 'false');
      target.replaceChildren(h('span', { className: 'muted' }, 'Não foi possível consultar os recursos. Abra o detalhe para tentar novamente.'));
    }
  }

  async function loadResources(point, target, ticket) {
    loading(target, 'Consultando recursos…');
    try {
      const data = readCollection(
        await api.request(point._links?.recursos?.href || `/api/pontos/${point.id}/recursos`, {
          signal: ticket.signal,
        }),
        'recursos',
      );
      if (!ticket.current()) return;
      target.setAttribute('aria-busy', 'false');
      target.replaceChildren(
        ...(data.items.length
          ? data.items.map((resource) =>
              h(
                'div',
                { className: 'resource-row' },
                h(
                  'div',
                  { className: 'resource-info' },
                  resourceIcon(resource),
                  h('div', {},
                    h('strong', {}, label(resource.tipo)),
                    manager() ? h('span', { className: 'muted' }, ` · ID ${resource.id}`) : null,
                    text(resource.disponivel ? 'Disponível' : 'Indisponível', 'resource-status'),
                  ),
                ),
                manager()
                  ? row(
                      action('Editar / mover', () =>
                        edit(
                          'recurso',
                          `Editar recurso #${resource.id}`,
                          `/api/recursos/${resource.id}`,
                          resource,
                          'PUT',
                        ),
                      ),
                      action(
                        'Excluir',
                        () =>
                          remove(`/api/recursos/${resource.id}`, `o recurso #${resource.id}`, async () => {
                            const slot = cardResourceSlots.get(point.id);
                            if (slot) void loadCardResources(slot);
                            if (state.selectedId === point.id && document.querySelector('#point-detail')) {
                              await selectPoint(point.id);
                            }
                          }),
                        'button danger',
                      ),
                    )
                  : null,
              ),
            )
          : [text('Nenhum recurso cadastrado para este ponto.')]),
      );
    } catch (error) {
      if (ticket.current()) fail(target, error, () => loadResources(point, target, ticket));
    }
  }

  async function loadHistory(url, target, detailTicket) {
    const ticket = gates.history.begin();
    loading(target, 'Carregando histórico…');
    try {
      const data = readCollection(await api.request(url, { signal: ticket.signal }), 'medicoes');
      if (!ticket.current() || !detailTicket.current()) return;
      target.setAttribute('aria-busy', 'false');
      target.replaceChildren(
        ...(data.items.length
          ? data.items.map((reading) =>
              h(
                'div',
                { className: 'history-row' },
                h('strong', {}, `${formatTemperature(reading.temperaturaC)} · ${reading.umidadePct}%`),
                h('span', {}, label(reading.origem)),
                h('time', { dateTime: reading.medidaEm }, formatDate(reading.medidaEm)),
              ),
            )
          : [text('Nenhuma leitura registrada.')]),
        pager(data, (href) => loadHistory(href, target, detailTicket)),
      );
    } catch (error) {
      if (ticket.current() && detailTicket.current()) fail(target, error, () => loadHistory(url, target, detailTicket));
    }
  }

  return { pointsPage };
}
