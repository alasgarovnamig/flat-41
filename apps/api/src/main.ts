import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import path from 'node:path';
import { API_PREFIX } from '@evtap/shared';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  // rawBody: needed to verify HMAC signatures of bank webhooks (req.rawBody)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX.slice(1));
  app.enableCors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true });
  app.useBodyParser('json', { limit: '2mb' });
  if (config.storage.driver === 'local') {
    app.useStaticAssets(path.resolve(config.storage.uploadDir), { prefix: '/uploads', maxAge: '30d' });
  }
  app.enableShutdownHooks();

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('EvTap API').setDescription('Real-estate marketplace API. Contract: packages/shared/src/api.ts').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, doc);

  await app.listen(config.port);
  Logger.log(`🚀 API on http://localhost:${config.port}${API_PREFIX} · docs /api/docs`, 'Bootstrap');
}
bootstrap();
