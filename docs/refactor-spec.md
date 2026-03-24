# Spec de Refatoração — SempreDesk
# Guia completo para o Claude Code implementar o redesign em todo o sistema

> ANTES DE TUDO: leia `CLAUDE.md` e `docs/design-system.md` inteiros.
> Copie os HTMLs de referência para `docs/ui/` no seu projeto.

---

## ESTRUTURA DE FASES

```
Fase 0  — Setup: tokens, fontes, primitivos UI
Fase 1  — Shell: NavSidebar + layout do admin
Fase 2  — Atendimento (chat)
Fase 3  — Tickets: lista
Fase 4  — Tickets: detalhe
Fase 5  — Portal do cliente
Fase 6  — Integração real-time (WebSocket)
Fase 7  — Testes e polish final
```

---

## FASE 0 — Setup de design system

### Prompt para o Claude Code:

```
Leia docs/design-system.md antes de começar.

Implemente o setup do design system do SempreDesk:

1. Configure tailwind.config.ts:
   - Adicione a fonte DM Sans e DM Mono via @next/font/google
   - Adicione os tokens de cor: brand (50..900), nav (#16133D)
   - Adicione borderRadius customizado: card: '12px', chip: '8px'

2. Atualize src/app/globals.css:
   - Importe DM Sans e DM Mono
   - Defina variáveis CSS base:
     --color-nav: #16133D
     --color-accent: #4F46E5
     --color-accent-hover: #4338CA
     --color-accent-light: #EEF2FF
     --color-accent-mid: #C7D2FE

3. Crie src/lib/tokens.ts com:
   - STATUS_COLORS: Record<StatusType, {bg, text, border}>
   - PRIORITY_COLORS: Record<PriorityType, {bg, text}>
   - CHANNEL_COLORS: Record<ChannelType, {bg, text}>

4. Crie src/types/shared.types.ts com:
   - StatusType: 'aberto' | 'em_andamento' | 'aguardando' | 'resolvido' | 'fechado' | 'cancelado'
   - PriorityType: 'baixa' | 'media' | 'alta' | 'critica'
   - ChannelType: 'whatsapp' | 'portal'
   - UserRole: 'admin' | 'tecnico' | 'cliente'

5. Crie os componentes primitivos em src/components/ui/:
   - StatusBadge.tsx
   - PriorityBadge.tsx
   - ChannelBadge.tsx
   - TicketNumber.tsx
   - Avatar.tsx (com geração automática de iniciais e cor por hash do nome)
   - SlaBar.tsx
   - IconButton.tsx
   - StatCard.tsx

Cada componente deve ser totalmente tipado em TypeScript.
Rode tsc --noEmit ao finalizar.
```

---

## FASE 1 — Shell e NavSidebar

### Prompt:

```
Leia docs/design-system.md, seção 6 (Layout shell).

Implemente o layout base do painel admin:

1. Crie src/app/(admin)/layout.tsx:
   - Flex row, h-screen, overflow-hidden
   - <NavSidebar /> fixo à esquerda
   - <main> flex-1 overflow-hidden para o conteúdo

2. Crie src/components/shared/NavSidebar.tsx:
   - 68px de largura, fundo #16133D (var(--color-nav))
   - Logo do sistema (ícone chat quadrado, accent indigo)
   - Grupo de NavItems com ícones lucide-react (strokeWidth={1.6})
   - Item ativo: bg rgba(255,255,255,.14), ícone stroke white
   - Item inativo: ícone stroke rgba(255,255,255,.45), hover bg rgba(255,255,255,.08)
   - Badge de não lidos (vermelho) sobre o item Atendimento
   - Separadores nsep (linha rgba branca sutil) entre grupos
   - Rodapé: ícone Configurações + Avatar do usuário logado com dot online verde

3. Crie src/components/shared/NavItem.tsx:
   - Props: icon, label (para title/tooltip), href, badge?, active?
   - Use next/link para navegação
   - Detecte rota ativa com usePathname()

Rotas e ícones: ver docs/design-system.md seção 6.
Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 2 — Atendimento (chat)

### Referência visual: `docs/ui/sempredesk_atendimento.html`

### Tipos necessários:

```ts
// src/types/atendimento.types.ts
interface Conversa {
  id: string
  clienteNome: string
  clienteEmpresa: string
  canal: ChannelType
  ticketId?: string
  status: 'aberta' | 'encerrada'
  ultimaMensagem: string
  ultimaMensagemAt: Date
  naoLidos: number
  urgente: boolean
}

