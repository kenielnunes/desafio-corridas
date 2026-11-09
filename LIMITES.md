# Limites

O que não fiz, o que faria com mais tempo e os riscos conhecidos que ficaram abertos.

## API

- **Idempotency-Key com corpo diferente.** Reenviar a mesma chave com outro corpo devolve a corrida original. O rascunho da IETF para o header sugere responder 422, o que exigiria guardar um hash do corpo junto com a chave.
- **Collation que ignora maiúsculas.** A collation padrão da tabela (`utf8mb4_unicode_ci`) compara sem diferenciar maiúsculas de minúsculas, então `ABC` e `abc` seriam a mesma chave de idempotência. Na prática a UI gera UUIDs, mas o correto seria `ascii_bin` nas colunas de ID e de chave.
- **Rate limit em memória.** Cada réplica da API conta separado, então com N réplicas o limite efetivo vira N vezes maior. Com várias réplicas, o contador iria para o Redis.
- **Tokens de teste.** Valem 1 ano. Não há refresh token nem revogação.
- **MySQL sem TLS.** A conexão usa `allowPublicKeyRetrieval` porque não há TLS no compose. Em produção, TLS.
- **Migração no start.** O container da API aplica as migrações ao subir; com várias réplicas, o Prisma serializa as execuções com um lock no banco. Em produção eu rodaria a migração como uma etapa separada do deploy.

## Testes

- **Node e pnpm.** Os testes exigem Node 24 e pnpm. Subir e validar o sistema exige só Docker.
