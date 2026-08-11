import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { DrillLibraryService } from '../drills/drill-library.service';

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
  /**
   * How many drill files this process actually loaded (ADR-0029).
   *
   * The endpoint's own comment below says nothing about the *environment*
   * belongs here, and this does not contravene it: like `version`, this is
   * a fact about the ARTIFACT rather than about the deployment. The
   * library ships inside the image, and `backend/.dockerignore` excludes
   * `*.md` — so "did this build actually carry the drills" is precisely
   * the question a running pod should be able to answer, and precisely the
   * one that would otherwise surface as an empty shelf with a green CI.
   *
   * A count of adult-authored training files discloses nothing: no child
   * data, no environment detail, no configuration.
   */
  drills: number;
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
  constructor(private readonly drillLibraryService: DrillLibraryService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthResponse {
    // Read from the environment rather than package.json: the value is
    // stamped by the image build (Dockerfile's APP_VERSION arg), so it
    // describes the artifact actually running, which a version committed
    // in a file cannot.
    return {
      status: 'ok',
      version: process.env.APP_VERSION ?? 'dev',
      drills: this.drillLibraryService.list().length,
    };
  }
}
