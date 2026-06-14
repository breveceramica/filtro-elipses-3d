import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

// ── Material definitions ──────────────────────────────────────────────────
export const BODY_MATS = {
  clay:        { color: 0x9B4020, roughness: 0.97, metalness: 0.00 },
  verde_folha: { color: 0x4A6B30, roughness: 0.96, metalness: 0.00 },
  white:       { color: 0xD8D2CA, roughness: 0.96, metalness: 0.00 },
}
export const BASE_MATS = {
  steel: { color: 0xB4BCBF, roughness: 0.38, metalness: 0.88 },
  latao: { color: 0xB89A38, roughness: 0.36, metalness: 0.86 },
}

// ── Mesh number → material role ───────────────────────────────────────────
// obj2gltf flattens all OBJ groups; nodes are named mesh0..mesh192.
//   mesh0–31:    Módulo baixo  → body_lower
//   mesh32–62:   Módulo topo   → body_upper
//   mesh63–115:  Tampa         → lid
//   mesh116–154: Pé            → base
//   mesh155–169: Torneira      → tap
//   mesh170–192: Vela          → vela (ceramic white candle)
function meshRole(name) {
  const m = name.match(/^mesh(\d+)$/)
  if (!m) return 'body_lower'
  const n = parseInt(m[1], 10)
  if (n <= 31)  return 'body_lower'
  if (n <= 62)  return 'body_upper'
  if (n <= 115) return 'lid'
  if (n <= 154) return 'base'
  if (n <= 169) return 'tap'
  return 'vela'
}

// ── Environment configs ───────────────────────────────────────────────────
const ENVS = [
  { bg: 0xF0EBE4, ambInt: 0.55, label: 'Estúdio', kitchen: false },
  { bg: 0xE8EEF5, ambInt: 0.65, label: 'Frio',    kitchen: false },
  { bg: 0xF2EEE8, ambInt: 0.72, label: 'Gourmet', kitchen: true  },
]

export class Viewer {
  constructor(canvas) {
    this.canvas    = canvas
    this.envIdx    = 0
    this.autoRot   = false
    this.exploding = false
    this.explodeT  = 0
    this.wireframe = false

    // Three objects set after init
    this.renderer  = null
    this.scene     = null
    this.camera    = null
    this.controls  = null
    this.model     = null

    // Material instances
    this.bodyMat   = null
    this.baseMat   = null
    this.tapMat    = null

    // Mesh groups for explode
    this.meshGroups = {}

    // Original positions for explode
    this.origPositions = {}

    // Kitchen environment group (shown only in Gourmet env)
    this._kitchenGroup = null
    this._roomEnvTexture = null
    this._kitchenHDR     = null

    this._init()
  }

  // ── Init ────────────────────────────────────────────────────────────────
  _init() {
    const canvas = this.canvas

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap
    renderer.outputColorSpace  = THREE.SRGBColorSpace
    renderer.toneMapping       = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    this.renderer = renderer

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(ENVS[0].bg)
    this.scene = scene

    // Environment (PBR reflections)
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envTexture = pmrem.fromScene(new RoomEnvironment(renderer)).texture
    scene.environment = envTexture
    scene.environmentIntensity = 1.6
    this._roomEnvTexture = envTexture
    // Kitchen HDR loads async — pmrem disposed inside after use
    this._loadKitchenHDR(renderer, pmrem)

    // Camera — positioned after model loads
    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 50)
    camera.position.set(0, 0.3, 1.5)
    this.camera = camera

    // Controls
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping    = true
    controls.dampingFactor    = 0.06
    controls.enablePan        = false
    controls.minDistance      = 0.3
    controls.maxDistance      = 4
    controls.maxPolarAngle    = Math.PI * 0.85
    controls.autoRotateSpeed  = 1.5
    this.controls = controls

    // Lights
    const ambient = new THREE.AmbientLight(0xfff5ee, ENVS[0].ambInt)
    ambient.name = 'ambient'
    scene.add(ambient)

