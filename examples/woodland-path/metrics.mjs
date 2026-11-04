import { writeExampleMetrics } from '../../packages/tools/src/example-metrics.mjs';
import plan from './plan.js';

writeExampleMetrics(import.meta.url, plan);
