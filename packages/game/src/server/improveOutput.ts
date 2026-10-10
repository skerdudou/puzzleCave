// Parsing of the `improve` output (see packages/tools/src/improve.ts, reportImprove).
export interface ImproveSummary {
  before?: number;
  after?: number;
  proven?: boolean;
  lowerBound?: number;
  unsolvable?: boolean;
  warnings?: string[];
}

const RESULT =
  /^\S+: solution (?:saved|found) \((\d+)\) → (\d+) moves — (optimal \(proven\)|best known, proven lower bound ≥ (\d+))/;
const NONE = /^\S+: no solution — (unsolvable|proven lower bound ≥ (\d+))/;
const WARN = /^\S+: .*(impossible threshold|warning|invalid|error)/;

export function parseImproveOutput(lines: readonly string[]): ImproveSummary {
  const out: ImproveSummary = {};
  const warnings: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = RESULT.exec(line);
    if (m) {
      out.before = Number(m[1]);
      out.after = Number(m[2]);
      out.proven = m[4] === undefined;
      out.lowerBound = m[4] === undefined ? out.after : Number(m[4]);
      continue;
    }
    const n = NONE.exec(line);
    if (n) {
      out.unsolvable = n[1] === 'unsolvable';
      if (n[2] !== undefined) out.lowerBound = Number(n[2]);
      continue;
    }
    if (WARN.test(line)) warnings.push(line);
  }
  if (warnings.length) out.warnings = warnings;
  return out;
}
