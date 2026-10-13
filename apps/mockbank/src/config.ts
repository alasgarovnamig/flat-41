export interface MerchantSeed {
  id: string;
  secret: string;
  name: string;
}

export interface Config {
  env: string;
  isProd: boolean;
  port: number;
  /** Public base URL of the bank (used for paymentUrl and checkout links). No trailing slash. */
  publicUrl: string;
  databaseUrl: string;
  merchants: MerchantSeed[];
  admin: { user: string; password: string };
  /** Minutes before an unpaid order becomes EXPIRED. */
  orderTtlMinutes: number;
  /** Multiplier applied to the webhook retry schedule (e.g. 0.01 in tests). */
  webhookRetryScale: number;
  /** Per-attempt webhook HTTP timeout. */
  webhookTimeoutMs: number;
  /** How often the background loop (webhook retries + expiry) runs. */
  schedulerIntervalMs: number;
  /** Maximum allowed clock skew for signed merchant requests. */
  signatureToleranceMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}

export function parseMerchants(raw: string): MerchantSeed[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, secret, ...nameParts] = entry.split(':');
      if (!id || !secret) throw new Error(`Invalid MERCHANTS entry "${entry}" (expected id:secret:name)`);
      return { id: id.trim(), secret: secret.trim(), name: nameParts.join(':').trim() || id.trim() };
    });
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value "${value}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = num(env.PORT, 4100);
  const logLevel = (env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info')) as Config['logLevel'];
  const config: Config = {
    env: nodeEnv,
    isProd: nodeEnv === 'production',
    port,
    publicUrl: (env.PUBLIC_URL ?? env.MOCKBANK_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL ?? 'postgres://evtap:evtap@localhost:5432/mockbank',
    merchants: parseMerchants(env.MERCHANTS ?? 'evtap:evtap-mockbank-secret:EvTap'),
    admin: { user: env.ADMIN_USER ?? 'admin', password: env.ADMIN_PASSWORD ?? 'admin' },
    orderTtlMinutes: num(env.ORDER_TTL_MINUTES, 30),
    webhookRetryScale: num(env.WEBHOOK_RETRY_SCALE, 1),
    webhookTimeoutMs: num(env.WEBHOOK_TIMEOUT_MS, 10_000),
    schedulerIntervalMs: num(env.SCHEDULER_INTERVAL_MS, 1_000),
    signatureToleranceMs: 5 * 60 * 1000,
    logLevel,
  };
  return { ...config, ...overrides };
}
