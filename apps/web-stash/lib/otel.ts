import { registerOTel } from '@vercel/otel';

let registered = false;

export function registerOtel(): void {
  if (registered) return;
  registerOTel({ serviceName: 'goalcoach-web' });
  registered = true;
}
