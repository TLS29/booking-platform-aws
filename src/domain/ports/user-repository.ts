import { User } from "#domain/entities/user";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  softDelete(id: string): Promise<void>;
}
