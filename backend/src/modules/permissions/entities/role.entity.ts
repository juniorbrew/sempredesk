import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { RolePermission } from './role-permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 50 }) slug: string;
  @Column({ length: 100 }) name: string;
  @Column({ nullable: true, length: 200 }) description: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @OneToMany(() => RolePermission, (rp) => rp.role)
  rolePermissions: RolePermission[];
}
