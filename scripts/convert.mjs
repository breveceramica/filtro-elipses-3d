/**
 * convert.mjs
 * Converts assets/Filtro_Elipses.obj → assets/filtro.glb
 *
 * Usage:
 *   node scripts/convert.mjs
 *
 * Requires obj2gltf (already in devDependencies):
 *   npm install
 */

import obj2gltf from 'obj2gltf'
import { writeFile, access } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')
const INPUT     = resolve(ROOT, 'assets', 'Filtro_Elipses.obj')
const OUTPUT    = resolve(ROOT, 'assets', 'filtro.glb')

async function main() {
  // Check input exists
  try {
    await access(INPUT)
  } catch {
    console.error(`\n❌  Arquivo não encontrado: ${INPUT}`)
    console.error('    Copie Filtro_Elipses.obj para a pasta assets/ e tente novamente.\n')
    process.exit(1)
  }

  console.log('⚙️   Convertendo OBJ → GLB...')
  console.log(`    entrada: ${INPUT}`)
  console.log(`    saída:   ${OUTPUT}\n`)

  try {
    const glb = await obj2gltf(INPUT, {
      binary: true,          // output GLB (binary GLTF)
      checkTransparency: false,
      secure: false,
    })

    await writeFile(OUTPUT, Buffer.from(glb))
    const sizeMB = (glb.byteLength / 1024 / 1024).toFixed(1)
    console.log(`✅   GLB gerado com sucesso! (${sizeMB} MB)`)
    console.log(`    → ${OUTPUT}\n`)
    console.log('Agora rode:  npm run dev\n')
  } catch (err) {
    console.error('❌   Erro na conversão:', err.message)
    process.exit(1)
  }
}

main()
