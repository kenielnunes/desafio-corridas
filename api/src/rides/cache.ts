import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import type { RideResponse } from './rides.service.js';

@Injectable()
export class RideCache implements OnModuleDestroy {
  // Sem fila offline e com timeout curto: com o Redis fora, o comando falha na hora e a
  // leitura cai para o MySQL, em vez de esperar o Redis voltar.
  private readonly redis = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    commandTimeout: 200,
    maxRetriesPerRequest: 1,
  });

  constructor() {
    // Sem listener, um 'error' do cliente derrubaria o processo. A falha já aparece na leitura,
    // que cai para o MySQL.
    this.redis.on('error', () => undefined);
  }

  async get(id: string): Promise<RideResponse | null> {
    const value = await this.redis.get(key(id));
    return value ? (JSON.parse(value) as RideResponse) : null;
  }

  // NX: só preenche se a chave não existir, para nunca sobrescrever uma versão mais nova gravada pelo worker.
  async fill(ride: RideResponse): Promise<void> {
    await this.redis.set(key(ride.id), JSON.stringify(ride), 'EX', config.cacheTtlSeconds, 'NX');
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}

const key = (id: string) => `ride:${id}`;
