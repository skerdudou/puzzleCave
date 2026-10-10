// global state: save, language, author mode
import { detectLang, setLang } from './i18n';
import { SaveStore, browserStorage, defaultSave, type SaveData } from './save';

export const app = {
  store: new SaveStore(browserStorage()),
  data: defaultSave() as SaveData,
  author: false,
  init(): void {
    this.data = this.store.load();
    this.author = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
    setLang(this.data.settings.lang ?? detectLang(navigator.languages ?? []));
  },
  persist(): void {
    this.store.save(this.data);
  },
};
