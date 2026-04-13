import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TicketSettingsService } from '../ticket-settings/ticket-settings.service';

export interface ResolvedClassification {
  department: string | null;
  category: string | null;
  subcategory: string | null;
}

/** Normaliza string: trimeia, colapsa espaços internos e retorna null se vazia. */
export function normalizeText(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized.length ? normalized : null;
}

/**
 * Resolve e valida a classificação de um ticket (departamento / categoria / subcategoria)
 * a partir de ticket_settings cadastrados no tenant.
 * Extraído de TicketsService para isolar a responsabilidade de lookup de classificação.
 */
@Injectable()
export class TicketClassificationHelper {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ticketSettingsService: TicketSettingsService,
  ) {}

  async getTicketSettingByName(
    tenantId: string,
    type: 'department' | 'category' | 'subcategory',
    name?: string | null,
  ) {
    const normalized = normalizeText(name);
    if (!normalized) return null;

    const rows = await this.dataSource.query(
      `SELECT id, parent_id, name, type
       FROM ticket_settings
       WHERE tenant_id = $1
         AND type = $2
         AND active = true
         AND LOWER(TRIM(name)) = LOWER(TRIM($3))
       LIMIT 1`,
      [tenantId, type, normalized],
    );

    return rows[0] || null;
  }

  async resolveTicketClassification(
    tenantId: string,
    department?: string | null,
    category?: string | null,
    subcategory?: string | null,
  ): Promise<ResolvedClassification> {
    const normalizedDepartment = normalizeText(department);
    const normalizedCategory   = normalizeText(category);
    const normalizedSubcategory = normalizeText(subcategory);

    const departmentRow  = await this.getTicketSettingByName(tenantId, 'department',  normalizedDepartment);
    const categoryRow    = await this.getTicketSettingByName(tenantId, 'category',    normalizedCategory);
    const subcategoryRow = await this.getTicketSettingByName(tenantId, 'subcategory', normalizedSubcategory);

    // Valores não cadastrados em ticket_settings são permitidos (ex.: tickets de automação)
    if (normalizedDepartment && !departmentRow) {
      return {
        department: normalizedDepartment,
        category: normalizedCategory || null,
        subcategory: normalizedSubcategory || null,
      };
    }
    if (normalizedCategory && !categoryRow) {
      return {
        department: departmentRow?.name || normalizedDepartment || null,
        category: normalizedCategory,
        subcategory: normalizedSubcategory || null,
      };
    }
    if (normalizedSubcategory && !subcategoryRow) {
      return {
        department: departmentRow?.name || normalizedDepartment || null,
        category: categoryRow?.name || normalizedCategory || null,
        subcategory: normalizedSubcategory,
      };
    }

    if (normalizedCategory && !normalizedDepartment) {
      throw new BadRequestException('Categoria exige departamento');
    }

    if (normalizedSubcategory && !normalizedCategory) {
      throw new BadRequestException('Subcategoria exige categoria');
    }

    if (departmentRow && categoryRow && categoryRow.parent_id !== departmentRow.id) {
      throw new BadRequestException('Categoria não pertence ao departamento informado');
    }

    if (categoryRow && subcategoryRow && subcategoryRow.parent_id !== categoryRow.id) {
      throw new BadRequestException('Subcategoria não pertence à categoria informada');
    }

    return {
      department: departmentRow?.name || normalizedDepartment || null,
      category: categoryRow?.name || normalizedCategory || null,
      subcategory: subcategoryRow?.name || normalizedSubcategory || null,
    };
  }

  async resolveInheritedPriorityIdForClassification(
    tenantId: string,
    classification: { department?: string | null; category?: string | null; subcategory?: string | null },
  ): Promise<string | null> {
    return this.ticketSettingsService.resolveDefaultPriorityIdForClassification(tenantId, {
      department: classification.department ?? null,
      category: classification.category ?? null,
      subcategory: classification.subcategory ?? null,
    });
  }
}
