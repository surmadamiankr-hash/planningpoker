/*
 * The 3D table. Everyone sits around a round card table and sees it from their
 * own seat; heads follow each player's mouse. Characters are built from simple
 * shapes in code, so there are no model files to load.
 *
 * createTable3D({ mount, onVote, onPlayer, onMiss, onLook, onSlow }) resolves to
 * { update(view), looks(map), emote(from, to, emoji), dispose() }.
 */
import * as THREE from './vendor/three.module.min.js';

const TAU = Math.PI * 2;
const TABLE_Y = 0.76;
const CARD_W = 0.062, CARD_H = 0.088;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const ease = t => t * t * (3 - 2 * t);
const lerpAngle = (a, b, t) => a + (((b - a + Math.PI * 3) % TAU) - Math.PI) * t;

/* ---------- the cast ---------- */
const SKIN = ['#F3D2B3', '#E6B48C', '#CC9366', '#A9744B', '#80522F', '#5C3A22'];
const CAST = [
  { skin: 1, w: 1.5, h: 0.94, belly: true, head: 1.06, hair: ['bald'], face: { brows: 'flat', mustache: '#2B1D14', mouth: 'grin' }, outfit: ['hawaii', '#E4572E', '#F6C945'], extras: ['chain'] },
  { skin: 4, w: 0.72, h: 1.16, neck: 1.8, head: 0.92, hair: ['short', '#1C1512'], face: { brows: 'raised', glasses: 'round', mouth: 'flat' }, outfit: ['turtleneck', '#22333B', '#22333B'] },
  { skin: 0, w: 0.95, h: 1.0, hair: ['mohawk', '#FF3E8A'], face: { brows: 'angry', mouth: 'smirk', earring: true }, outfit: ['jacket', '#1B1B1E', '#B8B8C0'] },
  { skin: 2, w: 1.05, h: 0.9, hair: ['sides', '#E9E9E4'], hat: ['flatcap', '#6B705C'], face: { brows: 'bushy', browColor: '#E9E9E4', mustache: '#E9E9E4', glasses: 'square', mouth: 'smile' }, outfit: ['cardigan', '#7F5539', '#DDB892'] },
  { skin: 1, w: 1.5, h: 1.08, shoulders: 1.45, head: 0.82, hair: ['flat', '#3A2A1E'], hat: ['headband', '#E63946'], face: { brows: 'angry', mouth: 'grin' }, outfit: ['tank', '#F1FAEE', '#E63946'] },
  { skin: 5, w: 0.95, h: 0.98, hair: ['messy', '#120D0A'], hat: ['hood', '#3A506B'], face: { brows: 'sad', eyes: 'tired', mouth: 'flat' }, outfit: ['hoodie', '#3A506B', '#5BC0BE'], extras: ['headphones'] },
  { skin: 0, w: 0.9, h: 1.04, hair: ['long', '#8D6E4A'], hat: ['headband', '#F4A261'], face: { brows: 'raised', glasses: 'tint', beard: '#8D6E4A', mouth: 'smile' }, outfit: ['tiedye', '#9B5DE5', '#F15BB5'] },
  { skin: 3, w: 1.1, h: 1.02, hair: ['slick', '#151515'], face: { brows: 'flat', mouth: 'flat' }, outfit: ['suit', '#1F2A44', '#C1121F'] },
  { skin: 0, w: 0.88, h: 1.06, hair: ['long', '#16130F'], face: { brows: 'flat', eyes: 'tired', beard: '#16130F', mouth: 'smirk' }, outfit: ['tee', '#151515', '#D62828'] },
  { skin: 2, w: 1.08, h: 1.02, hair: ['short', '#2F1B12'], hat: ['cowboy', '#8B5E34'], face: { brows: 'squint', eyes: 'squint', mustache: '#2F1B12', mouth: 'smirk' }, outfit: ['shirt', '#C9A227', '#7F4F24'], extras: ['bandana'] },
  { skin: 4, w: 1.12, h: 0.86, hair: ['bun', '#D9D9D9'], face: { brows: 'raised', browColor: '#BDBDBD', glasses: 'cateye', mouth: 'smile' }, outfit: ['cardigan', '#B56576', '#EAAC8B'], extras: ['pearls'] },
  { skin: 1, w: 1.0, h: 1.0, hair: ['short', '#6B4B2A'], hat: ['bucket', '#F1F1F1'], face: { brows: 'flat', mouth: 'smirk' }, outfit: ['track', '#0B6E4F', '#FFFFFF'], extras: ['chain'] },
];

/* ---------- shared geometry and materials ---------- */
const GEO = {
  sphere: new THREE.SphereGeometry(1, 22, 16),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  box: new THREE.BoxGeometry(1, 1, 1),
  card: new THREE.PlaneGeometry(CARD_W, CARD_H),
};
const mats = new Map();
function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = mats.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); mats.set(key, m); }
  return m;
}
function part(geo, material, scale, pos) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}
const UP = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function setLimb(m, a, b, r) {
  _dir.subVectors(b, a);
  const len = Math.max(0.001, _dir.length());
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _dir.normalize());
  m.scale.set(r, len, r);
}

