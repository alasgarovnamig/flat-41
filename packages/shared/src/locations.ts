import type { CountryCode, Locale } from './enums';

export type LocalizedName = Record<Locale, string>;

export interface Country { code: CountryCode; name: LocalizedName; currency: string; phonePrefix: string }
export interface City { id: string; country: CountryCode; name: LocalizedName; lat: number; lng: number; popular?: boolean }
export interface District { id: string; cityId: string; name: LocalizedName }
export interface MetroStation { id: string; cityId: string; line: 'red' | 'green' | 'purple'; name: LocalizedName; lat: number; lng: number }

const n = (az: string, en: string, ru: string): LocalizedName => ({ az, en, ru });

export const COUNTRIES: Country[] = [
  { code: 'AZ', name: n('Azərbaycan', 'Azerbaijan', 'Азербайджан'), currency: 'AZN', phonePrefix: '+994' },
  { code: 'GE', name: n('Gürcüstan', 'Georgia', 'Грузия'), currency: 'GEL', phonePrefix: '+995' },
];

export const CITIES: City[] = [
  // Azerbaijan
  { id: 'baku', country: 'AZ', name: n('Bakı', 'Baku', 'Баку'), lat: 40.4093, lng: 49.8671, popular: true },
  { id: 'sumgait', country: 'AZ', name: n('Sumqayıt', 'Sumgait', 'Сумгаит'), lat: 40.5897, lng: 49.6686, popular: true },
  { id: 'khirdalan', country: 'AZ', name: n('Xırdalan', 'Khirdalan', 'Хырдалан'), lat: 40.448, lng: 49.7553, popular: true },
  { id: 'ganja', country: 'AZ', name: n('Gəncə', 'Ganja', 'Гянджа'), lat: 40.6828, lng: 46.3606, popular: true },
  { id: 'absheron', country: 'AZ', name: n('Abşeron', 'Absheron', 'Апшерон'), lat: 40.4728, lng: 49.6233 },
  { id: 'mingachevir', country: 'AZ', name: n('Mingəçevir', 'Mingachevir', 'Мингечевир'), lat: 40.7703, lng: 47.0496 },
  { id: 'lankaran', country: 'AZ', name: n('Lənkəran', 'Lankaran', 'Ленкорань'), lat: 38.7529, lng: 48.8475 },
  { id: 'shaki', country: 'AZ', name: n('Şəki', 'Shaki', 'Шеки'), lat: 41.1919, lng: 47.1706 },
  { id: 'gabala', country: 'AZ', name: n('Qəbələ', 'Gabala', 'Габала'), lat: 40.9982, lng: 47.8468, popular: true },
  { id: 'guba', country: 'AZ', name: n('Quba', 'Guba', 'Губа'), lat: 41.3611, lng: 48.5126 },
  { id: 'gusar', country: 'AZ', name: n('Qusar', 'Gusar', 'Гусар'), lat: 41.4275, lng: 48.4302 },
  { id: 'shamakhi', country: 'AZ', name: n('Şamaxı', 'Shamakhi', 'Шемаха'), lat: 40.6314, lng: 48.6364 },
  { id: 'nakhchivan', country: 'AZ', name: n('Naxçıvan', 'Nakhchivan', 'Нахичевань'), lat: 39.2089, lng: 45.4122 },
  { id: 'shirvan', country: 'AZ', name: n('Şirvan', 'Shirvan', 'Ширван'), lat: 39.9317, lng: 48.9203 },
  { id: 'masalli', country: 'AZ', name: n('Masallı', 'Masalli', 'Масаллы'), lat: 39.0341, lng: 48.6654 },
  { id: 'nabran', country: 'AZ', name: n('Nabran', 'Nabran', 'Набрань'), lat: 41.8003, lng: 48.6153 },
  // Georgia (expansion market)
  { id: 'tbilisi', country: 'GE', name: n('Tbilisi', 'Tbilisi', 'Тбилиси'), lat: 41.7151, lng: 44.8271, popular: true },
  { id: 'batumi', country: 'GE', name: n('Batumi', 'Batumi', 'Батуми'), lat: 41.6168, lng: 41.6367, popular: true },
  { id: 'kutaisi', country: 'GE', name: n('Kutaisi', 'Kutaisi', 'Кутаиси'), lat: 42.2679, lng: 42.6946 },
  { id: 'rustavi', country: 'GE', name: n('Rustavi', 'Rustavi', 'Рустави'), lat: 41.5495, lng: 44.9934 },
  { id: 'gudauri', country: 'GE', name: n('Qudauri', 'Gudauri', 'Гудаури'), lat: 42.4775, lng: 44.4789 },
  { id: 'bakuriani', country: 'GE', name: n('Bakuriani', 'Bakuriani', 'Бакуриани'), lat: 41.7497, lng: 43.5326 },
  { id: 'kobuleti', country: 'GE', name: n('Kobuleti', 'Kobuleti', 'Кобулети'), lat: 41.8206, lng: 41.7756 },
];

