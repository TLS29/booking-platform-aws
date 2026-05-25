import type { User as PrismaUser } from "@prisma/client";
import { User } from "#domain/entities/user";
import type { UserRepository } from "#domain/ports/user-repository";
import type { PrismaClient } from "#infrastructure/persistence/prisma/client";

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- Queries ----------

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    return record ? PrismaUserRepository.toDomain(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });

    return record ? PrismaUserRepository.toDomain(record) : null;
  }

  // ---------- Commands ----------

  async save(user: User): Promise<void> {
    const data = PrismaUserRepository.toPersistence(user);
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: data,
      update: data,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  private static toDomain(record: PrismaUser): User {
    return User.reconstitute({
      id: record.id,
      email: record.email,
      name: record.name,
      passwordHash: record.passwordHash,
      isHost: record.isHost,
      isGuest: record.isGuest,
      role: record.role,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      version: record.version,
    });
  }

  private static toPersistence(entity: User): Omit<PrismaUser, never> {
    return {
      id: entity.id,
      email: entity.email,
      name: entity.name,
      passwordHash: entity.passwordHash,
      isHost: entity.isHost,
      isGuest: entity.isGuest,
      role: entity.role,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      version: entity.version,
    };
  }
}
