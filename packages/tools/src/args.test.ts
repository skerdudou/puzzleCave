import { expect, test } from 'vitest';
import { parseArgs } from './args';

test('validate', () => {
  expect(parseArgs(['validate'])).toEqual({ kind: 'validate' });
});

test('solve with ids and default values', () => {
  expect(parseArgs(['solve', 'pc-01', 'pc-02'])).toEqual({
    kind: 'solve',
    ids: ['pc-01', 'pc-02'],
    timeoutMs: 60_000,
    // no state limit nor explicit cap: memory decides (see parallel.ts)
    maxStates: undefined,
    maxMemoryMb: undefined,
    apply: false,
    force: false,
    gpu: 'auto',
  });
});

test('solve --all with limits and options', () => {
  expect(
    parseArgs(['solve', '--all', '--timeout', '5', '--max-states', '1000', '--apply', '--force']),
  ).toEqual({
    kind: 'solve',
    ids: 'all',
    timeoutMs: 5000,
    maxStates: 1000,
    apply: true,
    force: true,
    gpu: 'auto',
  });
});

test('improve: solution search options', () => {
  expect(
    parseArgs([
      'improve',
      'pc-11',
      '--from-scratch',
      '--find-timeout',
      '600',
      '--find-memory',
      '4096',
      '--key-closure',
    ]),
  ).toMatchObject({
    kind: 'improve',
    ids: ['pc-11'],
    find: { fromScratch: true, timeoutMs: 600_000, memoryMb: 4096, keyClosure: true },
  });
  expect(parseArgs(['improve', 'pc-11'])).not.toHaveProperty('find');
  expect(parseArgs(['solve', 'pc-11', '--key-closure'])).not.toHaveProperty('find');
  expect(parseArgs(['improve', 'pc-11', '--find-memory', '0'])).toMatchObject({ kind: 'error' });
});

test('option values are not mistaken for ids', () => {
  const r = parseArgs(['solve', '--timeout', '5', 'pc-03']);
  expect(r).toMatchObject({ kind: 'solve', ids: ['pc-03'] });
});

test.each([
  [['solve', 'pc-01', '--timeout']],
  [['solve', 'pc-01', '--timeout', 'abc']],
  [['solve', 'pc-01', '--timeout', '0']],
  [['solve', 'pc-01', '--timeout', '-3']],
  [['solve', 'pc-01', '--max-states']],
  [['solve', 'pc-01', '--max-states', 'x']],
  [['solve', 'pc-01', '--max-states', '0']],
  [['solve', 'pc-01', '--max-states', 'Infinity']],
  [['solve', 'pc-01', '--max-memory']],
  [['solve', 'pc-01', '--max-memory', '0']],
  [['solve', 'pc-01', '--max-memory', 'lots']],
])('%j: usage error', (argv) => {
  expect(parseArgs(argv)).toMatchObject({ kind: 'error' });
});

test('solve without id or --all, missing or unknown command: usage error', () => {
  expect(parseArgs(['solve'])).toMatchObject({ kind: 'error' });
  expect(parseArgs(['solve', '--apply'])).toMatchObject({ kind: 'error' });
  expect(parseArgs([])).toMatchObject({ kind: 'error' });
  expect(parseArgs(['nope'])).toMatchObject({ kind: 'error' });
});

test('solve --jobs', () => {
  expect(parseArgs(['solve', '--all', '--jobs', '4'])).toMatchObject({ kind: 'solve', jobs: 4 });
  expect(parseArgs(['solve', '--all'])).toMatchObject({ kind: 'solve', jobs: undefined });
  expect(parseArgs(['solve', '--jobs', '2', 'pc-01'])).toMatchObject({ ids: ['pc-01'], jobs: 2 });
});

test.each([[[]], [['0']], [['-1']], [['1.5']], [['x']], [['Infinity']]])(
  '--jobs %j: usage error',
  (value) => {
    expect(parseArgs(['solve', '--all', '--jobs', ...value])).toMatchObject({ kind: 'error' });
  },
);

test('solve --max-memory (MB per process)', () => {
  expect(parseArgs(['solve', '--all', '--max-memory', '2000'])).toMatchObject({
    kind: 'solve',
    maxMemoryMb: 2000,
    ids: 'all',
  });
  expect(parseArgs(['solve', '--max-memory', '1500', 'pc-01'])).toMatchObject({ ids: ['pc-01'] });
});

test('improve: same options as solve', () => {
  expect(parseArgs(['improve', 'pc-04', '--timeout', '600', '--apply'])).toEqual({
    kind: 'improve',
    ids: ['pc-04'],
    timeoutMs: 600_000,
    maxStates: undefined,
    maxMemoryMb: undefined,
    jobs: undefined,
    apply: true,
    force: false,
    gpu: 'auto',
  });
  expect(
    parseArgs(['improve', '--all', '--jobs', '3', '--force', '--max-memory', '2000']),
  ).toMatchObject({
    kind: 'improve',
    ids: 'all',
    jobs: 3,
    maxMemoryMb: 2000,
    force: true,
  });
  expect(parseArgs(['improve'])).toMatchObject({ kind: 'error' });
  expect(parseArgs(['improve', 'x', '--timeout', '0'])).toMatchObject({ kind: 'error' });
});

test('--gpu auto|on|off (auto by default) and --max-vram', () => {
  const plain = parseArgs(['solve', 'pc-01']);
  expect(plain).toMatchObject({ gpu: 'auto' });
  expect(plain.kind === 'solve' && plain.maxVramMb).toBeUndefined();
  for (const mode of ['auto', 'on', 'off'])
    expect(parseArgs(['improve', '--gpu', mode, 'pc-01'])).toMatchObject({
      kind: 'improve',
      ids: ['pc-01'],
      gpu: mode,
    });
  expect(parseArgs(['solve', '--all', '--max-vram', '6000'])).toMatchObject({ maxVramMb: 6000 });
  expect(parseArgs(['solve', '--max-vram', '6000', 'pc-02'])).toMatchObject({ ids: ['pc-02'] });
});

test.each([
  [['solve', 'pc-01', '--gpu']],
  [['solve', 'pc-01', '--gpu', 'yes']],
  [['solve', '--gpu', '--all']],
  [['solve', 'pc-01', '--max-vram', '0']],
  [['solve', 'pc-01', '--max-vram']],
])('%j: usage error', (argv) => {
  expect(parseArgs(argv)).toMatchObject({ kind: 'error' });
});
