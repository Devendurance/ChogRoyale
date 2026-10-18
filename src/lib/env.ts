import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_POOLED: z.string().optional(),
  DATABASE_URL_TEST: z.string().optional(),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1, "NEXT_PUBLIC_PRIVY_APP_ID is required"),
  PRIVY_APP_SECRET: z.string().min(1, "PRIVY_APP_SECRET is required"),
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  MONAD_RPC_URL: z.string().url().default("https://rpc.monad.xyz"),
  MONAD_CHAIN_ID: z.coerce.number().default(143),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
