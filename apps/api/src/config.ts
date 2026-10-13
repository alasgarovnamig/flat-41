import 'dotenv/config';

const str = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

export const config = {
  env: str('NODE_ENV', 'development'),
  isProd: process.env.NODE_ENV === 'production',
  port: num('PORT', 4000),
  apiPublicUrl: str('API_PUBLIC_URL', 'http://localhost:4000'),
  /** URL the bank uses for server-to-server webhooks (inside docker: http://api:4000). */
  apiInternalUrl: str('API_INTERNAL_URL', process.env.API_PUBLIC_URL ?? 'http://localhost:4000'),
  webUrl: str('WEB_URL', 'http://localhost:3000'),
  adminUrl: str('ADMIN_URL', 'http://localhost:3001'),
  corsOrigins: str('CORS_ORIGINS', '*').split(',').map((s) => s.trim()),
  databaseUrl: str('DATABASE_URL', 'postgres://evtap:evtap@localhost:5432/evtap'),
  jwt: {
    accessSecret: str('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: num('JWT_ACCESS_TTL', 900),
    refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 30),
  },
  storage: {
    driver: str('STORAGE_DRIVER', 'local') as 'local' | 's3',
    uploadDir: str('UPLOAD_DIR', './uploads'),
    s3: {
      endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, region: process.env.S3_REGION ?? 'auto',
      accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY, publicUrl: process.env.S3_PUBLIC_URL,
    },
  },
  sms: { provider: str('SMS_PROVIDER', 'console'), otpDevCode: process.env.OTP_DEV_CODE || null },
  payments: {
    provider: str('PAYMENT_PROVIDER', 'mockbank'),
    mockbank: {
      url: str('MOCKBANK_URL', 'http://localhost:4100'),
      publicUrl: str('MOCKBANK_PUBLIC_URL', process.env.MOCKBANK_URL ?? 'http://localhost:4100'),
      merchantId: str('MOCKBANK_MERCHANT_ID', 'evtap'),
      secret: str('MOCKBANK_SECRET', 'evtap-mockbank-secret'),
    },
  },
  push: { provider: str('PUSH_PROVIDER', 'console'), expoAccessToken: process.env.EXPO_ACCESS_TOKEN },
  admin: { email: str('ADMIN_EMAIL', 'admin@evtap.az'), password: str('ADMIN_PASSWORD', 'Admin12345!') },
};
export type AppConfig = typeof config;