export const DISTRICTS: District[] = [
  // Baku raions
  { id: 'baku-binagadi', cityId: 'baku', name: n('Binəqədi r.', 'Binagadi', 'Бинагадинский р.') },
  { id: 'baku-garadagh', cityId: 'baku', name: n('Qaradağ r.', 'Garadagh', 'Гарадагский р.') },
  { id: 'baku-khatai', cityId: 'baku', name: n('Xətai r.', 'Khatai', 'Хатаинский р.') },
  { id: 'baku-khazar', cityId: 'baku', name: n('Xəzər r.', 'Khazar', 'Хазарский р.') },
  { id: 'baku-narimanov', cityId: 'baku', name: n('Nərimanov r.', 'Narimanov', 'Наримановский р.') },
  { id: 'baku-nasimi', cityId: 'baku', name: n('Nəsimi r.', 'Nasimi', 'Насиминский р.') },
  { id: 'baku-nizami', cityId: 'baku', name: n('Nizami r.', 'Nizami', 'Низаминский р.') },
  { id: 'baku-pirallahi', cityId: 'baku', name: n('Pirallahı r.', 'Pirallahi', 'Пираллахинский р.') },
  { id: 'baku-sabunchu', cityId: 'baku', name: n('Sabunçu r.', 'Sabunchu', 'Сабунчинский р.') },
  { id: 'baku-sabail', cityId: 'baku', name: n('Səbail r.', 'Sabail', 'Сабаильский р.') },
  { id: 'baku-surakhani', cityId: 'baku', name: n('Suraxanı r.', 'Surakhani', 'Сураханский р.') },
  { id: 'baku-yasamal', cityId: 'baku', name: n('Yasamal r.', 'Yasamal', 'Ясамальский р.') },
  // Sumgait
  { id: 'sumgait-center', cityId: 'sumgait', name: n('Mərkəz', 'Center', 'Центр') },
  { id: 'sumgait-corat', cityId: 'sumgait', name: n('Corat', 'Jorat', 'Джорат') },
  // Ganja
  { id: 'ganja-kapaz', cityId: 'ganja', name: n('Kəpəz r.', 'Kapaz', 'Кяпазский р.') },
  { id: 'ganja-nizami', cityId: 'ganja', name: n('Nizami r.', 'Nizami', 'Низаминский р.') },
  // Tbilisi
  { id: 'tbilisi-vake', cityId: 'tbilisi', name: n('Vake', 'Vake', 'Ваке') },
  { id: 'tbilisi-saburtalo', cityId: 'tbilisi', name: n('Saburtalo', 'Saburtalo', 'Сабуртало') },
  { id: 'tbilisi-mtatsminda', cityId: 'tbilisi', name: n('Mtatsminda', 'Mtatsminda', 'Мтацминда') },
  { id: 'tbilisi-krtsanisi', cityId: 'tbilisi', name: n('Krtsanisi', 'Krtsanisi', 'Крцаниси') },
  { id: 'tbilisi-isani', cityId: 'tbilisi', name: n('İsani', 'Isani', 'Исани') },
  { id: 'tbilisi-samgori', cityId: 'tbilisi', name: n('Samqori', 'Samgori', 'Самгори') },
  { id: 'tbilisi-chughureti', cityId: 'tbilisi', name: n('Çuğureti', 'Chughureti', 'Чугурети') },
  { id: 'tbilisi-didube', cityId: 'tbilisi', name: n('Didube', 'Didube', 'Дидубе') },
  { id: 'tbilisi-nadzaladevi', cityId: 'tbilisi', name: n('Nadzaladevi', 'Nadzaladevi', 'Надзаладеви') },
  { id: 'tbilisi-gldani', cityId: 'tbilisi', name: n('Qldani', 'Gldani', 'Глдани') },
  // Batumi
  { id: 'batumi-old', cityId: 'batumi', name: n('Köhnə Batumi', 'Old Batumi', 'Старый Батуми') },
  { id: 'batumi-new', cityId: 'batumi', name: n('Yeni Bulvar', 'New Boulevard', 'Новый бульвар') },
];

