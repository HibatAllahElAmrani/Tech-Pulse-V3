import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),

  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_URL: z.string().default('redis://redis:6379'),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_PERSONAL_TOKEN: z.string().optional(),
  // Pool de tokens serveur (liste séparée par des virgules). Prioritaire sur
  // GITHUB_PERSONAL_TOKEN. Permet de multiplier le quota GitHub via rotation.
  GITHUB_TOKENS: z.string().optional(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex = 64 chars

  // Stack Exchange API — sans clé : 300 req/jour ; avec : 10 000 req/jour.
  // Gratuite sur stackapps.com/apps/oauth/register (champ "Key").
  STACKEXCHANGE_KEY: z.string().optional(),

  // AI Service
  AI_SERVICE_URL: z.string().url().default('http://ai-service:8000'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
