// global state: save, language, author mode
import { KONAMI, grant, newlyEarned } from './achievements';
import { setDebug } from './debug';
import { detectLang, setLang, t } from './i18n';
import { showNotice, showToast } from './notice';
import { achievements, saveContext } from './levels';
import { PREVIEW, SAVE_KEYS, previewDevMode } from './preview';
import { SaveStore, browserStorage, defaultSave, type SaveData } from './save';
import { playSfx } from './sfx';

export const app = {
  store: new SaveStore(browserStorage(), saveContext, SAVE_KEYS),
  data: defaultSave() as SaveData,
  author: false,
  init(): void {
    this.data = this.store.load();
    // the development server; the preview of main by ?dev (remembered, ?dev=0 to leave it); the
    // release never opens author mode (no switch, PREVIEW is the constant false there)
    this.author =
      import.meta.env.DEV || (PREVIEW && previewDevMode(location.search, browserStorage()));
    setLang(this.data.settings.lang ?? detectLang(navigator.languages ?? []));
    // a save from before the achievements (or of an older game version): what its records
    // already earn, without a toast for each
    this.checkRecords(true);
  },
  /** a failed save has been shown to the player (once per session: it fails again each time) */
  saveFailShown: false,
  /** Saves now; tells the player once if it cannot be (storage full, blocked, private mode). */
  persist(): boolean {
    const ok = this.store.save(this.data);
    if (!ok && !this.saveFailShown) {
      this.saveFailShown = true;
      showNotice(t('saveFailed'), '#ff8080');
    }
    setDebug({ saveFailed: !ok });
    return ok;
  },
  /** Every chapter is open: the Konami code has been entered (once is enough). */
  get allChaptersOpen(): boolean {
    return this.data.achievements[KONAMI] !== undefined;
  },
  /**
   * Earns the achievements `ids` (those already earned are left as they are) and saves. Each new
   * one gets a toast and a sound, unless `quiet`. Returns the new ones.
   */
  earn(ids: readonly string[], quiet = false): string[] {
    const fresh = grant(this.data.achievements, ids, Date.now());
    if (fresh.length === 0) return fresh;
    this.persist();
    setDebug({ achievements: Object.keys(this.data.achievements) });
    if (quiet) return fresh;
    for (const id of fresh) {
      const a = achievements.find((x) => x.id === id);
      if (a) showToast(t('achUnlocked', { name: t(a.name) }));
    }
    playSfx('achievement', this.data.settings.sfx);
    return fresh;
  },
  /** Earns what the level records now earn (after a finished level, an import). */
  checkRecords(quiet = false): string[] {
    return this.earn(newlyEarned(achievements, this.data.levels, this.data.achievements), quiet);
  },
};
