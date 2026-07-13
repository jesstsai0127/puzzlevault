export type LocaleCode = 'en' | 'zh-TW';

export type LocaleDict = Record<string, string>;

export const DEFAULT_LOCALE: LocaleCode = 'en';

/**
 * Minimal key-lookup i18n. All game/content text is referenced by key
 * (e.g. 'skill.flying_sword.name'), never hardcoded — this lets content packs
 * (characters, skills, monsters, maps) stay language-agnostic and lets a
 * locale be added later (zh-TW) without touching any content file.
 */
export class I18n {
  private active: LocaleDict;
  private fallback: LocaleDict;

  constructor(fallback: LocaleDict, active: LocaleDict = fallback) {
    this.fallback = fallback;
    this.active = active;
  }

  setActive(dict: LocaleDict): void {
    this.active = dict;
  }

  /** Looks up `key` in the active locale; falls back to the base locale, then to the key itself. */
  t(key: string): string {
    return this.active[key] ?? this.fallback[key] ?? key;
  }

  /** Keys present in fallback but missing from `dict` — use to spot incomplete translations. */
  missingKeys(dict: LocaleDict): string[] {
    return Object.keys(this.fallback).filter((k) => !(k in dict));
  }
}
