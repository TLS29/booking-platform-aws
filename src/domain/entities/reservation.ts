export class Reservation {
  constructor(
    public readonly id: string,
    public readonly guestId: string,
    public readonly listingId: string,
    public checkIn: Date,
    public checkOut: Date,
    public total: bigint,
    public holdExpiresAt: Date | null,
    public status:
      | "PENDING"
      | "HELD"
      | "CONFIRMED"
      | "CHECKED_IN"
      | "COMPLETED"
      | "CANCELLED",
    public currency: string,
    public guests: number,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public deletedAt: Date | null,
    public version: number,
  ) {}
}
