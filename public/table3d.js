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
// body shapes: radius at the hips, belly, chest and shoulders, how deep the body is, and arm thickness
const BUILD = {
  avg:   { hips: 0.165, belly: 0.165, chest: 0.178, shoulder: 0.2,   depth: 0.7,  rU: 0.04,  rL: 0.034 },
  fat:   { hips: 0.25,  belly: 0.285, chest: 0.25,  shoulder: 0.228, depth: 0.92, rU: 0.054, rL: 0.044 },
  thin:  { hips: 0.115, belly: 0.11,  chest: 0.122, shoulder: 0.152, depth: 0.72, rU: 0.03,  rL: 0.026 },
  buff:  { hips: 0.16,  belly: 0.155, chest: 0.24,  shoulder: 0.285, depth: 0.6,  rU: 0.07,  rL: 0.052 },
  round: { hips: 0.2,   belly: 0.215, chest: 0.19,  shoulder: 0.186, depth: 0.85, rU: 0.044, rL: 0.037 },
  broad: { hips: 0.17,  belly: 0.175, chest: 0.2,   shoulder: 0.226, depth: 0.7,  rU: 0.045, rL: 0.037 },
  slim:  { hips: 0.14,  belly: 0.135, chest: 0.152, shoulder: 0.176, depth: 0.68, rU: 0.034, rL: 0.029 },
};
const CAST = [
  { nick: 'Big Tony', skin: 1, build: 'fat', h: 0.94, head: 1.06, hair: ['bald'], face: { brows: 'flat', mustache: '#2B1D14', mouth: 'grin' }, outfit: ['hawaii', '#E4572E', '#F6C945'], sleeves: 'short', extras: ['chain'] },
  { nick: 'Stick', skin: 4, build: 'thin', h: 1.16, neck: 1.8, head: 0.92, hair: ['short', '#1C1512'], face: { brows: 'raised', glasses: 'round', mouth: 'flat' }, outfit: ['turtleneck', '#22333B', '#3A4F5A'], sleeves: 'long' },
  { nick: 'Spike', skin: 0, build: 'slim', h: 1.0, hair: ['mohawk', '#FF3E8A'], face: { brows: 'angry', mouth: 'smirk', earring: true }, outfit: ['jacket', '#1B1B1E', '#B8B8C0'], sleeves: 'long' },
  { nick: 'Grandpa', skin: 2, build: 'round', h: 0.9, hair: ['sides', '#E9E9E4'], hat: ['flatcap', '#6B705C'], face: { brows: 'bushy', browColor: '#E9E9E4', mustache: '#E9E9E4', glasses: 'square', mouth: 'smile' }, outfit: ['cardigan', '#7F5539', '#E6CCB2'], sleeves: 'long' },
  { nick: 'Gym Bro', skin: 1, build: 'buff', h: 1.08, head: 0.84, hair: ['flat', '#3A2A1E'], hat: ['headband', '#E63946'], face: { brows: 'angry', mouth: 'grin' }, outfit: ['tank', '#F1FAEE', '#E63946'], sleeves: 'none' },
  { nick: 'Night Owl', skin: 5, build: 'avg', h: 0.98, hair: ['messy', '#120D0A'], hat: ['hood', '#3A506B'], face: { brows: 'sad', eyes: 'tired', mouth: 'flat' }, outfit: ['hoodie', '#3A506B', '#E8EEF2'], sleeves: 'long', extras: ['headphones'] },
  { nick: 'Flower Child', skin: 0, build: 'slim', h: 1.04, hair: ['long', '#8D6E4A'], hat: ['headband', '#F4A261'], face: { brows: 'raised', glasses: 'tint', beard: '#8D6E4A', mouth: 'smile' }, outfit: ['tiedye', '#9B5DE5', '#F15BB5'], sleeves: 'short' },
  { nick: 'The Boss', skin: 3, build: 'broad', h: 1.02, hair: ['slick', '#151515'], face: { brows: 'flat', mouth: 'flat' }, outfit: ['suit', '#1F2A44', '#C1121F'], sleeves: 'long' },
  { nick: 'Rocker', skin: 0, build: 'slim', h: 1.06, hair: ['long', '#16130F'], face: { brows: 'flat', eyes: 'tired', beard: '#16130F', mouth: 'smirk' }, outfit: ['tee', '#18181B', '#D62828'], sleeves: 'short' },
  { nick: 'Cowboy', skin: 2, build: 'broad', h: 1.02, hair: ['short', '#2F1B12'], hat: ['cowboy', '#8B5E34'], face: { brows: 'squint', eyes: 'squint', mustache: '#2F1B12', mouth: 'smirk' }, outfit: ['plaid', '#C9A227', '#7F4F24'], sleeves: 'long', extras: ['bandana'] },
  { nick: 'Granny', skin: 4, build: 'round', h: 0.86, hair: ['bun', '#D9D9D9'], face: { brows: 'raised', browColor: '#BDBDBD', glasses: 'cateye', mouth: 'smile' }, outfit: ['cardigan', '#B56576', '#F3D5C0'], sleeves: 'long', extras: ['pearls'] },
  { nick: 'Tracksuit', skin: 1, build: 'avg', h: 1.0, hair: ['short', '#6B4B2A'], hat: ['bucket', '#F1F1F1'], face: { brows: 'flat', mouth: 'smirk' }, outfit: ['track', '#0B6E4F', '#FFFFFF'], sleeves: 'long', extras: ['chain'] },
];
const specOf = index => CAST[((index % CAST.length) + CAST.length) % CAST.length];
const shoulderHeight = spec => TABLE_Y + 0.37 * (spec.h || 1);
const headHeight = spec => shoulderHeight(spec) + 0.05 * (spec.neck || 1) + 0.118 * (spec.head || 1);

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
    x.fillStyle = '#FBF8EE'; x.fill();
    roundRect(x, 20, 20, w - 40, h - 40, 14);
    x.fillStyle = '#E8A93A'; x.fill();
    x.save(); x.clip();
    x.strokeStyle = 'rgba(35,25,5,0.32)'; x.lineWidth = 3;
    for (let i = -h; i < w + h; i += 20) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke();
      x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke();
    }
    x.restore();
    roundRect(x, 20, 20, w - 40, h - 40, 14);
    x.lineWidth = 4; x.strokeStyle = 'rgba(35,25,5,0.55)'; x.stroke();
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
function corkTexture() {          // the speckled filter end of a cigarette
  return canvasTexture(64, 64, (x) => {
    x.fillStyle = '#D8913E'; x.fillRect(0, 0, 64, 64);
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 120; i += 1) {
      x.fillStyle = i % 3 ? 'rgba(120,66,18,0.45)' : 'rgba(255,220,160,0.5)';
      x.fillRect(rnd() * 64, rnd() * 64, 1.5 + rnd() * 3, 1 + rnd() * 2);
    }
  });
}
function flameTexture() {
  return canvasTexture(64, 96, (x) => {
    const g = x.createRadialGradient(32, 64, 2, 32, 58, 36);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.3, 'rgba(255,222,110,0.95)');
    g.addColorStop(0.7, 'rgba(255,130,30,0.6)');
    g.addColorStop(1, 'rgba(255,90,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(32, 3); x.bezierCurveTo(54, 36, 60, 62, 32, 93); x.bezierCurveTo(4, 62, 10, 36, 32, 3); x.fill();
    const b = x.createRadialGradient(32, 84, 1, 32, 84, 14);
    b.addColorStop(0, 'rgba(120,170,255,0.9)'); b.addColorStop(1, 'rgba(120,170,255,0)');
    x.fillStyle = b; x.fillRect(14, 68, 36, 28);
  });
}
function glowTexture() {
  return canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,200,120,1)'); g.addColorStop(0.35, 'rgba(255,110,30,0.7)'); g.addColorStop(1, 'rgba(255,80,0,0)');
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

