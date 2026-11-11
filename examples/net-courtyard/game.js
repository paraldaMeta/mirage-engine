// net-courtyard's rules, imported by the page AND by the server (mirage-net --game game.js): one protocol, one list
// of pickups, one spawn, so the two ends cannot disagree. The world is hello-courtyard's plan.
import plan from '../hello-courtyard/plan.js';
import { kitProtocol, installKit } from '@miragekit/net/kit';

export const protocol = kitProtocol({ bounds: plan.bounds, y: [-2, 12] });
export const spawn = [plan.spawn.eye[0], 0, plan.spawn.eye[2]];
// six lanterns to collect: clear of the basin (r 1.86 at the centre), the palm and the pergola; one outside the gate
export const pickups = [[4.5, 0, 2.5], [-4.8, 0, -1.5], [2.6, 0, -3.4], [-2.2, 0, 5.4], [5.4, 0, -4.6], [0, 0, 11]];
export const tickRate = 20;
/** where the room runs: the server, or the page that hosts */
export const setup = (room, { restored = false } = {}) => installKit(room, { pickups, restored, respawnMs: 8000 });
