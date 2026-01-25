export interface ProvidersConfig {
  immoscout?: string;
  immowelt?: string;
  immonet?: string;
  kleinanzeigen?: string;
  sueddeutsche?: string;
  planethome?: string;
  wgGesucht?: string;
  wohnungsboerse?: string;
  sparkasse?: string;
  ohneMakler?: string;
}

export const defaultProvidersConfig: ProvidersConfig = {
  immoscout:
    'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/wohnung-kaufen?price=-500000.0&exclusioncriteria=swapflat,projectlisting&enteredFrom=result_list',
  immowelt:
    'https://www.immowelt.de/liste/muenchen/wohnungen/kaufen?pma=500000',
  immonet:
    'https://www.immonet.de/immobiliensuche/kaufen/wohnung/muenchen',
  kleinanzeigen:
    'https://www.kleinanzeigen.de/s-wohnung-kaufen/muenchen/c196l6411',
};
