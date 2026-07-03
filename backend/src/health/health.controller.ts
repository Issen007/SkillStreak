import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
}

// Liveness check only — no DB/Redis calls here on purpose. This confirms the
// API process is up; it does not (yet) confirm Postgres/Redis connectivity,
// since the API doesn't talk to either datastore until Phase 1.
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
