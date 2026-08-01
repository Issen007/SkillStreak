import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { buildConsentRequestEmail } from './consent-request-email.template';

// docs/adr/0014-multi-language-support.md Consequences — "code-critic
// should confirm at least one template has a test exercising the
// sv-fallback path (calling it with a locale that has no COPY entry yet)
// before this merges." This was originally written against `en` (part (a)
// shipped architecture only, no content, so `en` had no COPY entry and
// fell back to `sv`).
//
// Updated as part of part (b) (this session): every real PlayerLocale enum
// value (sv/en/fi/da/nb/de/cs/fr) now has a real, translated COPY entry in
// consent-request-email.template.ts, so there's no longer an
// enum-legitimate value left to exercise the fallback with. Restructured
// to exercise `resolveCopy`/`COPY[locale] ?? COPY.sv!` directly with a
// deliberately fake locale value (cast past the type system) instead —
// this still matters: a future 9th locale added to the enum ahead of its
// translated content shipping must behave identically, and this test
// keeps proving that regardless of which real locales happen to be
// populated at any given time.
describe('buildConsentRequestEmail — sv-fallback', () => {
  const baseInput = {
    screenName: 'FloorballStar15',
    teamName: 'IBK Testarna',
    consentUrl: 'https://example.test/api/v1/consent/abc123',
  };
  // Not a real PlayerLocale value — every real one is translated now.
  // Cast past the type system to simulate a locale the `COPY` map has no
  // entry for, the way a real not-yet-translated (or not-yet-added) locale
  // would look to `resolveCopy`.
  const fakeUntranslatedLocale = 'xx' as PlayerLocale;

  it('renders byte-identical output for a locale with no COPY entry and sv', () => {
    const svEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: PlayerLocale.SV,
    });
    const untranslatedEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: fakeUntranslatedLocale,
    });

    expect(untranslatedEmail).toEqual(svEmail);
  });

  it('never renders a blank/broken email for an untranslated locale', () => {
    const untranslatedEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: fakeUntranslatedLocale,
    });

    expect(untranslatedEmail.subject.length).toBeGreaterThan(0);
    expect(untranslatedEmail.text.length).toBeGreaterThan(0);
    expect(untranslatedEmail.html.length).toBeGreaterThan(0);
  });
});