interface Mensagem {
  id: string
  conversaId: string
  tipo: 'cliente' | 'agente' | 'nota_interna' | 'sistema'
  conteudo: string
  autorNome: string
  autorAvatar?: string
  criadaAt: Date
  lida: boolean
}

interface ClienteDetalhe {
  id: string
  nome: string
  empresa: string
  rede?: string
  cnpj: string
  whatsapp: string
  email: string
  cidade: string
  clienteDesde: string
  plano: string
  slaGarantido: string
  contratoVencimento: string
  stats: {
    totalTickets: number
    taxaResolucao: number
    tempoMedio: string
    urgentesAbertos: number
  }
}
```

### Prompt:

```
Leia docs/ui/sempredesk_atendimento.html como referência visual.
Leia docs/design-system.md antes de começar.

Implemente o módulo de Atendimento em src/app/(admin)/atendimento/.

STORE — src/stores/atendimentoStore.ts (Zustand):
- conversas: Conversa[]
- conversaSelecionada: Conversa | null
- mensagens: Record<string, Mensagem[]>
- clienteAtivo: ClienteDetalhe | null
- digitando: boolean
- actions: selecionarConversa, enviarMensagem, marcarLido, encerrarConversa

COMPONENTES em src/components/atendimento/:

1. ConversationList.tsx (310px, border-right)
   - Header: título "Atendimento" + botões nova conversa / filtros / atualizar
   - SearchInput: busca por nome, empresa ou ticket
   - Tabs: Todos / WhatsApp / Portal / Sem ticket
   - FilterChips: Em aberto / Encerradas / Vinculadas
   - Lista de ConversationItem com scroll

2. ConversationItem.tsx
   - Avatar com iniciais + ChannelDot (verde=WA, roxo=Portal)
   - Nome, tempo relativo, preview da última mensagem
   - Badges: TicketNumber, nome da empresa, urgência, não lidos
   - Item ativo: bg brand-50, border-color brand-600

3. ChatWindow.tsx (flex-1)
   - ChatHeader: avatar + nome + status + ChannelBadge + TicketChip + ações
   - MessageList: scroll para baixo no novo msg, gap entre grupos
   - TypingIndicator: 3 dots animados
   - ChatInput: toolbar + textarea auto-resize + send

4. MessageBubble.tsx
   - tipo 'cliente': bg white, border, border-radius 16px 16px 16px 4px
   - tipo 'agente': bg brand-600, text white, border-radius 16px 16px 4px 16px
   - tipo 'nota_interna': bg amber-50, border amber-200, label "Nota interna"
   - tipo 'sistema': texto centralizado muted, sem bubble

5. ClientPanel.tsx (290px, border-left)
   - Avatar + nome + empresa + tags (Premium, Portal, Ativo)
   - Seção: Responsável com botão Trocar
   - Seção: SLA com SlaBar
   - Seção: Informações (empresa, rede, CNPJ, tel, email, cidade)
   - Seção: Estatísticas (grid 2x2 com StatCard)
   - Seção: Tickets recentes (últimos 4)
   - Seção: Contrato

6. ChannelDot.tsx — bolinha no canto do avatar indicando canal

PAGE — src/app/(admin)/atendimento/page.tsx:
- Layout: flex h-full overflow-hidden
- <ConversationList /> + <ChatWindow /> + <ClientPanel />
- Conectado ao atendimentoStore

Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 3 — Tickets: lista

### Referência visual: `docs/ui/sempredesk_tickets_lista.html`

### Tipos:

```ts
// src/types/ticket.types.ts
interface Ticket {
  id: number
  numero: string        // '000048'
  assunto: string
  descricao?: string
  cliente: string
  departamento?: string
  categoria?: string
  subcategoria?: string
  status: StatusType
  prioridade: PriorityType
  canal?: ChannelType
  tecnico?: string
  sla?: string
  slaViolado: boolean
  urgente: boolean
  aberturaAt: Date
  resolucaoAt?: Date
  fechamentoAt?: Date
  tags: string[]
}
```

### Prompt:

