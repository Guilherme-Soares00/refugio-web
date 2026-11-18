export function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (['className', 'value', 'checked', 'selected', 'disabled', 'required', 'tabIndex'].includes(key))
      node[key] = value;
    else node.setAttribute(key, String(value));
  }
  node.append(...children.flat(Infinity).filter((item) => item !== null && item !== undefined));
  return node;
}

export function withSubmissionLock(action, onBusy = () => {}) {
  let busy = false;
  return async (...args) => {
    if (busy) return;
    busy = true;
    onBusy(true);
    try {
      return await action(...args);
    } finally {
      busy = false;
      onBusy(false);
    }
  };
}

export function selectionForPage(items, selectedId, requestedId) {
  if (requestedId) return items.find((item) => item.id === requestedId) || { id: requestedId };
  return items.find((item) => item.id === selectedId) || items[0] || null;
}

export function latestOnly() {
  let active;
  return {
    begin() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      return { signal: controller.signal, current: () => active === controller && !controller.signal.aborted };
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}

export function safeJson(value, token = '') {
  return JSON.stringify(
    value,
    (key, item) => {
      if (/token|senha|password|authorization|secret|jwt/i.test(key)) return '[oculto]';
      if (typeof item !== 'string') return item;
      return (token ? item.replaceAll(token, '[oculto]') : item).replace(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        '[oculto]',
      );
    },
    2,
  );
}

const labels = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  AGUA: 'Água',
  SOMBRA: 'Sombra',
  ASSENTO: 'Assento',
  ACESSIBILIDADE: 'Acessibilidade',
  SEM_AGUA: 'Sem água',
  SEM_SOMBRA: 'Sem sombra',
  ACESSO_BLOQUEADO: 'Acesso bloqueado',
  OUTRO: 'Outro',
  ABERTA: 'Aberta',
  EM_ANALISE: 'Em análise',
  RESOLVIDA: 'Resolvida',
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
  SIMULADA: 'Simulada',
  ARDUINO: 'Arduino',
};
export const label = (value) => labels[value] || value || 'Não informado';
export const formatTemperature = (value) =>
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} °C`;
export const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : 'Não informado';
