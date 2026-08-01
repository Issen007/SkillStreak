import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { buildConsentRequestEmail } from './consent-request-email.template';

// docs/adr/0014-multi-language-support.md Consequences — "code-critic
// should confirm at least one template has a test exercising the
// sv-fallback path (calling it with a locale that has no COPY entry yet)
// before this merges." This is that test: `en` has no real translation
// yet (part (a) ships architecture only, no content), so
// `resolveCopy`/`COPY[locale] ?? COPY.sv!` must silently render the exact
// same (Swedish) output as calling with `locale: 'sv'` directly — never a
// blank/broken email.
describe('buildConsentRequestEmail — sv-fallback', () => {
  const baseInput = {
    screenName: 'FloorballStar15',
    teamName: 'IBK Testarna',
    consentUrl: 'https://example.test/api/v1/consent/abc123',
  };

  it('renders byte-identical output for an untranslated locale (en) and sv', () => {
    const svEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: PlayerLocale.SV,
    });
    const enEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: PlayerLocale.EN,
    });

    expect(enEmail).toEqual(svEmail);
  });

  it('never renders a blank/broken email for an untranslated locale', () => {
    const enEmail = buildConsentRequestEmail({
      ...baseInput,
      locale: PlayerLocale.EN,
    });

    expect(enEmail.subject.length).toBeGreaterThan(0);
    expect(enEmail.text.length).toBeGreaterThan(0);
    expect(enEmail.html.length).toBeGreaterThan(0);
  });
});
