import { describe, it, expect, vi } from 'vitest';
import { runTool, runToolWithRetry, ToolError } from '../src/router';

describe('runTool', () => {
  it('dispatches by name', async () => {
    const handlers = {
      ping: vi.fn(async (input: { msg: string }) => `pong: ${input.msg}`),
    };
    const result = await runTool('ping', { msg: 'hi' }, handlers);
    expect(result).toBe('pong: hi');
    expect(handlers.ping).toHaveBeenCalledWith({ msg: 'hi' }, {});
  });

  it('passes ctx to handler', async () => {
    const handler = vi.fn(async () => 'ok');
    await runTool('foo', { x: 1 }, { foo: handler }, { userId: 'u1' });
    expect(handler).toHaveBeenCalledWith({ x: 1 }, { userId: 'u1' });
  });

  it('throws ToolError on unknown tool', async () => {
    await expect(runTool('nope', {}, {})).rejects.toThrow(ToolError);
    await expect(runTool('nope', {}, {})).rejects.toThrow(/unknown tool/i);
  });

  it('rejects input with null bytes', async () => {
    const handlers = { foo: vi.fn(async () => 'x') };
    await expect(
      runTool('foo', { body: 'evil\u0000payload' }, handlers)
    ).rejects.toThrow(/null byte/i);
  });

  it('rejects input exceeding 8KB', async () => {
    const handlers = { foo: vi.fn(async () => 'x') };
    const big = { body: 'x'.repeat(9000) };
    await expect(runTool('foo', big, handlers)).rejects.toThrow(/too large/i);
  });

  it('propagates handler errors', async () => {
    const handlers = { fail: vi.fn(async () => { throw new Error('boom'); }) };
    await expect(runTool('fail', {}, handlers)).rejects.toThrow('boom');
  });
});

describe('runToolWithRetry', () => {
  it('retries once when a tool throws ToolError("malformed args") then succeeds', async () => {
    let calls = 0;
    const handler = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) throw new ToolError('malformed args', 'create_goal');
      return { ok: true };
    });
    const result = await runToolWithRetry(handler, { title: 'x' }, {}, { retries: 1 });
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: true });
  });

  it('rejects input exceeding 8KB before invoking the handler', async () => {
    const handler = vi.fn(async () => {
      throw new Error('handler must not be invoked');
    });
    const big = { body: 'x'.repeat(9000) };
    const serializedLength = JSON.stringify(big).length;
    await expect(
      runToolWithRetry(handler, big, {}, { retries: 1 })
    ).rejects.toThrow(new ToolError(`input too large: ${serializedLength} bytes`, 'router'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects input with null bytes before invoking the handler', async () => {
    const handler = vi.fn(async () => {
      throw new Error('handler must not be invoked');
    });
    await expect(
      runToolWithRetry(handler, { title: 'a\u0000b' }, {}, { retries: 1 })
    ).rejects.toThrow(new ToolError('input contains null byte', 'router'));
    expect(handler).not.toHaveBeenCalled();
  });
});
