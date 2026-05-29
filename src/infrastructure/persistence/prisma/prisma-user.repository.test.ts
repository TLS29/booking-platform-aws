import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PrismaUserRepository } from "#infrastructure/persistence/prisma/prisma-user.repository";
import { User } from "#domain/entities/user";
import { beforeEach } from "vitest";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let repository: PrismaUserRepository;

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
  repository = new PrismaUserRepository(prisma);
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

describe("PrismaUserRepository", () => {
  it("saves a user and finds it by email", async () => {
    const user = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: false,
      isGuest: true,
    });

    await repository.save(user);

    const record = await repository.findByEmail(user.email);

    expect(record?.email).toBe(user.email);
    expect(record?.isGuest).toBe(true);
    expect(record?.isHost).toBe(false);
    expect(record?.role).toBe("USER");
  });

  it("saves a user and finds it by id", async () => {
    const user = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: false,
      isGuest: true,
    });

    await repository.save(user);

    const record = await repository.findById(user.id);

    expect(record?.email).toBe(user.email);
    expect(record?.isGuest).toBe(true);
    expect(record?.isHost).toBe(false);
    expect(record?.role).toBe("USER");
  });

  it("returns null when no user matches the id", async () => {
    const record = await repository.findById(
      "01971d4e-1b2a-7c3f-9d4e-5f6a7b8c9d0e",
    );

    expect(record).toBe(null);
  });

  it("returns null after soft delete", async () => {
    const user = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: false,
      isGuest: true,
    });

    await repository.save(user);
    await repository.softDelete(user.id);
    const deletedRecord = await repository.findById(user.id);

    expect(deletedRecord).toBe(null);
  });

  it("rejects when the email is already in use", async () => {
    const userA = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: false,
      isGuest: true,
    });

    const userB = User.create({
      email: "test@test.com",
      name: "John Doe",
      passwordHash: "asd23123aad",
      isHost: false,
      isGuest: true,
    });

    // we save userA
    await repository.save(userA);

    // then we check that userB can't be stored
    await expect(repository.save(userB)).rejects.toThrow();
  });
});
