export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerOtel } = await import('./lib/otel');
    registerOtel();
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    const { registerOtel } = await import('./lib/otel');
    registerOtel();
  }
}
