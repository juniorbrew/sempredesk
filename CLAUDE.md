# SempreDesk — Portal do Cliente
## Visão geral do projeto
Portal de atendimento ao cliente onde um usuário pode ser vinculado a múltiplas empresas.
Cada empresa tem seus próprios tickets, estatísticas e notificações completamente independentes.
## Stack
- React + Vite
- Sem UI library externa (CSS-in-JS com variáveis CSS nativas)
- Dark mode automático via prefers-color-scheme
## Estrutura de pastas relevante
src/
├── components/
│   └── PortalCliente.jsx
├── hooks/
│   └── usePortal.js
├── data/
│   └── mockData.js
└── main.jsx
## Regras de negócio — IMPORTANTE
### Multi-empresa
- Um usuário pode estar vinculado a N empresas simultaneamente
- Cada empresa tem um papel por usuário: Administrador, Operador ou Visualizador
- Ao trocar de empresa, SEMPRE resetar: filtro de tickets, busca e fechar dropdowns
- NUNCA misturar dados (tickets, stats, notificações) entre empresas diferentes
- O activeCompanyId em usePortal.js é a fonte de verdade da empresa ativa
### Permissões por papel
- Administrador — acesso total, pode abrir e gerenciar chamados
- Operador — pode abrir e acompanhar chamados
- Visualizador — somente leitura, botão de abrir chamado desabilitado
### Tickets
- O campo progress vai de 0 a 4:
  0 = Aberto · 1 = Recebido · 2 = Em análise · 3 = Em atendimento · 4 = Resolvido
- Status possíveis: Aberto, Em andamento, Resolvido
- Prioridades possíveis: Alta, Média, Baixa
## Endpoints da API
GET  /api/me
GET  /api/companies/:companyId/tickets?status=&search=
GET  /api/companies/:companyId/stats
GET  /api/companies/:companyId/notifications
PATCH /api/companies/:companyId/notifications/read-all
POST /api/companies/:companyId/tickets
## Padrões de código a seguir
- Componentes funcionais com hooks, sem classes
- CSS-in-JS com objetos de estilo inline + variáveis CSS
- Nenhuma dependência de UI library externa
- Nomes de variáveis e comentários em português
- Dark mode sempre via variáveis CSS, nunca hardcoded
## O que NÃO fazer
- Não instalar Chakra, MUI, Ant Design ou similares
- Não usar localStorage para estado de empresa ativa
- Não fazer fetch de tickets sem o companyId na URL
- Não exibir notificações de uma empresa quando outra estiver ativa
