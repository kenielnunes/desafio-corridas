# corridas

Serviço do desafio técnico da IPLANRIO: o passageiro solicita uma corrida, o motorista aceita, e o status é acompanhado quase em tempo real.

> Em construção. Este README ganha os comandos de validação a cada fase.

## Como subir

Pré-requisito: Docker com Compose.

```bash
docker compose up -d --build --wait
```

Se a porta 3000 já estiver ocupada na sua máquina, escolha outra e use-a nos comandos abaixo:

```bash
API_PORT=3100 docker compose up -d --build --wait
```

| Serviço           | Endereço               | Observação                                                    |
| ----------------- | ---------------------- | ------------------------------------------------------------- |
| API               | http://localhost:3000  | `/health/live` e `/health/ready` sem token                    |
| RabbitMQ (painel) | http://localhost:15672 | usuário `corridas`, senha `corridas_dev` (só desenvolvimento) |
| Prometheus        | http://localhost:9090  |                                                               |

Para derrubar tudo e apagar os dados:

```bash
docker compose down -v
```

## Tokens de teste

A pasta `auth-dev/tokens/` tem tokens JWT **de teste**, assinados por uma chave privada que foi descartada. A API só conhece a chave pública (`auth-dev/public-key.pem`).

| Arquivo                                 | Para quê                                |
| --------------------------------------- | --------------------------------------- |
| `passageiro-1.jwt` a `passageiro-5.jwt` | passageiros                             |
| `motorista-1.jwt` e `motorista-2.jwt`   | motoristas                              |
| `expired.jwt`                           | demonstrar o 401 de token vencido       |
| `other-key.jwt`                         | demonstrar o 401 de assinatura inválida |

Os tokens valem até novembro de 2027. Para gerar um par de chaves e tokens novos:

```bash
docker run --rm -v "$PWD/auth-dev:/auth-dev" node:24-alpine node /auth-dev/generate-tokens.mjs
docker compose restart api
```

## Roteiro de validação da API

```bash
API=http://localhost:3000
P1=$(cat auth-dev/tokens/passageiro-1.jwt)
P2=$(cat auth-dev/tokens/passageiro-2.jwt)
M1=$(cat auth-dev/tokens/motorista-1.jwt)
M2=$(cat auth-dev/tokens/motorista-2.jwt)
nova_chave() { uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid; }
```

**401: sem token, token vencido e token assinado por outra chave**

```bash
curl -i $API/corridas
curl -i -H "Authorization: Bearer $(cat auth-dev/tokens/expired.jwt)" $API/corridas
curl -i -H "Authorization: Bearer $(cat auth-dev/tokens/other-key.jwt)" $API/corridas
```

**201 e idempotência: o mesmo POST com a mesma `Idempotency-Key` devolve a mesma corrida**

```bash
CHAVE=$(nova_chave)
criar() { curl -s -i -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $CHAVE" \
  -H 'Content-Type: application/json' -d '{"origin":"Centro","destination":"Barra da Tijuca"}'; }
criar
criar   # mesmo id e o header Idempotent-Replayed: true
ID=$(criar | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
```

**403: perfil errado e corrida de outra pessoa**

```bash
curl -i -X PATCH $API/corridas/$ID/status -H "Authorization: Bearer $P1" \
  -H 'Content-Type: application/json' -d '{"status":"accepted"}'                 # passageiro não muda status
curl -i -H "Authorization: Bearer $P2" $API/corridas/$ID                     # corrida de outro passageiro
curl -i -X POST $API/corridas -H "Authorization: Bearer $M1" -H "Idempotency-Key: $(nova_chave)" \
  -H 'Content-Type: application/json' -d '{"origin":"Centro","destination":"Barra"}'   # motorista não cria
```

**200 e 409: dois motoristas aceitando a mesma corrida ao mesmo tempo**

```bash
aceitar() { curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $API/corridas/$ID/status \
  -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d '{"status":"accepted"}'; }
aceitar "$M1" & aceitar "$M2"; wait   # um 200 e um 409
```

**429: a 11ª criação no mesmo minuto**

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $API/corridas -H "Authorization: Bearer $P2" \
    -H "Idempotency-Key: $(nova_chave)" -H 'Content-Type: application/json' \
    -d '{"origin":"Centro","destination":"Barra"}'
done; echo
```

## Testes

Pré-requisito: Node 24 e pnpm (`corepack enable`).

```bash
pnpm install
pnpm test                                  # unitários (regras de status e de permissão)
pnpm --filter @corridas/api test:api       # testes de API, com o compose de pé
```

Se a API estiver em outra porta: `API_URL=http://localhost:3100 pnpm --filter @corridas/api test:api`. A suíte respeita o rate limit de 10 criações por minuto por passageiro; rodando mais de 3 vezes no mesmo minuto, ela começa a receber 429.

## Documentos

- [DECISIONS.md](DECISIONS.md): decisões, alternativas e trade-offs.
- [LIMITES.md](LIMITES.md): o que ficou de fora e os riscos conhecidos.
- [DIARIO.md](DIARIO.md): diário de bordo do desenvolvimento.
