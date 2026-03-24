import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('networks')
export class Network {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ nullable: true, length: 6 }) code: string;
  @Column({ length: 200 }) name: string;
  @Column({ length: 30, default: 'active' }) status: string;
  @Column({ nullable: true, length: 200 }) responsible: string;
  @Column({ nullable: true, length: 20 }) phone: string;
  @Column({ nullable: true, length: 200 }) email: string;
  @Column({ nullable: true, type: 'text' }) notes: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
