import { App } from './presentation/cli/App.js';
import { loadAppConfig } from './config/index.js';

async function main(): Promise<void> {
  const app = new App(loadAppConfig());
  await app.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