/* ---------- textures drawn on a canvas ---------- */
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
const CUP_PATHS = ['M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M17 11h1.5a2.5 2.5 0 0 1 0 5H17', 'M8 3v3M12 3v3'];
function drawCup(x, cx, cy, size) {
  x.save();
  x.translate(cx - size / 2, cy - size / 2);
  x.scale(size / 24, size / 24);
  x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#17211E';
  for (const d of CUP_PATHS) x.stroke(new Path2D(d));
  x.restore();
}
function faceTexture(value) {
  return canvasTexture(256, 364, (x, w, h) => {
    roundRect(x, 3, 3, w - 6, h - 6, 26);
    x.fillStyle = '#FBF8EE'; x.fill();
    x.lineWidth = 5; x.strokeStyle = '#CFC8B2'; x.stroke();
    if (value == null) return;
    x.fillStyle = '#17211E'; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (value === 'coffee') {
      drawCup(x, w / 2, h / 2, 150);
      drawCup(x, 44, 50, 52);
      return;
    }
    const big = value.length >= 4 ? 104 : value.length === 3 ? 136 : 190;
    x.font = '400 ' + big + 'px "League Gothic", "Arial Narrow", Impact, sans-serif';
    x.fillText(value, w / 2, h / 2 + 12);
    x.font = '400 ' + (value.length >= 3 ? 44 : 60) + 'px "League Gothic", "Arial Narrow", Impact, sans-serif';
    x.textAlign = 'left';
    x.fillText(value, 20, 48);
  });
}
function backTexture() {
  return canvasTexture(256, 364, (x, w, h) => {
    roundRect(x, 3, 3, w - 6, h - 6, 26);
    x.fillStyle = '#E8A93A'; x.fill();
    x.save(); x.clip();
    x.strokeStyle = 'rgba(35,25,5,0.3)'; x.lineWidth = 3;
    for (let i = -h; i < w + h; i += 18) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke();
      x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke();
    }
    x.restore();
    roundRect(x, 16, 16, w - 32, h - 32, 16);
    x.lineWidth = 5; x.strokeStyle = 'rgba(35,25,5,0.5)'; x.stroke();
  });
}
function puffTexture() {
  return canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(240,244,240,0.9)');
    g.addColorStop(1, 'rgba(240,244,240,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}
function emojiTexture(emoji) {
  return canvasTexture(128, 128, (x) => {
    x.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(emoji, 64, 70);
  });
}
function labelTexture(name, host) {
  return canvasTexture(512, 96, (x, w, h) => {
    x.font = '600 40px "Instrument Sans", system-ui, sans-serif';
    let text = name;
    while (text.length > 3 && x.measureText(text).width > (host ? 290 : 420)) text = text.slice(0, -2);
    if (text !== name) text += '…';
    const tw = x.measureText(text).width;
    const hw = host ? 104 : 0;
    const total = tw + 44 + (host ? hw + 12 : 0);
    const left = (w - total) / 2;
    roundRect(x, left, 16, total, 64, 32);
    x.fillStyle = 'rgba(8,16,13,0.74)'; x.fill();
    x.fillStyle = '#ECF4EF'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText(text, left + 22, 50);
    if (host) {
      roundRect(x, left + tw + 34, 27, hw, 42, 10);
      x.fillStyle = '#E8A93A'; x.fill();
      x.fillStyle = '#231905'; x.font = '700 26px "Instrument Sans", system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText('HOST', left + tw + 34 + hw / 2, 49);
    }
  });
}

/* ---------- characters ---------- */
function buildHead(spec, R) {
  const g = new THREE.Group();
  const skin = mat(SKIN[spec.skin]);
  const dark = mat('#17120E');
  const f = spec.face || {};
  const [hairType, hairColor] = spec.hair || ['bald'];
  const hairMat = mat(hairColor || '#222');
  const browMat = mat(f.browColor || hairColor || '#2B1D14');

  g.add(part(GEO.sphere, skin, [R, R * 1.08, R * 1.02], [0, 0, 0]));
  g.add(part(GEO.sphere, skin, [R * 0.15, R * 0.2, R * 0.1], [R * 0.98, 0.02 * R, 0]));
  g.add(part(GEO.sphere, skin, [R * 0.15, R * 0.2, R * 0.1], [-R * 0.98, 0.02 * R, 0]));
  g.add(part(GEO.sphere, skin, [R * 0.15, R * 0.14, R * 0.18], [0, -0.04 * R, R * 1.0]));

  // eyes (kept in a group so they can blink)
  const eyes = new THREE.Group();
  const lid = f.eyes === 'tired' ? 0.55 : f.eyes === 'squint' ? 0.38 : 1;
  for (const side of [-1, 1]) {
    eyes.add(part(GEO.sphere, mat('#FFFFFF', { roughness: 0.4 }), [R * 0.19, R * 0.19 * lid, R * 0.09], [side * 0.36 * R, 0.14 * R, 0.87 * R]));
    eyes.add(part(GEO.sphere, dark, [R * 0.085, R * 0.085 * Math.min(1, lid + 0.2), R * 0.05], [side * 0.36 * R, 0.13 * R, 0.95 * R]));
    if (f.eyes === 'tired') g.add(part(GEO.sphere, mat('#5B4A5E', { transparent: true, opacity: 0.55 }), [R * 0.2, R * 0.07, R * 0.04], [side * 0.36 * R, -0.03 * R, 0.9 * R]));
  }
  g.add(eyes);

  // brows
  const tilt = { angry: -0.38, sad: 0.34, squint: -0.15 }[f.brows] || 0;
  const browY = f.brows === 'raised' ? 0.5 : f.brows === 'squint' ? 0.3 : 0.4;
  const browH = f.brows === 'bushy' ? 0.13 : 0.07;
  for (const side of [-1, 1]) {
    const b = part(GEO.box, browMat, [R * 0.34, R * browH, R * 0.08], [side * 0.36 * R, browY * R, 0.9 * R]);
    b.rotation.z = side * tilt;
    g.add(b);
  }

  // mouth
  const mouthY = -0.42 * R, mouthZ = 0.9 * R;
  if (f.mouth === 'grin') {
    g.add(part(GEO.box, dark, [R * 0.5, R * 0.17, R * 0.04], [0, mouthY, mouthZ]));
    g.add(part(GEO.box, mat('#FFFFFF'), [R * 0.42, R * 0.09, R * 0.05], [0, mouthY + 0.01 * R, mouthZ + 0.01 * R]));
  } else if (f.mouth === 'smile' || f.mouth === 'frown') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.2, R * 0.03, 8, 16, Math.PI), dark);
    arc.position.set(0, mouthY + (f.mouth === 'smile' ? 0.08 * R : -0.08 * R), mouthZ);
    arc.rotation.z = f.mouth === 'smile' ? Math.PI : 0;
    g.add(arc);
  } else {
    const m = part(GEO.box, dark, [R * 0.36, R * 0.045, R * 0.04], [f.mouth === 'smirk' ? 0.06 * R : 0, mouthY, mouthZ]);
    if (f.mouth === 'smirk') m.rotation.z = 0.22;
    g.add(m);
  }

  // facial hair
  if (f.mustache) {
    for (const side of [-1, 1]) {
      const m = part(GEO.sphere, mat(f.mustache), [R * 0.24, R * 0.08, R * 0.08], [side * 0.17 * R, -0.25 * R, 0.98 * R]);
      m.rotation.z = side * -0.3;
      g.add(m);
    }
  }
  if (f.beard) g.add(part(GEO.sphere, mat(f.beard), [R * 0.74, R * 0.6, R * 0.62], [0, -0.58 * R, 0.42 * R]));

  // glasses
  if (f.glasses) {
    const square = f.glasses === 'square' || f.glasses === 'cateye';
    const frame = mat(f.glasses === 'cateye' ? '#C1121F' : f.glasses === 'tint' ? '#B5651D' : '#1A1A1A', { roughness: 0.4 });
    const ringGeo = new THREE.TorusGeometry(R * 0.25, R * 0.028, 8, square ? 4 : 24);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(ringGeo, frame);
      ring.position.set(side * 0.36 * R, 0.13 * R, 0.98 * R);
      ring.rotation.z = square ? Math.PI / 4 + (f.glasses === 'cateye' ? side * -0.2 : 0) : 0;
      g.add(ring);
      if (f.glasses === 'tint') {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(R * 0.24, 20), mat('#F4A261', { transparent: true, opacity: 0.55 }));
        lens.position.copy(ring.position);
        g.add(lens);
      }
    }
    g.add(part(GEO.box, frame, [R * 0.24, R * 0.035, R * 0.035], [0, 0.15 * R, 0.99 * R]));
  }
  if (f.earring) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.09, R * 0.02, 6, 14), mat('#E8C547', { metalness: 0.6, roughness: 0.3 }));
    ring.position.set(R * 1.02, -0.2 * R, 0);
    g.add(ring);
  }

  // hair
  const cap = (scale, tiltX) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 24, 12, 0, TAU, 0, Math.PI * 0.5), hairMat);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.rotation.x = tiltX;
    m.position.y = 0.04 * R;
    return m;
  };
  if (hairType === 'short' || hairType === 'messy' || hairType === 'bun' || hairType === 'long' || hairType === 'slick') g.add(cap([1, hairType === 'slick' ? 0.98 : 1.06, 1.02], -0.32));
  if (hairType === 'flat') g.add(part(GEO.cyl, hairMat, [R * 0.86, R * 0.34, R * 0.86], [0, 0.98 * R, -0.04 * R]));
  if (hairType === 'sides') {
    const ring = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 24, 8, Math.PI * 0.83, Math.PI * 1.34, Math.PI * 0.3, Math.PI * 0.3), hairMat);
    g.add(ring);
  }
  if (hairType === 'mohawk') {
    for (let i = 0; i < 7; i += 1) {
      const a = -0.75 + i * 0.33;      // from the forehead (negative) over the top to the back of the head
      const spike = part(GEO.box, hairMat, [R * 0.13, R * 0.52, R * 0.3], [0, Math.cos(a) * R * 1.2, -Math.sin(a) * R * 1.12]);
      spike.rotation.x = -a;
      g.add(spike);
    }
  }
  if (hairType === 'long') {
    g.add(part(GEO.sphere, hairMat, [R * 1.02, R * 1.25, R * 0.55], [0, -0.55 * R, -0.62 * R]));
    for (const side of [-1, 1]) g.add(part(GEO.sphere, hairMat, [R * 0.26, R * 0.95, R * 0.42], [side * 0.95 * R, -0.5 * R, -0.1 * R]));
  }
  if (hairType === 'messy') {
    const tufts = [[0.3, 1.0, 0.3], [-0.35, 1.02, 0.1], [0.05, 1.1, -0.2], [-0.1, 0.98, 0.5], [0.5, 0.9, -0.1]];
    for (const t of tufts) g.add(part(GEO.sphere, hairMat, [R * 0.3, R * 0.24, R * 0.3], [t[0] * R, t[1] * R, t[2] * R]));
  }
  if (hairType === 'bun') g.add(part(GEO.sphere, hairMat, [R * 0.42, R * 0.4, R * 0.42], [0, 1.18 * R, -0.3 * R]));

  // hats
  if (spec.hat) {
    const [hatType, hatColor] = spec.hat;
    const hm = mat(hatColor);
    if (hatType === 'flatcap') {
      const c = part(GEO.sphere, hm, [R * 1.14, R * 0.36, R * 1.24], [0, 0.82 * R, 0.08 * R]);
      c.rotation.x = 0.16;
      g.add(c, part(GEO.box, hm, [R * 0.9, R * 0.06, R * 0.5], [0, 0.6 * R, 1.08 * R]));
    } else if (hatType === 'cowboy') {
      g.add(part(GEO.cyl, hm, [R * 1.75, R * 0.07, R * 1.75], [0, 0.72 * R, 0]));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.68, R * 0.84, R * 0.62, 20), hm).translateY(1.05 * R));
      g.add(part(GEO.cyl, mat('#2B1D14'), [R * 0.86, R * 0.1, R * 0.86], [0, 0.8 * R, 0]));
    } else if (hatType === 'bucket') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.74, R * 1.28, R * 0.6, 22), hm).translateY(0.92 * R));
    } else if (hatType === 'headband') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.0, R * 0.075, 8, 28), hm);
      band.rotation.x = Math.PI / 2 - 0.12;
      band.position.y = 0.46 * R;
      g.add(band);
    } else if (hatType === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(R * 1.2, 24, 16, Math.PI * 0.68, Math.PI * 1.64, 0, Math.PI * 0.78), mat(hatColor, { side: THREE.DoubleSide }));
      hood.position.set(0, 0.02 * R, -0.06 * R);
      g.add(hood);
    }
  }
  for (const extra of spec.extras || []) {
    if (extra === 'headphones') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.24, R * 0.05, 8, 20, Math.PI), mat('#111111', { roughness: 0.4 }));
      band.position.y = 0.05 * R;
      g.add(band);
      for (const side of [-1, 1]) {
        const cup = part(GEO.cyl, mat('#111111', { roughness: 0.4 }), [R * 0.3, R * 0.16, R * 0.3], [side * 1.22 * R, 0.02 * R, 0]);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
      }
    }
  }
  return { group: g, eyes };
}

