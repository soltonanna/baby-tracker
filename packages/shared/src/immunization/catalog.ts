import type { Locale } from '../constants.js';
import type { LocalDate } from '../types/common.js';

/**
 * The immunization reference catalog: the Armenian national childhood
 * immunization calendar, as data.
 *
 * **Source.** Government of the Republic of Armenia, Decision N 58-N of
 * 15 January 2026 (2026–2030 National Immunization Programme), section 5
 * "National immunization calendar" and the rules of section 6. Item and rule
 * numbers are cited in `clause`. The Ministry of Health order N 5700-L of
 * 5 October 2026 (child medical card) carries the same calendar in its
 * vaccination record, which is how the two were cross-checked. Nothing in the
 * schedule comes from anywhere else; the few WHO items live apart in
 * `INTERNATIONAL_REFERENCES` and are never part of the schedule or its progress.
 *
 * **Scope.** Birth to the 4–6-year booster — what a baby tracker needs. The
 * decree also schedules adolescent and adult vaccines (HPV, Tdap, meningococcal,
 * hepatitis A, tularaemia, adult Td, …); they are not catalogued here.
 *
 * **Revision safety.** Health records never copy anything from this file except
 * a `scheduleKey` and the `catalogVersion` it was chosen from. A record holds
 * its own name, date and product, so changing this catalog — a new edition of
 * the decree, a corrected age — changes what the schedule *shows*, never what
 * a record *says*. Keys are therefore stable: never reuse or renumber one;
 * retire a dose by removing it, and records that point at it simply stop
 * matching (they are reported as unmatched, not lost).
 *
 * **Text.** Every explanation exists in all three interface languages, enforced
 * by `Localized`. Vaccine abbreviations in `hy` are the decree's own.
 */

export type Localized = Record<Locale, string>;

/** A point in a child's life, counted from birth. */
export type AgeSpec = { days: number } | { weeks: number } | { months: number } | { years: number };

/** Bump on every change to the schedule or its text; records remember it. */
export const IMMUNIZATION_CATALOG_VERSION = '2026.1';

/** The day the catalog was last checked against its sources. */
export const IMMUNIZATION_CATALOG_REVIEWED_ON: LocalDate = '2026-11-13';

export type ReferenceOrigin = 'official' | 'international';

export interface ImmunizationSource {
  id: string;
  origin: ReferenceOrigin;
  issuer: Localized;
  title: Localized;
  /** When the source was issued, or `null` where not applicable. */
  issuedOn: LocalDate | null;
  /** When the source took effect, if different from `issuedOn`. */
  effectiveFrom?: LocalDate;
  /**
   * `checked` — read in full against the document in this project.
   * `to_verify` — cited from general knowledge of the publication and not yet
   * checked against the text; shown to the user as such.
   */
  review: 'checked' | 'to_verify';
}

