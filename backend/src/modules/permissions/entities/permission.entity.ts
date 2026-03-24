import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 80 }) code: string;
  @Column({ length: 100 }) name: string;
  @Column({ length: 60, default: 'general' }) module: string;
  @Column({ nullable: true, length: 200 }) description: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
