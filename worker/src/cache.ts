import { Redis } from 'ioredis';
import type { RideEvent } from './event.js';

type Ride = RideEvent['ride'];

// Comparar a versão e gravar precisa ser uma operação só: o worker processa várias mensagens ao
// mesmo tempo (prefetch), e um GET seguido de SET deixaria um evento antigo sobrescrever um novo.
// O Redis executa o script inteiro sem intercalar nenhum outro comando.
const STORE_IF_NEWER = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).version >= tonumber(ARGV[2]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1`;

export class RideCache {
  private constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  static connect(url: string, ttlSeconds: number, onError: (message: string) => void) {
    const redis = new Redis(url, { maxRetriesPerRequest: 2 });
    redis.on('error', (error) => onError(error.message));
    return new RideCache(redis, ttlSeconds);
  }

  async update(ride: Ride): Promise<'updated' | 'ignored'> {
    const stored = await this.redis.eval(
      STORE_IF_NEWER,
      1,
      `ride:${ride.id}`,
      JSON.stringify(ride),
      ride.version,
      this.ttlSeconds,
    );
    return stored === 1 ? 'updated' : 'ignored';
  }

  async close() {
    await this.redis.quit();
  }
}
