import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Rejects writes to the public counters that did not come from one of
 * this project's own site origins.
 *
 * ## What it stops, and what it does not
 *
 * **Stops:** a third-party page firing these requests from its visitors'
 * browsers. That is a real path — a form-encoded `POST` is CORS-safelisted
 * and needs no preflight, so CORS itself provides no protection here at
 * all, only a hidden response. A browser always sends `Origin` on a
 * cross-origin POST, so an allow-list is the control that CORS is not.
 *
 * **Does not stop:** `curl`, or anything else that simply omits or forges
 * the header. `Origin` is only trustworthy because *browsers* set it and
 * pages cannot override it — it says nothing about a non-browser client.
 * Treating this as anti-abuse rather than as a boundary would be reading
 * more into it than it can carry.
 *
 * A missing `Origin` is therefore allowed. `sendBeacon` sets one, and so
 * does every cross-origin `fetch`; refusing requests without it would
 * reject nothing a browser sends while breaking `curl`-based smoke tests
 * and any future server-side caller, in exchange for no security at all.
 *
 * Falls open when `CORS_ORIGIN` is unset, which is the local-development
 * case — the same posture `main.ts` already takes for CORS itself, so
 * there is one switch rather than two that can disagree.
 */
@Injectable()
export class SiteOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.configService.get<string>('CORS_ORIGIN');
    if (!configured) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (!origin) return true;

    const allowed = configured.split(',').map((o) => o.trim());
    return allowed.includes(origin);
  }
}