function shade(hex, lightness) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, lightness);
  return '#' + c.getHexString();
}

/* Clothes are painted onto the body instead of being modelled, so nothing sticks out.
   The texture wraps once around the torso with the front in the middle; yOf(d) gives
   the fraction down the texture for a height d metres above (+) or below (-) the shoulders. */
function torsoTexture(spec, skinColor, yOf) {
  const [kind, c1, c2] = spec.outfit;
  return canvasTexture(512, 512, (x, W, H) => {
    const cx = W / 2;
    const Y = d => yOf(d) * H;
    const poly = (pts, fill) => { x.beginPath(); pts.forEach((pt, i) => (i ? x.lineTo(pt[0], pt[1]) : x.moveTo(pt[0], pt[1]))); x.closePath(); x.fillStyle = fill; x.fill(); };
    const dot = (px, py, r, fill) => { x.beginPath(); x.arc(px, py, r, 0, TAU); x.fillStyle = fill; x.fill(); };
    const line = (x1, y1, x2, y2, w, stroke) => { x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.lineWidth = w; x.lineCap = 'round'; x.strokeStyle = stroke; x.stroke(); };
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    x.fillStyle = c1; x.fillRect(0, 0, W, H);

    if (kind === 'hawaii') {
      for (let i = 0; i < 46; i += 1) {
        const px = rnd() * W, py = Y(-0.02) + rnd() * (H - Y(-0.02)), r = 9 + rnd() * 5;
        for (let k = 0; k < 5; k += 1) dot(px + Math.cos((k / 5) * TAU) * r, py + Math.sin((k / 5) * TAU) * r, r * 0.72, k % 2 ? c2 : '#FFF4D6');
        dot(px, py, r * 0.45, '#2B6A4D');
      }
      poly([[cx - 60, 0], [cx + 60, 0], [cx, Y(-0.15)]], skinColor);
      poly([[cx - 60, 0], [cx - 92, 0], [cx - 34, Y(-0.1)]], shade(c1, 0.12));
      poly([[cx + 60, 0], [cx + 92, 0], [cx + 34, Y(-0.1)]], shade(c1, 0.12));
    } else if (kind === 'turtleneck') {
      for (let py = 0; py < H; py += 9) line(0, py, W, py, 2, 'rgba(255,255,255,0.045)');
      x.fillStyle = c2; x.fillRect(0, 0, W, Y(-0.012));
    } else if (kind === 'jacket') {
      poly([[cx - 52, 0], [cx + 52, 0], [cx, Y(-0.21)]], '#E9E7E2');
      poly([[cx - 52, 0], [cx - 104, 0], [cx - 70, Y(-0.12)], [cx, Y(-0.21)]], shade(c1, 0.09));
      poly([[cx + 52, 0], [cx + 104, 0], [cx + 70, Y(-0.12)], [cx, Y(-0.21)]], shade(c1, 0.09));
      line(cx, Y(-0.21), cx, H, 4, c2);
      for (const side of [-1, 1]) for (let i = 0; i < 4; i += 1) dot(cx + side * (150 + i * 16), Y(-0.045), 4.5, c2);
      for (const side of [-1, 1]) line(cx + side * 62, Y(-0.3), cx + side * 100, Y(-0.3), 3, c2);
    } else if (kind === 'cardigan') {
      for (let px = 0; px < W; px += 10) line(px, 0, px, H, 2, 'rgba(0,0,0,0.05)');
      poly([[cx - 50, 0], [cx + 50, 0], [cx + 13, Y(-0.3)], [cx + 13, H], [cx - 13, H], [cx - 13, Y(-0.3)]], c2);
      for (let d = -0.32; d > -0.62; d -= 0.065) dot(cx + 24, Y(d), 6, shade(c1, -0.16));
      line(cx - 50, 0, cx - 13, Y(-0.3), 5, shade(c1, -0.1));
      line(cx + 50, 0, cx + 13, Y(-0.3), 5, shade(c1, -0.1));
    } else if (kind === 'tank') {
      x.fillStyle = skinColor; x.fillRect(0, 0, W, H);
      x.fillStyle = c1; x.fillRect(0, Y(-0.1), W, H);
      for (const sx of [cx - 62, cx + 62, 62, W - 62]) x.fillRect(sx - 23, 0, 46, Y(-0.1) + 2);
      const scoop = (px, rx, ry) => {      // a neckline or armhole: skin above, a coloured trim along the lower edge
        x.beginPath(); x.ellipse(px, Y(-0.1), rx, ry, 0, 0, TAU); x.fillStyle = skinColor; x.fill();
        x.beginPath(); x.ellipse(px, Y(-0.1), rx, ry, 0, 0, Math.PI); x.lineWidth = 5; x.strokeStyle = c2; x.stroke();
      };
      scoop(cx, 40, Y(-0.165) - Y(-0.1));
      scoop(W * 0.25, 70, Y(-0.215) - Y(-0.1));
      scoop(W * 0.75, 70, Y(-0.215) - Y(-0.1));
      scoop(0, 40, Y(-0.14) - Y(-0.1));
      scoop(W, 40, Y(-0.14) - Y(-0.1));
      x.fillStyle = skinColor; x.fillRect(0, 0, W, 6);
    } else if (kind === 'hoodie') {
      for (const side of [-1, 1]) { line(cx + side * 13, 0, cx + side * 15, Y(-0.21), 4, c2); dot(cx + side * 15, Y(-0.215), 5, c2); }
      x.lineWidth = 4; x.strokeStyle = shade(c1, -0.12);
      roundRect(x, cx - 74, Y(-0.33), 148, Y(-0.47) - Y(-0.33), 16); x.stroke();
      line(0, Y(-0.02), W, Y(-0.02), 5, shade(c1, -0.1));
    } else if (kind === 'tiedye') {
      const rings = [c1, c2, '#FEE440', '#00BBF9', c1, c2, '#FEE440'];
      for (let i = rings.length - 1; i >= 0; i -= 1) { dot(cx, Y(-0.2), 40 + i * 44, rings[i]); dot(cx - W, Y(-0.2), 40 + i * 44, rings[i]); dot(cx + W, Y(-0.2), 40 + i * 44, rings[i]); }
      line(0, 4, W, 4, 8, shade(c1, -0.15));
    } else if (kind === 'suit') {
      poly([[cx - 56, 0], [cx + 56, 0], [cx, Y(-0.27)]], '#F4F4F0');
      poly([[cx - 56, 0], [cx - 100, 0], [cx - 60, Y(-0.16)], [cx, Y(-0.27)]], shade(c1, 0.07));
      poly([[cx + 56, 0], [cx + 100, 0], [cx + 60, Y(-0.16)], [cx, Y(-0.27)]], shade(c1, 0.07));
      poly([[cx - 11, Y(-0.02)], [cx + 11, Y(-0.02)], [cx + 15, Y(-0.2)], [cx, Y(-0.25)], [cx - 15, Y(-0.2)]], c2);
      for (const d of [-0.33, -0.41]) dot(cx + 5, Y(d), 6, shade(c1, -0.1));
      line(cx + 78, Y(-0.2), cx + 116, Y(-0.2), 5, '#F4F4F0');
    } else if (kind === 'tee') {
      line(0, 5, W, 5, 10, shade(c1, 0.12));
      dot(cx, Y(-0.19), 46, c2);
      poly([[cx + 8, Y(-0.19) - 34], [cx - 18, Y(-0.19) + 4], [cx - 2, Y(-0.19) + 4], [cx - 10, Y(-0.19) + 34], [cx + 18, Y(-0.19) - 6], [cx + 2, Y(-0.19) - 6]], '#18181B');
    } else if (kind === 'plaid') {
      for (let px = 0; px < W; px += 40) { x.fillStyle = 'rgba(127,79,36,0.42)'; x.fillRect(px, 0, 12, H); }
      for (let py = 0; py < H; py += 40) { x.fillStyle = 'rgba(127,79,36,0.42)'; x.fillRect(0, py, W, 12); }
      x.fillStyle = shade(c1, -0.06); x.fillRect(cx - 10, 0, 20, H);
      for (let d = -0.1; d > -0.62; d -= 0.075) dot(cx, Y(d), 4.5, '#FFF8E7');
      poly([[cx - 8, 0], [cx - 74, 0], [cx - 40, Y(-0.085)]], c2);
      poly([[cx + 8, 0], [cx + 74, 0], [cx + 40, Y(-0.085)]], c2);
    } else if (kind === 'track') {
      line(cx, 0, cx, H, 5, c2);
      for (const px of [W * 0.25, W * 0.75]) { x.fillStyle = c2; x.fillRect(px - 15, Y(-0.06), 9, H); x.fillRect(px + 6, Y(-0.06), 9, H); }
      x.fillStyle = c2; x.fillRect(0, 0, W, Y(-0.012));
      x.fillStyle = c2; x.fillRect(cx + 38, Y(-0.17), 26, 16);
    }

    // jewellery and scarves are painted too
    const necklace = (fill, r, step) => {
      for (let t = 0; t <= 1.001; t += step) {
        const a = Math.PI * t;
        dot(cx - Math.cos(a) * 58, Y(-0.01) + Math.sin(a) * (Y(-0.125) - Y(-0.01)), r, fill);
      }
    };
    for (const extra of spec.extras || []) {
      if (extra === 'chain') necklace('#E8C547', 4.2, 0.045);
      if (extra === 'pearls') necklace('#FBF6EC', 6, 0.07);
      if (extra === 'bandana') poly([[cx - 66, 0], [cx + 66, 0], [cx, Y(-0.12)]], '#C1121F');
    }

    // a little shading towards the lap gives the body some depth
    const g = x.createLinearGradient(0, Y(-0.2), 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  });
}

function bubbleTexture(name, text) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '500 34px "Instrument Sans", system-ui, sans-serif';
  const words = text.split(' '), lines = [];
  let cur = '';
  for (let w of words) {
    while (probe.measureText(w).width > 430) { lines.push(w.slice(0, 22)); w = w.slice(22); }
    const next = cur ? cur + ' ' + w : w;
    if (probe.measureText(next).width > 430 && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].slice(0, 20) + '…'; }
  const width = Math.min(480, Math.max(170, ...lines.map(l => probe.measureText(l).width), probe.measureText(name).width * 0.8) + 44);
  const height = 50 + lines.length * 42 + 40;
  const tex = canvasTexture(512, height, (x, W, H) => {
    const left = (W - width) / 2, bodyH = H - 28;
    roundRect(x, left, 3, width, bodyH - 3, 24);
    x.fillStyle = '#FBF8EE'; x.fill();
    x.lineWidth = 4; x.strokeStyle = '#17211E'; x.stroke();
    x.beginPath(); x.moveTo(W / 2 - 16, bodyH - 2); x.lineTo(W / 2, H - 3); x.lineTo(W / 2 + 16, bodyH - 2); x.closePath();
    x.fillStyle = '#FBF8EE'; x.fill();
    x.beginPath(); x.moveTo(W / 2 - 16, bodyH); x.lineTo(W / 2, H - 3); x.lineTo(W / 2 + 16, bodyH); x.stroke();
    x.textAlign = 'left'; x.textBaseline = 'middle';
    x.font = '700 25px "Instrument Sans", system-ui, sans-serif';
    x.fillStyle = '#1E5646';
    x.fillText(name.length > 22 ? name.slice(0, 21) + '…' : name, left + 22, 30);
    x.font = '500 34px "Instrument Sans", system-ui, sans-serif';
    x.fillStyle = '#17211E';
    lines.forEach((l, i) => x.fillText(l, left + 22, 72 + i * 42));
  });
  tex.userData = { aspect: height / 512 };
  return tex;
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
    const spikeGeo = new THREE.ConeGeometry(1, 1, 10);
    for (let i = 0; i < 6; i += 1) {
      const a = -0.55 + i * 0.36;      // from the forehead (negative) over the top to the back of the head
      const spike = part(spikeGeo, hairMat, [R * 0.13, R * (0.62 - Math.abs(i - 2.2) * 0.05), R * 0.2], [0, Math.cos(a) * R * 1.26, -Math.sin(a) * R * 1.18]);
      spike.rotation.x = -a;
      g.add(spike);
    }
    g.add(part(GEO.sphere, hairMat, [R * 0.1, R * 0.12, R * 0.92], [0, R * 0.98, -R * 0.2]));
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

/* A cigarette: cork filter, gold band, paper that burns back, a glowing ember and a growing ash tip.
   It points along +z from the mouth end. */
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function makeCig(textures) {
  const group = new THREE.Group();
  const r = 0.0066, along = m => { m.rotation.x = Math.PI / 2; return m; };
  const filter = along(part(GEO.cyl, new THREE.MeshStandardMaterial({ map: textures.cork, roughness: 0.9 }), [r * 1.03, 0.024, r * 1.03], [0, 0, 0.012]));
  const band = along(part(GEO.cyl, mat('#C9A227', { metalness: 0.6, roughness: 0.35 }), [r * 1.05, 0.0018, r * 1.05], [0, 0, 0.0252]));
  const paper = along(part(GEO.cyl, mat('#F6F3EA', { roughness: 0.95 }), [r, 0.06, r], [0, 0, 0.056]));
  const ember = along(part(GEO.cyl, new THREE.MeshStandardMaterial({ color: '#2A0F08', emissive: '#FF5A1F', emissiveIntensity: 0, roughness: 1 }), [r * 1.02, 0.0036, r * 1.02], [0, 0, 0.088]));
  const ash = along(part(GEO.cyl, mat('#8F8F8A', { roughness: 1 }), [r * 0.93, 0.004, r * 0.93], [0, 0, 0.092]));
  const ashTip = part(GEO.sphere, mat('#A7A7A2', { roughness: 1 }), [r * 0.93, r * 0.93, r * 0.6], [0, 0, 0.094]);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  glow.raycast = () => {};
  group.add(filter, band, paper, ember, ash, ashTip, glow);
  const wisps = [];
  for (let i = 0; i < 6; i += 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.puff, transparent: true, depthWrite: false, opacity: 0 }));
    s.raycast = () => {};
    group.add(s);
    wisps.push(s);
  }
  group.visible = false;
  return { group, paper, ember, ash, ashTip, glow, wisps, tip: 0.094, seed: Math.random() * 9 };
}
/* `left` runs from 1 (just lit) to 0 (finished); `elapsed` is seconds since it was lit. */
function burnCig(cig, left, elapsed, time, wisp = 1) {      // wisp < 1 thins the smoke (used for your own cigarette, close to the eye)
  const lit = smooth(0.7, 1.6, elapsed);                  // nothing glows until the flame has caught
  const len = 0.008 + 0.054 * left;                       // paper still to burn
  const end = 0.026 + len;
  const phase = (time + cig.seed) % 9;                    // every so often the smoker takes a drag
  const drag = phase < 1.2 ? Math.sin((phase / 1.2) * Math.PI) : 0;
  const exhale = phase > 1.2 && phase < 3.2 ? Math.sin(((phase - 1.2) / 2) * Math.PI) : 0;
  const ashLen = (0.0015 + ((time * 0.045 + cig.seed) % 1) * 0.012) * lit;      // grows, then drops off
  cig.paper.scale.y = len;
  cig.paper.position.z = 0.026 + len / 2;
  cig.ember.position.z = end + 0.0018;
  cig.ember.material.emissiveIntensity = lit * (1.3 + drag * 3.2 + Math.sin(time * 7 + cig.seed) * 0.25);
  cig.ash.visible = cig.ashTip.visible = lit > 0.4;
  cig.ash.scale.y = Math.max(0.0005, ashLen);
  cig.ash.position.z = end + 0.0036 + ashLen / 2;
  cig.ashTip.position.z = end + 0.0036 + ashLen;
  cig.tip = end + 0.0036 + ashLen;
  cig.glow.position.z = end + 0.003;
  cig.glow.scale.setScalar(0.022 + drag * 0.034);
  cig.glow.material.opacity = lit * (0.4 + drag * 0.6);
  cig.wisps.forEach((s, i) => {
    const life = (time * 0.3 + i / cig.wisps.length) % 1;
    s.position.set(Math.sin(time * 0.9 + i * 1.7 + life * 4) * 0.014 * (0.3 + life) * wisp, 0.004 + life * 0.22 * wisp, cig.tip + life * 0.012);
    const k = (0.01 + life * (0.045 + exhale * 0.04)) * wisp;
    s.scale.set(k, k, 1);
    s.material.opacity = lit * Math.sin(life * Math.PI) * (0.3 + exhale * 0.3) * (wisp < 1 ? 0.7 : 1);
  });
}

