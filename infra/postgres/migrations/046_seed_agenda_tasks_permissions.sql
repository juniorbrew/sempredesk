BEGIN;
INSERT INTO permissions (code, name, module) VALUES
  ('agenda.view',   'Visualizar agenda',    'agenda'),
  ('agenda.create', 'Criar eventos',        'agenda'),
  ('agenda.edit',   'Editar eventos',       'agenda'),
  ('agenda.delete', 'Excluir eventos',      'agenda'),
  ('tasks.view',    'Visualizar tarefas',   'tasks'),
  ('tasks.create',  'Criar tarefas',        'tasks'),
  ('tasks.edit',    'Editar tarefas',       'tasks'),
  ('tasks.delete',  'Excluir tarefas',      'tasks')
ON CONFLICT (code) DO NOTHING;
COMMIT;
