// GPU thread of the long-run batch expansion (worker_threads): loads tsx in this thread, then
// the TypeScript host.
import { register } from 'tsx/esm/api';

register();
await import('./batchHost.ts');