/* A pocket lighter. Its flame sits at the top; `top` is how far above the base that is. */
function makeLighter(textures) {
  const group = new THREE.Group();
  group.add(part(GEO.box, mat('#D62828', { roughness: 0.3 }), [0.022, 0.05, 0.011], [0, 0.025, 0]));
  group.add(part(GEO.box, mat('#C9CCD1', { metalness: 0.8, roughness: 0.3 }), [0.022, 0.014, 0.011], [0, 0.057, 0]));
  const wheel = part(GEO.cyl, mat('#55585E', { metalness: 0.7, roughness: 0.4 }), [0.005, 0.009, 0.005], [0.006, 0.066, 0]);
  wheel.rotation.x = Math.PI / 2;
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.flame, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  flame.center.set(0.5, 0.06);
  flame.position.set(-0.004, 0.064, 0);
  flame.raycast = () => {};
  group.add(wheel, flame);
  group.visible = false;
  return { group, flame, top: 0.092 };
}
/* The lighting-up moment: the lighter comes up for the first couple of seconds of a smoke break. */
function lightUp(lighter, elapsed, time) {
  const up = smooth(0, 0.45, elapsed) * (1 - smooth(1.8, 2.3, elapsed));
  lighter.group.visible = up > 0.02;
  const burning = elapsed > 0.5 && elapsed < 1.85;
  lighter.flame.visible = burning;
  if (burning) {
    const flick = 0.85 + Math.sin(time * 31) * 0.1 + Math.sin(time * 17.3) * 0.08;
    lighter.flame.scale.set(0.02 * flick, 0.036 * flick, 1);
  }
  return up;
}

