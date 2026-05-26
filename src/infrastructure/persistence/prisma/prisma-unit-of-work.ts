import type { PrismaClient } from "#infrastructure/persistence/prisma/client";
import type { UnitOfWork, Repositories } from "#domain/ports/unit-of-work";
import { PrismaUserRepository } from "#infrastructure/persistence/prisma/prisma-user.repository";
import { PrismaListingRepository } from "#infrastructure/persistence/prisma/prisma-listing.repository";
import { PrismaReservationRepository } from "#infrastructure/persistence/prisma/prisma-reservation.repository";

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => {
      const repos: Repositories = {
        users: new PrismaUserRepository(tx),
        listings: new PrismaListingRepository(tx),
        reservations: new PrismaReservationRepository(tx),
      };
      return work(repos);
    });
  }
}