function buildAvatar(index, textures) {
  const spec = CAST[((index % CAST.length) + CAST.length) % CAST.length];
  const group = new THREE.Group();
  const w = spec.w || 1, h = spec.h || 1, sh = spec.shoulders || 1;
  const [outfit, c1, c2] = spec.outfit;
  const skin = mat(SKIN[spec.skin]);
  const cloth = mat(c1), accent = mat(c2);
  const shoulderY = TABLE_Y + 0.37 * h;
  const R = 0.118 * (spec.head || 1);
  const neckLen = 0.055 * (spec.neck || 1);

  // chair and body
  group.add(part(GEO.box, mat('#3A2416'), [0.46, 0.62, 0.05], [0, 0.78, -0.24]));
  group.add(part(GEO.box, mat('#3A2416'), [0.46, 0.05, 0.42], [0, 0.47, -0.05]));
  const torso = part(GEO.sphere, cloth, [0.2 * w, 0.29 * h, 0.15 * (0.7 + 0.3 * w)], [0, TABLE_Y + 0.115 * h, -0.02]);
  group.add(torso);
  group.add(part(GEO.sphere, cloth, [0.2 * w, 0.16, 0.19], [0, 0.56, -0.02]));
  if (spec.belly) group.add(part(GEO.sphere, cloth, [0.21 * w, 0.19, 0.2], [0, TABLE_Y + 0.03, 0.07]));
  const sleeveless = outfit === 'tank';
  const shoulderMat = sleeveless ? skin : cloth;
  for (const side of [-1, 1]) group.add(part(GEO.sphere, shoulderMat, [0.078 * sh, 0.07 * sh, 0.075 * sh], [side * 0.19 * w * (0.85 + 0.15 * sh), shoulderY - 0.035, -0.02]));
  group.add(part(GEO.cyl, outfit === 'turtleneck' ? cloth : skin, [outfit === 'turtleneck' ? 0.058 : 0.046, neckLen + 0.06, outfit === 'turtleneck' ? 0.058 : 0.046], [0, shoulderY + neckLen / 2 - 0.01, 0]));

  // outfit details on the chest
  const chestZ = 0.15 * (0.7 + 0.3 * w);
  const dot = (x, y, s, m) => {      // a flat blob on the front of the torso
    const nx = x / 0.2, ny = (y - 0.115) / 0.29;
    const z = -0.02 + chestZ * Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    group.add(part(GEO.sphere, m, [s, s, s * 0.35], [x * w, TABLE_Y + y * h, z]));
  };
  if (outfit === 'hawaii' || outfit === 'tiedye') {
    const spots = [[-0.09, 0.2, 0.03], [0.07, 0.27, 0.026], [0.1, 0.12, 0.032], [-0.03, 0.09, 0.024], [-0.12, 0.31, 0.022], [0.01, 0.33, 0.028]];
    for (const s of spots) dot(s[0], s[1], outfit === 'tiedye' ? s[2] * 1.5 : s[2], accent);
  } else if (outfit === 'suit') {
    group.add(part(GEO.box, mat('#F4F4F0'), [0.09, 0.2 * h, 0.02], [0, TABLE_Y + 0.25 * h, chestZ - 0.03]));
    group.add(part(GEO.box, accent, [0.034, 0.17 * h, 0.022], [0, TABLE_Y + 0.23 * h, chestZ - 0.022]));
  } else if (outfit === 'cardigan' || outfit === 'jacket' || outfit === 'track') {
    group.add(part(GEO.box, accent, [outfit === 'track' ? 0.02 : 0.07, 0.24 * h, 0.02], [0, TABLE_Y + 0.22 * h, chestZ - 0.03]));
    if (outfit === 'track') for (const side of [-1, 1]) group.add(part(GEO.box, accent, [0.014, 0.2 * h, 0.02], [side * 0.15 * w, TABLE_Y + 0.2 * h, chestZ * 0.62]));
  } else if (outfit === 'tee') {
    dot(0, 0.24, 0.05, accent);
  } else if (outfit === 'tank') {
    group.add(part(GEO.box, accent, [0.16 * w, 0.014, 0.02], [0, TABLE_Y + 0.34 * h, chestZ * 0.7]));
  } else if (outfit === 'hoodie') {
    for (const side of [-1, 1]) group.add(part(GEO.cyl, accent, [0.006, 0.12, 0.006], [side * 0.035, TABLE_Y + 0.27 * h, chestZ - 0.012]));
  } else if (outfit === 'shirt') {
    for (const side of [-1, 1]) {
      const c = part(GEO.box, accent, [0.07, 0.03, 0.02], [side * 0.045, shoulderY - 0.03, chestZ * 0.72]);
      c.rotation.z = side * 0.5;
      group.add(c);
    }
  }
  for (const extra of spec.extras || []) {
    if (extra === 'chain' || extra === 'pearls') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, extra === 'pearls' ? 0.011 : 0.008, 8, 28), extra === 'pearls' ? mat('#F6F1E7', { roughness: 0.3 }) : mat('#E8C547', { metalness: 0.7, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2 - 0.75;
      ring.position.set(0, shoulderY - 0.07, chestZ * 0.55);
      group.add(ring);
    } else if (extra === 'bandana') {
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.11, 3), mat('#C1121F'));
      b.rotation.set(Math.PI, 0, 0);
      b.scale.z = 0.35;
      b.position.set(0, shoulderY - 0.06, chestZ * 0.75);
      group.add(b);
    }
  }

  // head on a neck pivot, so it can turn with the player's mouse
  const headPivot = new THREE.Group();
  headPivot.rotation.order = 'YXZ';
  headPivot.position.set(0, shoulderY + neckLen, 0);
  const head = buildHead(spec, R);
  head.group.position.y = R * 1.0;
  headPivot.add(head.group);
  group.add(headPivot);
  const headY = shoulderY + neckLen + R;

  // cigarette and smoke, shown while on a smoke break
  const cig = new THREE.Group();
  const stick = part(GEO.cyl, mat('#F4F1E8'), [0.0055, 0.06, 0.0055], [0, 0, 0.03]);
  stick.rotation.x = Math.PI / 2;
  const filter = part(GEO.cyl, mat('#D9893B'), [0.0057, 0.02, 0.0057], [0, 0, 0.0]);
  filter.rotation.x = Math.PI / 2;
  const ember = part(GEO.sphere, new THREE.MeshStandardMaterial({ color: '#FF6A2B', emissive: '#FF4A1C', emissiveIntensity: 2 }), [0.0062, 0.0062, 0.0062], [0, 0, 0.061]);
  cig.add(stick, filter, ember);
  cig.position.set(R * 0.2, R * 0.58, R * 0.95);
  cig.rotation.set(0.25, 0.3, 0);
  const puffs = [];
  for (let i = 0; i < 4; i += 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.puff, transparent: true, depthWrite: false, opacity: 0 }));
    s.raycast = () => {};
    cig.add(s);
    puffs.push(s);
  }
  cig.visible = false;
  headPivot.add(cig);

  // arms and the hand of cards
  const sleeveMat = sleeveless ? skin : cloth;
  const foreMat = sleeveless || outfit === 'tee' || outfit === 'hawaii' || outfit === 'tiedye' ? skin : cloth;
  const armR = 0.034 * (0.8 + 0.2 * w) * (sh > 1 ? 1.25 : 1);
  const arms = [-1, 1].map(side => {
    const upper = new THREE.Mesh(GEO.cyl, sleeveMat), lower = new THREE.Mesh(GEO.cyl, foreMat);
    const elbow = part(GEO.sphere, sleeveMat, [armR, armR, armR], [0, 0, 0]);
    const hand = part(GEO.sphere, skin, [0.036, 0.03, 0.04], [0, 0, 0]);
    group.add(upper, lower, elbow, hand);
    return { side, upper, lower, elbow, hand, shoulder: new THREE.Vector3(side * 0.19 * w * (0.85 + 0.15 * sh), shoulderY - 0.04, -0.01) };
  });
  const fan = new THREE.Group();
  for (let i = 0; i < 5; i += 1) {
    const c = makeCard(textures.blankMat, textures.backMat);
    const a = (i - 2) * 0.2;
    c.position.set(Math.sin(a) * 0.16, Math.cos(a) * 0.16 - 0.16, i * 0.0015);
    c.rotation.z = -a;
    fan.add(c);
  }
  fan.rotation.order = 'YXZ';
  group.add(fan);

  // name tags keep the same size on screen however far away the player sits
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false }));
  label.scale.set(0.42, 0.079, 1);
  label.position.set(0, headY + R + 0.15, 0);
  label.raycast = () => {};
  group.add(label);

  return {
    index, group, headPivot, eyes: head.eyes, fan, arms, cig, puffs, label, torso, headY, R, armR,
    look: [0, 0, 0], yaw: 0, pitch: 0, peek: 0, blink: 2 + Math.random() * 4, labelKey: '', angle: 0, placed: false,
  };
}