```
Leia docs/ui/sempredesk_tickets_lista.html como referência visual.
Leia docs/design-system.md antes de começar.

Implemente a listagem de tickets em src/app/(admin)/tickets/.

STORE — src/stores/ticketStore.ts (Zustand):
- tickets: Ticket[]
- filtros: { status, prioridade, departamento, tecnico, busca }
- paginacao: { pagina, total, porPagina }
- ticketSelecionado: Ticket | null
- actions: setFiltro, setPagina, carregarTickets

COMPONENTES em src/components/tickets/:

1. TicketStatusCards.tsx
   - Grid de 6 StatCard clicáveis (Abertos, Em andamento, Aguardando, Resolvidos, Fechados, Cancelados)
   - Card ativo: border brand-600, bg brand-50
   - Cada card: ícone colorido + número grande + label
   - Click filtra a tabela pelo status correspondente

2. TicketFilters.tsx
   - SearchInput (busca por número, assunto, cliente)
   - Select: Todos os status
   - Select: Todas as prioridades
   - Select: Departamento
   - Select: Técnico
   - Todos controlados pelo ticketStore

3. TicketTable.tsx
   - Colunas: Nº | Assunto | Cliente | Depto/Categoria | Status | Prioridade | Técnico | SLA | Abertura
   - Header com sorting clicável (ícone chevron)
   - Linha de ticket:
     * Nº: <TicketNumber /> em font-mono
     * Assunto: texto principal + subtítulo em cinza (subcategoria)
     * Ícone triângulo de alerta se urgente=true (amarelo) ou slaViolado (vermelho)
     * Status: <StatusBadge />
     * Prioridade: <PriorityBadge />
     * SLA: vermelho bold "VIOLADO" se violado, cinza com tempo se ok
     * Abertura: font-mono, cinza
   - Hover: bg-surface, cursor pointer
   - Click na linha: navega para /tickets/[id]

4. TicketPagination.tsx
   - "Página X de Y · N tickets"
   - Botões prev / números / next
   - Página ativa: bg brand-600, text white

PAGE — src/app/(admin)/tickets/page.tsx:
- TopBar: ícone Ticket + "Tickets" + contagem + [Lista|Kanban] + CSV + Novo Ticket
- <TicketStatusCards />
- <TicketFilters />
- <TicketTable />

Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 4 — Tickets: detalhe

### Referência visual: `docs/ui/sempredesk_ticket_detalhe.html`

### Prompt:

```
Leia docs/ui/sempredesk_ticket_detalhe.html como referência visual.
Leia docs/design-system.md antes de começar.

Implemente o detalhe do ticket em src/app/(admin)/tickets/[id]/.

COMPONENTES em src/components/tickets/:

1. TicketBar.tsx (header da página de detalhe)
   - BackButton → navega para /tickets
   - TicketIdChip: #000039 em font-mono, bg brand-50, border brand-200
   - StatusChip clicável (abre select inline)
   - PriorityChip clicável
   - ChannelBadge
   - Spacer
   - BotãoReabrir (se fechado/resolvido) ou BotãoEncerrar (se aberto)

2. TicketInfoCard.tsx
   - Meta: ícone calendário + "Abertura: data" · ícone clock + "Fechamento: data" · "Resolução: data"
   - Assunto em destaque (text-base font-bold)
   - Descrição em cinza

3. ActivityFilters.tsx
   - Label "Visualizar:"
   - Chips toggle: Cliente / Agente / Atualizações / Notas internas / Conversa
   - Cada chip tem ícone + label, toggle on/off

4. ActivityTimeline.tsx
   - Lista de ActivityItem ordenada por data
   - Tipos de item:
     * 'mensagem_agente': avatar indigo + nome + badge "Agente" + hora + bubble bg-surface
     * 'mensagem_cliente': avatar verde + nome + badge "Cliente" + hora + bubble bg-surface
     * 'nota_interna': avatar indigo + badge "Nota interna" + bubble bg-amber-50 border-amber-200
     * 'sistema': avatar cinza com ícone check + texto muted (ex: "Chamado resolvido: teste")
     * 'conversa_vinculada': ConversationBlock (header clicável + botão "Carregar mais")
   - Filtrado pelos ActivityFilters

5. ReplyArea.tsx
   - Tabs: Resposta pública / Nota interna / Atualização
   - Textarea auto-resize com placeholder contextual
   - Toolbar: Arquivo / Imagem / Emoji / Respostas rápidas (ícones pequenos)
   - Botão "Enviar resposta" (brand-600)

6. TicketSidebar.tsx (272px, border-left)
   Seções:
   a) Detalhes: status, prioridade, abertura, resolução, fechamento, tempo total
   b) Dados do cliente: avatar + nome + CNPJ + contato com botão WhatsApp verde
   c) Histórico do cliente: últimos 3 tickets com dot colorido
   d) Ações: botões Editar ticket e Reabrir ticket
   e) Atribuição: selects de Prioridade, Técnico, Departamento, Categoria, Subcategoria + input Tags + botão Salvar

