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

## 2026-11-09 (Fase 1: API)

- O Prisma 7 exige a `DATABASE_URL` até para o `prisma generate`, que nem conecta no banco: o helper `env()` do `prisma.config.ts` lança erro se a variável faltar. Troquei por `process.env.DATABASE_URL ?? ''`. O generate passou a funcionar sem URL, e o `migrate deploy` sem URL falha com "Connection url is empty", que é claro.
- O pnpm 12 parou o `install` com `ERR_PNPM_IGNORED_BUILDS`: ele só roda scripts de instalação de pacotes liberados explicitamente. Liberei só os dois do Prisma (`allowBuilds`).
- A API não subiu porque a porta 3000 estava ocupada por outro projeto meu. Deixei a porta do host configurável (`API_PORT`), com 3000 como padrão. Quem for avaliar pode ter o mesmo problema.
- O smoke com `curl` pegou um bug: finalizar uma corrida que ninguém aceitou respondia 403 "a corrida é de outro motorista". A corrida não tinha motorista (`driver_id` nulo), e o código tratava "não é minha" como "é de outro". A decisão entre 403 e 409 virou uma função pura, com teste para os quatro casos.
- Os testes de API passaram na primeira rodada e falharam na segunda: a suíte esbarrou no próprio rate limit de 10 criações por minuto. Gerei mais duas personas e distribuí as criações, no máximo 3 por persona por rodada. Rodei 3 vezes seguidas para confirmar.
- Lendo o código do `@nestjs/throttler`, vi que a chave do contador é controller + método + usuário. O limite vale por usuário **em cada rota**, e não como um total por usuário. Ajustei a documentação para dizer exatamente isso.
- Revisão da Fase 1: um workflow com três agentes em paralelo (código, segurança e QA exploratório) e, para cada um, um verificador cético tentando refutar os achados. Vieram 18 achados, todos confirmados com evidência. O que mais me ensinou:
  - **A lista do motorista** juntava as corridas solicitadas de todo mundo com as dele e cortava em 50. Com a suíte criando corridas, logo havia mais de 50 solicitadas mais novas, e as corridas que o motorista tinha aceitado sumiam da lista dele. Separei em duas visões: "minhas" e `?available=true`.
  - **Collation:** eu tinha anotado a collation `_ci` do MySQL só como risco de idempotência ("abc" igual a "ABC"). Os revisores mostraram que é risco de autorização: o `WHERE passenger_id = 'PASSAGEIRO-1 '`, com maiúsculas e espaço no fim, devolvia as corridas de `passageiro-1`. Corrigi com uma migração para `utf8mb4_bin` e conferi que a consulta com outra caixa volta 0.
  - **Imagem Docker:** tinha 1,26 GB. Uns 400 MB eram cache do pnpm, do corepack e do Prisma esquecidos na camada final. Caiu para 698 MB.
  - **Header `Authorization`:** pela RFC 9110, o nome do esquema não diferencia maiúsculas, e eu recusava "bearer".
  - **Mensagem do 409:** revelava o status de uma corrida que o motorista não podia ler.
  - **Teste unitário:** eu testava uma função (`isTransitionAllowed`) que a produção nem usava. Passei a testar a que o service usa.
- O que ficou como limite, e não correção: o motorista vê o id do passageiro (LGPD), a API usa a mesma credencial que aplica as migrações, e o reenvio idempotente consome a cota do rate limit.
