import { ProvidersConfig } from '../../config/providers.config.js';

export interface User {
  id: string;
  name: string;
  providers: ProvidersConfig;
}
