# Filtro Elipses — Visualizador 3D

Projeto de visualizador 3D interativo para o produto Filtro Elipses da Breve Cerâmica.
Stack: Vite + Three.js r165 + OrbitControls + GLTFLoader.

---

## Setup inicial (rodar uma vez)

```bash
npm install
```

---

## Fluxo completo de primeira execução

**Passo 1 — Converter OBJ → GLB**

O arquivo `assets/Filtro_Elipses.obj` precisa ser convertido para GLB antes de usar.
Execute:

```bash
node scripts/convert.mjs
```

Isso gera `assets/filtro.glb`. Se der erro de módulo, instale a dependência:

```bash
npm install obj2gltf
node scripts/convert.mjs
```

**Passo 2 — Dev server**

```bash
npm run dev
```

Abre em http://localhost:5173

**Passo 3 — Build para produção**

```bash
npm run build
```

Gera pasta `dist/` pronta para deploy (Netlify, Vercel, GitHub Pages).

---

## Estrutura do projeto

```
filtro-elipses-3d/
├── CLAUDE.md
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.js        ← entry: inicializa viewer + UI
│   ├── viewer.js      ← Three.js: câmera, luzes, modelo, materiais
│   ├── ui.js          ← sidebar: swatches, sliders, botões
│   └── style.css      ← layout completo
└── assets/
    ├── Filtro_Elipses.obj  ← modelo original (não committar se >50MB)
    ├── filtro.glb          ← gerado pelo convert.mjs
    └── logo.png            ← logo Breve Cerâmica
```

---

## O que o viewer.js faz

- Carrega `assets/filtro.glb` via GLTFLoader
- Centraliza o modelo automaticamente com Box3.getCenter()
- OrbitControls com:
  - enableDamping: true (giro suave)
  - minDistance / maxDistance (zoom limitado)
  - maxPolarAngle: Math.PI * 0.85 (não vai abaixo do chão)
- 3 luzes DirectionalLight + AmbientLight
- Materiais MeshStandardMaterial por grupo:
  - "barro" (lower, upper, lid) → bodyMat
  - "base" (Pé) → baseMat  
  - "torneira" (Torneira) → tapMat
- Sombra projetada no chão (PlaneGeometry)
- Environment map (RoomEnvironment do Three.js para PBR real)

## Grupos do modelo OBJ

O modelo tem exatamente estes grupos (verificar no GLB):
- `Módulo baixo Vis` → barro
- `Módulo topo Vis` → barro
- `Tampa VIs` → barro
- `Pé` → alumínio
- `Torneira` → inox

## Paleta de materiais disponíveis

```js
// Barro
clay:   #A05030  rough:0.88  metal:0.00
white:  #D8D0C4  rough:0.90  metal:0.00
dark:   #2C2520  rough:0.85  metal:0.03
sage:   #5E7A5C  rough:0.87  metal:0.00
sand:   #C4996A  rough:0.84  metal:0.00
indigo: #484888  rough:0.85  metal:0.02

// Base metálica
steel:  #C0CACC  rough:0.30  metal:0.92
gold:   #C8A030  rough:0.20  metal:0.95
copper: #AA6030  rough:0.25  metal:0.90
black:  #181818  rough:0.75  metal:0.35
```

## Melhorias que o Code deve implementar

1. **OrbitControls nativos** — já incluídos via three/addons, giro perfeito out-of-the-box
2. **GLB com materiais** — o convert.mjs gera GLB com cores do OBJ, depois sobrescreve via JS
3. **Environment lighting** — `PMREMGenerator` + `RoomEnvironment` para reflections PBR reais
4. **Sombra no chão** — `renderer.shadowMap.enabled`, luz com `castShadow`
5. **Animação de câmera inicial** — ao carregar, câmera faz um pequeno zoom-in suave
6. **Loading overlay** — spinner enquanto GLB carrega, fade-out ao terminar
7. **Resize responsivo** — `window.addEventListener('resize', onResize)`
8. **Explode animation** — tween das peças com Three.js clock delta

## Problemas conhecidos / o que NÃO fazer

- NÃO usar `matrix` manual para câmera — usar só OrbitControls
- NÃO calcular lookAt manualmente — OrbitControls faz isso
- NÃO deixar target do OrbitControls em (0,0,0) — usar `box.getCenter(target)` do modelo carregado
- Se o modelo aparecer muito grande: ajustar `camera.position` após `box.getSize()`
- Se as normais estiverem invertidas no GLB: adicionar `side: THREE.DoubleSide` temporariamente

## Deploy

O `dist/` gerado pelo `npm run build` pode ser jogado diretamente no Netlify drag-and-drop.
O GLB fica em `dist/assets/filtro.glb` — o Vite cuida do hash de cache automaticamente.
