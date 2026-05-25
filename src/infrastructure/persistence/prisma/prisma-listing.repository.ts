import type { Listing as PrismaListing } from "@prisma/client";
import { Listing } from "#domain/entities/listing";
import type { ListingRepository } from "#domain/ports/listing-repository";
import type { PrismaClient } from "#infrastructure/persistence/prisma/client";

/**
 * Implementación del ListingRepository contra Postgres vía Prisma.
 *
 * Único lugar del codebase donde se cruza el boundary domain/persistence.
 * Los mappers toDomain/toPersistence son privados y viven aquí mismo.
 */
export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- Queries ----------

  async findById(id: string): Promise<Listing | null> {
    const record = await this.prisma.listing.findFirst({
      where: { id, deletedAt: null },
    });
    return record ? PrismaListingRepository.toDomain(record) : null;
  }

  async findPublishedByCity(city: string): Promise<Listing[]> {
    const records = await this.prisma.listing.findMany({
      where: { city, isPublished: true, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return records.map(PrismaListingRepository.toDomain);
  }

  async findByHostId(hostId: string): Promise<Listing[]> {
    const records = await this.prisma.listing.findMany({
      where: { hostId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return records.map(PrismaListingRepository.toDomain);
  }

  // ---------- Commands ----------

  async save(listing: Listing): Promise<void> {
    const data = PrismaListingRepository.toPersistence(listing);
    await this.prisma.listing.upsert({
      where: { id: listing.id },
      create: data,
      update: data,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.listing.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ---------- Mappers ----------

  private static toDomain(record: PrismaListing): Listing {
    return Listing.reconstitute({
      id: record.id,
      hostId: record.hostId,
      title: record.title,
      description: record.description,
      pricePerNight: record.pricePerNight,
      currency: record.currency,
      maxCapacity: record.maxCapacity,
      isPublished: record.isPublished,
      city: record.city,
      country: record.country,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      version: record.version,
    });
  }

  private static toPersistence(entity: Listing): Omit<PrismaListing, never> {
    return {
      id: entity.id,
      hostId: entity.hostId,
      title: entity.title,
      description: entity.description,
      pricePerNight: entity.pricePerNight,
      currency: entity.currency,
      maxCapacity: entity.maxCapacity,
      isPublished: entity.isPublished,
      city: entity.city,
      country: entity.country,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      version: entity.version,
    };
  }
}
