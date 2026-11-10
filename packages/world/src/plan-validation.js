import schema from '../plan.schema.json' with { type: 'json' };

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const field = (path, key) => /^[a-zA-Z_$][\w$]*$/.test(key)
  ? (path ? path + '.' + key : key) : path + '[' + JSON.stringify(key) + ']';

// Only the keywords used by the shipped schema are needed in a standalone world. Both the loader and CLI
// call this path. Coordinates and cross-field bounds are checked before the walk grid is allocated.
/** The problems as strings "path: message" (what definePlan throws). */
export function planProblems(plan) {
  return planIssues(plan).map(i => i.path + ': ' + i.message);
}

/** The same problems, structured: [{ path, rule, message }]. rule: required | type | enum | const | finite |
 *  range | empty | size | oneOf | order | walk (the tools map rules to diagnostic codes, docs/diagnostics.md). */
export function planIssues(plan) {
  const problems = [];
  const issue = (path, message, r) => problems.push({ path: path || '<plan>', rule: r, message });

  function visit(rule, value, path) {
    if (rule.$ref) rule = schema.$defs[rule.$ref.slice('#/$defs/'.length)];
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (rule.type && ![].concat(rule.type).includes(type)) { issue(path, 'expected ' + [].concat(rule.type).join(' or '), 'type'); return; }
    if (rule.const !== undefined && value !== rule.const) issue(path, 'expected ' + rule.const, 'const');
    if (rule.enum && !rule.enum.includes(value)) issue(path, 'expected one of ' + rule.enum.join(', '), 'enum');
    if (type === 'number') {
      if (!Number.isFinite(value)) issue(path, 'expected a finite number', 'finite');
      else if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) issue(path, 'must be greater than ' + rule.exclusiveMinimum, 'range');
    }
    if (type === 'string' && value.length < rule.minLength) issue(path, 'must not be empty', 'empty');
    if (type === 'array') {
      if (value.length < rule.minItems || value.length > rule.maxItems) {
        const size = rule.minItems === rule.maxItems ? rule.minItems + ' coordinates' : 'at least ' + rule.minItems + ' entries';
        issue(path, 'expected ' + size, 'size');
      }
      for (let i = 0; i < value.length; i++) {
        const item = rule.prefixItems?.[i] ?? rule.items;
        if (item) visit(item, value[i], path + '[' + i + ']');
      }
    }
    if (type !== 'object') return;
    const has = (key) => Object.hasOwn(value, key) && value[key] !== undefined;   // { seed: undefined } is no seed
    for (const key of rule.required || []) if (!has(key)) issue(field(path, key), 'is required', 'required');
    if (rule.oneOf) {
      const keys = rule.oneOf.map(option => option.required[0]);
      if (keys.filter(has).length !== 1) issue(path, 'expected exactly one of ' + keys.join(', '), 'oneOf');
    }
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const known = rule.properties && Object.hasOwn(rule.properties, key);
      const childRule = known ? rule.properties[key] : rule.additionalProperties;
      if (childRule) visit(childRule, child, field(path, key));
    }
  }

  function orderedRect(rect, path) {
    if (!Array.isArray(rect)) return;
    for (const axis of [0, 1]) {
      if (Number.isFinite(rect[axis]) && Number.isFinite(rect[axis + 2]) && rect[axis + 2] <= rect[axis]) {
        issue(path + '[' + (axis + 2) + ']', 'must be greater than ' + path + '[' + axis + ']', 'order');
      }
    }
  }

  visit(schema, plan, '');
  if (!record(plan)) return problems;
  orderedRect(plan.bounds, 'bounds');
  for (const group of ['regions', 'footprints']) {
    if (!record(plan[group])) continue;
    for (const [key, shape] of Object.entries(plan[group])) orderedRect(shape?.rect, field(group, key) + '.rect');
  }
  if (record(plan.walk)) {
    const { yMin = -1, yMax = 12 } = plan.walk;
    if (Number.isFinite(yMin) && Number.isFinite(yMax) && yMin >= yMax) issue('walk.yMax', 'must be greater than walk.yMin', 'walk');
  }
  return problems;
}
