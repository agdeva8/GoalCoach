export type OfflineQueue = {
  enqueue<T>(item: T, send: (item: T) => Promise<void>): void;
  flush(): Promise<void>;
  size(): number;
  isOnline(): boolean;
};

export type OfflineQueueOptions = {
  isOnline?: () => boolean;
};

export function createOfflineQueue(options: OfflineQueueOptions = {}): OfflineQueue {
  const isOnlineFn = options.isOnline ?? (() => true);
  const queue: Array<{ item: unknown; send: (item: unknown) => Promise<void> }> = [];

  const enqueue = <T>(item: T, send: (item: T) => Promise<void>) => {
    if (isOnlineFn()) {
      // fire and forget; caller awaits via send if needed
      void send(item).catch(() => {
        // network blip: requeue at end
        queue.push({ item, send: send as (item: unknown) => Promise<void> });
      });
      return;
    }
    queue.push({ item, send: send as (item: unknown) => Promise<void> });
  };

  const flush = async () => {
    while (queue.length > 0) {
      const head = queue.shift()!;
      try {
        await head.send(head.item);
      } catch {
        // swallow — queue advanced; user will retry manually
      }
    }
  };

  return {
    enqueue,
    flush,
    size: () => queue.length,
    isOnline: isOnlineFn,
  };
}
