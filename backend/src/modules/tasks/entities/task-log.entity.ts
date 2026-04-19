import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Task } from './task.entity';

@Entity('task_logs')
export class TaskLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ name: 'author_name', length: 200, nullable: true })
  authorName: string | null;

  /** created | status_changed | assigned | commented | completed | cancelled */
  @Column({ length: 50 })
  action: string;

  @Column({ name: 'from_value', length: 100, nullable: true })
  fromValue: string | null;

  @Column({ name: 'to_value', length: 100, nullable: true })
  toValue: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @ManyToOne(() => Task, (t) => t.logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
