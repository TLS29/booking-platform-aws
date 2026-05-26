import type { Reservation as PrismaReservation } from "@prisma/client";
import { Reservation } from "#domain/entities/reservation";
import type { ReservationRepository } from "#domain/ports/reservation-repository";
import type { DbClient } from "#infrastructure/persistence/prisma/client";

export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly prisma: DbClient) {}
  async findById(id: string): Promise<Reservation | null> {
    const record = await this.prisma.reservation.findFirst({
      where: { id, deletedAt: null },
    });

    return record ? PrismaReservationRepository.toDomain(record) : null;
  }

  async findByGuestId(guestId: string): Promise<Reservation[]> {
    const records = await this.prisma.reservation.findMany({
      where: { guestId, deletedAt: null },
    });

    return records.map(PrismaReservationRepository.toDomain);
  }

  async findByListingInRange(
    listingId: string,
    from: Date,
    to: Date,
  ): Promise<Reservation[]> {
    const records = await this.prisma.reservation.findMany({
      where: {
        checkIn: { lt: to },
        checkOut: { gt: from },
        deletedAt: null,
        listingId,
      },
    });

    return records.map(PrismaReservationRepository.toDomain);
  }

  async findExpiredHolds(now: Date): Promise<Reservation[]> {
    const records = await this.prisma.reservation.findMany({
      where: { holdExpiresAt: { lte: now }, deletedAt: null, status: "HELD" },
    });

    return records.map(PrismaReservationRepository.toDomain);
  }

  async save(reservation: Reservation): Promise<void> {
    const data = PrismaReservationRepository.toPersistence(reservation);
    await this.prisma.reservation.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  private static toDomain(record: PrismaReservation): Reservation {
    return Reservation.reconstitute({
      id: record.id,
      guestId: record.guestId,
      listingId: record.listingId,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      total: record.total,
      holdExpiresAt: record.holdExpiresAt,
      status: record.status,
      currency: record.currency,
      guests: record.guests,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      version: record.version,
    });
  }

  private static toPersistence(
    entity: Reservation,
  ): Omit<PrismaReservation, never> {
    return {
      id: entity.id,
      guestId: entity.guestId,
      listingId: entity.listingId,
      checkIn: entity.checkIn,
      checkOut: entity.checkOut,
      total: entity.total,
      holdExpiresAt: entity.holdExpiresAt,
      status: entity.status,
      currency: entity.currency,
      guests: entity.guests,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      version: entity.version,
    };
  }
}
