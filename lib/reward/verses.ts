/**
 * Verses shown after a completed planning session.
 *
 * Chosen for their fit with *finishing a piece of work and committing to the
 * next* — the moment the wizard ends — rather than as generic decoration.
 * Translations follow the Indonesian Ministry of Religious Affairs rendering.
 *
 * Deliberately a small, fixed, hand-checked set: this is scripture, and
 * generating or paraphrasing it would be the wrong kind of clever. Picked
 * deterministically from the date so re-opening the screen never reshuffles it.
 */

export interface Verse {
  /** Surah name and ayah range, e.g. "Al-Insyirah 94:5-6". */
  reference: string;
  /**
   * One entry per ayah, rendered on its own line.
   *
   * Not one string with the ۝ end-of-ayah mark between them: that glyph is
   * missing from the default font stack on most devices and renders as a tofu
   * box, which looks like a bug in the middle of scripture.
   */
  arabic: readonly string[];
  translation: string;
}

export const VERSES: readonly Verse[] = [
  {
    reference: "Al-Insyirah 94:5-6",
    arabic: ["فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا", "إِنَّ مَعَ ٱلْعُسْرِ يُسْرًا"],
    translation:
      "Maka sesungguhnya beserta kesulitan ada kemudahan. Sesungguhnya beserta kesulitan ada kemudahan.",
  },
  {
    reference: "Al-Insyirah 94:7",
    arabic: ["فَإِذَا فَرَغْتَ فَٱنصَبْ"],
    translation:
      "Maka apabila engkau telah selesai (dari suatu urusan), tetaplah bekerja keras (untuk urusan yang lain).",
  },
  {
    reference: "At-Taubah 9:105",
    arabic: [
      "وَقُلِ ٱعْمَلُوا۟ فَسَيَرَى ٱللَّهُ عَمَلَكُمْ وَرَسُولُهُۥ وَٱلْمُؤْمِنُونَ",
    ],
    translation:
      "Dan katakanlah, “Bekerjalah kamu, maka Allah akan melihat pekerjaanmu, begitu juga Rasul-Nya dan orang-orang mukmin.”",
  },
  {
    reference: "Al-Baqarah 2:286",
    arabic: ["لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا"],
    translation:
      "Allah tidak membebani seseorang melainkan sesuai dengan kesanggupannya.",
  },
  {
    reference: "Ar-Ra'd 13:11",
    arabic: [
      "إِنَّ ٱللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا۟ مَا بِأَنفُسِهِمْ",
    ],
    translation:
      "Sesungguhnya Allah tidak akan mengubah keadaan suatu kaum sebelum mereka mengubah keadaan diri mereka sendiri.",
  },
];

/** Stable per-day pick, so the verse does not change under the user. */
export function verseForDay(date: string): Verse {
  let hash = 0;
  for (let i = 0; i < date.length; i += 1) {
    hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  }
  return VERSES[hash % VERSES.length]!;
}