/* An ashtray for the middle of the table; finished cigarettes end up in it. */
function makeAshtray() {
  const group = new THREE.Group();
  const outline = [[0, 0.007], [0.058, 0.007], [0.07, 0.014], [0.074, 0.032], [0.088, 0.032], [0.092, 0.018], [0.088, 0], [0, 0]].map(pt => new THREE.Vector2(pt[0], pt[1]));
  const dish = new THREE.Mesh(new THREE.LatheGeometry(outline, 40), mat('#8A4B14', { roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
  const ashes = new THREE.Mesh(new THREE.CircleGeometry(0.056, 28), mat('#77726C', { roughness: 1 }));
  ashes.rotation.x = -Math.PI / 2;
  ashes.position.y = 0.0085;
  group.add(dish, ashes);
  for (let i = 0; i < 3; i += 1) {         // rests cut into the rim
    const a = (i / 3) * TAU + 0.5;
    const rest = part(GEO.cyl, mat('#5E3209', { roughness: 0.3 }), [0.0085, 0.022, 0.0085], [Math.sin(a) * 0.081, 0.033, Math.cos(a) * 0.081]);
    rest.rotation.set(Math.PI / 2, 0, -a);
    group.add(rest);
  }
  const butts = [];
  const addButt = () => {
    if (butts.length >= 9) group.remove(butts.shift());
    const butt = new THREE.Group();
    const along = m => { m.rotation.x = Math.PI / 2; return m; };
    butt.add(along(part(GEO.cyl, mat('#D8913E', { roughness: 0.9 }), [0.0066, 0.022, 0.0066], [0, 0, 0])));
    butt.add(along(part(GEO.cyl, mat('#EDEAE1', { roughness: 0.95 }), [0.0064, 0.007, 0.0064], [0, 0, 0.0145])));
    butt.add(part(GEO.sphere, mat('#3B3836', { roughness: 1 }), [0.0062, 0.0062, 0.004], [0, 0, 0.018]));
    const a = Math.random() * TAU, d = Math.random() * 0.034;
    butt.position.set(Math.sin(a) * d, 0.0155, Math.cos(a) * d);
    butt.rotation.set(-0.12, Math.random() * TAU, 0);
    group.add(butt);
    butts.push(butt);
  };
  return { group, addButt };
}

function buildAvatar(index, textures, labelText) {
  const spec = specOf(index);
  const b = BUILD[spec.build] || BUILD.avg;
  const group = new THREE.Group();
  const [outfit, c1, c2] = spec.outfit;
  const skinColor = SKIN[spec.skin];
  const skin = mat(skinColor);
  const cloth = mat(c1);
  const sy = shoulderHeight(spec);
  const R = 0.118 * (spec.head || 1);
  const neckLen = 0.05 * (spec.neck || 1);

  // chair
  const wood = mat('#3A2416');
  group.add(part(GEO.box, wood, [0.46, 0.05, 0.44], [0, 0.45, -0.04]));
  group.add(part(GEO.box, wood, [0.44, 0.6, 0.045], [0, 0.8, -0.27]));
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.24, 0.15]) group.add(part(GEO.cyl, wood, [0.018, 0.44, 0.018], [sx, 0.22, sz]));

  // body: one smooth shape from the lap to the collar, with the clothes painted on
  const outline = [
    [b.hips * 0.9, 0.46], [b.hips, 0.56], [b.belly, TABLE_Y - 0.03], [(b.belly + b.chest) / 2, TABLE_Y + 0.08],
    [b.chest, sy - 0.17], [b.shoulder, sy - 0.08], [b.shoulder * 0.93, sy - 0.035], [0.1, sy - 0.004], [0.056, sy + 0.02],
  ].map(pt => new THREE.Vector2(pt[0], pt[1]));
  const profile = new THREE.SplineCurve(outline).getSpacedPoints(44);
  const yOf = d => {
    let j = profile.findIndex(pt => pt.y >= sy + d);
    if (j < 0) j = profile.length - 1;
    return 1 - j / (profile.length - 1);
  };
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), new THREE.MeshStandardMaterial({ map: torsoTexture(spec, skinColor, yOf), roughness: 0.88 }));
  torso.rotation.y = Math.PI;        // puts the texture seam at the back
  torso.scale.z = b.depth;
  group.add(torso);
  const turtle = outfit === 'turtleneck';
  group.add(part(GEO.cyl, turtle ? mat(c2) : skin, [turtle ? 0.058 : 0.046, neckLen + 0.05, turtle ? 0.058 : 0.046], [0, sy + neckLen / 2, 0]));

  // legs under the table
  const pants = mat('#2A2C36'), legR = clamp(b.hips * 0.42, 0.05, 0.09);
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * b.hips * 0.5, 0.53, 0.02), knee = new THREE.Vector3(side * b.hips * 0.62, 0.52, 0.4), foot = new THREE.Vector3(side * b.hips * 0.62, 0.07, 0.43);
    const thigh = new THREE.Mesh(GEO.cyl, pants), shin = new THREE.Mesh(GEO.cyl, pants);
    setLimb(thigh, hip, knee, legR);
    setLimb(shin, knee, foot, legR * 0.8);
    group.add(thigh, shin, part(GEO.sphere, pants, [legR, legR, legR], [knee.x, knee.y, knee.z]));
    group.add(part(GEO.sphere, mat('#151515'), [legR * 0.95, 0.04, 0.1], [foot.x, 0.04, foot.z + 0.04]));
  }

  // head on a neck pivot, so it can turn with the player's mouse
  const headPivot = new THREE.Group();
  headPivot.rotation.order = 'YXZ';
  headPivot.position.set(0, sy + neckLen, 0);
  const head = buildHead(spec, R);
  head.group.position.y = R;
  headPivot.add(head.group);
  group.add(headPivot);
  const headY = sy + neckLen + R;

  const cig = makeCig(textures);
  cig.group.position.set(R * 0.2, R * 0.58, R * 0.93);
  cig.group.rotation.set(0.22, 0.3, 0);
  cig.group.scale.setScalar(1.2);
  headPivot.add(cig.group);
  const lighter = makeLighter(textures);
  group.add(lighter.group);

  // arms: same thickness along each part, so they read as sleeves and not sticks with knobs
  const sleeve = spec.sleeves === 'none' ? skin : cloth;
  const fore = spec.sleeves === 'long' ? cloth : skin;
  const arms = [-1, 1].map(side => {
    const shoulder = new THREE.Vector3(side * (b.shoulder - b.rU * 0.5), sy - 0.078, 0);
    const upper = new THREE.Mesh(GEO.cyl, sleeve), lower = new THREE.Mesh(GEO.cyl, fore);
    const elbow = part(GEO.sphere, sleeve, [b.rU, b.rU, b.rU], [0, 0, 0]);
    const hand = new THREE.Group();
    hand.add(part(GEO.sphere, skin, [0.04, 0.033, 0.047], [0, 0, 0.012]), part(GEO.sphere, skin, [0.015, 0.014, 0.024], [side * -0.03, 0.012, 0.022]));
    if (spec.sleeves === 'long') hand.add(part(GEO.cyl, cloth, [b.rL * 1.12, 0.022, b.rL * 1.12], [0, 0, -0.03]).rotateX(Math.PI / 2));
    group.add(upper, lower, elbow, hand, part(GEO.sphere, sleeve, [b.rU * 1.12, b.rU * 1.12, b.rU * 1.12], [shoulder.x, shoulder.y, shoulder.z]));
    return { side, upper, lower, elbow, hand, shoulder, rU: b.rU, rL: b.rL };
  });

  // the hand of cards
  const fan = new THREE.Group();
  for (let i = 0; i < 5; i += 1) {
    const c = makeCard(textures.blankMat, textures.backMat);
    const a = (i - 2) * 0.24;
    c.scale.setScalar(1.2);
    c.position.set(Math.sin(a) * 0.2, Math.cos(a) * 0.2 - 0.2, (i - 2) * 0.0016);
    c.rotation.z = -a;
    fan.add(c);
  }
  fan.rotation.order = 'YXZ';
  group.add(fan);

  // name tag and speech bubble keep the same size on screen at any distance
  const anchorY = headY + R + 0.15 + (spec.hat ? 0.05 : 0);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false }));
  label.scale.set(0.42, 0.079, 1);
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  bubble.center.set(0.5, 0);
  bubble.renderOrder = 8;
  for (const sp of [label, bubble]) { sp.position.set(0, anchorY, 0); sp.raycast = () => {}; group.add(sp); }
  bubble.visible = false;
  if (labelText) { label.material.map = labelTexture(labelText, false); }

  return {
    index, group, headPivot, eyes: head.eyes, fan, arms, cig, lighter, label, bubble, torso, headY, R,
    depth: b.depth, reach: Math.max(0.3, b.belly * b.depth + 0.105), anchorY,
    look: [0, 0, 0], yaw: 0, pitch: 0, peek: 0, blink: 2 + Math.random() * 4, labelKey: '', angle: 0,
    online: true, smokeEnd: 0, bubbleUntil: 0,
  };
}

