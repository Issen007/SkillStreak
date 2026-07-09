// Shared by every mail template that interpolates user/child-authored
// values into HTML (screen names, team names, chat message content, etc.)
// — extracted out of consent-request-email.template.ts (which used to keep
// its own private copy) so a second template doesn't reintroduce a
// second, possibly-drifting copy of the same escaping logic.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
