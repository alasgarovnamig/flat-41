import az from '../../messages/az.json';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';
import { createT, type Locale, type Messages } from './i18n';

const DICTS: Record<Locale, Messages> = { az: az as Messages, ru: ru as Messages, en: en as Messages };

export const getMessages = (locale: Locale): Messages => DICTS[locale] ?? DICTS.az;
/** Fallback dictionary for keys missing in a locale. */
export const FALLBACK_MESSAGES: Messages = DICTS.az;
export const getT = (locale: Locale) => createT(getMessages(locale), FALLBACK_MESSAGES);
