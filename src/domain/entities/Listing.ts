export interface Listing {
  id: string;
  title: string;
  price: string | null;
  size: string | null;
  address: string | null;
  link: string;
  description?: string | null;
  image?: string | null;
  hash: string;
  source: string;
}

export interface RawListing {
  id?: string;
  title?: string;
  price?: string;
  size?: string;
  address?: string;
  link?: string;
  description?: string;
  image?: string;
}
