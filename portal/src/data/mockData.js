// ── Usuário autenticado ──────────────────────────────────────────────────────
export const mockUsuario = {
  id: 'u1',
  nome: 'Carlos Mendes',
  email: 'carlos@empresa.com',
  avatar: 'CM',
};

// ── Empresas vinculadas ao usuário ───────────────────────────────────────────
export const mockEmpresas = [
  { id: 'e1', nome: 'Acme Tecnologia Ltda', papel: 'Administrador', logo: 'AT', cor: '#4f46e5' },
  { id: 'e2', nome: 'Globo Serviços S.A.',  papel: 'Operador',      logo: 'GS', cor: '#0891b2' },
  { id: 'e3', nome: 'Tech Start Inovações', papel: 'Visualizador',  logo: 'TS', cor: '#16a34a' },
];

// ── Helpers internos ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(4, '0');
const diasAtras = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
const horasAtras = (n) => {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
};

// ── Tickets por empresa ──────────────────────────────────────────────────────
export const mockTickets = {
  e1: [
    { id: 't101', numero: '#0101', assunto: 'Lentidão no sistema de PDV', status: 'Em andamento', prioridade: 'Alta',  progress: 3, empresa: 'e1', criadoEm: diasAtras(5),  atualizadoEm: horasAtras(2),  responsavel: 'Ana Lima',    categoria: 'Infraestrutura',
      historico: [
        { etapa: 0, data: diasAtras(5),  desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(4),  desc: 'Chamado recebido pela equipe' },
        { etapa: 2, data: diasAtras(3),  desc: 'Iniciada análise do ambiente' },
        { etapa: 3, data: horasAtras(2), desc: 'Técnico atuando no servidor de PDV' },
      ]},
    { id: 't102', numero: '#0102', assunto: 'Erro ao gerar relatório fiscal', status: 'Aberto',    prioridade: 'Média', progress: 1, empresa: 'e1', criadoEm: diasAtras(2),  atualizadoEm: diasAtras(2),   responsavel: null,          categoria: 'Financeiro',
      historico: [
        { etapa: 0, data: diasAtras(2),  desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(1),  desc: 'Chamado recebido e triado' },
      ]},
    { id: 't103', numero: '#0103', assunto: 'Atualização do certificado digital', status: 'Resolvido',  prioridade: 'Alta',  progress: 4, empresa: 'e1', criadoEm: diasAtras(15), atualizadoEm: diasAtras(8),   responsavel: 'Pedro Costa', categoria: 'Segurança',
      historico: [
        { etapa: 0, data: diasAtras(15), desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(14), desc: 'Recebido pela equipe de segurança' },
        { etapa: 2, data: diasAtras(13), desc: 'Certificado atual validado e identificado vencimento' },
        { etapa: 3, data: diasAtras(10), desc: 'Processo de renovação iniciado' },
        { etapa: 4, data: diasAtras(8),  desc: 'Certificado renovado e implantado com sucesso' },
      ]},
    { id: 't104', numero: '#0104', assunto: 'Integração com gateway de pagamento', status: 'Em andamento', prioridade: 'Alta',  progress: 2, empresa: 'e1', criadoEm: diasAtras(7),  atualizadoEm: diasAtras(1),   responsavel: 'Ana Lima',    categoria: 'Desenvolvimento',
      historico: [
        { etapa: 0, data: diasAtras(7),  desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(6),  desc: 'Chamado recebido' },
        { etapa: 2, data: diasAtras(1),  desc: 'Em análise dos endpoints da API' },
      ]},
    { id: 't105', numero: '#0105', assunto: 'Treinamento de usuários no módulo NF-e', status: 'Resolvido', prioridade: 'Baixa', progress: 4, empresa: 'e1', criadoEm: diasAtras(20), atualizadoEm: diasAtras(18),  responsavel: 'Sofia Reis',  categoria: 'Treinamento',
      historico: [
        { etapa: 0, data: diasAtras(20), desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(19), desc: 'Recebido e agendado' },
        { etapa: 2, data: diasAtras(19), desc: 'Material de treinamento preparado' },
        { etapa: 3, data: diasAtras(18), desc: 'Treinamento realizado presencialmente' },
        { etapa: 4, data: diasAtras(18), desc: 'Treinamento concluído com sucesso' },
      ]},
    { id: 't106', numero: '#0106', assunto: 'Backup automático não está executando', status: 'Aberto', prioridade: 'Média', progress: 0, empresa: 'e1', criadoEm: horasAtras(3),  atualizadoEm: horasAtras(3),  responsavel: null,          categoria: 'Infraestrutura',
      historico: [
        { etapa: 0, data: horasAtras(3), desc: 'Chamado aberto pelo cliente' },
      ]},
  ],
  e2: [
    { id: 't201', numero: '#0201', assunto: 'VPN corporativa com falha de conexão', status: 'Em andamento', prioridade: 'Alta',  progress: 3, empresa: 'e2', criadoEm: diasAtras(3),  atualizadoEm: horasAtras(5),  responsavel: 'Lucas Prado', categoria: 'Redes',
      historico: [
        { etapa: 0, data: diasAtras(3),  desc: 'Chamado aberto pelo cliente' },
        { etapa: 1, data: diasAtras(3),  desc: 'Recebido com prioridade alta' },
        { etapa: 2, data: diasAtras(2),  desc: 'Logs analisados, problema identificado no firewall' },
        { etapa: 3, data: horasAtras(5), desc: 'Técnico aplicando regras de firewall' },
      ]},
    { id: 't202', numero: '#0202', assunto: 'Impressoras da filial não imprimem', status: 'Resolvido', prioridade: 'Baixa', progress: 4, empresa: 'e2', criadoEm: diasAtras(10), atualizadoEm: diasAtras(9),   responsavel: 'Marta Alves', categoria: 'Hardware',
      historico: [
        { etapa: 0, data: diasAtras(10), desc: 'Chamado aberto' },
        { etapa: 1, data: diasAtras(10), desc: 'Recebido' },
        { etapa: 2, data: diasAtras(9),  desc: 'Driver desatualizado identificado' },
        { etapa: 3, data: diasAtras(9),  desc: 'Driver atualizado remotamente' },
        { etapa: 4, data: diasAtras(9),  desc: 'Impressão normalizada em todas as estações' },
      ]},
    { id: 't203', numero: '#0203', assunto: 'Solicitação de novo usuário no AD', status: 'Aberto', prioridade: 'Baixa', progress: 1, empresa: 'e2', criadoEm: horasAtras(12), atualizadoEm: horasAtras(10), responsavel: null,          categoria: 'Acesso',
      historico: [
        { etapa: 0, data: horasAtras(12), desc: 'Chamado aberto' },
        { etapa: 1, data: horasAtras(10), desc: 'Aguardando aprovação do gestor' },
      ]},
    { id: 't204', numero: '#0204', assunto: 'Servidor de e-mail com rejeição de mensagens', status: 'Em andamento', prioridade: 'Média', progress: 2, empresa: 'e2', criadoEm: diasAtras(1),  atualizadoEm: horasAtras(1),  responsavel: 'Lucas Prado', categoria: 'E-mail',
      historico: [
        { etapa: 0, data: diasAtras(1),  desc: 'Chamado aberto' },
        { etapa: 1, data: diasAtras(1),  desc: 'Recebido' },
        { etapa: 2, data: horasAtras(1), desc: 'Analisando logs do servidor SMTP' },
      ]},
  ],
  e3: [
    { id: 't301', numero: '#0301', assunto: 'Deploy do ambiente de homologação', status: 'Em andamento', prioridade: 'Média', progress: 2, empresa: 'e3', criadoEm: diasAtras(4),  atualizadoEm: diasAtras(1),   responsavel: 'Diego Moura', categoria: 'DevOps',
      historico: [
        { etapa: 0, data: diasAtras(4),  desc: 'Chamado aberto' },
        { etapa: 1, data: diasAtras(3),  desc: 'Recebido pela equipe de DevOps' },
        { etapa: 2, data: diasAtras(1),  desc: 'Configuração do pipeline em andamento' },
      ]},
    { id: 't302', numero: '#0302', assunto: 'Revisão de contrato de suporte', status: 'Resolvido', prioridade: 'Baixa', progress: 4, empresa: 'e3', criadoEm: diasAtras(30), atualizadoEm: diasAtras(25),  responsavel: 'Carla Neves', categoria: 'Administrativo',
      historico: [
        { etapa: 0, data: diasAtras(30), desc: 'Chamado aberto' },
        { etapa: 1, data: diasAtras(29), desc: 'Recebido' },
        { etapa: 2, data: diasAtras(28), desc: 'Contrato analisado' },
        { etapa: 3, data: diasAtras(27), desc: 'Proposta de renovação enviada' },
        { etapa: 4, data: diasAtras(25), desc: 'Contrato renovado e assinado' },
      ]},
    { id: 't303', numero: '#0303', assunto: 'Configuração de monitoramento de uptime', status: 'Aberto', prioridade: 'Alta', progress: 0, empresa: 'e3', criadoEm: horasAtras(6),  atualizadoEm: horasAtras(6),  responsavel: null,          categoria: 'Monitoramento',
      historico: [
        { etapa: 0, data: horasAtras(6), desc: 'Chamado aberto pelo cliente' },
      ]},
  ],
};

