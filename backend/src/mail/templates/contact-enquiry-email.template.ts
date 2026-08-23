import { escapeHtml } from './html-escape.util';

/**
 * The sponsorship enquiry, forwarded to whoever CONTACT_RECIPIENT_EMAIL
 * names.
 *
 * **Not localised, and that is the one deliberate difference from every
 * other template in this directory.** The others are addressed to a
 * player or a parent, so ADR-0014 Decision 3's per-locale COPY table
 * applies. This one is addressed to the project owner, who reads it in
 * one language whatever language the sender wrote in. Adding eight
 * unused translations of "New sponsorship enquiry" would be work that
 * nobody ever sees.
 *
 * Every interpolated value is attacker-controlled — an unauthenticated
 * stranger typed all of it — so every one goes through `escapeHtml`, and
 * the sender's address appears as text rather than as a `mailto:` link.
 * A link would make one click enough to act on a forged identity.
 */
export interface ContactEnquiryEmailInput {
  name: string;
  email: string;
  organisation?: string;
  message: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderContactEnquiryEmail(
  input: ContactEnquiryEmailInput,
): RenderedEmail {
  const org = input.organisation?.trim();
  const subject = `SkillStreak — sponsorship enquiry from ${
    org ? `${input.name} (${org})` : input.name
  }`;

  const lines = [
    `Name: ${input.name}`,
    ...(org ? [`Organisation: ${org}`] : []),
    `Email: ${input.email}`,
    '',
    input.message,
    '',
    '--',
    'Sent from the contact form on skillstreak.xyz. The sender is not',
    'authenticated and nothing here has been verified — reply only to an',
    'address you have checked.',
  ];

  const html = [
    '<p><strong>New sponsorship enquiry</strong></p>',
    `<p>Name: ${escapeHtml(input.name)}<br>`,
    ...(org ? [`Organisation: ${escapeHtml(org)}<br>`] : []),
    `Email: ${escapeHtml(input.email)}</p>`,
    `<p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
    '<hr>',
    '<p style="color:#666;font-size:13px">Sent from the contact form on ',
    'skillstreak.xyz. The sender is not authenticated and nothing here ',
    'has been verified — reply only to an address you have checked.</p>',
  ].join('');

  return { subject, html, text: lines.join('\n') };
}
