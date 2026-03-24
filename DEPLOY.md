# Comandos para deploy e correção de 502

Execute estes comandos **no terminal**, na pasta do projeto:

## 1. Aplicar alterações de código (rebuild completo)

```bash
cd /opt/suporte-tecnico
docker compose build --no-cache backend frontend
docker compose up -d backend frontend
docker compose restart nginx
```

## 2. Se aparecer 502 Bad Gateway

```bash
cd /opt/suporte-tecnico
docker compose restart nginx
```

## 3. Reiniciar tudo

```bash
cd /opt/suporte-tecnico
docker compose down
docker compose up -d
```

## 4. Verificar se está funcionando

```bash
# Status dos containers
docker compose ps

# Testar backend
curl -s http://localhost:4000/api/v1/health

# Testar frontend
curl -s http://localhost:3000/ | head -1
```

---

**Ordem recomendada após alterar código:**
1. `docker compose build --no-cache backend frontend`
2. `docker compose up -d backend frontend`
3. `docker compose restart nginx`
