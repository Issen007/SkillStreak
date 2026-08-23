import { renderContactEnquiryEmail } from './contact-enquiry-email.template';

describe('renderContactEnquiryEmail', () => {
  // Every value here was typed by an unauthenticated stranger. This is
  // the only template in the directory whose entire input is hostile by
  // default, so the escaping is the thing worth testing.
  it('escapes markup in every field a sender controls', () => {
    const rendered = renderContactEnquiryEmail({
      name: '<script>alert(1)</script>',
      email: 'a@b.example',
      organisation: '<img src=x onerror=alert(1)>',
      message: 'Hello <b>there</b> & goodbye',
    });

    // Asserting on `onerror=` would be the wrong test and it failed as
    // one: that substring survives escaping and is *supposed* to, because
    // it is now inert text inside `&lt;img src=x onerror=...&gt;` with no
    // tag around it. What actually matters is that no attacker-supplied
    // `<` reaches the output as a tag delimiter.
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.html).toContain('&amp;');

    // The plain-text part carries no markup semantics at all, so it is
    // left unescaped by design — assert that, rather than leaving a
    // reader to wonder whether it was forgotten.
    expect(rendered.text).toContain('<script>alert(1)</script>');
  });

  it('keeps the sender address as text, never as a mailto link', () => {
    // One click on a forged identity is one click too few.
    const rendered = renderContactEnquiryEmail({
      name: 'Anna',
      email: 'anna@example.com',
      message: 'Hello there, we would like to talk.',
    });

    expect(rendered.html).toContain('anna@example.com');
    expect(rendered.html).not.toContain('mailto:');
  });

  it('names the organisation in the subject when there is one', () => {
    expect(
      renderContactEnquiryEmail({
        name: 'Anna',
        email: 'a@b.example',
        organisation: 'Safespring',
        message: 'Hello there, we would like to talk.',
      }).subject,
    ).toContain('Anna (Safespring)');
  });

  it('omits the organisation cleanly when there is not', () => {
    const rendered = renderContactEnquiryEmail({
      name: 'Anna',
      email: 'a@b.example',
      message: 'Hello there, we would like to talk.',
    });

    expect(rendered.subject).toBe(
      'SkillStreak — sponsorship enquiry from Anna',
    );
    expect(rendered.text).not.toContain('Organisation:');
  });
});
