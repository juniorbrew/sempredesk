# Design System — SempreDesk

> Leia este arquivo inteiro antes de escrever qualquer linha de CSS ou Tailwind.
> Toda decisão visual do sistema parte daqui.

---

## 1. Filosofia visual

Estilo **painel de suporte empresarial** (referência: Intercom, Zendesk, Linear).
- Flat, limpo, sem gradientes decorativos
- Hierarquia clara: informação densa mas respirável
- Ações primárias sempre em indigo (`#4F46E5`)
- Feedback de estado via cor semântica nos badges

---

## 2. Paleta de cores (tokens Tailwind customizados)

Adicionar em `tailwind.config.ts`:

```ts
colors: {
  brand: {
    50:  '#EEF2FF',
    100: '#E0E7FF',
    200: '#C7D2FE',
    400: '#818CF8',
    500: '#6366F1',
    600: '#4F46E5',   // ← accent primário
    700: '#4338CA',   // ← accent hover
    800: '#3730A3',
    900: '#312E81',
  },
  nav: '#16133D',     // sidebar esquerda
}
```

### Cores semânticas de status (usar como classes utilitárias)

| Status        | Background  | Text        | Border      |
|---------------|-------------|-------------|-------------|
| Aberto        | `#EEF2FF`   | `#3730A3`   | `#C7D2FE`   |
| Em andamento  | `#FEF3C7`   | `#92400E`   | `#FDE68A`   |
| Aguardando    | `#F0F9FF`   | `#0369A1`   | `#BAE6FD`   |
| Resolvido     | `#F0FDF4`   | `#166534`   | `#BBF7D0`   |
| Fechado       | `#F9FAFB`   | `#374151`   | `#E5E7EB`   |
| Cancelado     | `#FEF2F2`   | `#991B1B`   | `#FECACA`   |

### Prioridade

| Nível   | Background  | Text        |
|---------|-------------|-------------|
| Baixa   | `#F0FDF4`   | `#166534`   |
| Média   | `#FEF3C7`   | `#92400E`   |
| Alta    | `#FFF7ED`   | `#C2410C`   |
| Crítica | `#FDF4FF`   | `#7E22CE`   |

### Canais

| Canal     | Background  | Text        |
|-----------|-------------|-------------|
| WhatsApp  | `#DCFCE7`   | `#15803D`   |
| Portal    | `#EEF2FF`   | `#4F46E5`   |

---

## 3. Tipografia

Fonte principal: **DM Sans** (Google Fonts)
Fonte mono: **DM Mono** (números de ticket, timestamps, CNPJs)

```ts
// tailwind.config.ts
fontFamily: {
  sans: ['DM Sans', 'system-ui', 'sans-serif'],
  mono: ['DM Mono', 'monospace'],
}
```

Escala:
- `text-[10px]` — labels de seção uppercase, meta info
- `text-[11px]` — subtítulos, timestamps, badges
- `text-[12px]` — corpo de tabelas, chips, campos
- `text-[13px]` — corpo principal, mensagens de chat
- `text-[15px]` — títulos de página
- `text-[16px]` — assunto de ticket, nome de cliente

---

## 4. Tokens de espaçamento e layout

```
Nav sidebar:      68px de largura, fundo #16133D
Conv list:        310px (atendimento)
Client panel:     272-290px (atendimento e ticket)
Ticket sidebar:   272px
Content padding:  px-6 py-5 (24px/20px)
Card padding:     p-4 ou px-4 py-3
Gap entre cards:  gap-3 (12px)
Border radius:    rounded-lg (12px) para cards, rounded-md (8px) para chips/botões
Border:           border border-black/[0.07] (1px solid rgba(0,0,0,.07))
Border hover:     border-black/[0.12]
```

---

## 5. Componentes UI — primitivos (`src/components/ui/`)

### StatusBadge
```tsx
// Uso: <StatusBadge status="aberto" />
// Props: status: 'aberto' | 'em_andamento' | 'aguardando' | 'resolvido' | 'fechado' | 'cancelado'
// Renderiza: bolinha colorida + label + bg colorido
```

### PriorityBadge
```tsx
// Uso: <PriorityBadge priority="media" />
// Props: priority: 'baixa' | 'media' | 'alta' | 'critica'
```

### ChannelBadge
```tsx
// Uso: <ChannelBadge channel="whatsapp" />
// Props: channel: 'whatsapp' | 'portal'
// Renderiza: ícone do canal + label
```

### TicketNumber
```tsx
// Uso: <TicketNumber id="000048" href="/tickets/48" />
// Renderiza: #000048 em font-mono, cor accent, hover underline
```

