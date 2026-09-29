import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOfflineQueue } from '@/lib/offline-queue';

describe('offline-queue', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('enqueues when offline', () => {
    const q = createOfflineQueue({ isOnline: () => false });
    const send = vi.fn().mockResolvedValue(undefined);
    q.enqueue('hello', send);
    expect(send).not.toHaveBeenCalled();
    expect(q.size()).toBe(1);
  });

  it('sends immediately when online', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = createOfflineQueue({ isOnline: () => true });
    q.enqueue('hello', send);
    expect(q.size()).toBe(0);
    // send is async — wait one microtask
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith('hello');
  });

  it('drains queue in FIFO order on flush()', async () => {
    const calls: string[] = [];
    const send = vi.fn().mockImplementation(async (msg: string) => {
      calls.push(msg);
    });
    const onlineRef = { value: false };
    const q = createOfflineQueue({ isOnline: () => onlineRef.value });
    q.enqueue('first', send);
    q.enqueue('second', send);
    q.enqueue('third', send);
    expect(q.size()).toBe(3);
    onlineRef.value = true;
    await q.flush();
    expect(calls).toEqual(['first', 'second', 'third']);
    expect(q.size()).toBe(0);
  });

  it('reports online state', () => {
    const q = createOfflineQueue({ isOnline: () => false });
    expect(q.isOnline()).toBe(false);
    const q2 = createOfflineQueue({ isOnline: () => true });
    expect(q2.isOnline()).toBe(true);
  });

  it('a failing send does not block queue progress', async () => {
    const send1 = vi.fn().mockResolvedValue(undefined);
    const send2 = vi.fn().mockRejectedValue(new Error('net down'));
    const send3 = vi.fn().mockResolvedValue(undefined);
    const q = createOfflineQueue({ isOnline: () => false });
    q.enqueue('a', send1);
    q.enqueue('b', send2);
    q.enqueue('c', send3);
    await q.flush();
    expect(send1).toHaveBeenCalled();
    expect(send2).toHaveBeenCalled();
    expect(send3).toHaveBeenCalled();
  });
});