// ── Estatísticas por empresa ─────────────────────────────────────────────────
export const mockStats = {
  e1: {
    total:        6,
    abertos:      2,
    emAndamento:  2,
    resolvidos:   2,
    tempoMedioH:  18,
    satisfacao:   4.5,
  },
  e2: {
    total:        4,
    abertos:      1,
    emAndamento:  2,
    resolvidos:   1,
    tempoMedioH:  12,
    satisfacao:   4.8,
  },
  e3: {
    total:        3,
    abertos:      1,
    emAndamento:  1,
    resolvidos:   1,
    tempoMedioH:  36,
    satisfacao:   4.2,
  },
};

// ── Notificações por empresa ─────────────────────────────────────────────────
export const mockNotificacoes = {
  e1: [
    { id: 'n101', ticketId: 't101', ticketNum: '#0101', mensagem: 'Técnico iniciou o atendimento no servidor de PDV.', tipo: 'progresso', lida: false, data: horasAtras(2) },
    { id: 'n102', ticketId: 't104', ticketNum: '#0104', mensagem: 'Chamado #0104 passou para análise técnica.', tipo: 'progresso', lida: false, data: diasAtras(1) },
    { id: 'n103', ticketId: 't103', ticketNum: '#0103', mensagem: 'Chamado #0103 foi resolvido com sucesso!', tipo: 'resolucao', lida: true,  data: diasAtras(8) },
    { id: 'n104', ticketId: 't102', ticketNum: '#0102', mensagem: 'Seu chamado #0102 foi recebido e triado.', tipo: 'recebido', lida: true,  data: diasAtras(2) },
  ],
  e2: [
    { id: 'n201', ticketId: 't201', ticketNum: '#0201', mensagem: 'Técnico está aplicando as regras de firewall agora.', tipo: 'progresso', lida: false, data: horasAtras(5) },
    { id: 'n202', ticketId: 't204', ticketNum: '#0204', mensagem: 'Análise dos logs do SMTP iniciada.', tipo: 'progresso', lida: false, data: horasAtras(1) },
    { id: 'n203', ticketId: 't202', ticketNum: '#0202', mensagem: 'Problema das impressoras resolvido!', tipo: 'resolucao', lida: true,  data: diasAtras(9) },
  ],
  e3: [
    { id: 'n301', ticketId: 't301', ticketNum: '#0301', mensagem: 'Pipeline de CI/CD em configuração.', tipo: 'progresso', lida: false, data: diasAtras(1) },
    { id: 'n302', ticketId: 't302', ticketNum: '#0302', mensagem: 'Contrato renovado e assinado com sucesso!', tipo: 'resolucao', lida: true,  data: diasAtras(25) },
  ],
};
