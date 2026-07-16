import { describe, expect, it } from 'vitest';
import { I18n } from '../core/i18n';
import en from '../locales/en.json';
import zhTW from '../locales/zh-TW.json';

describe('I18n', () => {
  it('resolves a key from the active locale', () => {
    const i18n = new I18n(en);
    expect(i18n.t('ui.end_turn')).toBe('End Turn');
  });

  it('falls back to the base locale when the active locale is missing a key', () => {
    const i18n = new I18n(en, { 'ui.end_turn': 'Fin du tour' });
    expect(i18n.t('ui.end_turn')).toBe('Fin du tour');
    expect(i18n.t('ui.undo')).toBe('Undo'); // missing in active -> fallback
  });

  it('returns the key itself when missing everywhere', () => {
    const i18n = new I18n(en);
    expect(i18n.t('ui.does_not_exist')).toBe('ui.does_not_exist');
  });

  it('missingKeys reports what an incomplete translation is missing', () => {
    const i18n = new I18n(en);
    const partial = { 'ui.end_turn': 'Fin du tour' };
    expect(i18n.missingKeys(partial)).toContain('ui.undo');
    expect(i18n.missingKeys(partial)).not.toContain('ui.end_turn');
  });
});

// The shipped locale files must stay key-synchronized in BOTH directions —
// a key present in only one file silently falls back (zh player sees English,
// or en player sees a raw key), and nothing else in the suite guards this:
// the I18n-class tests above only exercise the fallback mechanism itself.
describe('shipped locales', () => {
  it('zh-TW and en define exactly the same keys', () => {
    const enKeys = new Set(Object.keys(en));
    const zhKeys = new Set(Object.keys(zhTW));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(missingInZh).toEqual([]);
    expect(missingInEn).toEqual([]);
  });
});
