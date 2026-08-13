import { renderPtConsentReviewPage } from './pt-consent-page.templates';

/**
 * The parental-consent approval flow was broken in production for every
 * parent who used it: the forms carried `action="approve"`, a RELATIVE
 * url, and the page is served at `/api/v1/pt-consent/:reviewCode` with no
 * trailing slash — so browsers resolved it to
 * `/api/v1/pt-consent/approve` and the API answered
 * `Cannot POST /api/v1/pt-consent/approve`.
 *
 * Reported by the project owner clicking the button in a real email.
 * Nothing in this repository would have caught it: there were no tests on
 * this file, and the route and the template were each correct in
 * isolation.
 */
describe('renderPtConsentReviewPage', () => {
  const input = {
    screenName: 'FloorballStar15',
    ptDisplayName: 'Anna Svensson',
    ptEmail: 'anna@example.com',
    reviewCode: 'ABC123XY',
  };

  it('posts approve to the full path, including the review code', () => {
    expect(renderPtConsentReviewPage(input)).toContain(
      'action="/api/v1/pt-consent/ABC123XY/approve"',
    );
  });

  it('posts decline to the full path too', () => {
    expect(renderPtConsentReviewPage(input)).toContain(
      'action="/api/v1/pt-consent/ABC123XY/decline"',
    );
  });

  it('never emits a relative form action', () => {
    // The actual defect, stated as a rule: a relative action depends on
    // whether the URL happened to carry a trailing slash, which nobody
    // controls. Any action here must start with "/".
    const html = renderPtConsentReviewPage(input);
    for (const match of html.matchAll(/action="([^"]*)"/g)) {
      expect(match[1].startsWith('/')).toBe(true);
    }
  });

  it('url-encodes a review code so it cannot break out of the path', () => {
    const html = renderPtConsentReviewPage({
      ...input,
      reviewCode: 'a/b?c=d',
    });
    expect(html).toContain('action="/api/v1/pt-consent/a%2Fb%3Fc%3Dd/approve"');
    expect(html).not.toContain('action="/api/v1/pt-consent/a/b?c=d/approve"');
  });

  it('escapes the screen name and trainer identity', () => {
    // A screen name is child-chosen free text and reaches this page
    // unfiltered otherwise.
    const html = renderPtConsentReviewPage({
      ...input,
      screenName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still states what the trainer will and will not see', () => {
    // The informed-consent copy is the point of the page; a refactor that
    // fixed the form and lost this would be a worse bug than the 404.
    const html = renderPtConsentReviewPage(input);
    expect(html).toContain('Om du godkänner ser den här personen');
    expect(html).toContain('Den här personen ser ALDRIG');
    expect(html).toContain('FloorballStar15');
  });
});
