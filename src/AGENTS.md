# AGENTS.md

## Contexto do projeto
Portal multiempresa em React + Vite.

- Um usuário pode estar vinculado a múltiplas empresas
- Cada empresa possui dados isolados (tickets, stats, notifications)
- O `activeCompanyId` em `usePortal.js` é a fonte de verdade

## Regras críticas

1. Nunca misturar dados entre empresas
2. Sempre usar `companyId` nas requisições
3. Ao trocar empresa:
   - resetar filtros
   - resetar busca
   - fechar dropdowns
4. Nunca usar localStorage para empresa ativa

## Padrões obrigatórios

- Componentes funcionais com hooks
- CSS-in-JS inline
- Variáveis CSS nativas
- Dark mode via CSS variables
- Código em português
- Sem bibliotecas UI externas

## Permissões

- Administrador → total
- Operador → criar + acompanhar
- Visualizador → somente leitura

## O que sempre revisar

- Isolamento por empresa
- Uso correto de activeCompanyId
- Regressão ao trocar empresa
- Permissões corretas
- Consistência entre dados

## Regra obrigatória

Sempre revisar antes de finalizar qualquer tarefa.

## Formato de resposta esperado

1. diagnóstico
2. causa provável
3. arquivos impactados
4. solução
5. riscos
6. testes
7. revisão final