function makeCard(faceMat, backMat) {
  const g = new THREE.Group();
  const front = new THREE.Mesh(GEO.card, faceMat), back = new THREE.Mesh(GEO.card, backMat);
  front.position.z = 0.0007;
  back.position.z = -0.0007;
  back.rotation.y = Math.PI;
  g.add(front, back);
  return g;
}

/* ---------- the scene ---------- */
export async function createTable3D(opts) {
  try { await Promise.race([Promise.all([document.fonts.load('400 100px "League Gothic"'), document.fonts.load('600 40px "Instrument Sans"')]), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  opts.mount.prepend(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B1310');
  scene.fog = new THREE.Fog('#0B1310', 5, 13);
  const camera = new THREE.PerspectiveCamera(58, 1.6, 0.03, 40);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // room
  scene.add(new THREE.HemisphereLight('#FFF1DC', '#14231D', 1.25));
  const lamp = new THREE.PointLight('#FFD9A0', 9, 9, 1.7);
  lamp.position.set(0, 2.05, 0);
  scene.add(lamp);
  const fill = new THREE.DirectionalLight('#C8DAFF', 0.55);
  fill.position.set(2, 3, 4);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), mat('#1D140E', { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat('#40201B', { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.003;
  scene.add(rug);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 5, 48, 1, true), mat('#14271F', { side: THREE.BackSide, roughness: 1 }));
  wall.position.y = 2.5;
  scene.add(wall);
  for (let i = 0; i < 12; i += 1) {   // wall panels, so turning your head shows movement
    const a = (i / 12) * TAU;
    const panel = part(GEO.box, mat('#1C3329', { roughness: 1 }), [1.5, 2.2, 0.04], [Math.sin(a) * 6.4, 1.9, Math.cos(a) * 6.4]);
    panel.rotation.y = a;
    scene.add(panel);
  }
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.26, 28, 1, true), mat('#1E5646', { side: THREE.DoubleSide, roughness: 0.6 }));
  shade.position.y = 2.2;
  scene.add(shade, part(GEO.cyl, mat('#111'), [0.006, 2.4, 0.006], [0, 3.5, 0]));
  scene.add(part(GEO.sphere, new THREE.MeshBasicMaterial({ color: '#FFE9B8' }), [0.06, 0.06, 0.06], [0, 2.12, 0]));

  // table, built at radius 1 and scaled to fit the number of seats
  const table = new THREE.Group();
  table.add(part(GEO.cyl, mat('#1E5646', { roughness: 1 }), [1, 0.05, 1], [0, TABLE_Y - 0.025, 0]));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 12, 72), mat('#6B3F1D', { roughness: 0.55 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TABLE_Y - 0.012;
  const stitch = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.003, 6, 72), mat('#CFE3D8', { transparent: true, opacity: 0.35 }));
  stitch.rotation.x = Math.PI / 2;
  stitch.position.y = TABLE_Y + 0.001;
  table.add(rim, stitch);
  scene.add(table);
  scene.add(part(GEO.cyl, mat('#4A2B14', { roughness: 0.6 }), [0.11, TABLE_Y - 0.05, 0.11], [0, (TABLE_Y - 0.05) / 2, 0]));
  scene.add(part(GEO.cyl, mat('#4A2B14', { roughness: 0.6 }), [0.42, 0.05, 0.42], [0, 0.025, 0]));

  const textures = { puff: puffTexture(), back: backTexture(), blank: faceTexture(null), faces: new Map(), emoji: new Map() };
  textures.backMat = new THREE.MeshStandardMaterial({ map: textures.back, roughness: 0.6, alphaTest: 0.5 });
  // card faces are unlit so the values stay readable whatever the lamp is doing
  textures.blankMat = new THREE.MeshBasicMaterial({ map: textures.blank, alphaTest: 0.5, toneMapped: false });
  const faceMat = value => {
    let m = textures.faces.get(value);
    if (!m) { m = new THREE.MeshBasicMaterial({ map: faceTexture(value), alphaTest: 0.5, toneMapped: false }); textures.faces.set(value, m); }
    return m;
  };

  /* ----- state ----- */
  let view = { players: [], revealed: false, cards: [], myVote: null, canPlay: false };
  const avatars = new Map();          // other players, by id
  const tableCards = new Map();       // played cards, by player id
  const flying = [];                  // reactions in the air
  let seatR = 1.2, tableR = 0.84, myHeadY = 1.34, myAngle = 0, mySmoking = false;
  const look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, sent: [9, 9, 9], sentAt: 0 };
  let handUp = false, raise = 0, hover = null, pointer = null, disposed = false;

  // my own cards, held in front of the camera
  const handRig = new THREE.Group();
  camera.add(handRig);
  let handCards = [], handKey = '';
  const myCig = new THREE.Group();
  {
    const s = part(GEO.cyl, mat('#F4F1E8'), [0.006, 0.075, 0.006], [0, 0, -0.03]);
    s.rotation.x = Math.PI / 2;
    const f = part(GEO.cyl, mat('#D9893B'), [0.0062, 0.025, 0.0062], [0, 0, 0.02]);
    f.rotation.x = Math.PI / 2;
    const e = part(GEO.sphere, new THREE.MeshStandardMaterial({ color: '#FF6A2B', emissive: '#FF4A1C', emissiveIntensity: 2 }), [0.0068, 0.0068, 0.0068], [0, 0, -0.069]);
    myCig.add(s, f, e);
    myCig.traverse(o => { o.userData.mine = true; });
    myCig.position.set(0.19, -0.13, -0.36);
    myCig.rotation.set(0.35, 0.5, 0);
    myCig.userData.puffs = [];
    for (let i = 0; i < 4; i += 1) {
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.puff, transparent: true, depthWrite: false, opacity: 0 }));
      p.raycast = () => {};
      myCig.add(p);
      myCig.userData.puffs.push(p);
    }
    myCig.visible = false;
    camera.add(myCig);
  }

  function rebuildHand() {
    for (const c of handCards) handRig.remove(c.mesh);
    handCards = view.cards.map(value => {
      const mesh = makeCard(faceMat(value), textures.backMat);
      mesh.scale.setScalar(1.25);
      mesh.traverse(o => { o.userData.handValue = value; });
      handRig.add(mesh);
      return { value, mesh, lift: 0 };
    });
  }

  function layout() {
    const seated = view.players;
    const n = Math.max(1, seated.length);
    seatR = Math.max(1.2, 0.31 / Math.sin(Math.PI / Math.max(2, n)));
    tableR = seatR - 0.36;
    table.scale.set(tableR, 1, tableR);
    rug.scale.setScalar(seatR + 1.1);
    const meIndex = seated.findIndex(p => p.isMe);
    seated.forEach((p, i) => { p.angle = meIndex >= 0 ? ((i - meIndex) * TAU) / n : ((i + 0.5) * TAU) / n + Math.PI; });
    myAngle = 0;
  }

  function update(next) {
    const deckKey = next.cards.join('\n');
    view = next;
    if (deckKey !== handKey) { handKey = deckKey; rebuildHand(); }
    layout();
    const me = view.players.find(p => p.isMe);
    myHeadY = me ? TABLE_Y + 0.37 * (CAST[me.avatar % CAST.length].h || 1) + 0.055 * (CAST[me.avatar % CAST.length].neck || 1) + 0.118 * (CAST[me.avatar % CAST.length].head || 1) + 0.02 : 1.75;
    mySmoking = !!(me && me.smoking);
    const seen = new Set();
    for (const p of view.players) {
      if (p.isMe) continue;
      seen.add(p.id);
      let a = avatars.get(p.id);
      if (a && a.index !== p.avatar) { scene.remove(a.group); avatars.delete(p.id); a = null; }
      if (!a) {
        a = buildAvatar(p.avatar, textures);
        a.group.traverse(o => { o.userData.playerId = p.id; });
        a.angle = p.angle;
        scene.add(a.group);
        avatars.set(p.id, a);
      }
      a.target = p.angle;
      a.online = p.online;
      a.smoking = p.smoking;
      a.cig.visible = p.smoking;
      const key = p.name + '|' + (p.host ? 1 : 0);
      if (key !== a.labelKey) {
        a.labelKey = key;
        if (a.label.material.map) a.label.material.map.dispose();
        a.label.material.map = labelTexture(p.name, p.host);
        a.label.material.needsUpdate = true;
      }
    }
    for (const [id, a] of avatars) if (!seen.has(id)) { scene.remove(a.group); avatars.delete(id); }

    // played cards
    const voted = new Map();
    for (const p of view.players) if (p.voted) voted.set(p.id, p);
    for (const [id, c] of tableCards) if (!voted.has(id)) { scene.remove(c.outer); tableCards.delete(id); }
    let order = 0;
    for (const [id, p] of voted) {
      let c = tableCards.get(id);
      if (!c) {
        const mesh = makeCard(textures.blankMat, textures.backMat);
        const lay = new THREE.Group(), outer = new THREE.Group();
        lay.add(mesh); outer.add(lay);
        outer.traverse(o => { if (p.isMe) o.userData.myCard = true; });
        scene.add(outer);
        c = { outer, lay, mesh, t: 0, flip: 0, wait: 0, isMe: p.isMe, value: undefined, from: null };
        tableCards.set(id, c);
      }
      if (p.val !== c.value && p.val != null) { c.value = p.val; c.mesh.children[0].material = faceMat(p.val); }
      c.order = order;
      order += 1;
    }
    if (!view.canPlay) handUp = false;
  }

  /* ----- pointer: look around, hover, click ----- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick() {
    if (!pointer) return null;
    ndc.set(pointer.x * 2 - 1, -(pointer.y * 2 - 1));
    ray.setFromCamera(ndc, camera);
    if (view.canPlay) {
      const hits = ray.intersectObjects(handCards.filter(c => c.mesh.visible).map(c => c.mesh), true);
      if (hits.length) return { type: 'hand', hits };
    }
    const others = ray.intersectObjects(scene.children, true);
    for (const h of others) {
      if (h.object.userData.handValue !== undefined || h.object.userData.mine) continue;   // my own hand never blocks the view
      if (h.object.userData.myCard && view.canPlay) return { type: 'mine' };
      if (h.object.userData.playerId) return { type: 'player', id: h.object.userData.playerId };
      if (h.object.isMesh) break;      // something solid is in the way
    }
    return null;
  }
  function topHandCard(hits) {
    // cards overlap in the fan: the one drawn last (highest index) is on top
    let best = null;
    for (const h of hits) {
      const i = handCards.findIndex(c => c.value === h.object.userData.handValue);
      if (i >= 0 && (best === null || i > best)) best = i;
    }
    return best === null ? null : handCards[best];
  }
  let pointerMoved = false, lastHit = null;
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    pointer = { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
    pointerMoved = true;
    const k = handUp ? 0.3 : 1;
    look.tYaw = -(pointer.x * 2 - 1) * 1.15 * k;
    look.tPitch = -(pointer.y * 2 - 1) * 0.42 * k;
  }
  function onClick(e) {
    onMove(e);
    const hit = pick();
    if (hit && hit.type === 'hand') {
      if (!handUp) { handUp = true; return; }
      const card = topHandCard(hit.hits);
      if (card) { opts.onVote(card.value); handUp = false; }
      return;
    }
    if (handUp) { handUp = false; return; }
    if (hit && hit.type === 'mine') { opts.onVote(null); handUp = true; return; }
    if (hit && hit.type === 'player') {
      const a = avatars.get(hit.id);
      const v = new THREE.Vector3(0, a.headY + 0.05, 0).applyMatrix4(a.group.matrixWorld).project(camera);
      const r = canvas.getBoundingClientRect();
      opts.onPlayer(hit.id, { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height });
      return;
    }
    opts.onMiss();
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onMove);
  canvas.addEventListener('click', onClick);

  const resizer = new ResizeObserver(() => {
    const w = opts.mount.clientWidth, h = opts.mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizer.observe(opts.mount);

  /* ----- per-frame ----- */
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  function seatPos(angle, radius, out) { return out.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius); }

  function animatePuffs(puffs, origin, time, scale) {
    puffs.forEach((s, i) => {
      const life = ((time * 0.42 + i / puffs.length) % 1);
      s.position.set(origin[0] + Math.sin(time * 1.3 + i * 2.1) * 0.012 * scale, origin[1] + life * 0.2 * scale, origin[2] + life * 0.02);
      const size = (0.02 + life * 0.08) * scale;
      s.scale.set(size, size, 1);
      s.material.opacity = Math.sin(life * Math.PI) * 0.55;
    });
  }

  let last = performance.now(), time = 0;
  const pace = { frames: 0, total: 0, stage: 0 };     // watches the frame rate and backs off on slow machines
  function frame(now) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (document.hidden || !opts.mount.clientWidth) { last = now; return; }
    const elapsed = (now - last) / 1000;
    const dt = Math.min(0.05, elapsed);
    last = now;
    time += dt;
    if (time > 1.5 && pace.stage < 2 && elapsed < 2) {
      pace.frames += 1; pace.total += elapsed;
      if (pace.frames >= 45) {
        const avg = pace.total / pace.frames;
        pace.frames = 0; pace.total = 0;
        if (pace.stage === 0) { pace.stage = 1; if (avg > 0.07) renderer.setPixelRatio(1); }
        else { pace.stage = 2; if (avg > 0.14 && opts.onSlow) opts.onSlow(); }
      }
    }

    if (pointerMoved || handUp) { lastHit = pointer ? pick() : null; pointerMoved = false; }
    hover = lastHit ? lastHit.type : null;

    // my point of view
    look.yaw = damp(look.yaw, look.tYaw, 9, dt);
    look.pitch = damp(look.pitch, look.tPitch, 9, dt);
    const seated = view.players.some(p => p.isMe);
    if (seated) camera.position.set(0, myHeadY, seatR - 0.02);
    else camera.position.set(0, 1.85, seatR + 1.15);
    v1.set(0, TABLE_Y + 0.14, 0).sub(camera.position).normalize();
    const baseYaw = Math.atan2(-v1.x, -v1.z), basePitch = Math.asin(v1.y);
    camera.rotation.set(basePitch + look.pitch, baseYaw + look.yaw, 0);
    if (now - look.sentAt > 100 && (Math.abs(look.tYaw - look.sent[0]) > 0.012 || Math.abs(look.tPitch - look.sent[1]) > 0.012 || (handUp ? 1 : 0) !== look.sent[2])) {
      look.sent = [look.tYaw, look.tPitch, handUp ? 1 : 0];
      look.sentAt = now;
      opts.onLook(look.tYaw, look.tPitch, handUp ? 1 : 0);
    }

    // other players
    for (const a of avatars.values()) {
      a.angle = lerpAngle(a.angle, a.target, 1 - Math.exp(-6 * dt));
      seatPos(a.angle, seatR, a.group.position);
      a.group.rotation.y = Math.atan2(-a.group.position.x, -a.group.position.z);
      const asleep = !a.online;
      a.yaw = damp(a.yaw, asleep ? 0 : a.look[0], 10, dt);
      a.pitch = damp(a.pitch, asleep ? -0.75 : a.look[1], 10, dt);
      a.headPivot.rotation.set(-(-0.2 + a.pitch), a.yaw, 0);
      a.peek = damp(a.peek, a.look[2] && !view.revealed ? 1 : 0, 8, dt);
      a.torso.scale.y = 0.29 * (CAST[a.index % CAST.length].h || 1) * (1 + Math.sin(time * 1.6 + a.index) * 0.012);
      a.blink -= dt;
      a.eyes.scale.y = a.blink < 0.12 ? 0.1 : 1;
      if (a.blink < 0) a.blink = 2.5 + Math.random() * 4;
      // hand of cards: low over the table, raised to the face while looking at them
      const fy = TABLE_Y + 0.15 + a.peek * (a.headY - TABLE_Y - 0.3);
      a.fan.position.set(0, fy, 0.3 - a.peek * 0.06);
      a.fan.rotation.set(-0.42 + a.peek * 0.3, Math.PI, 0);
      a.fan.visible = !view.revealed;
      for (const arm of a.arms) {
        v1.set(arm.side * 0.085, fy - 0.035, 0.3 - a.peek * 0.06);
        if (view.revealed) v1.set(arm.side * 0.13, TABLE_Y + 0.03, 0.3);
        v2.addVectors(arm.shoulder, v1).multiplyScalar(0.5);
        v2.x += arm.side * 0.075; v2.y -= 0.075; v2.z -= 0.02;
        setLimb(arm.upper, arm.shoulder, v2, a.armR);
        setLimb(arm.lower, v2, v1, a.armR * 0.9);
        arm.elbow.position.copy(v2);
        arm.hand.position.copy(v1);
      }
      if (a.smoking) animatePuffs(a.puffs, [0, 0.005, 0.066], time + a.index, 1);
      a.label.material.opacity = a.online ? 1 : 0.45;
    }

    // played cards: dropped face down, then turned up to face you on reveal
    for (const [id, c] of tableCards) {
      const a = avatars.get(id);
      const angle = c.isMe ? myAngle : a ? a.angle : 0;
      const spot = seatPos(angle, Math.max(0.3, tableR * 0.5), v1);
      spot.y = TABLE_Y + 0.004;
      if (!c.from) {
        c.from = new THREE.Vector3();
        if (c.isMe) c.from.set(0, myHeadY - 0.3, seatR - 0.45);
        else if (a) c.from.set(a.group.position.x * 0.8, TABLE_Y + 0.2, a.group.position.z * 0.8);
        else c.from.copy(spot);
      }
      c.t = Math.min(1, c.t + dt * 2.6);
      const t = ease(c.t);
      if (view.revealed) { if (c.wait < c.order * 0.09) c.wait += dt; else c.flip = Math.min(1, c.flip + dt * 1.7); }
      else { c.flip = Math.max(0, c.flip - dt * 4); c.wait = 0; }
      const f = ease(c.flip);
      c.outer.position.lerpVectors(c.from, spot, t);
      c.outer.position.y += Math.sin(t * Math.PI) * 0.1 + f * 0.2;
      const flat = Math.atan2(spot.x, spot.z);
      const toCam = Math.atan2(camera.position.x - c.outer.position.x, camera.position.z - c.outer.position.z);
      c.outer.rotation.y = lerpAngle(flat, toCam, f);
      c.lay.rotation.x = (-Math.PI / 2) * (1 - f);
      c.mesh.rotation.y = Math.PI * (1 - Math.min(1, f * 2));
      c.outer.scale.setScalar(1.15 + f * 0.75);
    }

    // my own hand
    raise = damp(raise, handUp ? 1 : 0, 10, dt);
    handRig.visible = view.canPlay;
    if (view.canPlay) {
      const shown = handCards.filter(c => c.value !== view.myVote);
      for (const c of handCards) c.mesh.visible = c.value !== view.myVote;
      const n = shown.length;
      const dist = 0.44, rho = 0.75;        // a wide arc keeps the outer cards on screen
      const maxWidth = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * 0.78;
      const open = Math.min(0.042, (maxWidth - CARD_W * 1.25) / Math.max(1, n - 1)) / rho;
      const spread = 0.014 + (open - 0.014) * raise;
      handRig.position.set(0, -0.2 + raise * 0.125, -0.52 + raise * 0.08);
      handRig.rotation.x = 1.9 - raise * 2.08;
      const hot = handUp && lastHit && lastHit.type === 'hand' ? topHandCard(lastHit.hits) : null;
      shown.forEach((c, i) => {
        const a = (i - (n - 1) / 2) * spread;
        c.lift = damp(c.lift, c === hot ? 1 : 0, 16, dt);
        const r = rho + c.lift * 0.034;
        c.mesh.position.set(Math.sin(a) * r, Math.cos(a) * r - rho, i * 0.0014 + c.lift * 0.03);
        c.mesh.rotation.z = -a;
      });
    }
    myCig.visible = mySmoking;
    if (mySmoking) animatePuffs(myCig.userData.puffs, [0, 0.004, -0.072], time, 1.3);

    // reactions in the air
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const e = flying[i];
      e.t += dt / 0.75;
      const end = e.target(v2);
      if (e.t < 1) {
        const k = ease(e.t);
        e.sprite.position.lerpVectors(e.start, end, k);
        e.sprite.position.y += Math.sin(k * Math.PI) * 0.3;
        e.sprite.scale.setScalar(0.14 + k * 0.08);
      } else {
        const k = Math.min(1, (e.t - 1) / 0.9);
        e.sprite.position.copy(end).y += k * 0.16;
        e.sprite.scale.setScalar(0.22 + k * 0.2);
        e.sprite.material.opacity = 1 - k;
        if (k >= 1) { scene.remove(e.sprite); e.sprite.material.dispose(); flying.splice(i, 1); }
      }
    }

    canvas.style.cursor = hover ? 'pointer' : 'default';
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function headPoint(id, out) {
    const a = avatars.get(id);
    if (a) return out.set(0, a.headY + 0.02, 0.1).applyMatrix4(a.group.matrixWorld);
    // me: just in front of my own eyes
    camera.getWorldDirection(out);
    return out.multiplyScalar(0.55).add(camera.position).setY(camera.position.y - 0.08);
  }

  return {
    update,
    looks(map) {
      for (const id of Object.keys(map || {})) {
        const a = avatars.get(id), l = map[id];
        if (a && Array.isArray(l)) a.look = [clamp(Number(l[0]) || 0, -1.3, 1.3), clamp(Number(l[1]) || 0, -0.6, 0.6), l[2] ? 1 : 0];
      }
    },
    emote(from, to, emoji) {
      if (flying.length > 40 || document.hidden) return;
      const targetIsMe = !avatars.has(to);
      if (targetIsMe && !view.players.some(p => p.isMe && p.id === to)) return;
      let map = textures.emoji.get(emoji);
      if (!map) { map = emojiTexture(emoji); textures.emoji.set(emoji, map); }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false }));
      sprite.raycast = () => {};
      sprite.renderOrder = 10;
      const start = headPoint(from, new THREE.Vector3());
      if (!avatars.has(from)) start.y -= 0.12;
      sprite.position.copy(start);
      scene.add(sprite);
      flying.push({ sprite, start, t: 0, target: out => headPoint(to, out) });
    },
    dispose() {
      disposed = true;
      resizer.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onMove);
      canvas.removeEventListener('click', onClick);
      renderer.dispose();
      canvas.remove();
    },
  };
}
