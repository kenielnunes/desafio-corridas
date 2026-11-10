import { type RideEvent, RideEventSchema } from './event.js';

export type Result = 'processed' | 'duplicate' | 'invalid' | 'failed';

export type Dependencies = {
  recordHistory(event: RideEvent): Promise<'new' | 'duplicate'>;
  updateCache(ride: RideEvent['ride']): Promise<unknown>;
};

export async function processMessage(
  content: Buffer,
  dependencies: Dependencies,
): Promise<{ result: Result; event?: RideEvent; error?: unknown }> {
  const event = parseEvent(content);
  if (!event) return { result: 'invalid' };

  try {
    const history = await dependencies.recordHistory(event);
    // O cache é atualizado mesmo quando o evento é duplicado: se o worker caiu entre o Mongo e o
    // Redis, a reentrega precisa completar o que faltou. A checagem de versão evita regredir o status.
    await dependencies.updateCache(event.ride);
    return { result: history === 'new' ? 'processed' : 'duplicate', event };
  } catch (error) {
    return { result: 'failed', event, error };
  }
}

function parseEvent(content: Buffer): RideEvent | undefined {
  try {
    return RideEventSchema.parse(JSON.parse(content.toString('utf8')));
  } catch {
    return undefined;
  }
}
