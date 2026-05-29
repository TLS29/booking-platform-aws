import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PrismaReservationRepository } from "#infrastructure/persistence/prisma/prisma-reservation.repository";
import { PrismaListingRepository } from "#infrastructure/persistence/prisma/prisma-listing.repository";
import { PrismaUserRepository } from "#infrastructure/persistence/prisma/prisma-user.repository";
import { Reservation } from "#domain/entities/reservation";
import { Listing } from "#domain/entities/listing";
import { User } from "#domain/entities/user";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let reservationRepository: PrismaReservationRepository;
let listingRepository: PrismaListingRepository;
let userRepository: PrismaUserRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();

  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  prisma = new PrismaClient({ datasources: { db: { url } } });
  reservationRepository = new PrismaReservationRepository(prisma);
  listingRepository = new PrismaListingRepository(prisma);
  userRepository = new PrismaUserRepository(prisma);
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "users", "listings", "availabilities", "reservations", "reviews", "payments" RESTART IDENTITY CASCADE`,
  );
});

// ----------------------------------------------------------------------------
// Helpers — every reservation test needs a user + listing as FK targets,
// so the boilerplate lives here once.
// ----------------------------------------------------------------------------

async function seedHostAndListing() {
  const user = User.create({
    email: "test@test.com",
    name: "John Doe",
    passwordHash: "hash",
    isHost: true,
    isGuest: true,
  });
  const listing = Listing.create({
    hostId: user.id,
    title: "House",
    description: "Description",
    pricePerNight: 99999n,
    currency: "mxn",
    maxCapacity: 3,
    city: "CDMX",
    country: "Mexico",
  });
  await userRepository.save(user);
  await listingRepository.save(listing);
  return { user, listing };
}

function makeReservation(
  guestId: string,
  listingId: string,
  checkIn: Date,
  checkOut: Date,
) {
  return Reservation.create({
    guestId,
    listingId,
    checkIn,
    checkOut,
    total: 100000n,
    currency: "MXN",
    guests: 2,
  });
}

const date = (iso: string) => new Date(iso);

describe("PrismaReservationRepository", () => {
  it("saves a reservation and finds it by id", async () => {
    const { user, listing } = await seedHostAndListing();

    const reservation = makeReservation(
      user.id,
      listing.id,
      date("2026-06-10"),
      date("2026-06-15"),
    );

    await reservationRepository.save(reservation);

    const record = await reservationRepository.findById(reservation.id);

    expect(record?.guestId).toBe(user.id);
    expect(record?.listingId).toBe(listing.id);
    expect(record?.status).toBe("PENDING");
    expect(record?.total).toBe(100000n);
  });

  it("returns reservations overlapping the given date range for a listing", async () => {
    // NEW vs the prior tests: this query is RANGE-based, not equality-based.
    // The repo's overlap rule is the classic one:
    //   checkIn < queryTo AND checkOut > queryFrom
    //
    // For a query of [2026-06-10, 2026-06-15) we cover each edge:
    //   - "before"        checkOut <= 2026-06-10  → EXCLUDED
    //   - "overlap start" spans the left boundary → INCLUDED
    //   - "inside"        fully within            → INCLUDED
    //   - "overlap end"   spans the right boundary→ INCLUDED
    //   - "after"         checkIn >= 2026-06-15   → EXCLUDED
    //   - "other listing" different listingId     → EXCLUDED (proves listing filter still applies)
    const { user, listing } = await seedHostAndListing();

    // Second listing in the same DB — the listingId filter must exclude its reservation
    // even when the dates overlap perfectly.
    const otherListing = Listing.create({
      hostId: user.id,
      title: "Other house",
      description: "Description",
      pricePerNight: 99999n,
      currency: "mxn",
      maxCapacity: 3,
      city: "CDMX",
      country: "Mexico",
    });
    await listingRepository.save(otherListing);

    const before       = makeReservation(user.id, listing.id,      date("2026-06-01"), date("2026-06-05"));
    const overlapStart = makeReservation(user.id, listing.id,      date("2026-06-08"), date("2026-06-12"));
    const inside       = makeReservation(user.id, listing.id,      date("2026-06-11"), date("2026-06-13"));
    const overlapEnd   = makeReservation(user.id, listing.id,      date("2026-06-14"), date("2026-06-18"));
    const after        = makeReservation(user.id, listing.id,      date("2026-06-20"), date("2026-06-25"));
    const otherList    = makeReservation(user.id, otherListing.id, date("2026-06-11"), date("2026-06-13"));

    await reservationRepository.save(before);
    await reservationRepository.save(overlapStart);
    await reservationRepository.save(inside);
    await reservationRepository.save(overlapEnd);
    await reservationRepository.save(after);
    await reservationRepository.save(otherList);

    const records = await reservationRepository.findByListingInRange(
      listing.id,
      date("2026-06-10"),
      date("2026-06-15"),
    );

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.id).sort()).toEqual(
      [overlapStart.id, inside.id, overlapEnd.id].sort(),
    );
  });

  it("returns only HELD reservations whose hold has expired", async () => {
    // NEW vs the prior tests: status transitions and time math.
    //
    // To get a reservation into HELD we go through PENDING -> HELD via .hold(expiry).
    // To get CONFIRMED we go PENDING -> HELD -> CONFIRMED via .hold() then .confirm().
    //
    // findExpiredHolds(now) returns only: status === "HELD" AND holdExpiresAt <= now.
    // We cover both filters with 3 reservations:
    //   - expiredHold:  HELD,      expiry in the past   → INCLUDED
    //   - activeHold:   HELD,      expiry in the future → EXCLUDED (status OK, time not yet)
    //   - confirmed:    CONFIRMED, expiry in the past   → EXCLUDED (time OK, wrong status)
    const { user, listing } = await seedHostAndListing();
    const now = date("2026-06-01T12:00:00Z");

    const expiredHold = makeReservation(user.id, listing.id, date("2026-07-10"), date("2026-07-15"));
    expiredHold.hold(date("2026-06-01T11:59:00Z")); // 1 min before "now"

    const activeHold = makeReservation(user.id, listing.id, date("2026-07-10"), date("2026-07-15"));
    activeHold.hold(date("2026-06-01T12:01:00Z")); // 1 min after "now"

    const confirmed = makeReservation(user.id, listing.id, date("2026-07-10"), date("2026-07-15"));
    confirmed.hold(date("2026-06-01T11:59:00Z"));
    confirmed.confirm(); // promote to CONFIRMED

    await reservationRepository.save(expiredHold);
    await reservationRepository.save(activeHold);
    await reservationRepository.save(confirmed);

    const records = await reservationRepository.findExpiredHolds(now);

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(expiredHold.id);
  });

  it("rejects when listingId does not exist (FK violation)", async () => {
    // The guest IS saved, so the failure unambiguously points at the listingId FK.
    const user = User.create({
      email: "guest@test.com",
      name: "John Doe",
      passwordHash: "hash",
      isHost: false,
      isGuest: true,
    });
    await userRepository.save(user);

    const reservation = makeReservation(
      user.id,
      "01971d4e-1b2a-7c3f-9d4e-5f6a7b8c9d0e", // no listing has this id
      date("2026-06-10"),
      date("2026-06-15"),
    );

    await expect(reservationRepository.save(reservation)).rejects.toThrow();
  });
});
