import { EventRegistrationLocale } from '../../event-registrations/entities/event-registration.entity';
import { renderSignupConfirmationEmail } from './event-demo-emails.template';

/**
 * The confirmation must promise only what the person asked for.
 *
 * Until the form grew a second box this was trivially true — everyone who
 * filled it in was signing up for the demo. Afterwards, someone who ticked
 * only "release news" received "Thanks — you are signed up for the
 * SkillStreak demo" and a promise of a Meet link nobody would ever send
 * them. That is the kind of wrong that reads as carelessness to the exact
 * people the list exists to keep warm.
 */
const meetPromise = /Meet|visningen|demo/i;

describe('the signup confirmation', () => {
  it('does not promise a demo to someone who only wanted release news', () => {
    const mail = renderSignupConfirmationEmail({
      locale: EventRegistrationLocale.EN,
      unsubscribeUrl: 'https://api.example.test/unsub/abc',
      wantsDemoInvite: false,
      wantsReleaseUpdates: true,
    });

    expect(mail.subject).not.toMatch(meetPromise);
    expect(mail.text).not.toMatch(/Meet link/i);
    expect(mail.text).toMatch(/when the app is available/i);
  });

  it('still promises the demo to someone who asked for it', () => {
    const mail = renderSignupConfirmationEmail({
      locale: EventRegistrationLocale.EN,
      unsubscribeUrl: 'https://api.example.test/unsub/abc',
      wantsDemoInvite: true,
      wantsReleaseUpdates: false,
    });

    expect(mail.subject).toMatch(/demo/i);
    expect(mail.text).toMatch(/Meet link/i);
  });

  it('mentions both when both were asked for, without repeating itself', () => {
    const mail = renderSignupConfirmationEmail({
      locale: EventRegistrationLocale.SV,
      unsubscribeUrl: 'https://api.example.test/unsub/abc',
      wantsDemoInvite: true,
      wantsReleaseUpdates: true,
    });

    expect(mail.text).toMatch(/Meet-länken/);
    expect(mail.text).toMatch(/appen finns att hämta/);
    // The demo paragraph exactly once, not once per box ticked.
    expect(mail.text.match(/Meet-länken/g)).toHaveLength(1);
  });

  it('carries the unsubscribe link in every variant', () => {
    for (const [demo, releases] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const mail = renderSignupConfirmationEmail({
        locale: EventRegistrationLocale.EN,
        unsubscribeUrl: 'https://api.example.test/unsub/abc',
        wantsDemoInvite: demo,
        wantsReleaseUpdates: releases,
      });
      expect(mail.text).toContain('https://api.example.test/unsub/abc');
      expect(mail.html).toContain('https://api.example.test/unsub/abc');
    }
  });
});
