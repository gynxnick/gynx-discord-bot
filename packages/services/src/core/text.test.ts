import { describe, expect, it } from 'vitest';
import {
  defineTexts,
  interpolate,
  listTextDefinitions,
  runWithTextOverrides,
  validateOverride,
  type RegisteredText,
} from './text';
import { CoreText } from './texts';

const T = defineTexts('unittest', {
  greet: { default: 'Hi {user}!', help: 'test', vars: ['user'], kind: 'short' },
  button: { default: 'Click', help: 'test', kind: 'label' },
});
const def = (key: string): RegisteredText => listTextDefinitions().find((d) => d.key === key)!;

describe('defineTexts', () => {
  it('registers keys under the namespace and uses the default outside a scope', () => {
    expect(T.greet({ user: 'Nick' })).toBe('Hi Nick!');
    expect(def('unittest.greet')).toMatchObject({ namespace: 'unittest', vars: ['user'], max: 100 });
  });

  it('rejects defaults with undeclared placeholders (catches typos at startup)', () => {
    expect(() =>
      defineTexts('unittest-bad', { x: { default: 'Hi {usr}', help: 't', vars: ['user'] } }),
    ).toThrow(/undeclared placeholder/);
  });

  it('rejects a key defined twice with different defaults', () => {
    expect(() => defineTexts('unittest', { greet: { default: 'Other', help: 't' } })).toThrow(
      /defined twice/,
    );
  });
});

describe('overrides', () => {
  it('apply inside a scope and fall back to defaults outside', () => {
    expect(
      runWithTextOverrides({ 'unittest.greet': 'Welcome, {user}.' }, () => T.greet({ user: 'Ana' })),
    ).toBe('Welcome, Ana.');
    expect(T.greet({ user: 'Ana' })).toBe('Hi Ana!');
  });

  it('interpolation leaves unknown placeholders visible instead of crashing', () => {
    expect(interpolate('Hi {user} {missing}', { user: 'x' })).toBe('Hi x {missing}');
  });

  it('core texts are editable too', () => {
    expect(runWithTextOverrides({ 'core.errorTitle': 'Oops' }, () => CoreText.errorTitle())).toBe('Oops');
  });
});

describe('validateOverride', () => {
  it('accepts allowed placeholders and trims', () => {
    expect(validateOverride(def('unittest.greet'), '  Hey {user}  ')).toBe('Hey {user}');
  });

  it('rejects unknown placeholders with a helpful message', () => {
    expect(() => validateOverride(def('unittest.greet'), 'Hey {name}')).toThrow(
      /Unknown placeholder \{name\}.*\{user\}/,
    );
  });

  it('enforces Discord length limits and single-line labels', () => {
    expect(() => validateOverride(def('unittest.button'), 'x'.repeat(81))).toThrow(/Too long/);
    expect(() => validateOverride(def('unittest.button'), 'two\nlines')).toThrow(/single line/);
  });

  it('rejects empty text (use reset instead)', () => {
    expect(() => validateOverride(def('unittest.button'), '   ')).toThrow(/empty/);
  });
});
