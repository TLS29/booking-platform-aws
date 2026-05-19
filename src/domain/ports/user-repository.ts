import { User } from "#domain/entities/user";

export interface UserRepository {
  findById(userId: string): Promise<User | null>;
  findByEmail(userEmail: string): Promise<User | null>;
  save(user: User): Promise<void>;
  softDelete(userId: string): Promise<void>;
}
