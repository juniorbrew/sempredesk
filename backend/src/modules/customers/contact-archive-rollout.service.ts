import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Etapa 9 — rollout seguro: feature flag FEATURE_CONTACT_ARCHIVE + contadores em memória (por processo).
 * Default habilitado; desligar com false/0/off/no/disabled (case-insensitive).
 */
@Injectable()
export class ContactArchiveRolloutService {
  private readonly counters = {
    archiveManual: 0,
    unarchiveManual: 0,
    autoReactivateCanonical: 0,
    autoReactivateFindOrCreateFallback: 0,
    fallbackFindByWhatsappInactivePromoted: 0,
    fallbackFindByWhatsappArchivedSkippedLog: 0,
    consolidateInactivePromotedToActive: 0,
  };

  constructor(private readonly cfg: ConfigService) {}

  /** Quando false, bloqueia arquivo/desarquivo manual e reativação automática (canonical + fallback). */
  isArchiveFeatureEnabled(): boolean {
    const raw = this.cfg.get<string | undefined>('FEATURE_CONTACT_ARCHIVE');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return true;
    }
    const s = String(raw).trim().toLowerCase();
    return !['false', '0', 'off', 'no', 'disabled'].includes(s);
  }

  incrArchiveManual() {
    this.counters.archiveManual += 1;
  }

  incrUnarchiveManual() {
    this.counters.unarchiveManual += 1;
  }

  incrAutoReactivateCanonical() {
    this.counters.autoReactivateCanonical += 1;
  }

  incrAutoReactivateFindOrCreateFallback() {
    this.counters.autoReactivateFindOrCreateFallback += 1;
  }

  incrFallbackInactivePromoted() {
    this.counters.fallbackFindByWhatsappInactivePromoted += 1;
  }

  incrFallbackArchivedSkipped() {
    this.counters.fallbackFindByWhatsappArchivedSkippedLog += 1;
  }

  incrConsolidateInactivePromoted() {
    this.counters.consolidateInactivePromotedToActive += 1;
  }

  getCounters(): Readonly<typeof this.counters> {
    return { ...this.counters };
  }

  resetCountersForTests() {
    Object.keys(this.counters).forEach((k) => {
      (this.counters as any)[k] = 0;
    });
  }
}
