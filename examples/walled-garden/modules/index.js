// The modules of walled-garden in build order; props last (it consumes every anchor in finalize).
import terraces from './terraces.js';
import walls from './walls.js';
import paths from './paths.js';
import pavilion from './pavilion.js';
import vegetation from './vegetation.js';
import props from './props.js';
import broken from './broken.js';
import lawn from './lawn.js';
// opts.lawn ('fur' | 'fur-fins' | 'tufts'): turf on one lawn panel (lawn.js), only when asked for
export default (opts = {}) => [terraces, walls, ...(opts.broken ? [broken] : []), paths, pavilion, vegetation, ...(opts.lawn ? [lawn(opts.lawn)] : []), props];
