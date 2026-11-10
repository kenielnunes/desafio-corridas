import { Redis } from 'ioredis';
import type { RideEvent } from './event.js';

type Ride = RideEvent['ride'];

export class RideCache {
  private constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  static connect(url: string, ttlSeconds: number) {
    return new RideCache(new Redis(url, { maxRetriesPerRequest: 2 }), ttlSeconds);
  }

  async update(ride: Ride): Promise<'updated' | 'ignored'> {
    const key = `ride:${ride.id}`;
    const current = await this.redis.get(key);
    if (current && (JSON.parse(current) as Ride).version >= ride.version) return 'ignored';
    await this.redis.set(key, JSON.stringify(ride), 'EX', this.ttlSeconds);
    return 'updated';
  }

  async close() {
    await this.redis.quit();
  }
}
