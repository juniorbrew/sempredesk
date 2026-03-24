import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

/**
 * Pivot N:N entre Contact e Client.
 *
 * Quando um agente vincula um contato de WhatsApp (auto-criado) a um cliente
 * real cadastrado, um registro é criado aqui.
 *
 * O vínculo primário (contacts.client_id, 1-N) permanece intacto.
 * Este pivot é **adicional** e não substitui o FK original.
 */
@Entity('contact_customers')
@Unique(['contactId', 'clientId'])
export class ContactCustomer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'contact_id' })
  contactId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  /** ID do agente que criou o vínculo (null = vínculo automático/sistêmico) */
  @Column({ name: 'linked_by', nullable: true })
  linkedBy: string | null;

  @Column({ name: 'linked_at', type: 'timestamptz', default: () => 'NOW()' })
  linkedAt: Date;
}
