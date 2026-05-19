import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  //   REDIS_URL: z.string().url(),
  //   JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  //   AWS_REGION: z.string().min(1),
  //   COGNITO_USER_POOL_ID: z.string().min(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  logLevel: parsed.data.LOG_LEVEL,
  //   redisUrl: parsed.data.REDIS_URL,
  //   jwtSecret: parsed.data.JWT_SECRET,
  //   awsRegion: parsed.data.AWS_REGION,
  //   cognitoUserPoolId: parsed.data.COGNITO_USER_POOL_ID,
} as const;

export type Env = typeof env;
