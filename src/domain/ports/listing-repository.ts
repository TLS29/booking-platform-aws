import { Listing } from "#domain/entities/listing";

export interface ListingRepository {
  findById(id: string): Promise<Listing | null>;
  save(listing: Listing): Promise<void>;
  findPublishedByCity(city: string): Promise<Listing[]>;
  findByHostId(hostId: string): Promise<Listing[]>;
  softDelete(id: string): Promise<void>;
}
