# Diário de bordo

Registro cronológico e informal: o que tentei, o que quebrou, como investiguei e o que aprendi.

## 2026-11-09

- Li o PDF. A primeira versão do plano (montada com IA) tinha outbox transacional, retry com atraso nativo do RabbitMQ 4.3, script Lua no Redis, JWKS e kind rodando dentro de um container. Ao ler, percebi que não conseguiria explicar tudo aquilo com segurança na entrevista. Reescrevi o plano com a versão mais simples de cada requisito. O que ficou de fora vai para o LIMITES com a explicação de como eu faria.
- Escopo: Partes 1 e 2. Kubernetes só se sobrar fôlego. O próprio PDF diz que uma Parte 1 sólida vale mais do que três partes superficiais.
- `npm view prisma version` devolveu `8.0.0-rc.33`. A dist-tag `latest` do CLI aponta para um RC, enquanto o `@prisma/client` está em `7.10.1`. Se eu instalasse sem versão, o CLI e o client ficariam desalinhados. Fixei 7.10.1 nos dois.
- `typescript@latest` é a 7.0.2, mas o typescript-eslint aceita só até a 6.0 e a CLI do NestJS 12 pede a 6.0. Fixei o TypeScript em 6.0.3.
- Healthcheck do MySQL: pesquisando o entrypoint da imagem oficial, vi que durante a inicialização o mysqld sobe um servidor temporário sem rede. Um `mysqladmin ping` pelo socket responderia antes de o banco estar pronto de verdade, então o healthcheck usa TCP em `127.0.0.1`.
