import { describe, expect, it } from 'vitest';
import { emailTaken, hasJoined, isValidEmail, normaliseEmail } from './people';

describe('hasJoined', () => {
  it('is true with an account and false while the person has not joined', () => {
    expect(hasJoined({ user_id: 'u1' })).toBe(true);
    expect(hasJoined({ user_id: null })).toBe(false);
  });
});

describe('normaliseEmail', () => {
  it('trims spaces, tabs and line breaks and lower-cases', () => {
    expect(normaliseEmail('  Shea.Smith@Gmail.COM \n')).toBe('shea.smith@gmail.com');
    expect(normaliseEmail('')).toBe('');
  });
});

describe('isValidEmail', () => {
  it('needs one @, no spaces and a dot in the domain', () => {
    expect(isValidEmail('shea@gmail.com')).toBe(true);
    expect(isValidEmail('a.b+c@mail.example.co.uk')).toBe(true);
    for (const bad of ['', 'shea', 'shea@', '@gmail.com', 'shea@gmail', 'she a@gmail.com', 'a@b@c.com']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it('allows at most 254 characters', () => {
    const at = (n: number) => `${'a'.repeat(n - '@example.com'.length)}@example.com`;
    expect(isValidEmail(at(254))).toBe(true);
    expect(isValidEmail(at(255))).toBe(false);
  });
});

describe('emailTaken', () => {
  const people = [
    { id: 'm1', email: 'stratis@gmail.com' },
    { id: 'm2', email: '' },
  ];
  it('compares case-insensitively and ignores blanks and the person themselves', () => {
    expect(emailTaken(people, ' Stratis@Gmail.com')).toBe(true);
    expect(emailTaken(people, 'stratis@gmail.com', 'm1')).toBe(false);
    expect(emailTaken(people, '')).toBe(false);
    expect(emailTaken(people, 'shea@gmail.com')).toBe(false);
  });
});
