// global state: save, language, author mode
import { setDebug } from './debug';
import { detectLang, setLang, t } from './i18n';
import { showNotice } from './notice';
import { saveContext } from './levels';
import { SaveStore, browserStorage, defaultSave, type SaveData } from './save';

export const app = {
  store: new SaveStore(browserStorage(), saveContext),
  data: defaultSave() as SaveData,
  author: false,
  init(): void {
    this.data = this.store.load();
    // development server only: the published build never opens author mode (no ?dev switch)
    this.author = import.meta.env.DEV;
    setLang(this.data.settings.lang ?? detectLang(navigator.languages ?? []));
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
};
