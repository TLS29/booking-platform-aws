import { v7 as uuidv7 } from "uuid";
import { DomainError } from "#domain/errors/DomainError";

export interface ListingCreateProps {
  hostId: string;
  title: string;
  description: string;
  pricePerNight: bigint;
  currency: string;
  maxCapacity: number;
  city: string;
  country: string;
}

export interface ListingReconstituteProps {
  id: string;
  hostId: string;
  title: string;
  description: string;
  pricePerNight: bigint;
  currency: string;
  maxCapacity: number;
  isPublished: boolean;
  city: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export class Listing {
  private constructor(
    private readonly _id: string,
    private readonly _hostId: string,
    private _title: string,
    private _description: string,
    private _pricePerNight: bigint,
    private _currency: string,
    private _maxCapacity: number,
    private _isPublished: boolean,
    private _city: string,
    private _country: string,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _deletedAt: Date | null,
    private _version: number,
  ) {}

  // ---------- Factories ----------

  static create(props: ListingCreateProps): Listing {
    if (props.title.trim().length === 0) {
      throw new DomainError("LISTING_INVALID_TITLE", "Title cannot be empty", 400);
    }
    if (props.pricePerNight <= 0n) {
      throw new DomainError("LISTING_INVALID_PRICE", "Price must be positive", 400);
    }
    if (props.maxCapacity < 1) {
      throw new DomainError("LISTING_INVALID_CAPACITY", "Capacity must be >= 1", 400);
    }
    if (props.currency.length !== 3) {
      throw new DomainError("LISTING_INVALID_CURRENCY", "Currency must be ISO 4217 (3 chars)", 400);
    }

    const now = new Date();
    return new Listing(
      uuidv7(),
      props.hostId,
      props.title,
      props.description,
      props.pricePerNight,
      props.currency.toUpperCase(),
      props.maxCapacity,
      false,
      props.city,
      props.country,
      now,
      now,
      null,
      0,
    );
  }

  static reconstitute(props: ListingReconstituteProps): Listing {
    return new Listing(
      props.id,
      props.hostId,
      props.title,
      props.description,
      props.pricePerNight,
      props.currency,
      props.maxCapacity,
      props.isPublished,
      props.city,
      props.country,
      props.createdAt,
      props.updatedAt,
      props.deletedAt,
      props.version,
    );
  }

  // ---------- Business methods ----------

  publish(): void {
    if (this._deletedAt !== null) {
      throw new DomainError("LISTING_DELETED", "Cannot publish a deleted listing", 409);
    }
    if (this._isPublished) {
      throw new DomainError("LISTING_ALREADY_PUBLISHED", "Listing is already published", 409);
    }
    this._isPublished = true;
    this.touch();
  }

  unpublish(): void {
    if (!this._isPublished) {
      throw new DomainError("LISTING_NOT_PUBLISHED", "Listing is not published", 409);
    }
    this._isPublished = false;
    this.touch();
  }

  updatePricing(pricePerNight: bigint, currency: string): void {
    if (pricePerNight <= 0n) {
      throw new DomainError("LISTING_INVALID_PRICE", "Price must be positive", 400);
    }
    if (currency.length !== 3) {
      throw new DomainError("LISTING_INVALID_CURRENCY", "Currency must be ISO 4217 (3 chars)", 400);
    }
    this._pricePerNight = pricePerNight;
    this._currency = currency.toUpperCase();
    this.touch();
  }

  private touch(): void {
    this._updatedAt = new Date();
    this._version += 1;
  }

  // ---------- Getters ----------

  get id() { return this._id; }
  get hostId() { return this._hostId; }
  get title() { return this._title; }
  get description() { return this._description; }
  get pricePerNight() { return this._pricePerNight; }
  get currency() { return this._currency; }
  get maxCapacity() { return this._maxCapacity; }
  get isPublished() { return this._isPublished; }
  get city() { return this._city; }
  get country() { return this._country; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
  get deletedAt() { return this._deletedAt; }
  get version() { return this._version; }
}
