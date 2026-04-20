# SempreDesk - Configurar Chave SSH no VPS

Objetivo: parar de digitar senha sempre que publicar no VPS.

## Passo 1 - Gerar a chave local

Rode:

- `scripts/15-gerar-chave-vps.bat`

Isso cria:

- `scripts/keys/sempredesk-vps.ppk`
- `scripts/keys/sempredesk-vps.pub`

## Passo 2 - Copiar a chave publica

Rode:

- `scripts/16-copiar-chave-publica-vps.bat`

Isso copia a chave publica para a area de transferencia.

## Passo 3 - Adicionar a chave no VPS

Entre no VPS com a sua senha atual e rode:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

Cole a chave publica copiada, salve e depois rode:

```bash
chmod 600 ~/.ssh/authorized_keys
```

## Passo 4 - Carregar a chave privada no Windows

Rode:

- `scripts/17-iniciar-pageant-vps.bat`

Isso carrega a chave no `Pageant`.

## Passo 5 - Testar publicacao

Depois disso, teste:

- `scripts/12-publicar-backend-vps.bat`

Se a chave estiver correta e o `Pageant` carregado, o script nao deve pedir a senha SSH novamente.
