/** Accepts untrusted input. An empty result means the shipped schema and ordering checks passed. */
export function planProblems(plan: unknown): string[];
/** One problem of a plan: the field path, the rule it breaks and the words definePlan prints. */
export interface PlanIssue { path: string; rule: 'required' | 'type' | 'enum' | 'const' | 'finite' | 'range' | 'empty' | 'size' | 'oneOf' | 'order' | 'walk'; message: string }
/** The same checks as planProblems, structured. */
export function planIssues(plan: unknown): PlanIssue[];
