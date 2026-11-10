import { type Collection, MongoClient, MongoServerError } from 'mongodb';
import type { RideEvent } from './event.js';

const DUPLICATE_KEY = 11000;

type HistoryDocument = {
  _id: string;
  type: RideEvent['type'];
  rideId: string;
  status: RideEvent['ride']['status'];
  version: number;
  occurredAt: Date;
  processedAt: Date;
  correlationId: string | null;
  ride: RideEvent['ride'];
};

export class RideHistory {
  private constructor(
    private readonly client: MongoClient,
    private readonly collection: Collection<HistoryDocument>,
  ) {}

  static async connect(url: string) {
    const client = await MongoClient.connect(url, { serverSelectionTimeoutMS: 5_000 });
    const collection = client.db('corridas').collection<HistoryDocument>('ride_history');
    await collection.createIndex({ rideId: 1, version: 1 });
    return new RideHistory(client, collection);
  }

  async record(event: RideEvent, correlationId?: string): Promise<'new' | 'duplicate'> {
    try {
      await this.collection.insertOne({
        _id: event.eventId,
        type: event.type,
        rideId: event.ride.id,
        status: event.ride.status,
        version: event.ride.version,
        occurredAt: new Date(event.occurredAt),
        processedAt: new Date(),
        correlationId: correlationId ?? null,
        ride: event.ride,
      });
      return 'new';
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return 'duplicate';
      throw error;
    }
  }

  async close() {
    await this.client.close();
  }
}
