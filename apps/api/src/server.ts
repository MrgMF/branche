import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config, { logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'arrêt du serveur');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { payment: config.paymentProvider, charger: config.chargerAdapter, publicUrl: config.publicUrl },
    config.paymentProvider === 'mock' ? 'API Branché démarrée (mode démo)' : 'API Branché démarrée (Stripe)',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