export const IMMUNIZATION_SOURCES: readonly ImmunizationSource[] = [
  {
    id: 'am-gov-58n-2026',
    origin: 'official',
    issuer: {
      en: 'Government of the Republic of Armenia',
      ru: 'Правительство Республики Армения',
      hy: 'Հայաստանի Հանրապետության կառավարություն',
    },
    title: {
      en: 'Decision N 58-N of 15 January 2026: National Immunization Programme 2026–2030 and procedure for obtaining the preventive vaccination certificate',
      ru: 'Решение N 58-Н от 15 января 2026 года: Национальная программа иммунопрофилактики на 2026–2030 годы и порядок получения свидетельства о профилактических прививках',
      hy: 'Որոշում N 58-Ն, 15 հունվարի 2026 թ.՝ 2026–2030 թվականների իմունականխարգելման ազգային ծրագիրը և կանխարգելիչ պատվաստումների վկայականը ստանալու կարգը',
    },
    issuedOn: '2026-01-15',
    effectiveFrom: '2026-01-17',
    review: 'checked',
  },
  {
    id: 'am-moh-5700l-2026',
    origin: 'official',
    issuer: {
      en: 'Ministry of Health of the Republic of Armenia',
      ru: 'Министерство здравоохранения Республики Армения',
      hy: 'Հայաստանի Հանրապետության առողջապահության նախարարություն',
    },
    title: {
      en: 'Order N 5700-L of 5 October 2026, amending Order N 5889-L of 8 December 2023 (child medical card, including the vaccination record)',
      ru: 'Приказ N 5700-Л от 5 октября 2026 года о внесении изменений в приказ N 5889-Л от 8 декабря 2023 года (медицинская карта ребёнка, включая запись о прививках)',
      hy: 'Հրաման N 5700-Լ, 5 հոկտեմբերի 2026 թ.՝ 2023 թվականի դեկտեմբերի 8-ի N 5889-Լ հրամանում փոփոխություններ կատարելու մասին (երեխայի բժշկական քարտ, ներառյալ պատվաստումների գրառումը)',
    },
    issuedOn: '2026-10-05',
    review: 'checked',
  },
  {
    id: 'who-influenza-2022',
    origin: 'international',
    issuer: {
      en: 'World Health Organization',
      ru: 'Всемирная организация здравоохранения',
      hy: 'Առողջապահության համաշխարհային կազմակերպություն',
    },
    title: {
      en: 'Vaccines against influenza: WHO position paper (Weekly Epidemiological Record, 2022)',
      ru: 'Вакцины против гриппа: позиционный документ ВОЗ (Еженедельный эпидемиологический бюллетень, 2022)',
      hy: 'Գրիպի դեմ պատվաստանյութեր. ԱՀԿ դիրքորոշման փաստաթուղթ (Շաբաթական համաճարակաբանական տեղեկագիր, 2022)',
    },
    issuedOn: null,
    review: 'to_verify',
  },
  {
    id: 'who-hepa-2022',
    origin: 'international',
    issuer: {
      en: 'World Health Organization',
      ru: 'Всемирная организация здравоохранения',
      hy: 'Առողջապահության համաշխարհային կազմակերպություն',
    },
    title: {
      en: 'Hepatitis A vaccines: WHO position paper (Weekly Epidemiological Record, 2022)',
      ru: 'Вакцины против гепатита A: позиционный документ ВОЗ (Еженедельный эпидемиологический бюллетень, 2022)',
      hy: 'Վիրուսային հեպատիտ Ա-ի դեմ պատվաստանյութեր. ԱՀԿ դիրքորոշման փաստաթուղթ (Շաբաթական համաճարակաբանական տեղեկագիր, 2022)',
    },
    issuedOn: null,
    review: 'to_verify',
  },
];

/** Shown wherever the schedule is. Never to be shortened away. */
export const IMMUNIZATION_DISCLAIMER: Localized = {
  en: 'This is an information summary of the Armenian national immunization calendar. The dose, volume and timing for your child must follow the vaccine’s product information and your paediatrician’s instructions. Dates are calculated from the date of birth and do not replace a doctor’s advice.',
  ru: 'Это информационная сводка Национального календаря профилактических прививок Армении. Доза, объём и сроки для вашего ребёнка должны соответствовать инструкции к вакцине и указаниям педиатра. Даты рассчитаны от даты рождения и не заменяют совет врача.',
  hy: 'Սա Հայաստանի պատվաստումների ազգային օրացույցի տեղեկատու ամփոփագիր է: Ձեր երեխայի համար դեղաչափը, ծավալը և ժամկետները պետք է համապատասխանեն պատվաստանյութի օգտագործման հրահանգին և մանկաբույժի ցուցումներին: Ամսաթվերը հաշվարկված են ծննդյան օրվանից և չեն փոխարինում բժշկի խորհրդին:',
};

/**
 * Routine checkups and screenings. No verified Armenian official reference was
 * available, so the app lists none and says so — rather than offer a schedule
 * of unknown standing. Replace with data when one is added.
 */
export const CHECKUP_REFERENCE_PLACEHOLDER: Localized = {
  en: 'A routine checkup and screening schedule is not included yet: no verified official Armenian reference has been added. Ask your paediatrician which checkups your child needs, and record them under Records → Checkup.',
  ru: 'График плановых осмотров и скринингов пока не включён: проверенный официальный армянский источник не добавлен. Спросите педиатра, какие осмотры нужны вашему ребёнку, и записывайте их в разделе «Записи» → «Осмотр».',
  hy: 'Պարբերական զննումների և սկրինինգների ժամանակացույցը դեռ ներառված չէ. ստուգված պաշտոնական հայկական աղբյուր չի ավելացվել: Հարցրեք մանկաբույժին, թե որ զննումներն են անհրաժեշտ Ձեր երեխային, և գրանցեք դրանք «Գրառումներ» → «Զննում» բաժնում:',
};

export type AdministrationRoute = 'intramuscular' | 'intradermal';
export type AdministrationSite = 'right_thigh' | 'left_thigh' | 'left_upper_arm';