    // Soft studio key — front-left, gentle like a large softbox
    const key = new THREE.DirectionalLight(0xfffaf5, 1.9)
    key.position.set(-1.5, 4, 3)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.1
    key.shadow.camera.far  = 12
    key.shadow.camera.left = key.shadow.camera.bottom = -0.8
    key.shadow.camera.right = key.shadow.camera.top   =  0.8
    key.shadow.bias   = -0.0008
    key.shadow.radius = 6
    scene.add(key)

    // Strong warm fill to match studio wrap-around softness
    const fill = new THREE.DirectionalLight(0xfff5ee, 1.4)
    fill.position.set(3, 2, 1)
    scene.add(fill)

    // Back rim — very subtle
    const rim = new THREE.DirectionalLight(0xfff0e8, 0.3)
    rim.position.set(0, 3, -4)
    scene.add(rim)

    // Hemisphere fills bottom shadows with warm ground bounce
    const hemi = new THREE.HemisphereLight(0xfff8f0, 0xf0e8e0, 0.7)
    scene.add(hemi)

    // Ground shadow catcher
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.12, transparent: true })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // Kitchen environment (countertop + wall, hidden until Gourmet env)
    this._kitchenGroup = this._buildKitchen()
    scene.add(this._kitchenGroup)

    // Materials (shared instances — MeshPhysicalMaterial for better PBR)
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color:             BODY_MATS.clay.color,
      roughness:         BODY_MATS.clay.roughness,
      metalness:         BODY_MATS.clay.metalness,
      specularIntensity: 0.06,  // barely any sheen — unglazed ceramic
      specularColor:     new THREE.Color(0xfff4ee),
    })
    this.baseMat = new THREE.MeshPhysicalMaterial({
      color:     BASE_MATS.steel.color,
      roughness: BASE_MATS.steel.roughness,
      metalness: BASE_MATS.steel.metalness,
    })
    // tapMat is separate — same color as base but more polished (stainless look)
    this.tapMat = new THREE.MeshPhysicalMaterial({
      color:     BASE_MATS.steel.color,
      roughness: 0.20,
      metalness: 0.90,
    })
    // Vela: off-white fired ceramic (Stefani candle)
    this.velaMat = new THREE.MeshPhysicalMaterial({
      color:             0xEFEBE3,
      roughness:         0.78,
      metalness:         0.00,
      specularIntensity: 0.10,
      specularColor:     new THREE.Color(0xffffff),
    })

    // Resize
    this._onResize()
    window.addEventListener('resize', () => this._onResize())

    // Animate
    this._animate()
  }

  // ── Load model ──────────────────────────────────────────────────────────
  async loadModel(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader()
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene
          this.model  = model

          // ── Auto-fit: rotate (OBJ uses Z-up), center, scale ──
          model.rotation.x = -Math.PI / 2  // Z-up → Y-up

          const box    = new THREE.Box3().setFromObject(model)
          const center = new THREE.Vector3()
          const size   = new THREE.Vector3()
          box.getCenter(center)
          box.getSize(size)

          // Scale: fit longest dimension to 1 unit
          const maxDim = Math.max(size.x, size.y, size.z)
          const scale  = 1.0 / maxDim
          model.scale.setScalar(scale)

          // Re-center after scale
          const box2 = new THREE.Box3().setFromObject(model)
          const center2 = new THREE.Vector3()
          box2.getCenter(center2)
          model.position.sub(center2)

          // Reposition ground to model bottom (recompute after all transforms)
          const box3 = new THREE.Box3().setFromObject(model)
          const groundY = box3.min.y
          const groundMesh = this.scene.children.find(
            c => c.isMesh && c.material instanceof THREE.ShadowMaterial
          )
          if (groundMesh) groundMesh.position.y = groundY - 0.002

          // ── Position kitchen to model bottom ──
          if (this._kitchenGroup) {
            const scaledH = size.y * scale
            const counter = this._kitchenGroup.getObjectByName('counter')
            if (counter) counter.position.y = groundY - 0.025
            const edge = this._kitchenGroup.getObjectByName('edge')
            if (edge) {
              edge.position.y = groundY - 0.002
              edge.position.z = 1.0
            }
          }

          // ── Assign materials by mesh number range ──
          model.traverse((node) => {
            if (!node.isMesh) return
            node.castShadow    = true
            node.receiveShadow = true

            const role = meshRole(node.name)
            if      (role === 'base') node.material = this.baseMat
            else if (role === 'tap')  node.material = this.tapMat
            else if (role === 'vela') node.material = this.velaMat
            else                      node.material = this.bodyMat

            // Store for explode
            if (!this.meshGroups[role]) this.meshGroups[role] = []
            this.meshGroups[role].push(node)
            this.origPositions[node.uuid] = node.position.clone()
          })

          this.scene.add(model)

          // ── Camera: position to frame model ──
          const scaledHeight = size.y * scale
          const scaledMaxW   = Math.max(size.x, size.z) * scale
          const halfFovV = THREE.MathUtils.degToRad(35) / 2
          const aspect   = this.camera.aspect || 1
          const halfFovH = Math.atan(Math.tan(halfFovV) * aspect)
          const distH = (scaledHeight / 2) / Math.tan(halfFovV)
          const distW = (scaledMaxW  / 2) / Math.tan(halfFovH)
          const dist  = Math.max(distH, distW) * 1.6
          this.camera.position.set(0, scaledHeight * 0.05, dist)
          this.controls.target.set(0, 0, 0)
          this.controls.update()

          resolve(model)
        },
        undefined,
        (err) => {
          console.error('GLTFLoader error:', err)
          reject(err)
        }
      )
    })
  }

  // ── Material updates ─────────────────────────────────────────────────────
  setBodyMaterial(key) {
    const def = BODY_MATS[key]
    if (!def) return
    this.bodyMat.color.setHex(def.color)
    this.bodyMat.roughness = def.roughness
    this.bodyMat.metalness = def.metalness
    this.bodyMat.needsUpdate = true
  }

  setBaseMaterial(key) {
    const def = BASE_MATS[key]
    if (!def) return
    this.baseMat.color.setHex(def.color)
    this.baseMat.roughness = def.roughness
    this.baseMat.metalness = def.metalness
    this.baseMat.needsUpdate = true
    // Tap: same color as base but always more polished (stainless vs brushed)
    this.tapMat.color.setHex(def.color)
    this.tapMat.roughness = Math.max(0.16, def.roughness - 0.20)
    this.tapMat.metalness = def.metalness
    this.tapMat.needsUpdate = true
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  setAutoRotate(on) {
    this.autoRot = on
    this.controls.autoRotate = on
  }

  setExplode(on) {
    this.exploding = on
  }

  cycleEnvironment() {
    this.envIdx = (this.envIdx + 1) % ENVS.length
    const env = ENVS[this.envIdx]
    const amb = this.scene.getObjectByName('ambient')
    if (amb) amb.intensity = env.ambInt

    if (env.kitchen && this._kitchenHDR) {
      this.scene.background           = this._kitchenHDR.bg
      this.scene.environment          = this._kitchenHDR.env
      this.scene.environmentIntensity = 0.85
      // Tilt camera down so the model base aligns with the panorama counter
      this.controls.target.set(0, -0.14, 0)
      this.controls.update()
    } else {
      this.scene.background           = new THREE.Color(env.bg)
      this.scene.environment          = this._roomEnvTexture
      this.scene.environmentIntensity = 1.4
      // Reset camera target to center
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    }
    if (this._kitchenGroup) this._kitchenGroup.visible = !!env.kitchen
    return env.label
  }

  // ── Load kitchen environment (async, called once at init) ────────────────
  async _loadKitchenHDR(renderer, pmrem) {
    try {
      // JPEG panorama as visible background (user's kitchen photo)
      const bgTex = await new THREE.TextureLoader()
        .loadAsync(import.meta.env.BASE_URL + 'assets/kitchen_bg.jpg')
      bgTex.mapping    = THREE.EquirectangularReflectionMapping
      bgTex.colorSpace = THREE.SRGBColorSpace

      // HDR (Poly Haven) for accurate PBR reflections on the model
      const hdr = await new RGBELoader()
        .loadAsync(import.meta.env.BASE_URL + 'assets/kitchen.hdr')
      hdr.mapping = THREE.EquirectangularReflectionMapping
      const envTex = pmrem.fromEquirectangular(hdr).texture
      pmrem.dispose()

      this._kitchenHDR = { bg: bgTex, env: envTex }

      if (ENVS[this.envIdx].kitchen) {
        this.scene.background           = bgTex
        this.scene.environment          = envTex
        this.scene.environmentIntensity = 0.85
      }
    } catch (e) {
      console.warn('Kitchen environment not loaded:', e)
      pmrem.dispose()
    }
  }

  // ── Kitchen environment geometry ─────────────────────────────────────────
  _buildKitchen() {
    const group = new THREE.Group()
    group.visible = false

    // Dark granite/quartz countertop (HDR provides the background wall)
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x1E1C1A, roughness: 0.14, metalness: 0.05,
    })
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 2.0), topMat)
    counter.receiveShadow = true
    counter.name = 'counter'
    group.add(counter)

    // Subtle counter edge highlight (thin strip at front)
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x2A2826, roughness: 0.08, metalness: 0.10,
    })
    const edge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.005, 0.01), edgeMat)
    edge.name = 'edge'
    group.add(edge)

    return group
  }

  setWireframe(on) {
    this.wireframe = on
    ;[this.bodyMat, this.baseMat, this.tapMat, this.velaMat].forEach(mat => {
      mat.wireframe = on
      mat.needsUpdate = true
    })
  }

  // ── Resize ───────────────────────────────────────────────────────────────
  _onResize() {
    const el  = this.canvas.parentElement
    const w   = el.clientWidth
    const h   = el.clientHeight
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.renderer.setSize(w, h, false)
    this.canvas.style.width  = w + 'px'
    this.canvas.style.height = h + 'px'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ── Explode animation ────────────────────────────────────────────────────
  _updateExplode(delta) {
    const target = this.exploding ? 1 : 0
    this.explodeT += (target - this.explodeT) * Math.min(delta * 3, 0.15)

    if (!this.model) return

    // Explode: model has rotation.x = -PI/2, so local Z = world Y (vertical)
    // and local -Y = world +Z (toward camera)
    const ROLE_OFFSETS = {
      lid:        new THREE.Vector3(0,  0,    +0.26),  // world up
      body_upper: new THREE.Vector3(0,  0,    +0.12),  // world up (less)
      body_lower: new THREE.Vector3(0,  0,     0   ),  // stays
      base:       new THREE.Vector3(0,  0,    -0.16),  // world down
      tap:        new THREE.Vector3(0, -0.24,  0   ),  // world +Z toward camera
    }

    this.model.traverse(node => {
      if (!node.isMesh) return
      const orig = this.origPositions[node.uuid]
      if (!orig) return
      const role   = meshRole(node.name)
      const offset = ROLE_OFFSETS[role]
      if (offset) {
        node.position.lerpVectors(orig, orig.clone().add(offset), this.explodeT)
      }
    })
  }

  // ── Render loop ──────────────────────────────────────────────────────────
  _animate() {
    const clock = new THREE.Clock()
    const tick  = () => {
      requestAnimationFrame(tick)
      const delta = clock.getDelta()
      this.controls.update()
      this._updateExplode(delta)
      this.renderer.render(this.scene, this.camera)
    }
    tick()
  }
}
