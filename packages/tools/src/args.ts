export const USAGE =
  'usage: validate | solve|improve <id…>|--all [--timeout s] [--max-states n] [--max-memory MB] [--jobs n] [--gpu auto|on|off] [--max-vram Mo] [--apply] [--force]';

/** engine for global exact searches: GPU when possible (auto), required (on), never (off) */
export type GpuMode = 'auto' | 'on' | 'off';
const GPU_MODES: readonly string[] = ['auto', 'on', 'off'];

export type ParsedArgs =
  | { kind: 'validate' }
  | {
      /** solve: exact search only; improve: "best known" pipeline */
      kind: 'solve' | 'improve';
      ids: string[] | 'all';
      timeoutMs: number;
      /** state limit; undefined = unlimited (memory decides) */
      maxStates: number | undefined;
      /** solver memory cap per process, in MB; undefined = computed (see parallel) */
      maxMemoryMb: number | undefined;
      /** parallel solver processes; undefined = default (see cli) */
      jobs: number | undefined;
      apply: boolean;
      force: boolean;
      gpu: GpuMode;
      /** VRAM of each GPU search, in MB; undefined = GPU engine default */
      maxVramMb?: number | undefined;
    }
  | { kind: 'error'; message: string };

const VALUED = new Set([
  '--timeout',
  '--max-states',
  '--max-memory',
  '--jobs',
  '--gpu',
  '--max-vram',
]);

/** strictly positive value of the option, undefined if absent, message if invalid */
function positive(args: string[], name: string): number | undefined | string {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const raw = args[i + 1];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    return `${name} expects a strictly positive number (got: ${raw ?? 'nothing'})`;
  return n;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...args] = argv;
  if (cmd === 'validate') return { kind: 'validate' };
  if (cmd !== 'solve' && cmd !== 'improve') return { kind: 'error', message: USAGE };
  const timeout = positive(args, '--timeout') ?? 60;
  if (typeof timeout === 'string') return { kind: 'error', message: `${timeout}\n${USAGE}` };
  const maxStates = positive(args, '--max-states');
  if (typeof maxStates === 'string') return { kind: 'error', message: `${maxStates}\n${USAGE}` };
  const maxMemoryMb = positive(args, '--max-memory');
  if (typeof maxMemoryMb === 'string')
    return { kind: 'error', message: `${maxMemoryMb}\n${USAGE}` };
  const maxVramMb = positive(args, '--max-vram');
  if (typeof maxVramMb === 'string') return { kind: 'error', message: `${maxVramMb}\n${USAGE}` };
  let jobs: number | undefined;
  if (args.includes('--jobs')) {
    const j = positive(args, '--jobs');
    if (typeof j !== 'number' || !Number.isInteger(j))
      return {
        kind: 'error',
        message: `--jobs expects an integer ≥ 1 (got: ${args[args.indexOf('--jobs') + 1] ?? 'nothing'})\n${USAGE}`,
      };
    jobs = j;
  }
  let gpu: GpuMode = 'auto';
  if (args.includes('--gpu')) {
    const raw = args[args.indexOf('--gpu') + 1];
    if (raw === undefined || !GPU_MODES.includes(raw))
      return {
        kind: 'error',
        message: `--gpu expects auto, on or off (got: ${raw ?? 'nothing'})\n${USAGE}`,
      };
    gpu = raw as GpuMode;
  }
  const all = args.includes('--all');
  const ids = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''));
  if (!all && ids.length === 0) return { kind: 'error', message: `no level given\n${USAGE}` };
  return {
    kind: cmd,
    ids: all ? 'all' : ids,
    timeoutMs: timeout * 1000,
    maxStates,
    maxMemoryMb,
    jobs,
    apply: args.includes('--apply'),
    force: args.includes('--force'),
    gpu,
    ...(maxVramMb !== undefined ? { maxVramMb } : {}),
  };
}
