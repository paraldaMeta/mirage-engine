// Experiment shim: the two names examples/neon-district/modules/cars.js (and rain-beads.js) take from @miragekit/core,
// so the example's car builder can be imported read-only into models.html without the engine's renderer.
// The wet layer and the rain are off here: the comparison is of shape, on a neutral stage.
export const withWet = (hooks) => hooks;
export const WET = { uRain: { value: 0 } };
