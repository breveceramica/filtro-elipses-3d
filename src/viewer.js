import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

// ── Material definitions ──────────────────────────────────────────────────
export const BODY_MATS = {
  clay:        { color: 0x9B4020, roughness: 0.93, metalness: 0.00 },
  verde_folha: { color: 0x4A6B30, roughness: 0.92, metalness: 0.00 },
  white:       { color: 0xDDD8D0, roughness: 0.91, metalness: 0.00 },
}
export const BASE_MATS = {
  steel: { color: 0xC8D0D4, roughness: 0.22, metalness: 0.95 },
  latao: { color: 0xC8A840, roughness: 0.20, metalness: 0.92 },
}

// ── Environment configs ───────────────────────────────────────────────────
const ENVS = [
  { bg: 0xF0EBE4, ambInt: 0.55, label: 'Estúdio', kitchen: false },
  { bg: 0xE8EEF5, ambInt: 0.65, label: 'Frio',    kitchen: false },
  { bg: 0xF2EEE8, ambInt: 0.72, label: 'Gourmet', kitchen: true  },
]

// ── Role detection for Keyshot GLB ───────────────────────────────────────
// Material index from Keyshot: mat 1 & 4 are bright polished metal (roughness=0.12)
// Mat 0, 2, 3 are ceramic body parts (roughness=1.0 from texture)
// Mat 5 is the Ground Plane (skip it)
// We detect metal vs ceramic by checking the parsed roughness factor.
function detectRoles(productMeshes) {
  const data = productMeshes.map(node => {
    const b = new THREE.Box3().setFromObject(node)
    const c = new THREE.Vector3()
    b.getCenter(c)
    // Keyshot metal mats have explicit roughnessFactor=0.12; ceramic defaults to 1.0
    const isMetal = node.material && node.material.roughness < 0.15
    return { node, cx: c.x, cy: c.y, cz: c.z, isMetal }
  })

  // Tap (torneira) sticks out asymmetrically on X axis
  const maxAbsCx = Math.max(...data.map(d => Math.abs(d.cx)))
  data.forEach(d => {
    d.isTap = !d.isMetal && maxAbsCx > 0.05 && Math.abs(d.cx) > maxAbsCx * 0.55
  })

  // Ceramic parts sorted top to bottom
  const ceramics = data
    .filter(d => !d.isMetal && !d.isTap)
    .sort((a, b) => b.cy - a.cy)

  // Metal parts sorted top to bottom (base is bottom-most)
  const metals = data
    .filter(d => d.isMetal)
    .sort((a, b) => b.cy - a.cy)

  const roles = new Map()

  // If we have more than 3 ceramic parts, lowest is probably vela (inside)
  ceramics.forEach((d, i) => {
    if (i === 0) roles.set(d.node, 'lid')
    else if (i === 1) roles.set(d.node, 'body_upper')
    else if (i === ceramics.length - 1 && ceramics.length >= 3) roles.set(d.node, 'body_lower')
    else roles.set(d.node, 'body_upper')
  })

  data.filter(d => d.isTap).forEach(d => roles.set(d.node, 'tap'))

  // Bottom metal = base, upper metal = also base (same material)
  metals.forEach(d => roles.set(d.node, 'base'))

  return roles
}

export class Viewer {
  constructor(canvas) {
    this.canvas    = canvas
    this.envIdx    = 0
    this.autoRot   = false
    this.exploding = false
    this.explodeT  = 0
    this.wireframe = false

    this.renderer  = null
    this.scene     = null
    this.camera    = null
    this.controls  = null
    this.model     = null

    this.bodyMat   = null
    this.baseMat   = null
    this.tapMat    = null
    this.velaMat   = null

    this.meshGroups    = {}
    this.origPositions = {}

    this._kitchenGroup   = null
    this._roomEnvTexture = null
    this._kitchenHDR     = null

    this._init()
  }

  // ── Init ────────────────────────────────────────────────────────────────
  _init() {
    const canvas = this.canvas

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled  = true
    renderer.shadowMap.type     = THREE.PCFSoftShadowMap
    renderer.outputColorSpace   = THREE.SRGBColorSpace
    renderer.toneMapping        = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    this.renderer = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(ENVS[0].bg)
    this.scene = scene

    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envTexture = pmrem.fromScene(new RoomEnvironment(renderer)).texture
    scene.environment          = envTexture
    scene.environmentIntensity = 1.6
    this._roomEnvTexture = envTexture
    this._loadKitchenHDR(renderer, pmrem)

    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 50)
    camera.position.set(0, 0.3, 1.5)
    this.camera = camera

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping   = true
    controls.dampingFactor   = 0.06
    controls.enablePan       = false
    controls.minDistance     = 0.3
    controls.maxDistance     = 4
    controls.maxPolarAngle   = Math.PI * 0.85
    controls.autoRotateSpeed = 1.5
    this.controls = controls

