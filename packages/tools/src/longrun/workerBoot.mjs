// Long-run worker thread entry point (worker_threads): loads tsx in this thread, then the
// TypeScript worker.
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