/** Only where the decree itself states it; never filled in from anywhere else. */
export interface DecreeAdministration {
  volumeMl: number;
  route: AdministrationRoute;
  site: AdministrationSite;
  clause: string;
}

/** One vaccine (or combination) and the explanation that goes with every dose of it. */
export interface ImmunizationVaccine {
  id: string;
  /** The decree's own abbreviation in `hy`; the usual one in `en` and `ru`. */
  abbreviation: Localized;
  name: Localized;
  protectsAgainst: Localized;
  purpose: Localized;
  /** How many doses and how far apart, in words. */
  doses: Localized;
  /** What the decree says to do when a dose is late. */
  catchUp?: Localized;
}

export const IMMUNIZATION_VACCINES: readonly ImmunizationVaccine[] = [
  {
    id: 'hepb',
    abbreviation: { en: 'HepB', ru: 'ВГВ', hy: 'ՎՀԲ' },
    name: {
      en: 'Hepatitis B vaccine (birth dose)',
      ru: 'Вакцина против гепатита B (доза при рождении)',
      hy: 'Վիրուսային հեպատիտ Բ-ի դեմ պատվաստանյութ (ծննդյան դեղաչափ)',
    },
    protectsAgainst: {
      en: 'Hepatitis B, a viral infection of the liver',
      ru: 'Гепатит B — вирусная инфекция печени',
      hy: 'Վիրուսային հեպատիտ Բ՝ լյարդի վիրուսային վարակ',
    },
    purpose: {
      en: 'Hepatitis B caught in infancy often becomes a lifelong infection. The first dose is given in the maternity hospital within 24 hours of birth; the later doses are given inside the combined hexavalent vaccine.',
      ru: 'Гепатит B, перенесённый в младенчестве, часто становится пожизненной инфекцией. Первая доза вводится в роддоме в первые 24 часа жизни; последующие дозы входят в комбинированную шестивалентную вакцину.',
      hy: 'Մանկական տարիքում ձեռք բերված հեպատիտ Բ-ն հաճախ դառնում է ցմահ վարակ: Առաջին դեղաչափը կատարվում է ծննդատանը՝ ծնվելուց հետո 24 ժամվա ընթացքում, հաջորդ դեղաչափերը՝ համակցված վեցավալենտ պատվաստանյութի կազմում:',
    },
    doses: {
      en: 'One birth dose, then three doses inside the hexavalent vaccine.',
      ru: 'Одна доза при рождении, затем три дозы в составе шестивалентной вакцины.',
      hy: 'Մեկ ծննդյան դեղաչափ, ապա երեք դեղաչափ վեցավալենտ պատվաստանյութի կազմում:',
    },
    catchUp: {
      en: 'If the birth dose was not given in the maternity hospital, a separate hepatitis B vaccine is no longer given later; the hexavalent doses continue on schedule. Babies of mothers with a positive hepatitis B test, or an unknown result, follow a different protocol set by the doctor.',
      ru: 'Если доза при рождении не была введена в роддоме, отдельная вакцина против гепатита B позже не вводится; дозы шестивалентной вакцины продолжаются по календарю. Дети матерей с положительным анализом на гепатит B или с неизвестным результатом наблюдаются по особому протоколу врача.',
      hy: 'Եթե ծննդատանը ծննդյան դեղաչափը չի կատարվել, հետագայում առանձին մոնովալենտ պատվաստանյութ այլևս չի ներարկվում. վեցավալենտ պատվաստանյութի դեղաչափերը շարունակվում են ըստ օրացույցի: Հեպատիտ Բ-ի դրական կամ անհայտ պատասխանով մայրերի նորածինները հետևում են բժշկի սահմանած առանձին կարգին:',
    },
  },
  {
    id: 'bcg',
    abbreviation: { en: 'BCG', ru: 'БЦЖ', hy: 'ԲՑԺ' },
    name: {
      en: 'BCG vaccine',
      ru: 'Вакцина БЦЖ',
      hy: 'Տուբերկուլոզի դեմ պատվաստանյութ (ԲՑԺ)',
    },
    protectsAgainst: {
      en: 'Tuberculosis',
      ru: 'Туберкулёз',
      hy: 'Տուբերկուլոզ',
    },
    purpose: {
      en: 'Lowers the risk of severe forms of tuberculosis in young children. One dose within 48 hours of birth for babies weighing 2000 g or more.',
      ru: 'Снижает риск тяжёлых форм туберкулёза у маленьких детей. Одна доза в первые 48 часов жизни для детей с весом 2000 г и более.',
      hy: 'Նվազեցնում է փոքր երեխաների մոտ տուբերկուլոզի ծանր ձևերի վտանգը: Մեկ դեղաչափ՝ ծնվելուց հետո 48 ժամվա ընթացքում, 2000 գրամ և ավելի քաշով նորածիններին:',
    },
    doses: {
      en: 'One dose.',
      ru: 'Одна доза.',
      hy: 'Մեկ դեղաչափ:',
    },
    catchUp: {
      en: 'If it could not be given at birth, BCG may be given up to 12 months of age. From 8 weeks of age a tuberculin skin test is done before the vaccine.',
      ru: 'Если вакцину нельзя было ввести при рождении, БЦЖ можно сделать до 12 месяцев. С возраста 8 недель перед прививкой проводится туберкулиновая проба.',
      hy: 'Եթե ծննդյան ժամանակ հնարավոր չի եղել, ԲՑԺ-ն կարելի է կատարել մինչև 12 ամսականը: 8 շաբաթականից բարձր տարիքում պատվաստումից առաջ կատարվում է տուբերկուլինային մաշկային փորձ:',
    },
  },
  {
    id: 'hexa',
    abbreviation: {
      en: 'DTaP-HepB-Hib-IPV',
      ru: 'АКДС-ВГВ-Hib-ИПВ',
      hy: 'ԱԿԴՓ/ՎՀԲ/ՀԻԲ/ԻՊՊ',
    },
    name: {
      en: 'Hexavalent combined vaccine',
      ru: 'Комбинированная шестивалентная вакцина',
      hy: 'Համակցված վեցավալենտ պատվաստանյութ',
    },
    protectsAgainst: {
      en: 'Diphtheria, pertussis (whooping cough), tetanus, hepatitis B, Haemophilus influenzae type b (Hib) and polio',
      ru: 'Дифтерия, коклюш, столбняк, гепатит B, гемофильная инфекция типа b (Hib) и полиомиелит',
      hy: 'Դիֆթերիա, կապույտ հազ, փայտացում, վիրուսային հեպատիտ Բ, հեմոֆիլուս ինֆլուենզա Բ տիպի վարակ և պոլիոմիելիտ',
    },
    purpose: {
      en: 'One injection protects against six diseases that are dangerous for infants. The pertussis part is acellular (non-cellular).',
      ru: 'Одна инъекция защищает от шести опасных для младенцев болезней. Коклюшный компонент бесклеточный.',
      hy: 'Մեկ ներարկումը պաշտպանում է նորածինների համար վտանգավոր վեց հիվանդությունից: Կապույտ հազի բաղադրիչը ոչ բջջային է:',
    },
    doses: {
      en: 'Three doses at 6, 12 and 18 weeks, then a fourth dose at 18 months (given as DTaP-IPV or another combined vaccine).',
      ru: 'Три дозы в 6, 12 и 18 недель, затем четвёртая доза в 18 месяцев (вводится как АКДС-ИПВ или другая комбинированная вакцина).',
      hy: 'Երեք դեղաչափ՝ 6, 12 և 18 շաբաթականում, ապա չորրորդը՝ 18 ամսականում (ԱԿԴՓ/ԻՊՊ կամ այլ համակցված պատվաստանյութով):',
    },
    catchUp: {
      en: 'If late, the first three doses are given at least 4 weeks apart and the fourth 6 months after the third. A dose is never given earlier than the calendar age.',
      ru: 'При опоздании первые три дозы вводятся с интервалом не менее 4 недель, четвёртая — через 6 месяцев после третьей. Раньше календарного возраста дозу не вводят.',
      hy: 'Ուշացման դեպքում առաջին երեք դեղաչափերը կատարվում են առնվազն 4 շաբաթ ընդմիջումով, չորրորդը՝ երրորդից 6 ամիս հետո: Օրացուցային ժամկետից շուտ չեն պատվաստում:',
    },
  },
  {
    id: 'rota',
    abbreviation: { en: 'Rotavirus', ru: 'Ротавирус', hy: 'ՌՈՏԱ' },
    name: {
      en: 'Rotavirus vaccine (oral)',
      ru: 'Ротавирусная вакцина (пероральная)',
      hy: 'Ռոտավիրուսային վարակի դեմ պատվաստանյութ (բերանային)',
    },
    protectsAgainst: {
      en: 'Rotavirus infection, a common cause of severe diarrhoea and dehydration in infants',
      ru: 'Ротавирусная инфекция — частая причина тяжёлой диареи и обезвоживания у младенцев',
      hy: 'Ռոտավիրուսային վարակ՝ նորածինների մոտ ծանր փորլուծության և ջրազրկման հաճախակի պատճառ',
    },
    purpose: {
      en: 'A live vaccine given by mouth as drops. The number of doses is set by the product information of the vaccine used.',
      ru: 'Живая вакцина, вводится через рот в виде капель. Количество доз определяется инструкцией к применяемой вакцине.',
      hy: 'Կենդանի պատվաստանյութ, տրվում է բերանով՝ կաթիլների տեսքով: Դեղաչափերի քանակը սահմանվում է օգտագործվող պատվաստանյութի հրահանգով:',
    },
    doses: {
      en: 'Doses at 6 and 12 weeks; the exact number follows the product information.',
      ru: 'Дозы в 6 и 12 недель; точное количество — по инструкции к вакцине.',
      hy: 'Դեղաչափեր՝ 6 և 12 շաբաթականում. ճշգրիտ քանակը՝ ըստ հրահանգի:',
    },
    catchUp: {
      en: 'A child older than 15 weeks no longer receives the first dose, and one older than 32 weeks no longer receives the second.',
      ru: 'Ребёнку старше 15 недель первую дозу уже не вводят, а старше 32 недель — вторую.',
      hy: '15 շաբաթականից բարձր երեխաներն այլևս ենթակա չեն առաջին դեղաչափի, 32 շաբաթականից բարձր՝ երկրորդ դեղաչափի պատվաստման:',
    },
  },
  {
    id: 'pcv',
    abbreviation: { en: 'PCV', ru: 'ПКВ', hy: 'ՊՆԵՎՄՈ' },
    name: {
      en: 'Pneumococcal conjugate vaccine (at least 13-valent)',
      ru: 'Пневмококковая конъюгированная вакцина (не менее 13-валентная)',
      hy: 'Պնևմակոկային վարակի դեմ պատվաստանյութ (առնվազն 13-վալենտ, կոնյուգացված)',
    },
    protectsAgainst: {
      en: 'Pneumococcal infection: pneumonia, meningitis, blood infection and ear infections',
      ru: 'Пневмококковая инфекция: пневмония, менингит, сепсис и воспаление уха',
      hy: 'Պնևմակոկային վարակ՝ թոքաբորբ, մենինգիտ, արյան վարակ և միջին ականջի բորբոքում',
    },
    purpose: {
      en: 'Protects infants against the most serious types of pneumococcus.',
      ru: 'Защищает младенцев от наиболее опасных типов пневмококка.',
      hy: 'Պաշտպանում է նորածիններին պնևմոկոկի ամենավտանգավոր տիպերից:',
    },
    doses: {
      en: 'Three doses at 6, 12 and 18 weeks.',
      ru: 'Три дозы в 6, 12 и 18 недель.',
      hy: 'Երեք դեղաչափ՝ 6, 12 և 18 շաբաթականում:',
    },
    catchUp: {
      en: 'If no dose was given before 12 months, two doses are given between 12 and 24 months, at least 8 weeks apart. If none was given before 24 months, one dose is given.',
      ru: 'Если до 12 месяцев не введено ни одной дозы, в возрасте 12–24 месяцев вводят две дозы с интервалом не менее 8 недель. Если до 24 месяцев не введено ни одной дозы — одну дозу.',
      hy: 'Եթե մինչև 12 ամսականը ոչ մի դեղաչափ չի ստացվել, 12–24 ամսականում կատարվում է 2 դեղաչափ՝ առնվազն 8 շաբաթ ընդմիջումով: Եթե մինչև 24 ամսականը ոչ մի դեղաչափ չի ստացվել, կատարվում է 1 դեղաչափ:',
    },
  },
  {
    id: 'mmr',
    abbreviation: { en: 'MMR', ru: 'КПК', hy: 'ԿԿԽ' },
    name: {
      en: 'Measles, mumps and rubella vaccine',
      ru: 'Вакцина против кори, паротита и краснухи',
      hy: 'Կարմրուկի, կարմրախտի և խոզուկի դեմ պատվաստանյութ',
    },
    protectsAgainst: {
      en: 'Measles, rubella and mumps (epidemic parotitis)',
      ru: 'Корь, краснуха и эпидемический паротит',
      hy: 'Կարմրուկ, կարմրախտ, խոզուկ (համաճարակային պարօտիտ)',
    },
    purpose: {
      en: 'A live combined vaccine. Measles spreads very easily and can cause pneumonia and brain inflammation; rubella is dangerous in pregnancy.',
      ru: 'Живая комбинированная вакцина. Корь очень заразна и может вызывать пневмонию и воспаление мозга; краснуха опасна при беременности.',
      hy: 'Կենդանի համակցված պատվաստանյութ: Կարմրուկը շատ հեշտ է փոխանցվում և կարող է առաջացնել թոքաբորբ և ուղեղի բորբոքում, կարմրախտը վտանգավոր է հղիության ժամանակ:',
    },
    doses: {
      en: 'Two doses: at 12 months and at 4–6 years.',
      ru: 'Две дозы: в 12 месяцев и в 4–6 лет.',
      hy: 'Երկու դեղաչափ՝ 12 ամսականում և 4–6 տարեկանում:',
    },
    catchUp: {
      en: 'An unvaccinated child receives two doses at least 4 weeks apart.',
      ru: 'Непривитый ребёнок получает две дозы с интервалом не менее 4 недель.',
      hy: 'Չպատվաստված երեխան ստանում է 2 դեղաչափ՝ առնվազն 4 շաբաթ ընդմիջումով:',
    },
  },
  {
    id: 'varicella',
    abbreviation: { en: 'Varicella', ru: 'Ветряная оспа', hy: 'ՋՐԾԱՂԻԿԻ ԴԵՄ' },
    name: {
      en: 'Varicella (chickenpox) vaccine',
      ru: 'Вакцина против ветряной оспы',
      hy: 'Ջրծաղիկի դեմ պատվաստանյութ',
    },
    protectsAgainst: {
      en: 'Chickenpox (varicella)',
      ru: 'Ветряная оспа',
      hy: 'Ջրծաղիկ',
    },
    purpose: {
      en: 'A live vaccine that prevents chickenpox and its complications. The second dose, at 4–6 years, is part of the calendar from 2027.',
      ru: 'Живая вакцина, предупреждающая ветряную оспу и её осложнения. Вторая доза в 4–6 лет входит в календарь с 2027 года.',
      hy: 'Կենդանի պատվաստանյութ, որը կանխարգելում է ջրծաղիկը և նրա բարդությունները: 4–6 տարեկանի երկրորդ դեղաչափը օրացույցում է 2027 թվականից:',
    },
    doses: {
      en: 'Two doses: at 12 months and at 4–6 years (from 2027).',
      ru: 'Две дозы: в 12 месяцев и в 4–6 лет (с 2027 года).',
      hy: 'Երկու դեղաչափ՝ 12 ամսականում և 4–6 տարեկանում (2027 թվականից):',
    },
    catchUp: {
      en: 'An unvaccinated person receives two doses at least 4 weeks apart.',
      ru: 'Непривитый человек получает две дозы с интервалом не менее 4 недель.',
      hy: 'Չպատվաստված անձինք ստանում են 2 դեղաչափ՝ առնվազն 4 շաբաթ ընդմիջումով:',
    },
  },
  {
    id: 'dtapipv',
    abbreviation: { en: 'DTaP-IPV', ru: 'АКДС-ИПВ', hy: 'ԱԿԴՓ/ԻՊՊ' },
    name: {
      en: 'Tetravalent DTaP-IPV booster',
      ru: 'Четырёхвалентная ревакцинация АКДС-ИПВ',
      hy: 'Քառավալենտ ԱԿԴՓ/ԻՊՊ պատվաստանյութ',
    },
    protectsAgainst: {
      en: 'Diphtheria, pertussis (whooping cough), tetanus and polio',
      ru: 'Дифтерия, коклюш, столбняк и полиомиелит',
      hy: 'Դիֆթերիա, կապույտ հազ, փայտացում և պոլիոմիելիտ',
    },
    purpose: {
      en: 'Boosts protection that fades after the infant doses. Other combined vaccines that also contain hepatitis B and Hib are allowed.',
      ru: 'Поддерживает защиту, которая ослабевает после младенческих доз. Допускаются другие комбинированные вакцины, также содержащие гепатит B и Hib.',
      hy: 'Ամրապնդում է մանկական դեղաչափերից հետո թուլացող պաշտպանությունը: Թույլատրվում են նաև այլ համակցված պատվաստանյութեր՝ վիրուսային հեպատիտ Բ և ՀԻԲ բաղադրիչներով:',
    },
    doses: {
      en: 'Two doses: at 18 months and at 4–6 years.',
      ru: 'Две дозы: в 18 месяцев и в 4–6 лет.',
      hy: 'Երկու դեղաչափ՝ 18 ամսականում և 4–6 տարեկանում:',
    },
  },
];

