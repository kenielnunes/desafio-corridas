# Regras do projeto `corridas`

Desafio técnico da IPLANRIO. O PDF original fica na raiz e não é versionado.

## Princípio

A solução mais simples que cumpre o requisito e que o Keniel consiga explicar e defender na entrevista. Alternativas mais robustas vão para o `LIMITES.md` ou o `DECISIONS.md`, como "o que eu faria com mais tempo".

## Escrita

- Português do Brasil em docs, commits e comentários.
- Domínio em português (`Corrida`, `passageiro`, `motorista`). Termos técnicos e nomes de métricas em inglês, como manda a convenção do Prometheus.
- Proibido travessão (—), meia risca (–) e hífen com espaços no meio de frase, em código, docs e mensagens de commit. Hífen só dentro de palavras que o têm (e-mail, segunda-feira).
- Comentário no código só quando um dev sênior não entenderia o porquê daquilo estar ali. Nada que repita o que o código já diz.

## Commits

- Conventional Commits em pt-BR, por exemplo `feat(api): exige Idempotency-Key no POST /corridas`.
- Pequenos e frequentes, com o porquê no corpo da mensagem.
- Sem squash: o histórico faz parte da avaliação.
- Nunca dar push. O Keniel faz o push manualmente; avise quando houver algo pronto para subir.

## Segurança

- Nenhum segredo real no repositório. Senhas do compose e tokens de exemplo têm nomes que deixam claro que são de teste.
- Nunca logar o header `Authorization`.

## Versões

- Prisma fixado em 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-mariadb`). A dist-tag `latest` do CLI no npm aponta para um RC da versão 8.
- TypeScript fixado em 6.0.3. A CLI do NestJS 12 e o typescript-eslint ainda não aceitam o TypeScript 7.
- Versões exatas no `package.json`, e o lockfile é commitado.

## Fluxo de cada fase

1. Aula curta (analogia, termos essenciais, como entra no projeto).
2. Prática guiada do Keniel.
3. Desenvolvimento com commits pequenos.
4. Revisão em paralelo por agentes: código, segurança e QA com Playwright no Chrome do WSL.
5. Três perguntas no estilo da entrevista.
6. Review do Keniel.
7. Merge local em `main` sem squash e aviso para o push.

## Comandos

- `docker compose up -d --wait`: sobe a infraestrutura.
- `pnpm lint` e `pnpm format:check`: qualidade de código.
