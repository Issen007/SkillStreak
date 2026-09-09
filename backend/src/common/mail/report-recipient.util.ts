import { Logger } from '@nestjs/common';

// k8s/secret.yaml.example's fill-me-in marker, shared by every key in that
// file. See below for why this specific string has to be rejected.
const SECRET_TEMPLATE_PLACEHOLDER = 'CHANGE_ME';

// One address only: no comma/semicolon/whitespace anywhere, one `@`, and a
// dotted domain. Deliberately coarse — see below.
const SINGLE_EMAIL_ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Resolves the single address an internal, operator-facing scheduled
 * report may be sent to — or `null`, in which case the caller should
 * no-op rather than throw. A reporting job must never take the API down.
 *
 * Extracted from UsageMetricsReportService (ADR-0020 Decision 5), whose
 * code-critic/security-reviewer pass found all three rejections below.
 * It lives here because ADR-0037's weekly suggestion digest needs exactly
 * the same three, and a second hand-rolled copy is how two jobs end up
 * disagreeing about what "configured" means:
 *
 * 1. **Empty string**, treated exactly like unset: a k8s Secret key
 *    created from an unset GitHub Actions secret arrives as '' (see
 *    config/env.validation.spec.ts for the boot crash this same behaviour
 *    caused elsewhere), and so does docker-compose's `${VAR:-}`.
 * 2. **The literal placeholder** from k8s/secret.yaml.example. That file
 *    is copied by hand to create the internal cluster's real Secret, so
 *    "left at CHANGE_ME" is a genuinely likely live state — and
 *    `CHANGE_ME` is truthy, so without this the job would compute a full
 *    report over real child-derived data and hand it to the SMTP relay
 *    addressed to nobody.
 * 3. **Anything that isn't exactly one address.** nodemailer treats `to`
 *    as a LIST, so a hand-typed "a@x.com, b@y.com" would silently fan an
 *    internal report out to several mailboxes, with nothing in the logs
 *    to notice. The check is a plausibility check (one `@`, a dot in the
 *    domain, no separators/whitespace), not RFC 5321 validation: the only
 *    real question here is "is this one address", and anything stricter
 *    would start rejecting valid addresses.
 */
export function resolveSingleReportRecipient(options: {
  /** Raw config value, exactly as ConfigService returned it. */
  value: string | undefined;
  /** The env var's name, so a warning says which knob to go and fix. */
  envVarName: string;
  /** The caller's own logger, so the warning is attributed to the job. */
  logger: Logger;
}): string | null {
  const { envVarName, logger } = options;
  const raw = options.value?.trim();
  if (!raw) return null;

  if (raw === SECRET_TEMPLATE_PLACEHOLDER) {
    logger.warn(
      `${envVarName} is still the ${SECRET_TEMPLATE_PLACEHOLDER} placeholder from k8s/secret.yaml.example — treating it as unset and sending nothing.`,
    );
    return null;
  }

  if (!SINGLE_EMAIL_ADDRESS.test(raw)) {
    logger.warn(
      `${envVarName} is not a single email address (this report goes to exactly one recipient) — treating it as unset and sending nothing.`,
    );
    return null;
  }

  return raw;
}
