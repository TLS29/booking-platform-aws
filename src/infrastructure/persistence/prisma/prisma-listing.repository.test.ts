import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PrismaListingRepository } from "#infrastructure/persistence/prisma/prisma-listing.repository";
import { PrismaUserRepository } from "#infrastructure/persistence/prisma/prisma-user.repository";
import { Listing } from "#domain/entities/listing";
import { User } from "#domain/entities/user";
import { beforeEach } from "vitest";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let listingRepository: PrismaListingRepository;
let userRepository: PrismaUserRepository;

beforeAll(async () => {
  // 1. start a throwaway Postgres container (same version as your dev DB)
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();

  // 2. build the schema inside it by applying your existing migrations
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  // 3. point Prisma at THIS container (not your dev DB)
  prisma = new PrismaClient({ datasources: { db: { url } } });
  listingRepository = new PrismaListingRepository(prisma);
  userRepository = new PrismaUserRepository(prisma);
}, 60_000); // long timeout: first run may download the image

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "users", "listings", "availabilities", "reservations", "reviews", "payments" RESTART IDENTITY CASCADE`,
  );
});

describe("PrismaListingRepository", () => {
  it("saves a listing and finds it by id", async () => {
    const user = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: true,
      isGuest: true,
    });

    const listing = Listing.create({
      hostId: user.id,
      title: "Beautiful house",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    await userRepository.save(user);
    await listingRepository.save(listing);

    const record = await listingRepository.findById(listing.id);

    expect(record?.hostId).toBe(user.id);
    expect(record?.pricePerNight).toBe(99999n);
    expect(record?.currency).toBe("MXN");
  });

  it("find published listings", async () => {
    const user = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: true,
      isGuest: true,
    });

    const listingA = Listing.create({
      hostId: user.id,
      title: "Beautiful house Torreon",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    const listingB = Listing.create({
      hostId: user.id,
      title: "Beautiful house CDMX",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "CDMX",
      country: "Mexico",
    });

    const listingC = Listing.create({
      hostId: user.id,
      title: "Beautiful house Torreon 2",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    listingB.publish();
    listingC.publish();

    await userRepository.save(user);
    await listingRepository.save(listingA);
    await listingRepository.save(listingB);
    await listingRepository.save(listingC);

    const records = await listingRepository.findPublishedByCity("CDMX");

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(listingB.id);
    expect(records[0]?.city).toBe("CDMX");
  });

  it("return listings by host id", async () => {
    const userA = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: true,
      isGuest: true,
    });

    const userB = User.create({
      email: "test2@test2.com",
      name: "Juan Doe",
      passwordHash: "asd23123aad",
      isHost: true,
      isGuest: true,
    });

    const listingA = Listing.create({
      hostId: userA.id,
      title: "Beautiful house Torreon",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    const listingB = Listing.create({
      hostId: userB.id,
      title: "Beautiful house CDMX",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "CDMX",
      country: "Mexico",
    });

    const listingC = Listing.create({
      hostId: userA.id,
      title: "Beautiful house Torreon 2",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    await userRepository.save(userA);
    await userRepository.save(userB);
    await listingRepository.save(listingA);
    await listingRepository.save(listingB);
    await listingRepository.save(listingC);

    const records = await listingRepository.findByHostId(userA.id);

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id).sort()).toEqual(
      [listingA.id, listingC.id].sort(),
    );
  });

  it("rejects to save listing when hostId is null", async () => {
    const listing = Listing.create({
      hostId: "01971d4e-1b2a-7c3f-9d4e-5f6a7b8c9d0e",
      title: "Beautiful house Torreon",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "Torreon",
      country: "Mexico",
    });

    await expect(listingRepository.save(listing)).rejects.toThrow();
  });
});
