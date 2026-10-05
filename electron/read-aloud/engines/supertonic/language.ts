import type { SupertonicLanguage } from "./text";

// Words that are common in one language and rare in the others it could be
// mistaken for. Only Latin-script languages need them; the rest go by script.
const stopwords: Partial<Record<SupertonicLanguage, string>> = {
  en: "the and is are to of in it you that this with for was have not",
  sk: "je sa že som sú ako aj nie ale alebo ktoré ktorý už čo všetko teraz môžeš keď pre",
  cs: "je se že jsem jsou jako ale nebo které který už co všechno teď můžeš když pro není",
  pl: "jest się że nie jak ale czy już dla tak są który które wszystko",
  de: "der die das und ist nicht ich mit sich auf für ein eine auch wir",
  nl: "de het een en is niet dat van ik voor met zijn op ook",
  fr: "le la les et est une des que pas pour dans avec vous je ce",
  es: "el la los las y es que una por para con no pero está como",
  pt: "o a os as e é que um uma não para com por mas está",
  it: "il la e è che di un una non per con sono ma anche gli",
  ro: "și este în că nu pe cu un o sunt pentru dar mai",
  hu: "a az és hogy nem is egy van meg már csak ez de",
  hr: "je i se da u na ne su što sam ali kao ili",
  sl: "je in se da v na ne so ki sem pa kot tudi",
  sv: "och är att det som en på inte för med jag har av",
  da: "og er at det som en på ikke for med jeg har af",
  fi: "ja on ei se että oli ovat kun mutta tämä myös",
  et: "ja on ei see et oli kui aga ka mis ning",
  lv: "un ir ka uz ar no par nav bet kā tas",
  lt: "ir yra kad su ne bet kaip tai jis buvo iš",
  tr: "ve bir bu da de için ile değil çok ama gibi",
  id: "dan yang di ini itu dengan untuk tidak ada dari akan",
};

// Letters that appear in one Latin-script language and few others; each counts double.
const letters: Partial<Record<SupertonicLanguage, string>> = {
  sk: "äôĺľŕ",
  cs: "řěů",
  pl: "łąęśźżńć",
  de: "ßäöü",
  hu: "őű",
  ro: "ăâîșțşţ",
  tr: "ğış",
  lv: "āēīūķļņģ",
  lt: "ąęėįųū",
  hr: "đ",
  da: "æø",
  sv: "åäö",
  fi: "äö",
  et: "õäöü",
  fr: "àâçèêëîïôùûœ",
  es: "ñ¿¡",
  pt: "ãõç",
  it: "àèìòù",
  vi: "ơưđăạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ",
};

const scripts: [RegExp, string][] = [
  [/\p{Script=Latin}/u, "latin"],
  [/\p{Script=Cyrillic}/u, "cyrillic"],
  [/\p{Script=Greek}/u, "el"],
  [/\p{Script=Arabic}/u, "ar"],
  [/\p{Script=Devanagari}/u, "hi"],
  [/\p{Script=Hangul}/u, "ko"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
  [/\p{Script=Han}/u, "han"],
];

/**
 * Guesses the language of `text` from its script, then from distinctive
 * letters and common words. A wrong language reads worse than none, so
 * without a clear winner it answers "na" (read without a language), or "en"
 * for plain ASCII.
 */
export function detectLanguage(text: string): SupertonicLanguage {
  const counts = new Map<string, number>();
  for (const char of text) {
    const script = scripts.find(([pattern]) => pattern.test(char))?.[1];
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  const script = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  switch (script) {
    case undefined:
      return "na";
    case "cyrillic":
      if (/[іїєґ]/i.test(text)) return "uk";
      if (/[ыэё]/i.test(text)) return "ru";
      return /ъ/i.test(text) ? "bg" : "ru";
    // Han without kana is most likely Chinese, which the model doesn't speak.
    case "han":
      return counts.has("ja") ? "ja" : "na";
    case "latin":
      return latinLanguage(text);
    default:
      return script as SupertonicLanguage;
  }
}

function latinLanguage(text: string): SupertonicLanguage {
  const lower = text.toLowerCase();
  const words = lower.match(/\p{L}+/gu) ?? [];
  const scores = new Map<SupertonicLanguage, number>();
  const add = (lang: SupertonicLanguage, by: number) =>
    scores.set(lang, (scores.get(lang) ?? 0) + by);
  for (const [lang, list] of Object.entries(stopwords)) {
    const set = new Set(list.split(" "));
    for (const word of words)
      if (set.has(word)) add(lang as SupertonicLanguage, 1);
  }
  for (const [lang, set] of Object.entries(letters)) {
    for (const char of lower)
      if (set.includes(char)) add(lang as SupertonicLanguage, 2);
  }
  const [best, second] = [...scores].sort((a, b) => b[1] - a[1]);
  if (best && best[1] > (second?.[1] ?? 0)) return best[0];
  return /[^\x00-\x7F]/.test(text) ? "na" : "en";
}