export const METRO_STATIONS: MetroStation[] = [
  { id: 'icherisheher', cityId: 'baku', line: 'red', name: n('İçərişəhər', 'Icherisheher', 'Ичеришехер'), lat: 40.3659, lng: 49.8317 },
  { id: 'sahil', cityId: 'baku', line: 'red', name: n('Sahil', 'Sahil', 'Сахил'), lat: 40.3716, lng: 49.8442 },
  { id: '28-may', cityId: 'baku', line: 'red', name: n('28 May', '28 May', '28 Мая'), lat: 40.3799, lng: 49.8487 },
  { id: 'ganjlik', cityId: 'baku', line: 'red', name: n('Gənclik', 'Ganjlik', 'Гянджлик'), lat: 40.4004, lng: 49.8513 },
  { id: 'nariman-narimanov', cityId: 'baku', line: 'red', name: n('Nəriman Nərimanov', 'Nariman Narimanov', 'Нариман Нариманов'), lat: 40.4027, lng: 49.8708 },
  { id: 'bakmil', cityId: 'baku', line: 'red', name: n('Bakmil', 'Bakmil', 'Бакмил'), lat: 40.4146, lng: 49.8794 },
  { id: 'ulduz', cityId: 'baku', line: 'red', name: n('Ulduz', 'Ulduz', 'Улдуз'), lat: 40.4148, lng: 49.8913 },
  { id: 'koroghlu', cityId: 'baku', line: 'red', name: n('Koroğlu', 'Koroghlu', 'Кероглу'), lat: 40.4211, lng: 49.9178 },
  { id: 'qara-qarayev', cityId: 'baku', line: 'red', name: n('Qara Qarayev', 'Gara Garayev', 'Кара Караев'), lat: 40.4176, lng: 49.9336 },
  { id: 'neftchilar', cityId: 'baku', line: 'red', name: n('Neftçilər', 'Neftchilar', 'Нефтчиляр'), lat: 40.4106, lng: 49.9431 },
  { id: 'khalglar-dostlugu', cityId: 'baku', line: 'red', name: n('Xalqlar Dostluğu', 'Khalglar Dostlughu', 'Халглар Достлугу'), lat: 40.3976, lng: 49.9527 },
  { id: 'ahmadli', cityId: 'baku', line: 'red', name: n('Əhmədli', 'Ahmadli', 'Ахмедлы'), lat: 40.3853, lng: 49.954 },
  { id: 'hazi-aslanov', cityId: 'baku', line: 'red', name: n('Həzi Aslanov', 'Hazi Aslanov', 'Ази Асланов'), lat: 40.3727, lng: 49.9532 },
  { id: 'nizami', cityId: 'baku', line: 'green', name: n('Nizami', 'Nizami', 'Низами'), lat: 40.3794, lng: 49.8303 },
  { id: 'elmlar-akademiyasi', cityId: 'baku', line: 'green', name: n('Elmlər Akademiyası', 'Elmlar Akademiyasi', 'Элмляр Академиясы'), lat: 40.3751, lng: 49.8155 },
  { id: 'inshaatchilar', cityId: 'baku', line: 'green', name: n('İnşaatçılar', 'Inshaatchilar', 'Иншаатчылар'), lat: 40.3913, lng: 49.8028 },
  { id: '20-yanvar', cityId: 'baku', line: 'green', name: n('20 Yanvar', '20 Yanvar', '20 Января'), lat: 40.4042, lng: 49.8086 },
  { id: 'memar-ajami', cityId: 'baku', line: 'green', name: n('Memar Əcəmi', 'Memar Ajami', 'Мемар Аджеми'), lat: 40.4111, lng: 49.8141 },
  { id: 'nasimi', cityId: 'baku', line: 'green', name: n('Nəsimi', 'Nasimi', 'Насими'), lat: 40.4246, lng: 49.8226 },
  { id: 'azadlig-prospekti', cityId: 'baku', line: 'green', name: n('Azadlıq Prospekti', 'Azadlig Prospekti', 'Азадлыг проспекти'), lat: 40.4258, lng: 49.8434 },
  { id: 'darnagul', cityId: 'baku', line: 'green', name: n('Dərnəgül', 'Darnagul', 'Дарнагюль'), lat: 40.4251, lng: 49.8606 },
  { id: 'jafar-jabbarli', cityId: 'baku', line: 'green', name: n('Cəfər Cabbarlı', 'Jafar Jabbarli', 'Джафар Джаббарлы'), lat: 40.3798, lng: 49.8494 },
  { id: 'shah-ismayil-khatai', cityId: 'baku', line: 'green', name: n('Şah İsmayıl Xətai', 'Shah Ismayil Khatai', 'Шах Исмаил Хатаи'), lat: 40.3833, lng: 49.8719 },
  { id: 'avtovagzal', cityId: 'baku', line: 'purple', name: n('Avtovağzal', 'Avtovaghzal', 'Автовокзал'), lat: 40.4211, lng: 49.7949 },
  { id: 'memar-ajami-2', cityId: 'baku', line: 'purple', name: n('Memar Əcəmi-2', 'Memar Ajami-2', 'Мемар Аджеми-2'), lat: 40.4118, lng: 49.8129 },
  { id: '8-noyabr', cityId: 'baku', line: 'purple', name: n('8 Noyabr', '8 Noyabr', '8 Ноября'), lat: 40.4012, lng: 49.8177 },
  { id: 'khojasan', cityId: 'baku', line: 'purple', name: n('Xocəsən', 'Khojasan', 'Ходжасан'), lat: 40.4211, lng: 49.7809 },
];

export const getCity = (id: string) => CITIES.find((c) => c.id === id);
export const getDistrict = (id: string) => DISTRICTS.find((d) => d.id === id);
export const getMetro = (id: string) => METRO_STATIONS.find((m) => m.id === id);
export const districtsOf = (cityId: string) => DISTRICTS.filter((d) => d.cityId === cityId);
export const metrosOf = (cityId: string) => METRO_STATIONS.filter((m) => m.cityId === cityId);
export const localized = (name: LocalizedName | undefined, locale: Locale) => (name ? name[locale] ?? name.az : '');
