import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate at the boundary (incoming requests), per CLAUDE.md — reject
  // unknown fields rather than silently accepting/ignoring them (e.g. a
  // client trying to slip a location field into a request body).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());

  // CORS, off by default — only enabled if CORS_ORIGIN is explicitly set
  // (see env.validation.ts), and only for the specific origins listed, not
  // a wildcard. Exists so the site container's embedded onboarding widget
  // (GET /teams/invite, POST /players — already unauthenticated per
  // docs/api/phase1-contract.md, so this doesn't grant new access to
  // anything auth-gated) can call this API cross-origin. No credentials
  // (this app authenticates via a Bearer sessionToken, never cookies), so
  // there's no cross-origin credential-leak risk to configure around.
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