/**
 * One dose in the national calendar.
 *
 * Ages are counted from birth. A dose is **due** from `dueAge` until the end of
 * its window, then **overdue**; `catchUpUntilAge` is the last age the decree
 * allows it to be given at all, after which it is **missed** (and the
 * paediatrician decides). `closedAfterWindow` marks a dose that cannot be given
 * later at all.
 */
export interface ImmunizationScheduleItem {
  /** Stable forever — records point at it. Never reuse or renumber. */
  key: string;
  vaccineId: string;
  origin: 'official';
  sourceId: string;
  /** Item and clause of the source, e.g. "table 5, no. 3; clause 15". */
  clause: string;
  /** 1-based dose number within `vaccineId`. */
  dose: number;
  /** Doses of this vaccine in the catalogued range. */
  totalDoses: number;
  /** The recommended age, and the earliest valid one. */
  dueAge: AgeSpec;
  /** Days after `dueAge` during which it is "due" rather than "overdue". Default 28. */
  dueWindowDays?: number;
  /** Overrides `dueWindowDays`: the age at which "due" turns into "overdue". */
  dueUntilAge?: AgeSpec;
  catchUpUntilAge?: AgeSpec;
  closedAfterWindow?: boolean;
  /**
   * The dose must follow another by at least this long. When absent, a later
   * dose of the same vaccine must follow the previous one by 4 weeks
   * (decree clause 12(3)).
   */
  minIntervalFrom?: { key: string; age: AgeSpec };
  /** Not part of the calendar before this date. */
  effectiveFrom?: LocalDate;
  administration?: DecreeAdministration;
}

