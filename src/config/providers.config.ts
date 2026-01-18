export interface ProvidersConfig {
  immoscout?: string;
  immowelt?: string;
  immonet?: string;
  kleinanzeigen?: string;
  wgGesucht?: string;
  wohnungsboerse?: string;
  sparkasse?: string;
  ohneMakler?: string;
}

export const defaultProvidersConfig: ProvidersConfig = {
  immoscout:
    'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/wohnung-mieten?price=-2000.0&exclusioncriteria=swapflat,projectlisting&pricetype=rentpermonth&enteredFrom=result_list',
  immowelt:
    'https://www.immowelt.de/classified-search?distributionTypes=Rent&estateTypes=Apartment&locations=AD08DE6345&projectTypes=Stock&order=DateDesc',
  immonet:
    'https://www.immonet.de/classified-search?distributionTypes=Rent&estateTypes=Apartment&locations=AD08DE6345&priceMax=2000&priceMin=1000&projectTypes=Stock',
  kleinanzeigen:
    'https://www.kleinanzeigen.de/s-wohnung-mieten/muenchen/anbieter:privat/preis:1000:2000/c203l6411',
};