/* Moves one character for this frame: head, breathing, blinking, arms and cards, cigarette, speech bubble. */
const _hand = new THREE.Vector3(), _elbow = new THREE.Vector3(), _tip = new THREE.Vector3();
function animateAvatar(a, dt, time, revealed, smokeTotal) {
  const asleep = !a.online;
  a.yaw = damp(a.yaw, asleep ? 0 : a.look[0], 10, dt);
  a.pitch = damp(a.pitch, asleep ? -0.75 : a.look[1], 10, dt);
  a.headPivot.rotation.set(0.2 - a.pitch, a.yaw, 0);
  a.peek = damp(a.peek, a.look[2] && !revealed ? 1 : 0, 8, dt);
  const breath = Math.sin(time * 1.6 + a.index) * 0.012;
  a.torso.scale.set(1 + breath, 1, a.depth * (1 + breath));
  a.blink -= dt;
  a.eyes.scale.y = a.blink < 0.12 ? 0.1 : 1;
  if (a.blink < 0) a.blink = 2.5 + Math.random() * 4;

  // cards low over the table, raised to the face while the player looks at them
  const fy = TABLE_Y + 0.165 + a.peek * (a.headY - TABLE_Y - 0.31);
  const fz = a.reach - a.peek * 0.07;
  a.fan.position.set(0, fy, fz);
  a.fan.rotation.set(-0.36 + a.peek * 0.26, Math.PI, 0);
  a.fan.visible = !revealed;
  for (const arm of a.arms) {
    if (revealed) _hand.set(arm.side * 0.15, TABLE_Y + 0.04, a.reach + 0.03);
    else _hand.set(arm.side * 0.115, fy - 0.03, fz - 0.012);
    _elbow.addVectors(arm.shoulder, _hand).multiplyScalar(0.5);
    _elbow.x += arm.side * 0.08; _elbow.y -= 0.09; _elbow.z -= 0.035;
    setLimb(arm.upper, arm.shoulder, _elbow, arm.rU);
    setLimb(arm.lower, _elbow, _hand, arm.rL);
    arm.elbow.position.copy(_elbow);
    arm.hand.position.copy(_hand);
    arm.hand.lookAt(a.group.localToWorld(_dir.copy(_hand).add(_elbow.subVectors(_hand, _elbow))));
  }

  // smoke break: light up with the right hand, then the cigarette burns down by itself
  const remaining = a.smokeEnd ? a.smokeEnd - Date.now() : 0;
  const smoking = remaining > 0;
  a.cig.group.visible = smoking;
  if (smoking) {
    const elapsed = (smokeTotal - remaining) / 1000;
    burnCig(a.cig, clamp(remaining / smokeTotal, 0, 1), elapsed, time + a.index);
    const up = lightUp(a.lighter, elapsed, time);
    if (up > 0.02) {
      const arm = a.arms[1];
      a.cig.group.localToWorld(_tip.set(0, 0, a.cig.tip));
      a.group.worldToLocal(_tip);
      _hand.copy(arm.hand.position).lerp(_tip.set(_tip.x + 0.004, _tip.y - a.lighter.top - 0.012, _tip.z + 0.004), up);
      _elbow.addVectors(arm.shoulder, _hand).multiplyScalar(0.5);
      _elbow.x += 0.09; _elbow.y -= 0.07; _elbow.z -= 0.01;
      setLimb(arm.upper, arm.shoulder, _elbow, arm.rU);
      setLimb(arm.lower, _elbow, _hand, arm.rL);
      arm.elbow.position.copy(_elbow);
      arm.hand.position.copy(_hand);
      a.lighter.group.position.set(_hand.x, _hand.y + 0.012, _hand.z);
    }
  } else a.lighter.group.visible = false;

  if (a.bubble.visible) {
    const remaining = a.bubbleUntil - performance.now();
    if (remaining <= 0) { a.bubble.visible = false; a.label.visible = true; }
    else a.bubble.material.opacity = Math.min(1, remaining / 400);
  }
  a.label.material.opacity = a.online ? 1 : 0.45;
}