const DECREE = 'am-gov-58n-2026';

export const IMMUNIZATION_SCHEDULE: readonly ImmunizationScheduleItem[] = [
  {
    key: 'hepb-birth',
    vaccineId: 'hepb',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 1; clause 13',
    dose: 1,
    totalDoses: 1,
    dueAge: { days: 0 },
    dueWindowDays: 1,
    closedAfterWindow: true,
    administration: {
      volumeMl: 0.5,
      route: 'intramuscular',
      site: 'right_thigh',
      clause: 'clause 13(9)',
    },
  },
  {
    key: 'bcg-1',
    vaccineId: 'bcg',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 2; clause 14',
    dose: 1,
    totalDoses: 1,
    dueAge: { days: 0 },
    dueWindowDays: 2,
    catchUpUntilAge: { months: 12 },
    administration: {
      volumeMl: 0.05,
      route: 'intradermal',
      site: 'left_upper_arm',
      clause: 'clause 14(2)',
    },
  },
  ...[1, 2, 3].map((dose): ImmunizationScheduleItem => ({
    key: `hexa-${dose}`,
    vaccineId: 'hexa',
    origin: 'official',
    sourceId: DECREE,
    clause: `table 5, no. ${[3, 6, 9][dose - 1]}; clause 15`,
    dose,
    totalDoses: 4,
    dueAge: { weeks: dose * 6 },
    administration: {
      volumeMl: 0.5,
      route: 'intramuscular',
      site: 'right_thigh',
      clause: 'clause 15(4)',
    },
  })),
  ...[1, 2].map((dose): ImmunizationScheduleItem => ({
    key: `rota-${dose}`,
    vaccineId: 'rota',
    origin: 'official',
    sourceId: DECREE,
    clause: `table 5, no. ${[4, 7][dose - 1]}; clause 16`,
    dose,
    totalDoses: 2,
    dueAge: { weeks: dose * 6 },
    catchUpUntilAge: { weeks: dose === 1 ? 15 : 32 },
  })),
  ...[1, 2, 3].map((dose): ImmunizationScheduleItem => ({
    key: `pcv-${dose}`,
    vaccineId: 'pcv',
    origin: 'official',
    sourceId: DECREE,
    clause: `table 5, no. ${[5, 8, 10][dose - 1]}; clause 17`,
    dose,
    totalDoses: 3,
    dueAge: { weeks: dose * 6 },
    administration: {
      volumeMl: 0.5,
      route: 'intramuscular',
      site: 'left_thigh',
      clause: 'clause 17(2)',
    },
  })),
  {
    key: 'mmr-1',
    vaccineId: 'mmr',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 11; clause 18',
    dose: 1,
    totalDoses: 2,
    dueAge: { months: 12 },
  },
  {
    key: 'varicella-1',
    vaccineId: 'varicella',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 12; clause 19',
    dose: 1,
    totalDoses: 2,
    dueAge: { months: 12 },
  },
  {
    key: 'dtapipv-1',
    vaccineId: 'dtapipv',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 13; clause 15(3)',
    dose: 1,
    totalDoses: 2,
    dueAge: { months: 18 },
    // Clause 15(5): the fourth dose of the hexavalent course follows the third by 6 months.
    minIntervalFrom: { key: 'hexa-3', age: { months: 6 } },
  },
  {
    key: 'mmr-2',
    vaccineId: 'mmr',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 15; clause 18(2)',
    dose: 2,
    totalDoses: 2,
    dueAge: { years: 4 },
    dueUntilAge: { years: 7 },
  },
  {
    key: 'dtapipv-2',
    vaccineId: 'dtapipv',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 14; clause 15(6)',
    dose: 2,
    totalDoses: 2,
    dueAge: { years: 4 },
    dueUntilAge: { years: 7 },
  },
  {
    key: 'varicella-2',
    vaccineId: 'varicella',
    origin: 'official',
    sourceId: DECREE,
    clause: 'table 5, no. 16; clause 19(1)',
    dose: 2,
    totalDoses: 2,
    dueAge: { years: 4 },
    dueUntilAge: { years: 7 },
    effectiveFrom: '2027-01-01',
  },
];

