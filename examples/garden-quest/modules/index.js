// garden-quest builds with walled-garden's modules plus the lantern stands; props stays last.
import terraces from '../../walled-garden/modules/terraces.js';
import walls from '../../walled-garden/modules/walls.js';
import paths from '../../walled-garden/modules/paths.js';
import pavilion from '../../walled-garden/modules/pavilion.js';
import vegetation from '../../walled-garden/modules/vegetation.js';
import props from '../../walled-garden/modules/props.js';
import stands from './stands.js';
export default [terraces, walls, paths, pavilion, stands, vegetation, props];