### Avatar
```tsx
// Uso: <Avatar name="Kleiton Neves" size="md" color="green" />
// Gera iniciais automaticamente (KN)
// Sizes: sm(26px) | md(34px) | lg(42px) | xl(48px)
// Colors: green | blue | orange | purple | rose | indigo | gray
```

### SlaBar
```tsx
// Uso: <SlaBar percent={58} label="2h garantido" />
// percent < 50  → verde
// percent 50-80 → amarelo
// percent > 80  → vermelho
```

### IconButton
```tsx
// Uso: <IconButton icon={<PlusIcon />} onClick={...} />
// 30x30px, rounded-lg, border, bg-surface, hover bg-surface-2
```

### StatCard
```tsx
// Uso: <StatCard value={48} label="Tickets total" trend="+3 esse mês" trendDir="up" />
```

### NavItem
```tsx
// Uso: <NavItem icon={<TicketIcon />} label="Tickets" href="/tickets" badge={2} active />
// Renderiza item da sidebar esquerda dark
```

---

## 6. Layout shell do admin

```tsx
// src/app/(admin)/layout.tsx
// Estrutura: <div class="flex h-screen overflow-hidden">
//   <NavSidebar />        ← 68px, fixo, dark
//   <main class="flex-1 overflow-hidden">
//     {children}
//   </main>
// </div>
```

### NavSidebar — ícones e rotas

| Ícone       | Label                | Rota                    |
|-------------|----------------------|-------------------------|
| Grid        | Dashboard            | `/dashboard`            |
| MessageSquare | Atendimento        | `/atendimento`          |
| MessagesSquare | Chat interno      | `/chat`                 |
| Ticket      | Tickets              | `/tickets`              |
| Users       | Clientes             | `/clientes`             |
| FileText    | Contratos            | `/contratos`            |
| Monitor     | Monitoramento PDV    | `/monitoramento-pdv`    |
| BookOpen    | Base de Conhecimento | `/base-conhecimento`    |
| BarChart    | Relatórios           | `/relatorios`           |
| Settings    | Configurações        | `/configuracoes`        |

---

## 7. Padrões por tela

### Tela de lista (tabelas)
- TopBar: ícone da página + título + subtítulo (contagem) + ações à direita
- Stat cards clicáveis para filtrar por status (6 cards em grid)
- Barra de filtros: busca + selects de status/prioridade/departamento/técnico
- Tabela com colunas fixas, header com sorting, body com overflow-y auto
- Paginação no rodapé da tabela
- Linhas com hover bg-surface, cursor pointer → navega para detalhe

### Tela de detalhe (ticket)
- TicketBar: back button + chips de id/status/prioridade/canal + ações
- Layout 2 colunas: coluna principal (flex-1) + sidebar direita (272px)
- Coluna principal: InfoCard + ActivityFilters + Timeline + ReplyArea
- Sidebar: Detalhes + DadosCliente + Histórico + Ações + Atribuição

### Tela de atendimento (chat)
- Layout 4 colunas: Nav(68px) + ConvList(310px) + Chat(flex-1) + ClientPanel(290px)
- ConvList: busca + tabs de canal + filtros + lista de conversas com badges ricos
- Chat: header + mensagens + input com toolbar
- ClientPanel: informações completas do cliente + SLA + tickets + contrato

### Portal do cliente
- Layout 2 colunas: sidebar simples (220px) + conteúdo (flex-1)
- Sidebar: logo da rede + avatar do contato + links de navegação
- Paleta levemente diferente: usar brand-600 mas bg mais claro/neutro
- Sem NavSidebar dark — portal é mais clean, estilo "self-service"

---

## 8. Animações e micro-interações

```css
/* Transições padrão — aplicar em todos os elementos interativos */
transition-colors duration-100   /* hover de bg/cor */
transition-all duration-150      /* hover de cards */

/* Typing indicator (chat) */
@keyframes bounce {
  0%, 70%, 100% { transform: translateY(0) }
  35%           { transform: translateY(-4px) }
}
```

---

## 9. Ícones

Usar exclusivamente **lucide-react**.
```bash
npm install lucide-react
```

Tamanho padrão: `size={16}` para inline, `size={18}` para nav, `size={20}` para page icons.
strokeWidth sempre `1.6` (mais refinado que o padrão 2).

---

## 10. Acessibilidade mínima

- Todos os botões com `title` ou `aria-label`
- Tabelas com `<th scope="col">`
- Inputs com `<label>` associado
- Foco visível: `focus-visible:ring-2 focus-visible:ring-brand-600`
