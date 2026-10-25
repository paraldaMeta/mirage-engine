// The modules of hello-courtyard, in build order (props last: it consumes the lamps anchors in finalize).
import ground from './ground.js';
import walls from './walls.js';
import vegetation from './vegetation.js';
import props from './props.js';
import broken from './broken.js';
export default (opts = {}) => [ground, walls, ...(opts.broken ? [broken] : []), vegetation, props];
