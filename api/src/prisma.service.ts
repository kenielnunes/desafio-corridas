import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from './config.js';
import { PrismaClient } from './generated/prisma/client.js';

function mysqlAdapter(databaseUrl: string, poolSize: number) {
  const url = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: poolSize,
    // MySQL 8 sem TLS: sem isto o driver não consegue buscar a chave RSA do servidor e a conexão falha
    allowPublicKeyRetrieval: true,
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: mysqlAdapter(config.databaseUrl, config.databasePoolSize) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
