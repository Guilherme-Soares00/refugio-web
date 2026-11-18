# Refúgio Web

Interface web para consultar pontos de alívio térmico, acompanhar recursos e medições e registrar ocorrências. Cidadãos consultam e relatam problemas; gestores mantêm os pontos e avançam o atendimento das ocorrências.

> Dados demonstrativos. Confirme local e horários antes de usar. As medições e os endereços de demonstração não representam um serviço de monitoramento real. A etiqueta de 32 °C é didática, não clínica.

Este repositório contém somente o frontend e seu servidor local. A API Java, as regras de negócio e o PostgreSQL permanecem no projeto [Refúgio](https://github.com/Guilherme-Soares00/refugio).

## Equipe

| Integrante | RM | Turma |
| --- | --- | --- |
| Luis Fillipe Rodrigues Seripieri | 567918 | 2TDSPB |
| Gabriel Rocha de Souza | 567023 | 2TDSPB |
| Luiz Kichimoto Valdevino | 567726 | 2TDSPB |
| Guilherme Soares | 568227 | 2TDSPB |
| Gabriel Stuani | 566682 | 2TDSPB |

## Executar

Pré-requisitos: Node.js 22 ou superior e a API Refúgio em execução com seus dados demonstrativos habilitados. Siga o README do backend para iniciar Java/PostgreSQL. Não é necessário instalar pacotes para executar ou testar este frontend: ele usa HTML, CSS, JavaScript e módulos nativos do Node.js.

Clone e entre na raiz:

```bash
git clone https://github.com/Guilherme-Soares00/refugio-web.git
cd refugio-web
```

Se a API estiver em `http://localhost:8080`, execute:

```bash
npm start
```

Abra **http://localhost:3000/**. O servidor web escuta somente em `127.0.0.1`.

Para outra porta da API, configure a origem antes de iniciar. Exemplos executados na raiz do frontend:

**PowerShell local:**

```powershell
$env:API_BASE_URL = 'http://localhost:18080'
npm start
```

**Bash local — Linux ou Git Bash:**

```bash
API_BASE_URL=http://localhost:18080 npm start
```

| Variável | Padrão | Uso |
|---|---|---|
| `API_BASE_URL` | `http://localhost:8080` | Origem HTTP/HTTPS da API, sem caminho ou credenciais |
| `PORT` | `3000` | Porta local do servidor web |

O servidor lê variáveis do processo; não carrega `.env` automaticamente. Se a API não estiver acessível, os fluxos dependentes dela exibem erro. Não há substituição silenciosa por dados mockados. Para encerrar, use `Ctrl+C` no terminal do servidor.

## Como a integração funciona

```text
Navegador → localhost:3000 → servidor web/proxy → API Java → PostgreSQL
```

A página chama `/api/...` na própria origem. O servidor encaminha essas requisições para `API_BASE_URL`, preservando método, corpo, Bearer e o Host do navegador. Assim, os links HAL e os cabeçalhos de navegação gerados pela API continuam apontando para a origem web, sem reescrever JSON. Também são encaminhados Swagger/OpenAPI e os endpoints de Actuator usados na interface.

O proxy não implementa regras de negócio nem autentica usuários: a API Java valida JWT, papéis, entradas e transições. Cookies não são encaminhados. O destino da API é configurado apenas no servidor, não por parâmetros recebidos do navegador. Corpos de requisição têm limite de 1 MiB, e a espera da API é limitada a 15 segundos. O servidor não publica `.env`, código do servidor, testes ou arquivos fora da pasta de assets.

O proxy local mantém navegador e chamadas HTTP na mesma origem. Isso dispensa CORS para este caminho, sem remover a configuração de CORS existente na API para outros clientes. O servidor é voltado à demonstração/desenvolvimento local, não é uma implantação pública com HTTPS.

## Fluxos disponíveis

- Consulta pública de pontos, filtros por bairro/status/recurso, ordenação, paginação e detalhes.
- Recursos disponíveis, última medição e histórico de medições do ponto.
- Cadastro, login e saída; cadastro cria cidadão, nunca gestor.
- Registro e acompanhamento das próprias ocorrências.
- Gestão de pontos e recursos, movimentação de recurso e registro de medição.
- Atualização do status de ocorrência por ID. O contrato atual da API não oferece uma fila global de ocorrências: informe o identificador retornado no registro.
- Diagnóstico com health e info públicos e métricas restritas a gestor; acesso ao Swagger.

O JWT fica somente na memória da página. Recarregar exige novo login; não é salvo em localStorage ou cookies nem exibido na interface. O papel controla a apresentação dos botões, mas a autorização real é responsabilidade do backend. Os dados retornados são inseridos como texto/elementos DOM, sem interpretar descrições como HTML.

A interface usa as coleções HAL `_embedded`, `_links` e `page`, inclusive quando `_embedded` não existe numa lista vazia. Respostas 204 não são interpretadas como JSON, e erros de entrada, autenticação, permissão, inexistência e conflito preservam os status da API.

### Contas fictícias de demonstração

As contas só existem quando o seed demonstrativo da API está habilitado.

| Papel | E-mail | Senha fictícia |
|---|---|---|
| CIDADAO | `cidadao01@example.test` | `CidadaoDemo2026!` |
| GESTOR | `gestor09@example.test` | `GestorDemo2026!` |

São credenciais públicas de uma base fictícia, não senhas de produção. Não use informações pessoais. Identificadores são gerados pelo banco: capture o ID retornado, sem presumir que um ponto ou ocorrência sempre terá o mesmo número.

## Testes

Na raiz do frontend:

```bash
npm test
```

A suíte usa `node:test` e servidores HTTP isolados. Verifica contratos do cliente, HAL, sessão, tratamento de erros, restrição de origem dos links, entrega de assets e encaminhamento HTTP. Os testes de proxy usam um upstream controlado de teste; não substituem a conferência ponta a ponta com Java e PostgreSQL reais.

Para uma conferência manual com o backend: consulte pontos sem login; registre uma ocorrência como cidadão e guarde seu ID; entre como gestor, crie e edite um ponto e seus recursos, registre uma medição e avance a ocorrência; volte ao cidadão e confira o estado atualizado. Verifique também os erros no Swagger, pois ocultar controles não prova a autorização da API.

## Identidade visual e recursos locais

O web acompanha as cores e os componentes do aplicativo Mobile da equipe: verde-petróleo, fundo claro, cartões brancos e símbolo de abrigo. A fonte Roboto e os ícones Material são servidos localmente, sem CDN na execução. As licenças estão em `web/assets/fonts/OFL.txt` e `web/assets/icons/LICENSE.txt`. As transições respeitam a preferência de movimento reduzido do navegador.

## Estrutura

```text
index.html          estrutura da interface
web/                estilos, cliente HTTP e interação
server.mjs          servidor local de assets e proxy da API
tests/              testes automatizados sem dependências externas
```

A aplicação Mobile é independente deste repositório. O web demonstra a integração com a API real e não altera os dados simulados usados no Flutter.
