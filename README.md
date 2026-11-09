# corridas

Serviço do desafio técnico da IPLANRIO: o passageiro solicita uma corrida, o motorista aceita, e o status é acompanhado quase em tempo real.

> Em construção. Este README ganha os comandos de validação a cada fase.

## Como subir

Pré-requisito: Docker com Compose.

```bash
docker compose up -d --wait
```

| Serviço           | Endereço               | Observação                                                    |
| ----------------- | ---------------------- | ------------------------------------------------------------- |
| RabbitMQ (painel) | http://localhost:15672 | usuário `corridas`, senha `corridas_dev` (só desenvolvimento) |
| Prometheus        | http://localhost:9090  |                                                               |

Para derrubar tudo e apagar os dados:

```bash
docker compose down -v
```

## Documentos

- [DIARIO.md](DIARIO.md): diário de bordo do desenvolvimento.
