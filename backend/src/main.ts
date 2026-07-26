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
  // a wildcard. This applies app-wide (NestJS's enableCors isn't
  // per-route), not literally scoped to just GET /teams/invite and
  // POST /players — the two endpoints this exists for. In practice every
  // other, auth-gated route stays cross-origin-unreadable anyway, because
  // allowedHeaders excludes Authorization: a cross-origin fetch() can't
  // attach the Bearer sessionToken this app's auth relies on, so its
  // preflight fails before the request ever carries credentials. That's
  // today's safety net, not a designed guarantee — if a future
  // unauthenticated GET/POST endpoint is added, it inherits cross-origin
  // readability from this same block without a new decision being made.
  // No credentials mode (this app authenticates via a Bearer
  // sessionToken, never cookies), so there's no cross-origin
  // credential-leak risk to configure around either way.
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
