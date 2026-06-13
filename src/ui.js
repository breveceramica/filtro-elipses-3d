// ── UI bindings ──────────────────────────────────────────────────────────
// Connects all sidebar controls to the Viewer instance.

export function initUI(viewer) {

  // ── Body color swatches ──
  document.querySelectorAll('#body-swatches .sw').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#body-swatches .sw').forEach(b => b.classList.remove('on'))
      btn.classList.add('on')
      viewer.setBodyMaterial(btn.dataset.mat)
    })
  })

  // ── Base material buttons ──
  document.querySelectorAll('#base-swatches .bb').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#base-swatches .bb').forEach(b => b.classList.remove('on'))
      btn.classList.add('on')
      viewer.setBaseMaterial(btn.dataset.mat)
    })
  })

  // ── Auto-rotation ──
  const btnAutoRot = document.getElementById('btn-autorot')
  btnAutoRot.addEventListener('click', () => {
    const on = !viewer.autoRot
    viewer.setAutoRotate(on)
    btnAutoRot.classList.toggle('on', on)
  })

  // ── Explode ──
  const btnExplode = document.getElementById('btn-explode')
  btnExplode.addEventListener('click', () => {
    const on = !viewer.exploding
    viewer.setExplode(on)
    btnExplode.classList.toggle('on', on)
  })

  // ── Environment ──
  const btnEnv = document.getElementById('btn-env')
  btnEnv.addEventListener('click', () => {
    const label = viewer.cycleEnvironment()
    btnEnv.textContent = `◐\u2005Ambiente: ${label}`
  })

  // ── Wireframe ──
  const btnWire = document.getElementById('btn-wireframe')
  btnWire.addEventListener('click', () => {
    const on = !viewer.wireframe
    viewer.setWireframe(on)
    btnWire.classList.toggle('on', on)
  })
}
