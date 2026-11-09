# Diário de bordo

Registro cronológico e informal: o que tentei, o que quebrou, como investiguei e o que aprendi.

## 2026-11-09

- Li o PDF. A primeira versão do plano (montada com IA) tinha outbox transacional, retry com atraso nativo do RabbitMQ 4.3, script Lua no Redis, JWKS e kind rodando dentro de um container. Ao ler, percebi que não conseguiria explicar tudo aquilo com segurança na entrevista. Reescrevi o plano com a versão mais simples de cada requisito. O que ficou de fora vai para o LIMITES com a explicação de como eu faria.
- Escopo: Partes 1 e 2. Kubernetes só se sobrar fôlego. O próprio PDF diz que uma Parte 1 sólida vale mais do que três partes superficiais.
- `npm view prisma version` devolveu `8.0.0-rc.33`. A dist-tag `latest` do CLI aponta para um RC, enquanto o `@prisma/client` está em `7.10.1`. Se eu instalasse sem versão, o CLI e o client ficariam desalinhados. Fixei 7.10.1 nos dois.
- `typescript@latest` é a 7.0.2, mas o typescript-eslint aceita só até a 6.0 e a CLI do NestJS 12 pede a 6.0. Fixei o TypeScript em 6.0.3.
- Healthcheck do MySQL: pesquisando o entrypoint da imagem oficial, vi que durante a inicialização o mysqld sobe um servidor temporário sem rede. Um `mysqladmin ping` pelo socket responderia antes de o banco estar pronto de verdade, então o healthcheck usa TCP em `127.0.0.1`.
- Revisão da Fase 0 por dois agentes, um de código e um de segurança. O que encontraram:
  - **Painéis abertos:** o RabbitMQ (15672) e o Prometheus (9090) estavam publicados em `0.0.0.0`. No meu WSL ninguém da rede alcança, mas no Linux de quem avalia a porta ficaria aberta para a rede local, com a senha de dev que vai estar no GitHub. Passei para `127.0.0.1`.
  - **Healthcheck do Mongo:** a mesma armadilha do MySQL, que eu tinha evitado num e esquecido no outro. Durante o init, o mongod temporário escuta só em localhost, e o healthcheck passava cedo demais. O revisor reproduziu com um script de init lento. Agora o check conecta pelo hostname do container.
  - **RabbitMQ sem hostname fixo:** o nome do nó vem do hostname, e os dados ficam numa pasta com esse nome. Cada container novo ganhava um nome aleatório, então um `down`/`up` perderia as filas.
  - **TypeScript 6:** a opção `types` passou a ser vazia por padrão, e sem `"types": ["node"]` nem `process` é encontrado.
- Decidi não criar o banco "shadow" que o `prisma migrate dev` exige (o usuário da aplicação não pode criar bancos, e não quero dar esse privilégio a ele). Vou gerar as migrações com `prisma migrate diff`, que não precisa desse banco.
