import { t } from '../i18n';

/** JSON shape of GET /__pc/job/:id */
export interface JobInfo {
  state: 'running' | 'done' | 'failed';
  levelId: string;
  log: string[];
  elapsedMs: number;
  timeoutS: number;
  before?: number;
  after?: number;
  proven?: boolean;
  lowerBound?: number;
  warnings: string[];
  tmxChanged: boolean;
  /** goldTime (s) written into the level by the run (a new level gets its reference time) */
  goldTime?: number;
  /** the old proven-optimal solution was kept (the new run did not prove it) */
  proofKept?: boolean;
}

export interface JobText {
  headline: string;
  detail: string;
  /** finished with a strictly shorter solution */
  improved: boolean;
}

/** the reference time written into the level by the run, if any */
function goldTimeText(job: JobInfo): string {
  return job.goldTime !== undefined ? t('goldTimeSet', { s: job.goldTime }) : '';
}

/** detail of a finished run: the reference time written, then the warnings */
function doneDetail(job: JobInfo): string {
  return [goldTimeText(job), job.warnings.join(' ')].filter(Boolean).join('\n');
}

/** Progress or result text; `tick` animates the dots. No duration is assumed. */
export function describeJob(job: JobInfo, tick: number): JobText {
  if (job.state === 'running') {
    const last = [...job.log].reverse().find((l) => l.startsWith('  '));
    return {
      headline: `${t('optimizing', { dots: '.'.repeat(tick % 4) })} ${t('optimizingTime', { s: Math.floor(job.elapsedMs / 1000) })}`,
      detail: last?.trim() ?? '',
      improved: false,
    };
  }
  if (job.state === 'failed' || job.after === undefined) {
    return {
      headline: t('optimizeFailed'),
      detail: [job.log.slice(-2).join(' ').trim(), goldTimeText(job), ...job.warnings]
        .filter(Boolean)
        .join('\n'),
      improved: false,
    };
  }
  const status = job.proven ? t('statusProven') : t('statusBest', { lb: job.lowerBound ?? '?' });
  if (job.proofKept) {
    return {
      headline: t('proofKept', { n: job.after }),
      detail: doneDetail(job),
      improved: false,
    };
  }
  const before = job.before ?? job.after;
  if (job.after < before) {
    return {
      headline: t('optimizedFromTo', { from: before, to: job.after, status }),
      detail: doneDetail(job),
      improved: true,
    };
  }
  return {
    headline: job.proven
      ? t('alreadyOptimal', { n: job.after })
      : t('noImprovement', { n: job.after, status }),
    detail: doneDetail(job),
    improved: false,
  };
}
