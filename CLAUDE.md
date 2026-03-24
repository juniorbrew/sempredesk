# SempreDesk — Contexto do Projeto

## Stack
- **Frontend (admin):** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Zustand
- **Frontend (portal):** Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend:** NestJS, TypeScript, TypeORM, PostgreSQL, Redis, RabbitMQ
- **Infra:** Docker Compose, Nginx (reverse proxy)
- **Comunicação real-time:** WebSockets (Socket.io ou WS nativo)

## Comandos
- Dev admin:   `npm run dev`
- Dev portal:  `npm run dev` (pasta separada ou mesmo repo com turbo)
- Build:       `npm run build`
- Lint:        `npm run lint`
- Types:       `npx tsc --noEmit`
- Testes:      `npm run test`

## Estrutura de pastas esperada (admin)
```
src/
  app/
    (admin)/
      dashboard/
      atendimento/
      tickets/
        [id]/
      contratos/
      clientes/
      monitoramento-pdv/
      base-conhecimento/
      relatorios/
      configuracoes/
    layout.tsx          ← shell com NavSidebar
  components/
    ui/                 ← primitivos reutilizáveis
    atendimento/
    tickets/
    shared/
  stores/
  types/
  lib/
  hooks/
```

## Estrutura de pastas esperada (portal)
```
src/
  app/
    (portal)/
      dashboard/
      tickets/
        [id]/
      base-conhecimento/
      conta/
    layout.tsx
  components/
    portal/
  types/
  lib/
```

## Convenções obrigatórias
- Functional components com hooks — sem class components
- Tailwind para tudo — sem CSS modules, sem styled-components
- Nomear componentes: PascalCase | arquivos: kebab-case
- Tipos em `.types.ts` separados por domínio
- Stores Zustand em `src/stores/`, um arquivo por domínio
- Nunca hardcodar cores — usar apenas tokens do design system (`src/lib/tokens.ts`)
- `npx tsc --noEmit` + `npm run lint` ao final de cada fase

## Design System — referência visual completa
Ver: `docs/design-system.md`

## Telas redesenhadas (HTML de referência)
- Atendimento (chat):     `docs/ui/sempredesk_atendimento.html`
- Tickets (lista):        `docs/ui/sempredesk_tickets_lista.html`
- Ticket (detalhe):       `docs/ui/sempredesk_ticket_detalhe.html`
- Portal cliente:         `docs/ui/sempredesk_portal.html`  ← gerado em fase posterior

## Spec de implementação por módulo
Ver: `docs/refactor-spec.md`
