export class Listing {
  constructor(
    public readonly id: string,
    public readonly hostId: string,
    public title: string,
    public description: string,
    public pricePerNight: bigint,
    public currency: string,
    public maxCapacity: number,
    public isPublished: boolean,
    public city: string,
    public country: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public deletedAt: Date | null,
    public version: number,
  ) {}
}