/* Keeps a speech bubble on screen: above the head when there is room, otherwise beside it. */
const _anchor = new THREE.Vector3();
function placeBubble(a, camera) {
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  a.group.localToWorld(_anchor.set(0, a.anchorY, 0));
  const dist = Math.max(0.3, _anchor.distanceTo(camera.position));
  _anchor.project(camera);
  const tall = a.bubble.scale.y / tan, wide = a.bubble.scale.x / tan / camera.aspect;     // size in screen units (-1..1)
  if (_anchor.y + tall > 0.96) {
    const gap = (a.R * 1.4) / (dist * a.bubble.scale.x);
    a.bubble.position.y = a.headY;
    a.bubble.center.set(_anchor.x < 0 ? -gap : 1 + gap, 0.5);
    a.label.visible = true;
  } else {
    let cx = 0.5;
    if (_anchor.x + wide / 2 > 0.97) cx += (_anchor.x + wide / 2 - 0.97) / wide;
    if (_anchor.x - wide / 2 < -0.97) cx -= (-0.97 - (_anchor.x - wide / 2)) / wide;
    a.bubble.position.y = a.anchorY;
    a.bubble.center.set(cx, 0);
    a.label.visible = false;
  }
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
function makeTextures() {
  const t = { puff: puffTexture(), cork: corkTexture(), flame: flameTexture(), glow: glowTexture(), back: backTexture(), blank: faceTexture(null), faces: new Map(), emoji: new Map() };
  // card backs glow a little so a hand of cards still reads as cards in the dim room
  t.backMat = new THREE.MeshStandardMaterial({ map: t.back, emissive: '#FFFFFF', emissiveMap: t.back, emissiveIntensity: 0.3, roughness: 0.6, alphaTest: 0.5 });
  // card faces are unlit so the values stay readable whatever the lamp is doing
  t.blankMat = new THREE.MeshBasicMaterial({ map: t.blank, alphaTest: 0.5, toneMapped: false });
  return t;
}
async function fontsReady() {
  try { await Promise.race([Promise.all([document.fonts.load('400 100px "League Gothic"'), document.fonts.load('600 40px "Instrument Sans"')]), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
}

export async function createTable3D(opts) {
  await fontsReady();

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

  const textures = makeTextures();
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
  let seatR = 1.2, tableR = 0.84, myHeadY = 1.34, myAngle = 0, mySmokeEnd = 0, smokeTotal = 180000;
  const look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, sent: [9, 9, 9], sentAt: 0 };
  let handUp = false, raise = 0, hover = null, pointer = null, disposed = false;

  // my own cards, held in front of the camera
  const handRig = new THREE.Group();
  camera.add(handRig);
  let handCards = [], handKey = '';
  const myCig = makeCig(textures);
  myCig.group.traverse(o => { o.userData.mine = true; });
  myCig.group.position.set(0.19, -0.15, -0.3);
  myCig.group.rotation.set(0.3, Math.PI + 0.45, 0);       // filter towards me, tip pointing at the table
  myCig.group.scale.setScalar(1.3);
  camera.add(myCig.group);
  const myLighter = makeLighter(textures);
  myLighter.group.traverse(o => { o.userData.mine = true; });
  myLighter.group.scale.setScalar(1.3);
  camera.add(myLighter.group);

  const ashtray = makeAshtray();
  ashtray.group.position.set(0, TABLE_Y, 0);
  scene.add(ashtray.group);
  const wasSmoking = new Set();        // to notice when a smoke break ends and a butt goes in the ashtray

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
    myHeadY = me ? headHeight(specOf(me.avatar)) + 0.02 : 1.75;
    mySmokeEnd = me ? me.smokeEnd || 0 : 0;
    smokeTotal = next.smokeTotal || 180000;
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
      a.smokeEnd = p.smokeEnd || 0;
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

    const nowMs = Date.now();
    for (const p of view.players) {
      const smoking = (p.smokeEnd || 0) > nowMs;
      if (!smoking && wasSmoking.has(p.id)) ashtray.addButt();
      if (smoking) wasSmoking.add(p.id); else wasSmoking.delete(p.id);
    }
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
    if (handUp) return;                 // while the cards are up the view holds still, so picking one is easy
    look.tYaw = -(pointer.x * 2 - 1) * 1.15;
    look.tPitch = -(pointer.y * 2 - 1) * 0.42;
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

  let last = performance.now(), time = 0;
  const pace = { frames: 0, total: 0, stage: 0 };     // watches the frame rate and backs off on slow machines
  function frame(now) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (document.hidden || !opts.mount.clientWidth) { last = now; return; }
    const elapsed = Math.max(0, (now - last) / 1000);     // never negative, even if the clock is adjusted
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
      animateAvatar(a, dt, time, view.revealed, smokeTotal);
      if (a.bubble.visible) placeBubble(a, camera);
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
    const myRemaining = mySmokeEnd ? mySmokeEnd - Date.now() : 0;
    myCig.group.visible = myRemaining > 0;
    if (myRemaining > 0) {
      const elapsed = (smokeTotal - myRemaining) / 1000;
      burnCig(myCig, clamp(myRemaining / smokeTotal, 0, 1), elapsed, time, 0.4);
      const up = lightUp(myLighter, elapsed, time);
      if (up > 0.02) {                 // my lighter comes up from below to the tip of my cigarette
        myCig.group.updateMatrix();
        v3.set(0, 0, myCig.tip).applyMatrix4(myCig.group.matrix);
        myLighter.group.position.set(v3.x + 0.02 * (1 - up), v3.y - myLighter.top * 1.3 - 0.012 - (1 - up) * 0.22, v3.z + 0.004);
      }
    } else myLighter.group.visible = false;

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
    chat(from, name, text) {          // a speech bubble over the speaker's head
      const a = avatars.get(from);
      if (!a) return;
      if (a.bubble.material.map) a.bubble.material.map.dispose();
      const map = bubbleTexture(String(name).slice(0, 24), String(text).slice(0, 140));
      a.bubble.material.map = map;
      a.bubble.material.opacity = 1;
      a.bubble.material.needsUpdate = true;
      a.bubble.scale.set(0.6, 0.6 * map.userData.aspect, 1);
      a.bubble.visible = true;
      a.label.visible = false;
      a.bubbleUntil = performance.now() + Math.min(9000, 3500 + String(text).length * 60);
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

/* ---------- meet the cast: every character side by side (cast.html) ---------- */
export async function createCastPreview(mount) {
  await fontsReady();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  mount.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14271F');
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 40);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight('#FFF1DC', '#14231D', 1.5));
  const key = new THREE.DirectionalLight('#FFE2B8', 1.6);
  key.position.set(2, 4, 5);
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat('#1D140E', { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(part(GEO.box, mat('#2A1B12', { roughness: 0.9 }), [6.4, 0.75, 1.3], [0.4, 0.375, -1.15]));
  const textures = makeTextures();
  const cast = CAST.map((spec, i) => {
    const a = buildAvatar(i, textures, spec.nick);
    const col = i % 6, row = Math.floor(i / 6);      // two rows, the back one on a riser like a team photo
    a.group.position.set((col - 2.5) * 0.8 + (row ? 0.4 : 0), row ? 0.75 : 0, row ? -1.1 : 0.3);
    a.group.rotation.y = (2.5 - col) * 0.05;
    a.label.scale.multiplyScalar(0.45);
    a.smokeEnd = i === 8 || i === 0 ? Date.now() + 180000 - (i === 8 ? 60000 : 0) : 0;      // one lighting up, one mid-cigarette
    scene.add(a.group);
    return a;
  });
  const pointer = { x: 0, y: 0 };
  mount.addEventListener('pointermove', e => {
    const r = mount.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  const size = () => {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(size).observe(mount);
  size();
  let last = performance.now(), time = 0;
  const frame = now => {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now; time += dt;
    const far = Math.max(6.4, 5.6 / Math.min(1, camera.aspect / 1.9));
    camera.position.set(0.2, 2.0, far);
    camera.lookAt(0.2, 1.25, -0.4);
    for (const a of cast) {
      a.look = [-pointer.x * 0.9, -pointer.y * 0.35, Math.sin(time * 0.5 + a.index) > 0.92 ? 1 : 0];
      animateAvatar(a, dt, time, false, 180000);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
