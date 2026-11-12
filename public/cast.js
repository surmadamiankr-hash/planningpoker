import { createCastPreview } from './table3d.js';

const mount = document.getElementById('cast');
createCastPreview(mount).catch(() => { mount.textContent = '3D is not available in this browser.'; });