PAGE — src/app/(admin)/tickets/[id]/page.tsx:
- Busca dados do ticket pelo id (server component ou useEffect)
- <TicketBar />
- Layout flex: <div class="flex-1 flex flex-col overflow-hidden p-5 gap-3">
    <TicketInfoCard />
    <ActivityFilters />
    <ActivityTimeline />   (flex-1 overflow-y-auto)
    <ReplyArea />
  </div>
  <TicketSidebar />

Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 5 — Portal do cliente

### Conceito visual do portal:
- Mais limpo que o admin, menos denso
- Sidebar esquerda clara (220px), fundo branco com borda
- Logo da rede/empresa no topo da sidebar
- Navegação simples: Dashboard / Meus Tickets / Base de Conhecimento / Minha Conta
- Paleta idêntica (brand-600 = indigo) mas sem o dark nav

### Prompt PARTE A — layout e dashboard:

```
Implemente o portal do cliente em src/app/(portal)/.
Leia docs/design-system.md antes de começar.

O portal é acessado pelos clientes (postos, empresas) para abrir e acompanhar tickets.
Layout diferente do admin: sidebar clara (220px) + conteúdo (flex-1).

1. src/app/(portal)/layout.tsx
   - Flex row h-screen overflow-hidden
   - <PortalSidebar /> + <main flex-1 overflow-hidden bg-surface-2>

2. src/components/portal/PortalSidebar.tsx (220px, bg white, border-right)
   - Topo: logo da empresa/rede (placeholder)
   - Avatar do contato logado + nome + empresa
   - Nav links:
     * Dashboard (ícone grid)
     * Meus Tickets (ícone ticket, badge com abertos)
     * Base de Conhecimento (ícone book)
     * Minha Conta (ícone user)
   - Item ativo: bg brand-50, text brand-700, border-left-2 brand-600
   - Rodapé: botão Sair

3. src/app/(portal)/dashboard/page.tsx
   Layout em 2 colunas (1fr + 320px):

   COLUNA PRINCIPAL:
   a) Saudação: "Bom dia, Kleiton 👋" + subtítulo "Posto Novo Lago"
   b) StatCards (3 em linha): Tickets abertos / Resolvidos este mês / Tempo médio
   c) Card "Tickets recentes" (tabela simplificada):
      - Colunas: Nº | Assunto | Status | Prioridade | Abertura
      - Últimos 5 tickets
      - Link "Ver todos" no rodapé
   d) Card "Atualizações recentes" (lista de atividade):
      - Cada item: dot colorido + texto da atualização + data relativa
      - Ex: "Ticket #000048 foi atualizado há 3 minutos"

   COLUNA LATERAL (320px):
   a) Card "Abrir novo ticket":
      - Ícone + título + descrição curta
      - Botão "Novo ticket" brand-600
   b) Card "Base de conhecimento":
      - 3 artigos recentes com link
      - Link "Ver todos os artigos"
   c) Card "Contato do suporte":
      - WhatsApp, e-mail, horário de atendimento

Rode lint + tsc --noEmit ao finalizar.
```

### Prompt PARTE B — lista e detalhe de tickets do portal:

```
Continue o portal do cliente.
Leia docs/design-system.md antes de começar.

4. src/app/(portal)/tickets/page.tsx
   - TopBar: "Meus Tickets" + botão "Abrir novo ticket"
   - FilterChips horizontais: Todos / Abertos / Em andamento / Aguardando / Resolvidos / Fechados
   - Tabela de tickets (sem colunas de técnico e departamento interno):
     Colunas: Nº | Assunto | Status | Prioridade | Última atualização | Abertura
   - Linha clicável → /portal/tickets/[id]

5. src/app/(portal)/tickets/new/page.tsx (formulário de abertura)
   Card centralizado (max-w-xl) com:
   - Input: Assunto (obrigatório)
   - Textarea: Descrição detalhada
   - Select: Departamento
   - Select: Prioridade (padrão: Média)
   - Upload de arquivo (opcional)
   - Botões: Cancelar + Enviar ticket

6. src/app/(portal)/tickets/[id]/page.tsx
   Layout similar ao admin mas simplificado:
   - Header: back + número + StatusBadge + ChannelBadge
   - InfoCard: assunto + datas
   - Timeline de mensagens (sem filtros de agente/sistema — só a conversa)
   - ReplyBox simples: textarea + botão Responder
   - Sidebar simplificada (240px):
     * Status + Prioridade + datas
     * Técnico atribuído
     * Sem campos de edição (cliente não edita)

Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 6 — Integração real-time

### Prompt:

```
Implemente a camada de WebSocket para o módulo de Atendimento.
Leia docs/design-system.md e src/stores/atendimentoStore.ts antes de começar.

