// GPU thread entry point (worker_threads): loads tsx in this thread, then the TypeScript host.
import { register } from 'tsx/esm/api';

register();
await import('./host.ts');
