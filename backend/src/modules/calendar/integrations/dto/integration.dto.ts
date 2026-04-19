import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class SyncCalendarDto {
  /** ID do calendário do provider a sincronizar. Se omitido, sincroniza o calendário principal. */
  @IsOptional()
  @IsString()
  calendarId?: string;

  /**
   * Número de dias no passado a importar. Padrão: 30.
   * Fase 4.1: janela estática. Fase 4.2: usar syncToken para incremental.
   */
  @IsOptional()
  daysBack?: number;

  /** Número de dias no futuro a importar. Padrão: 90. */
  @IsOptional()
  daysForward?: number;
}

export class ConnectIntegrationDto {
  @IsIn(['google', 'outlook'])
  provider: 'google' | 'outlook';
}
