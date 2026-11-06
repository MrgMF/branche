// Langues de l'appareil : expo-localization en natif, navigator.languages sur le web.
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import { pickLang, type Lang } from './index';

export function deviceTags(): string[] {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const l = navigator.languages?.length ? navigator.languages : [navigator.language];
    return l.filter(Boolean) as string[];
  }
  try {
    return getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

export function deviceLang(): { lang: Lang; tag: string } {
  return pickLang(deviceTags());
}
