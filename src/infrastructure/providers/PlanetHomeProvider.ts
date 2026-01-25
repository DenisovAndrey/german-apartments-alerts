import { BaseProvider } from './BaseProvider.js';
import { Listing } from '../../domain/entities/Listing.js';
import { DatabaseConnection } from '../database/Database.js';

interface LocationGeometry {
  type: string;
  coordinates: number[][][][];
}

interface LocationData {
  latitude: number;
  longitude: number;
  geometry: LocationGeometry;
}

interface PropertySearchResult {
  id: string;
  title: string;
  description?: string;
  price?: {
    totalPurchasePrice?: number;
    purchasePricePerSqm?: number;
  };
  property?: {
    propertyType?: string;
    propertySubType?: string;
    construction?: {
      constructionYear?: number;
    };
    premises?: {
      roomNumbers?: {
        numberOfRooms?: number;
      };
    };
    area?: {
      livingArea?: number;
    };
    address?: {
      zipcode?: string;
      city?: string;
      street?: string;
    };
    mainImagePublicUrl?: string;
  };
}

const PROPERTY_SEARCH_QUERY = `
query searchPublicPropertySales($propertySearchInput: PropertySearchInput!, $paging: Pagination!) {
  searchPublicPropertySales(propertySearchInput: $propertySearchInput, paging: $paging) {
    totalCount
    items {
      id
      title
      description
      price {
        totalPurchasePrice
        purchasePricePerSqm
      }
      property {
        propertyType
        propertySubType
        construction {
          constructionYear
        }
        premises {
          roomNumbers {
            numberOfRooms
          }
        }
        area {
          livingArea
        }
        address {
          zipcode
          city
          street
        }
        mainImagePublicUrl
      }
    }
  }
}`;

const GEO_DETAILS_QUERY = `
query details($id: String!, $range: Int) {
  details(id: $id, range: $range) {
    isBoundary
    latitude
    longitude
    originalGeometry {
      type
      coordinates
    }
    extendedGeometry {
      type
      coordinates
    }
  }
}`;

export class PlanetHomeProvider extends BaseProvider {
  readonly name = 'PlanetHome';
  readonly id = 'planethome';

  private static readonly PROPERTY_SEARCH_URL = 'https://api.planethome.com/property-search-index-service/graphql';
  private static readonly GEO_SERVICE_URL = 'https://api.planethome.com/geo-service/graphql';

  constructor(
    url: string | undefined,
    private readonly database: DatabaseConnection
  ) {
    super(url);
  }

