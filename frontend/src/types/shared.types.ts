export type StatusType =
  | 'aberto'
  | 'em_andamento'
  | 'aguardando'
  | 'resolvido'
  | 'fechado'
  | 'cancelado';

export type PriorityType = 'baixa' | 'media' | 'alta' | 'critica';

export type ChannelType = 'whatsapp' | 'portal';

export type UserRole = 'admin' | 'tecnico' | 'cliente';
