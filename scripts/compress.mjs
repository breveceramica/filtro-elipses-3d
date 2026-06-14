import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, weld } from '@gltf-transform/functions';
import draco3d from 'draco3d';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.join(__dirname, '../Breve_Filtro_Agua_Elipses.glb');
const DEST = path.join(__dirname, '../public/assets/filtro_keyshot.glb');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const encoder = await draco3d.createEncoderModule();
const decoder = await draco3d.createDecoderModule();
io.registerDependencies({ 'draco3d.encoder': encoder, 'draco3d.decoder': decoder });

console.log('Reading...');
const doc = await io.read(SRC);

console.log('Processing...');
await doc.transform(
  dedup(),
  prune(),
  weld(),
  draco({ quantizationVolume: 'scene' }),
);

console.log('Writing...');
await io.write(DEST, doc);
console.log('Done →', DEST);
