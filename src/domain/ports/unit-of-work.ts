import type { UserRepository } from "#domain/ports/user-repository";
import type { ListingRepository } from "#domain/ports/listing-repository";
import type { ReservationRepository } from "#domain/ports/reservation-repository";

export interface Repositories {
  users: UserRepository;
  listings: ListingRepository;
  reservations: ReservationRepository;
}

export interface UnitOfWork {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
