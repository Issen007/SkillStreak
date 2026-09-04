/**
 * GDPR Article 8's digital-consent age, which is **not one number**.
 *
 * Article 8(1) sets 16 and then lets each member state lower it to no
 * less than 13. Most did, by different amounts, so the age at which a
 * child may consent for themselves to an information society service —
 * this app — depends on where they are, not on what language they read.
 *
 * **This is why locale cannot answer it.** `PlayerLocale` deliberately
 * carries no region subtag (see its own comment, and ADR-0014 Decision
 * 5): `de` spans Germany at 16, Austria at 14, and Switzerland, which is
 * outside the GDPR entirely; `fr` spans France at 15 and Belgium at 13.
 * Reading a jurisdiction out of a language is guessing, and guessing low
 * means a 14-year-old in Munich self-consenting where German law requires
 * a parent.
 *
 * Until 2026-09-04 this app applied Sweden's 13 to every account in every
 * locale. That was correct for the Swedish beta it was written for and
 * became wrong the moment the app shipped nine locales.
 *
 * **These ages are a legal parameter, not a fact about the code.** They
 * were current as of this file's writing and are the kind of thing that
 * changes by national amendment without warning. Confirm them with
 * counsel before launch in any market, and treat a mismatch here as this
 * table being stale rather than as the law being wrong.
 */

/**
 * ISO 3166-1 alpha-2, limited to countries this app plausibly serves.
 *
 * Deliberately a fixed enum rather than a free string, for the same
 * reason `PlayerLocale` is: an unrecognised value must be a compile
 * error, not a silent fall-through to whatever default sits below.
 */
export enum Jurisdiction {
  SE = 'SE',
  NO = 'NO',
  DK = 'DK',
  FI = 'FI',
  IS = 'IS',
  DE = 'DE',
  AT = 'AT',
  CH = 'CH',
  CZ = 'CZ',
  FR = 'FR',
  BE = 'BE',
  ES = 'ES',
  NL = 'NL',
  PL = 'PL',
  IE = 'IE',
  GB = 'GB',
}

/**
 * The strictest age the GDPR permits, and this app's answer whenever it
 * does not know better.
 *
 * Unknown must fail toward *more* protection, never less — the same
 * posture ADR-0030 Decision 11 takes with the sharing allow-list, where
 * an empty list means nobody rather than everybody. A missing
 * jurisdiction here asks for a parent; it never lets a child through.
 */
export const STRICTEST_ARTICLE_8_AGE = 16;

/**
 * Each country's Article 8(1) derogation.
 *
 * Switzerland is in this table at 16 and is a deliberate special case: it
 * is not an EU/EEA state and the GDPR's Article 8 does not apply to it at
 * all. Its Federal Act on Data Protection has no fixed age and turns on
 * the child's capacity to judge, which is not a rule this app can encode.
 * 16 is therefore not Switzerland's law being stated — it is this app
 * declining to guess, in the safe direction.
 */
const ARTICLE_8_AGE: Record<Jurisdiction, number> = {
  [Jurisdiction.SE]: 13,
  [Jurisdiction.NO]: 13,
  [Jurisdiction.DK]: 13,
  [Jurisdiction.FI]: 13,
  [Jurisdiction.IS]: 13,
  [Jurisdiction.BE]: 13,
  [Jurisdiction.GB]: 13,
  [Jurisdiction.AT]: 14,
  [Jurisdiction.ES]: 14,
  [Jurisdiction.CZ]: 15,
  [Jurisdiction.FR]: 15,
  [Jurisdiction.DE]: 16,
  [Jurisdiction.NL]: 16,
  [Jurisdiction.PL]: 16,
  [Jurisdiction.IE]: 16,
  [Jurisdiction.CH]: STRICTEST_ARTICLE_8_AGE,
};

/**
 * The self-consent age for a jurisdiction, or the strictest age when it
 * is unknown.
 *
 * `null`/`undefined` is an expected input, not a caller's mistake: a team
 * created before this column existed has no jurisdiction until someone
 * sets one, and that account must still be able to onboard — just via a
 * parent rather than by self-consenting.
 */
export function article8AgeFor(
  jurisdiction: Jurisdiction | null | undefined,
): number {
  if (!jurisdiction) return STRICTEST_ARTICLE_8_AGE;
  return ARTICLE_8_AGE[jurisdiction] ?? STRICTEST_ARTICLE_8_AGE;
}
