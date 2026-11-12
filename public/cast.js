import { createCastPreview } from './table3d.js';

const mount = document.getElementById('cast');
const LABELS = {
  scratch: 'Scratch', think: 'Think', tap: 'Tap the table', stretch: 'Stretch', wave: 'Wave', talk: 'Talk', recoil: 'Flinch',
  nod: 'Nod', cheer: 'Cheer', shrug: 'Shrug', play: 'Play a card', stub: 'Stub out', light: 'Light up',
};
createCastPreview(mount).then(preview => {
  const box = document.getElementById('cast-acts');
  for (const name of preview.names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-plain';
    b.textContent = LABELS[name] || name;
    b.addEventListener('click', () => preview.play(name));
    box.append(b);
  }
}).catch(() => { mount.textContent = '3D is not available in this browser.'; });
