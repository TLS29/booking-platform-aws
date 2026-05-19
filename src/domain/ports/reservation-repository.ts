import { Reservation } from "#domain/entities/reservation";

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
  findByGuestId(guestId: string): Promise<Reservation[]>;
  findByListingInRange(
    listingId: string,
    from: Date,
    to: Date,
  ): Promise<Reservation[]>;
  findExpiredHolds(): Promise<Reservation[]>;
}
