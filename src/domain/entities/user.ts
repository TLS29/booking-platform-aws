import { v7 as uuidv7 } from "uuid";
import { DomainError } from "#domain/errors/DomainError";

export type UserRole = "ADMIN" | "USER";

export interface UserCreateProps {
  email: string;
  name: string;
  passwordHash: string;
  isHost?: boolean;
  isGuest?: boolean;
}

export interface UserReconstituteProps {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isHost: boolean;
  isGuest: boolean;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class User {
  constructor(
    private readonly _id: string,
    private _email: string,
    private _name: string,
    private _passwordHash: string,
    private _isHost: boolean,
    private _isGuest: boolean,
    private _role: "ADMIN" | "USER",
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _deletedAt: Date | null,
    private _version: number,
  ) {}

  static create(props: UserCreateProps): User {
    const normalizedEmail = props.email.trim().toLowerCase();

    if (!EMAIL_RE.test(normalizedEmail)) {
      throw new DomainError("USER_INVALID_EMAIL", "Email format invalid", 400);
    }

    if (props.name.trim().length === 0) {
      throw new DomainError("USER_INVALID_NAME", "Name cannot be empty", 400);
    }

    if (props.passwordHash.trim().length === 0) {
      throw new DomainError(
        "USER_INVALID_PASSWORD",
        "Password hash cannot be empty",
        400,
      );
    }

    const now = new Date();
    return new User(
      uuidv7(),
      normalizedEmail,
      props.name,
      props.passwordHash,
      props.isHost ?? false,
      props.isGuest ?? true,
      "USER",
      now,
      now,
      null,
      0,
    );
  }

  static reconstitute(props: UserReconstituteProps): User {
    return new User(
      props.id,
      props.email,
      props.name,
      props.passwordHash,
      props.isHost,
      props.isGuest,
      props.role,
      props.createdAt,
      props.updatedAt,
      props.deletedAt,
      props.version,
    );
  }

  // ---------- Business methods ----------

  rename(newName: string): void {
    const normalizedName = newName.trim();
    if (normalizedName.length === 0) {
      throw new DomainError("USER_INVALID_NAME", "Name cannot be empty", 400);
    }

    this._name = normalizedName;
    this.touch();
  }

  changeEmail(newEmail: string): void {
    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_RE.test(normalizedEmail)) {
      throw new DomainError("USER_INVALID_EMAIL", "Email format invalid", 400);
    }

    this._email = normalizedEmail;
    this.touch();
  }

  changePasswordHash(newHash: string): void {
    if (newHash.trim().length === 0) {
      throw new DomainError(
        "USER_INVALID_PASSWORD",
        "Password hash cannot be empty",
        400,
      );
    }

    this._passwordHash = newHash;
    this.touch();
  }

  becomeHost(): void {
    if (this._isHost) {
      throw new DomainError("USER_ALREADY_HOST", "User is already a host", 409);
    }

    if (this._deletedAt !== null) {
      throw new DomainError(
        "USER_DELETED",
        "Cannot modify a deleted user",
        409,
      );
    }

    if (this._role === "ADMIN") {
      throw new DomainError(
        "ADMIN_CANNOT_BE_HOST",
        "Admins cannot host listings",
        403,
      );
    }

    this._isHost = true;
    this.touch();
  }

  revokeHost(): void {
    if (!this._isHost) {
      throw new DomainError("USER_NOT_HOST", "User is not a host", 409);
    }

    if (this._deletedAt !== null) {
      throw new DomainError(
        "USER_DELETED",
        "Cannot modify a deleted user",
        409,
      );
    }

    this._isHost = false;
    this.touch();
  }

  private touch(): void {
    this._updatedAt = new Date();
    this._version += 1;
  }

  // ---------- Getters ----------

  get id() {
    return this._id;
  }
  get email() {
    return this._email;
  }
  get name() {
    return this._name;
  }
  get passwordHash() {
    return this._passwordHash;
  }
  get isHost() {
    return this._isHost;
  }
  get isGuest() {
    return this._isGuest;
  }
  get role() {
    return this._role;
  }
  get createdAt() {
    return this._createdAt;
  }
  get updatedAt() {
    return this._updatedAt;
  }
  get deletedAt() {
    return this._deletedAt;
  }
  get version() {
    return this._version;
  }
}