1. Crie src/lib/socket.ts:
   - Cliente Socket.io (ou WS nativo conforme o backend)
   - Função connect(token: string): Socket
   - Função disconnect(): void
   - Export singleton

2. Crie src/hooks/useAtendimentoSocket.ts:
   - Conecta ao WebSocket ao montar
   - Eventos a escutar:
     * 'nova_mensagem'     → atualiza mensagens no store
     * 'nova_conversa'     → adiciona conversa na lista
     * 'digitando'         → seta digitando=true por 3s
     * 'conversa_encerrada'→ atualiza status na lista
   - Eventos a emitir:
     * enviarMensagem(conversaId, conteudo)
     * marcarLido(conversaId)
     * digitando(conversaId)
   - Desconecta ao desmontar (cleanup)

3. Integre useAtendimentoSocket no ChatWindow.tsx:
   - Chame o hook ao montar o componente
   - Scroll automático para a última mensagem ao receber nova

4. Indicador de conexão no NavSidebar:
   - Dot verde "Online" quando conectado
   - Dot amarelo "Reconectando..." quando em retry
   - Dot cinza quando offline

Rode lint + tsc --noEmit ao finalizar.
```

---

## FASE 7 — Polish e testes

### Prompt:

```
Fase final de polish do SempreDesk.
Leia CLAUDE.md e docs/design-system.md antes de começar.

1. Responsividade mínima (breakpoint lg = 1280px):
   - Telas abaixo de 1280px: ocultar ClientPanel (botão para abrir em drawer)
   - Telas abaixo de 1024px: ocultar ConversationList (botão hambúrguer)
   - Portal: sidebar colapsável em mobile

2. Estados vazios (empty states):
   - ConversationList sem conversas: ícone + "Nenhuma conversa encontrada"
   - TicketTable sem resultados: ícone + "Nenhum ticket encontrado" + botão limpar filtros
   - Timeline sem atividade: ícone + "Nenhuma atividade ainda"
   - Portal dashboard sem tickets: ícone + "Tudo certo por aqui!" + botão novo ticket

3. Estados de loading:
   - Skeleton loader para ConversationList (5 itens placeholder)
   - Skeleton loader para TicketTable (8 linhas placeholder)
   - Skeleton loader para TicketSidebar
   - Spinner no botão Enviar enquanto aguarda resposta

4. Toasts de feedback (usar react-hot-toast ou sonner):
   - Sucesso: "Mensagem enviada", "Ticket atualizado", "Ticket encerrado"
   - Erro: "Erro ao enviar mensagem. Tente novamente."
   - Info: "Novo ticket de [cliente] recebido"

5. Atalhos de teclado:
   - Ctrl+K → abre busca global
   - Ctrl+N → novo ticket
   - Escape → fecha modais/drawers

6. Rode npm run build completo e corrija todos os erros.
   Rode npm run lint e corrija todos os warnings.
```

---

## DICAS IMPORTANTES para o Claude Code

### Use Plan Mode antes de cada fase
`Shift+Tab` duas vezes → Claude planeja sem escrever código.
Aprove o plano antes de continuar.

### Referencie sempre os arquivos HTML
```
@docs/ui/sempredesk_atendimento.html
```
O Claude Code lê o HTML e usa como spec de pixel-perfeito.

### Limpe o contexto entre fases
```
/clear
```
Evita confusão entre componentes já implementados.

### Commit a cada fase concluída
```
Faça commit com mensagem: "feat: fase X — [nome da fase]"
```

### Se algo quebrar, dê contexto cirúrgico
```
@src/components/atendimento/ChatWindow.tsx
@src/stores/atendimentoStore.ts
O ChatWindow não está recebendo as mensagens do store. O problema está na linha 47.
Corrija sem alterar outros arquivos.
```

### Ordem de prioridade se houver conflito
1. TypeScript sem erros
2. Lint sem warnings
3. Funcionalidade correta
4. Fidelidade visual ao HTML de referência

---

## CHECKLIST FINAL

```
[ ] Fase 0: tokens, tipos, primitivos UI
[ ] Fase 1: NavSidebar + layout shell
[ ] Fase 2: Atendimento completo (lista + chat + painel cliente)
[ ] Fase 3: Tickets lista com filtros e tabela
[ ] Fase 4: Tickets detalhe com timeline e sidebar
[ ] Fase 5A: Portal dashboard
[ ] Fase 5B: Portal tickets (lista + novo + detalhe)
[ ] Fase 6: WebSocket real-time
[ ] Fase 7: Polish, empty states, loading, toasts, atalhos
[ ] Build limpo sem erros
[ ] Lint limpo sem warnings
```