  private parseUrlParams(): { locationIds: string[]; locationNames: string[]; propertyType: string; radius: number; priceFrom?: number; priceTo?: number } | null {
    try {
      const parsed = new URL(this.url!);
      const locationIds = parsed.searchParams.getAll('locationId');
      const locationNames = parsed.searchParams.getAll('location');
      const propertyType = parsed.searchParams.get('propertyType') || 'FLAT';
      const radius = parseInt(parsed.searchParams.get('radius') || '0', 10);
      const priceFromStr = parsed.searchParams.get('priceFrom');
      const priceToStr = parsed.searchParams.get('priceTo');
      const priceFrom = priceFromStr ? parseInt(priceFromStr, 10) : undefined;
      const priceTo = priceToStr ? parseInt(priceToStr, 10) : undefined;

      if (locationIds.length === 0) {
        this.logger.error('Missing locationId in URL', undefined, { url: this.url });
        return null;
      }

      return { locationIds, locationNames, propertyType, radius, priceFrom, priceTo };
    } catch (error) {
      this.logger.error('Failed to parse URL', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  private async fetchLocationData(locationId: string, _locationName: string): Promise<LocationData | null> {
    try {
      const response = await fetch(PlanetHomeProvider.GEO_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://planethome.de',
          'Referer': 'https://planethome.de/',
        },
        body: JSON.stringify({
          operationName: 'details',
          query: GEO_DETAILS_QUERY,
          variables: {
            id: locationId,
            range: 0,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Geo service HTTP ${response.status}`);
      }

      const json = await response.json() as {
        data?: {
          details?: {
            latitude: number;
            longitude: number;
            originalGeometry?: LocationGeometry;
            extendedGeometry?: LocationGeometry;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        throw new Error(`GraphQL error: ${json.errors[0].message}`);
      }

      const details = json.data?.details;
      if (!details) {
        throw new Error(`Location not found for ID: ${locationId}`);
      }

      const geometry = details.originalGeometry || details.extendedGeometry;
      if (!geometry) {
        throw new Error(`No geometry found for location ID: ${locationId}`);
      }

      return {
        latitude: details.latitude,
        longitude: details.longitude,
        geometry,
      };
    } catch (error) {
      this.logger.error('Failed to fetch location data', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  private async getLocationData(locationId: string, locationName: string): Promise<LocationData | null> {
    // Try cache first
    const cached = await this.database.getCachedLocation(locationId, this.id);
    if (cached) {
      this.logger.debug(`Using cached location data for ${locationId}`);
      return {
        latitude: cached.latitude,
        longitude: cached.longitude,
        geometry: cached.geometry as LocationGeometry,
      };
    }

    // Fetch from geo service
    this.logger.info(`Fetching location data for ${locationId} from geo service`);
    const data = await this.fetchLocationData(locationId, locationName);

    if (data) {
      await this.database.setCachedLocation(
        locationId,
        this.id,
        data.latitude,
        data.longitude,
        data.geometry
      );
    }

    return data;
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const params = this.parseUrlParams();

    if (!params) {
      return [];
    }

    try {
      // Fetch location data for all locationIds
      let locationsData = await this.getAllLocationsData(params.locationIds, params.locationNames);

      if (locationsData.length === 0) {
        throw new Error('Failed to get location data for search');
      }

      const result = await this.fetchProperties(params, locationsData, maxResults);

      // Check for location-related errors and retry with fresh data
      if (result.error && this.isLocationError(result.error)) {
        this.logger.warn('Possible stale location data, invalidating cache and retrying');
        await this.invalidateAllLocations(params.locationIds);
        locationsData = await this.getAllLocationsData(params.locationIds, params.locationNames);

        if (locationsData.length === 0) {
          throw new Error('Failed to refresh location data');
        }

        const retryResult = await this.fetchProperties(params, locationsData, maxResults);
        if (retryResult.error) {
          throw retryResult.error;
        }
        this.resetErrors();
        return retryResult.listings;
      }

      if (result.error) {
        throw result.error;
      }

      this.resetErrors();
      return result.listings;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, { duration: `${Date.now() - startTime}ms` });
      return [];
    }
  }

  private async getAllLocationsData(locationIds: string[], locationNames: string[]): Promise<LocationData[]> {
    const results: LocationData[] = [];
    for (let i = 0; i < locationIds.length; i++) {
      const locationId = locationIds[i];
      const locationName = locationNames[i] || locationNames[0] || '';
      const data = await this.getLocationData(locationId, locationName);
      if (data) {
        results.push(data);
      }
    }
    return results;
  }

  private async invalidateAllLocations(locationIds: string[]): Promise<void> {
    for (const locationId of locationIds) {
      await this.database.invalidateCachedLocation(locationId, this.id);
    }
  }

  private isLocationError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('location') ||
      message.includes('geometry') ||
      message.includes('coordinates') ||
      message.includes('invalid') ||
      message.includes('not found')
    );
  }

  private async fetchProperties(
    params: { propertyType: string; radius: number; priceFrom?: number; priceTo?: number },
    locationsData: LocationData[],
    maxResults: number
  ): Promise<{ listings: Listing[]; error?: Error }> {
    try {
      const locations = locationsData.map((loc) => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius: params.radius,
        geometry: loc.geometry,
      }));

      const propertySearchInput: Record<string, unknown> = {
        portal: 'ph-de',
        propertyType: params.propertyType,
        locations,
      };

      if (params.priceFrom !== undefined) {
        propertySearchInput.priceFrom = params.priceFrom;
      }
      if (params.priceTo !== undefined) {
        propertySearchInput.priceTo = params.priceTo;
      }

      const response = await fetch(PlanetHomeProvider.PROPERTY_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify({
          operationName: 'searchPublicPropertySales',
          query: PROPERTY_SEARCH_QUERY,
          variables: {
            propertySearchInput,
            paging: {
              offset: 0,
              limit: Math.min(maxResults, 50),
            },
          },
        }),
      });

      if (!response.ok) {
        return { listings: [], error: new Error(`HTTP ${response.status}: ${response.statusText}`) };
      }

      const json = await response.json() as {
        data?: {
          searchPublicPropertySales?: {
            totalCount: number;
            items: PropertySearchResult[];
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        return { listings: [], error: new Error(`GraphQL error: ${json.errors[0].message}`) };
      }

      const results = json.data?.searchPublicPropertySales?.items || [];

      if (results.length === 0) {
        this.logger.warn('No listings found in PlanetHome API response');
      }

      const listings = results.slice(0, maxResults).map((r) => this.transformResult(r));
      return { listings };
    } catch (error) {
      return { listings: [], error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private transformResult(result: PropertySearchResult): Listing {
    const price = result.price?.totalPurchasePrice
      ? `${result.price.totalPurchasePrice.toLocaleString('de-DE')} €`
      : 'Preis auf Anfrage';

    const size = result.property?.area?.livingArea
      ? `${result.property.area.livingArea} m²`
      : '';

    const rooms = result.property?.premises?.roomNumbers?.numberOfRooms;
    const roomsStr = rooms ? `${rooms} Zimmer` : '';

    const address = [
      result.property?.address?.street,
      result.property?.address?.zipcode,
      result.property?.address?.city,
    ]
      .filter(Boolean)
      .join(', ');

    const sizeAndRooms = [size, roomsStr].filter(Boolean).join(', ');

    // Extract numeric ID from full ID (e.g., "ph-dephmaklerimport728215" -> "728215")
    const numericId = result.id.match(/\d+$/)?.[0] || result.id;

    return this.normalizeListing(
      {
        id: result.id,
        title: result.title || 'Immobilie',
        price,
        size: sizeAndRooms,
        link: `https://planethome.de/objekt-detailseite?id=${numericId}`,
        address: address || 'Keine Adresse',
        description: result.description || undefined,
        image: result.property?.mainImagePublicUrl || undefined,
      },
      this.name
    );
  }
}
