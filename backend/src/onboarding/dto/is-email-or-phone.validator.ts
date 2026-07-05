import { registerDecorator, ValidationOptions, isEmail } from 'class-validator';

// Deliberately permissive per-field format check: this only exists to catch
// obviously-malformed input (e.g. "asdf") at the point a coach fat-fingers
// parentContact at practice — not to fully validate E.164 phone numbers or
// RFC-compliant emails. Rejecting slightly-unusual-but-real contact details
// would be worse than letting a few odd-but-plausible ones through, since
// this field gates whether the consent flow can ever reach a parent at all
// (see docs/adr/0002-data-model.md addendum §2).
//
// Accepts:
//  - anything class-validator's isEmail considers a valid email, or
//  - a "phone-shaped" string: digits, with optional leading "+", and
//    optional spaces/hyphens/parens/dots as separators, 7-15 digits total
//    (loosely bracketing real-world national/international phone lengths).
const PHONE_SHAPE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

function isPlausiblePhoneNumber(value: string): boolean {
  if (!PHONE_SHAPE_PATTERN.test(value)) {
    return false;
  }
  const digitCount = value.replace(/\D/g, '').length;
  return digitCount >= 7 && digitCount <= 15;
}

export function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') {
            return false;
          }
          const trimmed = value.trim();
          return isEmail(trimmed) || isPlausiblePhoneNumber(trimmed);
        },
        defaultMessage() {
          return 'parentContact must be a valid email address or phone number.';
        },
      },
    });
  };
}
