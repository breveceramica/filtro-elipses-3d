import './style.css'
import { Viewer } from './viewer.js'
import { initUI }  from './ui.js'

const canvas  = document.getElementById('canvas')
const loading = document.getElementById('loading')

// Init viewer
const viewer = new Viewer(canvas)

// Init UI (pass viewer so controls can call its methods)
initUI(viewer)

// Load model
viewer.loadModel(import.meta.env.BASE_URL + 'assets/filtro_keyshot.glb')
  .then(() => {
    loading.classList.add('hidden')
  })
  .catch(err => {
    loading.querySelector('p').textContent = 'Erro ao carregar modelo.'
    console.error(err)
  })
