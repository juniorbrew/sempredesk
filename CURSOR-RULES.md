\# CURSOR-RULES.md



\## Contexto do projeto

Este projeto é o SempreDesk.



Stack principal:

\- frontend local

\- repositório versionado no GitHub

\- deploy e validações finais no VPS

\- uso de Codex local para apoio analítico e revisão quando necessário



\## Fluxo obrigatório de trabalho

Sempre seguir esta ordem:



1\. analisar o código local primeiro

2\. identificar arquivos impactados

3\. propor alteração mínima e segura

4\. aplicar a correção localmente

5\. revisar impacto no restante do sistema

6\. preparar mudanças para commit

7\. considerar integração com GitHub

8\. considerar validação final no VPS quando houver impacto real em ambiente, API, processo, banco, fila ou comportamento de produção



\## Regra principal

Sempre trabalhar neste caminho:



LOCAL -> GITHUB -> VPS



\### LOCAL

No ambiente local, fazer:

\- leitura e análise do código

\- implementação

\- refatoração controlada

\- revisão de impacto

\- testes locais quando possível



\### GITHUB

No GitHub, considerar:

\- organização das mudanças

\- diff limpo

\- descrição objetiva

\- preparação para commit e push

\- abertura de PR quando aplicável



\### VPS

No VPS, considerar apenas quando necessário:

\- validar comportamento em ambiente real

\- inspecionar logs

\- revisar variáveis de ambiente

\- revisar processos, serviços, filas e integrações

\- confirmar se a correção local faz sentido no ambiente real



\## Instrução de comportamento

Nunca sair alterando muita coisa sem necessidade.

Sempre priorizar correção pequena, segura e objetiva.

Sempre respeitar o padrão já existente do projeto.

Sempre explicar:

1\. causa provável

2\. arquivos impactados

3\. alteração proposta

4\. risco de regressão

5\. próximos passos



\## Regras do SempreDesk

\- respeitar arquitetura multiempresa

\- nunca misturar dados entre empresas

\- sempre considerar companyId

\- activeCompanyId é a fonte de verdade no portal

\- não quebrar permissões por papel

\- não introduzir biblioteca nova sem necessidade

\- manter padrão existente de código



\## Quando envolver Codex local

Usar Codex local quando a tarefa exigir:

\- análise mais profunda

\- revisão arquitetural

\- avaliação de regressão

\- comparação entre alternativas

\- revisão final antes de mudança sensível



\## Quando envolver GitHub

Envolver GitHub quando a tarefa exigir:

\- commit organizado

\- branch dedicada

\- revisão de diff

\- PR

\- histórico limpo da solução



\## Quando envolver VPS

Envolver VPS quando a tarefa envolver:

\- bug que só ocorre em produção

\- comportamento dependente de ambiente

\- API real

\- banco real

\- filas, workers, serviços ou logs

\- validação final de deploy



\## Formato esperado das respostas

Sempre responder neste formato:



1\. diagnóstico

2\. causa provável

3\. arquivos impactados

4\. alteração recomendada

5\. risco de regressão

6\. se precisa GitHub

7\. se precisa VPS

8\. próximos passos

