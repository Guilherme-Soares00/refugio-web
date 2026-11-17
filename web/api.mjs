export function createSession(now = Date.now) {
  let token = null;
  let id = null;
  let expires = 0;
  const clear = () => {
    token = null;
    id = null;
    expires = 0;
  };
  const current = () => {
    if (now() >= expires) clear();
    return token;
  };
  return {
    clear,
    token: current,
    userId: () => (current() ? id : null),
    expiresAt: () => (current() ? expires : 0),
    set(response) {
      clear();
      let claims;
      try {
        const part = response.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        claims = JSON.parse(atob(part));
        if (
          !/^[1-9][0-9]*$/.test(claims.sub) ||
          !Number.isFinite(claims.exp) ||
          !Number.isFinite(response.expiresIn) ||
          response.expiresIn <= 0
        )
          throw new Error();
      } catch {
        throw new Error('Resposta de autenticação inválida.');
      }
      expires = Math.min(claims.exp * 1000, now() + response.expiresIn * 1000);
      if (expires <= now()) {
        clear();
        throw new Error('A sessão já expirou. Entre novamente.');
      }
      id = claims.sub;
      token = response.accessToken;
    },
  };
}

export function readCollection(data, key) {
  return {
    items: data?._embedded?.[key] ?? [],
    page: data?.page ?? { number: 0, totalPages: 0, totalElements: 0 },
    links: data?._links ?? {},
  };
}

export function createClient({
  origin = globalThis.location.origin,
  fetcher = globalThis.fetch,
  getToken = () => null,
  onUnauthorized = () => {},
} = {}) {
  return {
    async request(path, { method = 'GET', auth = false, body, signal } = {}) {
      let url;
      try {
        url = new URL(path, origin);
      } catch {
        throw new Error('Link inválido: informe uma URL da mesma origem.');
      }
      if (url.origin !== new URL(origin).origin || url.username || url.password)
        throw new Error('Link rejeitado: somente a mesma origem é permitida.');
      const token = auth ? getToken() : null;
      if (auth && !token) throw new Error('Entre na sua conta para continuar.');
      const headers = { Accept: 'application/hal+json, application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      let response;
      try {
        response = await fetcher(url.href, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
          redirect: 'error',
          credentials: 'same-origin',
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Não foi possível conectar ao serviço. Verifique a conexão e tente novamente.');
      }
      if (response.status === 401 && token && getToken() === token) onUnauthorized();
      if (response.status === 204) return null;
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const fallback = {
          400: 'Revise os campos informados.',
          401: 'Entre novamente para continuar.',
          403: 'Seu perfil não tem permissão para esta ação.',
          404: 'Registro não encontrado.',
          409: 'A operação conflita com o estado atual.',
        };
        const error = new Error(
          `HTTP ${response.status}: ${data?.mensagem || fallback[response.status] || 'Não foi possível concluir a solicitação.'}`,
        );
        error.status = response.status;
        error.path = data?.path;
        throw error;
      }
      if (text && data === null) throw new Error('A API retornou uma resposta inválida.');
      return data;
    },
  };
}