    // Lights — soft studio setup
    const ambient = new THREE.AmbientLight(0xfff5ee, ENVS[0].ambInt)
    ambient.name = 'ambient'
    scene.add(ambient)

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

    const fill = new THREE.DirectionalLight(0xfff5ee, 1.4)
    fill.position.set(3, 2, 1)
    scene.add(fill)

    const rim = new THREE.DirectionalLight(0xfff0e8, 0.3)
    rim.position.set(0, 3, -4)
    scene.add(rim)

    const hemi = new THREE.HemisphereLight(0xfff8f0, 0xf0e8e0, 0.7)
    scene.add(hemi)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.12, transparent: true })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    this._kitchenGroup = this._buildKitchen()
    scene.add(this._kitchenGroup)

    // Ceramic: high roughness + clearcoat simulates fired clay microsheen
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color:              BODY_MATS.clay.color,
      roughness:          BODY_MATS.clay.roughness,
      metalness:          0.00,
      specularIntensity:  0.08,
      specularColor:      new THREE.Color(0xfff0e8),
      clearcoat:          0.06,
      clearcoatRoughness: 0.85,
    })
    // Polished aluminum/brass base
    this.baseMat = new THREE.MeshPhysicalMaterial({
      color:     BASE_MATS.steel.color,
      roughness: BASE_MATS.steel.roughness,
      metalness: BASE_MATS.steel.metalness,
    })
    // Stainless tap — slightly more polished
    this.tapMat = new THREE.MeshPhysicalMaterial({
      color:     BASE_MATS.steel.color,
      roughness: Math.max(0.12, BASE_MATS.steel.roughness - 0.06),
      metalness: BASE_MATS.steel.metalness,
    })
    // Vela (Stefani candle): off-white fired ceramic
    this.velaMat = new THREE.MeshPhysicalMaterial({
      color:              0xEEEAE2,
      roughness:          0.82,
      metalness:          0.00,
      specularIntensity:  0.12,
      clearcoat:          0.04,
      clearcoatRoughness: 0.90,
    })

    this._onResize()
    window.addEventListener('resize', () => this._onResize())
    this._animate()
  }

  // ── Load model ──────────────────────────────────────────────────────────
  async loadModel(url) {
    return new Promise((resolve, reject) => {
      const dracoLoader = new DRACOLoader()
      dracoLoader.setDecoderPath(
        'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
      )

      const loader = new GLTFLoader()
      loader.setDRACOLoader(dracoLoader)

      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene
          this.model  = model

          // Node "P_Aprovado" (parent of all product meshes) already has a matrix
          // that converts Z-up → Y-up. DO NOT add extra rotation here.

          // Remove Ground Plane (Keyshot studio floor) before bbox calculation
          const toRemove = []
          model.traverse(node => {
            if (node.isMesh && node.parent?.name !== 'P_Aprovado') toRemove.push(node)
          })
          toRemove.forEach(n => n.parent?.remove(n))

          // Collect product meshes
          const productMeshes = []
          model.traverse(node => {
            if (!node.isMesh) return
            node.castShadow    = true
            node.receiveShadow = true
            productMeshes.push(node)
          })

          // Compute bbox from product meshes only
          const bbox = new THREE.Box3()
          productMeshes.forEach(n => bbox.expandByObject(n))
          const size = new THREE.Vector3()
          bbox.getSize(size)

          const maxDim = Math.max(size.x, size.y, size.z)
          const scale  = 1.0 / maxDim
          model.scale.setScalar(scale)

          // Center model on product bbox
          const bbox2   = new THREE.Box3()
          productMeshes.forEach(n => bbox2.expandByObject(n))
          const center2 = new THREE.Vector3()
          bbox2.getCenter(center2)
          model.position.sub(center2)

          // Ground/counter at model bottom
          const bbox3  = new THREE.Box3()
          productMeshes.forEach(n => bbox3.expandByObject(n))
          const groundY = bbox3.min.y
          const groundMesh = this.scene.children.find(
            c => c.isMesh && c.material instanceof THREE.ShadowMaterial
          )
          if (groundMesh) groundMesh.position.y = groundY - 0.002

          if (this._kitchenGroup) {
            const counter = this._kitchenGroup.getObjectByName('counter')
            if (counter) counter.position.y = groundY - 0.025
            const edge = this._kitchenGroup.getObjectByName('edge')
            if (edge) {
              edge.position.y = groundY - 0.002
              edge.position.z = 1.0
            }
          }

          // Auto-detect roles from bounding box + material roughness
          const roles = detectRoles(productMeshes)

          productMeshes.forEach(node => {
            const role = roles.get(node) || 'body_lower'
            if      (role === 'base') node.material = this.baseMat
            else if (role === 'tap')  node.material = this.tapMat
            else if (role === 'vela') node.material = this.velaMat
            else                      node.material = this.bodyMat

            if (!this.meshGroups[role]) this.meshGroups[role] = []
            this.meshGroups[role].push(node)
            this.origPositions[node.uuid] = node.position.clone()
          })

          if (this.wireframe) {
            productMeshes.forEach(n => { n.material.wireframe = true })
          }

          this.scene.add(model)

          // Camera — frame the full model with padding
          const scaledH  = size.y * scale
          const scaledW  = Math.max(size.x, size.z) * scale
          const halfFovV = THREE.MathUtils.degToRad(35) / 2
          const aspect   = this.camera.aspect || 1
          const halfFovH = Math.atan(Math.tan(halfFovV) * aspect)
          const distH    = (scaledH / 2) / Math.tan(halfFovV)
          const distW    = (scaledW / 2) / Math.tan(halfFovH)
          const dist     = Math.max(distH, distW) * 1.5
          this.camera.position.set(0, 0, dist)
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
    this.bodyMat.roughness  = def.roughness
    this.bodyMat.metalness  = def.metalness
    this.bodyMat.needsUpdate = true
  }

  setBaseMaterial(key) {
    const def = BASE_MATS[key]
    if (!def) return
    this.baseMat.color.setHex(def.color)
    this.baseMat.roughness  = def.roughness
    this.baseMat.metalness  = def.metalness
    this.baseMat.needsUpdate = true
    this.tapMat.color.setHex(def.color)
    this.tapMat.roughness   = Math.max(0.16, def.roughness - 0.20)
    this.tapMat.metalness   = def.metalness
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
    const env   = ENVS[this.envIdx]
    const amb   = this.scene.getObjectByName('ambient')
    if (amb) amb.intensity = env.ambInt

    if (env.kitchen && this._kitchenHDR) {
      this.scene.background           = this._kitchenHDR.bg
      this.scene.environment          = this._kitchenHDR.env
      this.scene.environmentIntensity = 0.85
      this.controls.target.set(0, -0.14, 0)
      this.controls.update()
    } else {
      this.scene.background           = new THREE.Color(env.bg)
      this.scene.environment          = this._roomEnvTexture
      this.scene.environmentIntensity = 1.4
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    }
    if (this._kitchenGroup) this._kitchenGroup.visible = !!env.kitchen
    return env.label
  }

  setWireframe(on) {
    this.wireframe = on
    ;[this.bodyMat, this.baseMat, this.tapMat, this.velaMat].forEach(mat => {
      mat.wireframe  = on
      mat.needsUpdate = true
    })
  }

  // ── Kitchen HDR (async, called once) ────────────────────────────────────
  async _loadKitchenHDR(renderer, pmrem) {
    try {
      const bgTex = await new THREE.TextureLoader()
        .loadAsync(import.meta.env.BASE_URL + 'assets/kitchen_bg.jpg')
      bgTex.mapping    = THREE.EquirectangularReflectionMapping
      bgTex.colorSpace = THREE.SRGBColorSpace

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

  // ── Kitchen geometry ─────────────────────────────────────────────────────
  _buildKitchen() {
    const group = new THREE.Group()
    group.visible = false

    const topMat = new THREE.MeshStandardMaterial({
      color: 0x1E1C1A, roughness: 0.14, metalness: 0.05,
    })
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 2.0), topMat)
    counter.receiveShadow = true
    counter.name = 'counter'
    group.add(counter)

    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x2A2826, roughness: 0.08, metalness: 0.10,
    })
    const edge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.005, 0.01), edgeMat)
    edge.name = 'edge'
    group.add(edge)

    return group
  }

  // ── Resize ───────────────────────────────────────────────────────────────
  _onResize() {
    const el  = this.canvas.parentElement
    const w   = el.clientWidth
    const h   = el.clientHeight
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

    // Node positions are in P_Aprovado local space (Z-up before node matrix):
    //   local +Z → world +Y (up), local -Y → world +Z (toward camera)
    const ROLE_OFFSETS = {
      lid:        new THREE.Vector3(0,  0,    +0.26),
      body_upper: new THREE.Vector3(0,  0,    +0.12),
      body_lower: new THREE.Vector3(0,  0,     0   ),
      base:       new THREE.Vector3(0,  0,    -0.16),
      tap:        new THREE.Vector3(0, -0.20,  0   ),
    }

    Object.entries(this.meshGroups).forEach(([role, nodes]) => {
      const offset = ROLE_OFFSETS[role]
      if (!offset) return
      nodes.forEach(node => {
        const orig = this.origPositions[node.uuid]
        if (!orig) return
        node.position.lerpVectors(orig, orig.clone().add(offset), this.explodeT)
      })
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
