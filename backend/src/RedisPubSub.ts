import Redis from 'ioredis';

export class RedisPubSub {
  public publisher: Redis;
  public subscriber: Redis;

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }

  // Subscribe to a room's channel
  async subscribe(room: string, onMessage: (channel: string, message: Buffer) => void) {
    await this.subscriber.subscribe(`room:${room}`);
    this.subscriber.on('message', (channel, message) => {
      if (channel === `room:${room}`) {
        onMessage(channel, message);
      }
    });
  }

  // Unsubscribe from a room
  async unsubscribe(room: string) {
    await this.subscriber.unsubscribe(`room:${room}`);
  }

  // Publish a message to a room's channel
  async publish(room: string, message: Buffer) {
    await this.publisher.publish(`room:${room}`, message);
  }
}