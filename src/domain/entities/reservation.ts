import { v7 as uuidv7 } from "uuid";
import { DomainError } from "#domain/errors/DomainError";

export type ReservationStatus =
  | "PENDING"
  | "HELD"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED";

export interface ReservationCreateProps {
  guestId: string;
  listingId: string;
  checkIn: Date;
  checkOut: Date;
  total: bigint;
  currency: string;
  guests: number;
}

export interface ReservationReconstituteProps {
  id: string;
  guestId: string;
  listingId: string;
  checkIn: Date;
  checkOut: Date;
  total: bigint;
  holdExpiresAt: Date | null;
  status: ReservationStatus;
  currency: string;
  guests: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export class Reservation {
  constructor(
    private readonly _id: string,
    private readonly _guestId: string,
    private readonly _listingId: string,
    private _checkIn: Date,
    private _checkOut: Date,
    private _total: bigint,
    private _holdExpiresAt: Date | null,
    private _status: ReservationStatus,
    private _currency: string,
    private _guests: number,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _deletedAt: Date | null,
    private _version: number,
  ) {}

  static create(props: ReservationCreateProps): Reservation {
    if (props.checkIn >= props.checkOut) {
      throw new DomainError(
        "RESERVATION_INVALID_DATE",
        "Check in date is greater than checkout",
        400,
      );
    }

    if (props.currency.length !== 3) {
      throw new DomainError(
        "RESERVATION_INVALID_CURRENCY",
        "Currency must be ISO 4217 (3 chars)",
        400,
      );
    }

    if (props.guests <= 0) {
      throw new DomainError(
        "RESERVATION_INVALID_GUESTS",
        "Guests must be >= 1",
        400,
      );
    }

    if (props.total <= 0n) {
      throw new DomainError(
        "RESERVATION_INVALID_TOTAL",
        "Total must be positive",
        400,
      );
    }

    const now = new Date();
    return new Reservation(
      uuidv7(),
      props.guestId,
      props.listingId,
      props.checkIn,
      props.checkOut,
      props.total,
      null,
      "PENDING",
      props.currency.toUpperCase(),
      props.guests,
      now,
      now,
      null,
      0,
    );
  }

  static reconstitute(props: ReservationReconstituteProps): Reservation {
    return new Reservation(
      props.id,
      props.guestId,
      props.listingId,
      props.checkIn,
      props.checkOut,
      props.total,
      props.holdExpiresAt,
      props.status,
      props.currency,
      props.guests,
      props.createdAt,
      props.updatedAt,
      props.deletedAt,
      props.version,
    );
  }

  complete(): void {
    if (this._status !== "CHECKED_IN") {
      throw new DomainError(
        "RESERVATION_INVALID_TRANSITION",
        `Cannot complete from ${this._status}`,
        409,
      );
    }

    this._status = "COMPLETED";
    this.touch();
  }

  markCheckedIn(): void {
    if (this._status !== "CONFIRMED") {
      throw new DomainError(
        "RESERVATION_INVALID_TRANSITION",
        `Cannot check in from ${this._status}`,
        409,
      );
    }

    this._status = "CHECKED_IN";
    this.touch();
  }

  confirm(): void {
    if (this._status !== "HELD") {
      throw new DomainError(
        "RESERVATION_INVALID_TRANSITION",
        `Cannot confirm from ${this._status}`,
        409,
      );
    }

    this._status = "CONFIRMED";
    this.touch();
  }

  hold(holdExpiresAt: Date): void {
    if (this._status !== "PENDING") {
      throw new DomainError(
        "RESERVATION_INVALID_TRANSITION",
        `Cannot hold from ${this._status}`,
        409,
      );
    }

    this._status = "HELD";
    this._holdExpiresAt = holdExpiresAt;
    this.touch();
  }

  cancel(): void {
    const validStatuses: ReservationStatus[] = ["PENDING", "HELD", "CONFIRMED"];
    if (!validStatuses.includes(this._status)) {
      throw new DomainError(
        "RESERVATION_INVALID_TRANSITION",
        `Cannot cancel from ${this._status}`,
        409,
      );
    }

    this._status = "CANCELLED";
    this.touch();
  }

  private touch(): void {
    this._updatedAt = new Date();
    this._version += 1;
  }

  // ---------- Getters ----------

  get id() { return this._id; }
  get guestId() { return this._guestId; }
  get listingId() { return this._listingId; }
  get checkIn() { return this._checkIn; }
  get checkOut() { return this._checkOut; }
  get total() { return this._total; }
  get holdExpiresAt() { return this._holdExpiresAt; }
  get status() { return this._status; }
  get currency() { return this._currency; }
  get guests() { return this._guests; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
  get deletedAt() { return this._deletedAt; }
  get version() { return this._version; }
}
