import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Which teams may use public sharing at all.
 *
 * **An allow-list rather than a boolean, and the reason is that a
 * server-side flag cannot tell a TestFlight tester from a real family.**
 * TestFlight builds use the `production` EAS profile, which points at the
 * same `api.skillstreak.xyz` that serves the live beta — so "on for
 * testing" and "on for everyone" would have been the same switch.
 *
 * That matters more than usual here. ADR-0030's interim posture makes the
 * monthly reminder the design's only recurring control. A handful of
 * known families is exactly the scale at which that trade was argued to
 * be defensible — Decision 9 says so in as many words — so the
 * allow-list is not merely a test harness, it is the honest boundary of
 * that argument.
 *
 * **Finding 4 closed 2026-08-19** (Decision 12: a bounce mailbox parsed
 * for DSNs), so the reminder can now actually detect an undeliverable
 * address and Decision 5's disable can fire. That removes one of the two
 * reasons this list is narrow; Decision 9's own "small scale" argument
 * is the other, and it is untouched.
 *
 * Empty or unset means **nobody**, deliberately. A misconfigured
 * deployment must not silently open child media to everyone; the failure
 * direction is the whole point of the setting existing.
 *
 * Widening later is one env var in the production ConfigMap. Removing the
 * gate entirely should wait for Decision 9's review (due 2026-09-16) —
 * and note that the disable it relies on only works while the bounce
 * mailbox is actually configured.
 */
@Injectable()
export class PublicSharingAccessService {
  private readonly logger = new Logger(PublicSharingAccessService.name);
  private readonly allowed: ReadonlySet<string>;

  constructor(configService: ConfigService) {
    const raw =
      configService.get<string>('PUBLIC_SHARING_ENABLED_TEAM_IDS') ?? '';
    this.allowed = new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );

    // Logged at boot so "why can nobody share?" is answerable from the
    // pod's own output rather than by reading a ConfigMap. Team ids are
    // not personal data — they identify a team, not a child — but the
    // count is logged rather than the list to keep the line short.
    this.logger.log(
      this.allowed.size === 0
        ? 'Public sharing is disabled: PUBLIC_SHARING_ENABLED_TEAM_IDS is empty.'
        : `Public sharing enabled for ${this.allowed.size} team(s).`,
    );
  }

  /**
   * Deliberately takes the team id rather than the player id: the unit
   * being rolled out to is a team, and a caller that has to fetch the
   * player's team first cannot accidentally check the wrong thing.
   */
  isEnabledForTeam(teamId: string | null | undefined): boolean {
    if (!teamId) return false;
    return this.allowed.has(teamId);
  }
}
