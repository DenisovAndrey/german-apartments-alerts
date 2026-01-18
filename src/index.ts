import { App } from './presentation/cli/App.js';
import { loadAppConfig } from './config/index.js';
import { MonitoringService } from './infrastructure/monitoring/MonitoringService.js';

async function main(): Promise<void> {
  const app = new App(loadAppConfig());
  await app.run();
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  const errorMsg = error instanceof Error ? error.message : String(error);
  await MonitoringService.getInstance().logCriticalError('App', errorMsg).catch(() => {});
  process.exit(1);
});