/**
 * WHO recommendations that go beyond the Armenian calendar for this age range.
 * Information only: they are never matched against records, never counted in
 * progress and never shown as overdue. Where the decree covers the same
 * vaccine "by epidemiological indication" (influenza) or at a later age
 * (hepatitis A, 15–16 years), the Armenian position is the official one.
 */
export interface InternationalReference {
  id: string;
  origin: 'international';
  sourceId: string;
  name: Localized;
  protectsAgainst: Localized;
  note: Localized;
  fromAge: AgeSpec;
}

export const INTERNATIONAL_REFERENCES: readonly InternationalReference[] = [
  {
    id: 'influenza-seasonal',
    origin: 'international',
    sourceId: 'who-influenza-2022',
    name: {
      en: 'Seasonal influenza vaccine',
      ru: 'Вакцина против сезонного гриппа',
      hy: 'Սեզոնային գրիպի դեմ պատվաստանյութ',
    },
    protectsAgainst: { en: 'Influenza', ru: 'Грипп', hy: 'Գրիպ' },
    note: {
      en: 'WHO lists young children from 6 months as a group to be offered seasonal influenza vaccine. In Armenia it is given by epidemiological indication, according to the instructions. Ask your paediatrician.',
      ru: 'ВОЗ относит маленьких детей с 6 месяцев к группе, которой предлагается вакцина против сезонного гриппа. В Армении она проводится по эпидемиологическим показаниям, согласно инструкции. Спросите педиатра.',
      hy: 'ԱՀԿ-ն 6 ամսականից սկսած փոքր երեխաներին դասում է այն խմբին, որին առաջարկվում է սեզոնային գրիպի դեմ պատվաստանյութ: Հայաստանում այն կատարվում է համաճարակաբանական ցուցումով՝ ըստ հրահանգի: Հարցրեք մանկաբույժին:',
    },
    fromAge: { months: 6 },
  },
  {
    id: 'hepa',
    origin: 'international',
    sourceId: 'who-hepa-2022',
    name: {
      en: 'Hepatitis A vaccine',
      ru: 'Вакцина против гепатита A',
      hy: 'Վիրուսային հեպատիտ Ա-ի դեմ պատվաստանյութ',
    },
    protectsAgainst: {
      en: 'Hepatitis A',
      ru: 'Гепатит A',
      hy: 'Վիրուսային հեպատիտ Ա',
    },
    note: {
      en: 'WHO suggests hepatitis A vaccination from 12 months of age where the infection is moderately common. The Armenian calendar schedules it at 15–16 years. Ask your paediatrician.',
      ru: 'ВОЗ рекомендует вакцинацию против гепатита A с 12 месяцев там, где инфекция распространена умеренно. Календарь Армении предусматривает её в 15–16 лет. Спросите педиатра.',
      hy: 'ԱՀԿ-ն առաջարկում է հեպատիտ Ա-ի դեմ պատվաստում 12 ամսականից այնտեղ, որտեղ վարակը չափավոր տարածված է: Հայաստանի օրացույցը նախատեսում է այն 15–16 տարեկանում: Հարցրեք մանկաբույժին:',
    },
    fromAge: { months: 12 },
  },
];
