// @ts-check
import { definePlan } from '@mirage/world';
import { addTerrain } from '@mirage/world/kits/terrain';

const plan = definePlan({ name: 'checked-js', bounds: [-2, -2, 2, 2], cabin: { height: 2.5 } });
plan.cabin.height.toFixed(1);
// @ts-expect-error the custom field is not any in JavaScript either
plan.cabin.height.toUpperCase();
/** @type {import('@mirage/world').WorldModule<typeof plan>} */
export const ground = {
  name: 'ground',
  build(ctx) { return addTerrain(ctx, { bounds: ctx.plan.bounds, sample: () => 0 }); },
};
