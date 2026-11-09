import * as THREE from 'three';
import { fbm2, geom } from '@mirage/core';
import { addTerrain } from '@mirage/world/kits/terrain';
import { addWater } from '@mirage/world/kits/water';
import { addGrass, addTreeCanopies } from '@mirage/world/kits/vegetation';
import { channelX } from './plan.js';

const bed = {
  name: 'riverbed',
  build(ctx) {
    const seed = ctx.rng('bank-relief').seed;
    const material = ctx.mat.std({ roughness: 0.94 }, {
      albedo: `{
        float bank = smoothstep(-0.10, 0.95, mgWorldPos.y);
        float grain = mgFbm3(mgWorldPos * 5.0, 3);
        vec3 shore = mix(vec3(0.19, 0.15, 0.095), vec3(0.13, 0.16, 0.068), bank);
        diffuseColor.rgb *= shore * (1.0 + 0.31 * grain);
      }`,
    });
    return addTerrain(ctx, { ...ctx.plan.land, material, surface: 'gravel', sample(x, z) {
      const d = Math.abs(x - channelX(z));
      const bank = geom.smoothstep(1.7, 6.1, d);
      const gravel = fbm2(x * 0.29, z * 0.29, 3, seed) - 0.5;
      const hills = geom.smoothstep(11, 32, d) * (2 + 6 * fbm2(x * 0.055, z * 0.055, 3, seed));
      return -0.65 + 1.8 * bank + 0.16 * gravel + hills;
    } });
  },
};

const stream = { name: 'stream', build(ctx) { return addWater(ctx, ctx.plan.creek); } };

const banks = {
  name: 'banks',
  build(ctx) {
    const { heightAt } = ctx.modules.riverbed, R = ctx.rng('shingle');
    const stones = [];
    for (let i = 0; i < 460; i++) {
      const z = R.range(-17, 17), x = channelX(z) + R.sign() * R.range(1.7, 5.5);
      const r = R.range(0.05, 0.32);
      stones.push(geom.compose([x, heightAt(x, z), z], [0, R.range(0, Math.PI * 2), 0], [r, r * 0.32, r * 0.74]));
    }
    const gravel = geom.instances(new THREE.IcosahedronGeometry(1, 0), ctx.mat.std({ color: 0x837865, roughness: 0.88 }), stones);
    gravel.userData.collide = false; gravel.name = 'rounded-shingle';
    ctx.root.add(gravel);
    const trees = [[-8,-8,7],[-11,-13,6],[-9,10,6],[9,8,6.6],[12,13,8],[8,-12,7.4],[-6,-18,7.6],[9,-20,8],
      [-13,20,8],[13,21,7],[-14,-24,10],[14,-25,9]].map(([x,z,height]) => ({ pos: [x,heightAt(x,z),z], height }));
    addTreeCanopies(ctx, { trees, cardsPerTree: ctx.quality === 'low' ? 40 : 70 });
    addGrass(ctx, { bounds: [-16,-22,16,22], count: ctx.quality === 'low' ? 1200 : 2600, height: 0.58,
      heightAt, include: (x,z) => Math.abs(z) > 1.5 && heightAt(x,z) > 0.1 });
  },
};

export default [bed, stream, banks];
