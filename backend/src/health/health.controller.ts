import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  /**
   * The release this process was built from — `v0.1.3`, or `dev` for a
   * local build. Added 2026-08-09 alongside the auto-versioning change so
   * it is always possible to ask a *running* pod what it actually is,
   * rather than inferring it from whichever image tag someone believes was
   * deployed.
   *
   * That distinction is not academic here: this project has already had a
   * live incident where production ran an image built for the internal
   * test cluster (see CLAUDE.md's environment-parity section), which no
   * amount of reading CI logs would have revealed. A version the pod
   * reports about itself is the check that would have caught it.
   */
  version: string;
}

// Liveness check only — no DB/Redis calls here on purpose. This confirms the
// API process is up; it does not (yet) confirm Postgres/Redis connectivity,
// since the API doesn't talk to either datastore until Phase 1.
//
// Deliberately unauthenticated, and deliberately carries nothing but these
// two fields: the version is not a secret (it is a public git tag and a
// public image tag), but nothing else about the environment belongs on an
// open endpoint.
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthResponse {
    // Read from the environment rather than package.json: the value is
    // stamped by the image build (Dockerfile's APP_VERSION arg), so it
    // describes the artifact actually running, which a version committed
    // in a file cannot.
    return { status: 'ok', version: process.env.APP_VERSION ?? 'dev' };
  }
}
