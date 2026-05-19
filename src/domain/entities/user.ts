export class User {
  constructor(
    public readonly id: string,
    public email: string,
    public name: string,
    public passwordHash: string,
    public isHost: boolean,
    public isGuest: boolean,
    public role: "ADMIN" | "USER",
    public readonly createdAt: Date,
    public updatedAt: Date,
    public deletedAt: Date | null,
    public version: number,
  ) {}
}
