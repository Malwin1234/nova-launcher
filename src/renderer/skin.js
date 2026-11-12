// Skin-Editor: Presets (prozedural gezeichnet) + eigene Malebene + 3D-Vorschau.
(() => {
  const SIZE = 64;
  // Klassisches Skin-Layout (4px-Arme). x/y = Mittelpunkt im Modell (Pixel, y nach unten).
  const PARTS = {
    head: { label: 'Kopf', base: [0, 0], over: [32, 0], w: 8, h: 8, d: 8, x: 0, y: 4 },
    body: { label: 'Körper', base: [16, 16], over: [16, 32], w: 8, h: 12, d: 4, x: 0, y: 14 },
    rArm: { label: 'Rechter Arm', base: [40, 16], over: [40, 32], w: 4, h: 12, d: 4, x: -6, y: 14 },
    lArm: { label: 'Linker Arm', base: [32, 48], over: [48, 48], w: 4, h: 12, d: 4, x: 6, y: 14 },
    rLeg: { label: 'Rechtes Bein', base: [0, 16], over: [0, 32], w: 4, h: 12, d: 4, x: -2, y: 26 },
    lLeg: { label: 'Linkes Bein', base: [16, 48], over: [0, 48], w: 4, h: 12, d: 4, x: 2, y: 26 },
  };
  const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];
  const FACE_NAMES = { top: 'Oberseite', bottom: 'Unterseite', right: 'Rechte Seite', front: 'Vorne', left: 'Linke Seite', back: 'Hinten' };
  const SIDES = ['front', 'back', 'left', 'right'];

  function faceRect(p, layer, face) {
    const [u, v] = p[layer];
    switch (face) {
      case 'top': return [u + p.d, v, p.w, p.d];
      case 'bottom': return [u + p.d + p.w, v, p.w, p.d];
      case 'right': return [u, v + p.d, p.d, p.h];
      case 'front': return [u + p.d, v + p.d, p.w, p.h];
      case 'left': return [u + p.d + p.w, v + p.d, p.d, p.h];
      default: return [u + 2 * p.d + p.w, v + p.d, p.w, p.h];
    }
  }
  function faceAt(p, x, y) {
    if (y < p.d) {
      if (x >= p.d && x < p.d + p.w) return 'top';
      if (x >= p.d + p.w && x < p.d + 2 * p.w) return 'bottom';
      return null;
    }
    if (x < p.d) return 'right';
    if (x < p.d + p.w) return 'front';
    if (x < 2 * p.d + p.w) return 'left';
    return 'back';
  }

  // ---------- Farben ----------
  function shade(hex, f) {
    let r; let g; let b;
    if (hex[0] === '#') {
      const n = parseInt(hex.slice(1), 16);
      r = n >> 16; g = (n >> 8) & 255; b = n & 255;
    } else {
      [r, g, b] = hex.match(/\d+/g).map(Number);
    }
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return `rgb(${ch(r)},${ch(g)},${ch(b)})`;
  }
  function noise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }

  // ---------- Zeichenhelfer (Koordinaten relativ zur Fläche) ----------
  function rect(ctx, part, layer, face, x, y, w, h, color, vary = 0.07) {
    const [fx, fy, fw, fh] = faceRect(PARTS[part], layer, face);
    for (let j = Math.max(0, y); j < Math.min(fh, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(fw, x + w); i++) {
        ctx.fillStyle = vary ? shade(color, noise(fx + i, fy + j) * vary) : color;
        ctx.fillRect(fx + i, fy + j, 1, 1);
      }
    }
  }
  const dot = (ctx, part, layer, face, x, y, color) => rect(ctx, part, layer, face, x, y, 1, 1, color, 0);
  function band(ctx, part, layer, y0, y1, color, vary) {
    for (const f of SIDES) rect(ctx, part, layer, f, 0, y0, 8, y1 - y0 + 1, color, vary);
  }
  function box(ctx, part, layer, color, vary) {
    for (const f of FACES) rect(ctx, part, layer, f, 0, 0, 8, 12, color, vary);
  }
  const both = (fn) => { fn('r'); fn('l'); };

  // ---------- Presets ----------
  const SKIN = ['#f6d7c3', '#eebf9f', '#d9a17a', '#c68642', '#a66a3d', '#7d4a2a', '#5a3420', '#8fc98a', '#9fb7e8'];
  const HAIR = ['#1b1b1b', '#3b2416', '#6b3f1d', '#a8642a', '#d9a441', '#f1dc8a', '#b33a2a', '#e8e8e8', '#e25bb0', '#3d7be0', '#35b56a'];
  const CLOTH = ['#e04848', '#e8833a', '#f0c93d', '#4caf50', '#2e8b7a', '#3d9be0', '#3a55c8', '#7c5cff', '#d357b0', '#f2f2f2', '#8a8f98', '#2b2d33', '#6b4a2f'];
  const EYES = ['#3a2a1a', '#2f6fd6', '#3a9a4a', '#7a7f88', '#8a5a2a', '#b03030', '#7c5cff'];

  const CATS = [
    {
      key: 'skin', label: 'Haut', colors: SKIN,
      draw(ctx, s) { for (const p of Object.keys(PARTS)) box(ctx, p, 'base', s.color, 0.05); },
    },
    {
      key: 'mouth', label: 'Mund & Bart',
      styles: [['none', 'Keiner'], ['neutral', 'Neutral'], ['smile', 'Lächeln'], ['open', 'Offen'], ['stache', 'Schnurrbart'], ['beard', 'Vollbart']],
      draw(ctx, s, all) {
        const dark = shade(all.skin.color, -0.4);
        const hair = all.hair.color;
        const d = (x, y, c) => dot(ctx, 'head', 'base', 'front', x, y, c);
        if (s.style === 'neutral') { d(3, 6, dark); d(4, 6, dark); }
        if (s.style === 'smile') { d(2, 5, dark); d(5, 5, dark); d(3, 6, dark); d(4, 6, dark); }
        if (s.style === 'open') { d(3, 6, '#6e2222'); d(4, 6, '#6e2222'); d(3, 5, dark); d(4, 5, dark); }
        if (s.style === 'stache') { rect(ctx, 'head', 'base', 'front', 2, 5, 4, 1, hair); d(3, 6, dark); d(4, 6, dark); }
        if (s.style === 'beard') {
          rect(ctx, 'head', 'base', 'front', 0, 7, 8, 1, hair);
          rect(ctx, 'head', 'base', 'front', 0, 5, 1, 2, hair);
          rect(ctx, 'head', 'base', 'front', 7, 5, 1, 2, hair);
          rect(ctx, 'head', 'base', 'front', 1, 6, 2, 1, hair);
          rect(ctx, 'head', 'base', 'front', 5, 6, 2, 1, hair);
          rect(ctx, 'head', 'base', 'front', 2, 5, 4, 1, hair);
          d(3, 6, dark); d(4, 6, dark);
          rect(ctx, 'head', 'base', 'right', 5, 5, 3, 3, hair);
          rect(ctx, 'head', 'base', 'left', 0, 5, 3, 3, hair);
          rect(ctx, 'head', 'base', 'bottom', 0, 0, 8, 3, hair);
        }
      },
    },
    {
      key: 'eyes', label: 'Augen', colors: EYES,
      styles: [['normal', 'Normal'], ['big', 'Groß'], ['brows', 'Mit Brauen'], ['closed', 'Geschlossen']],
      draw(ctx, s, all) {
        const d = (x, y, c) => dot(ctx, 'head', 'base', 'front', x, y, c);
        if (s.style === 'closed') {
          const c = shade(all.skin.color, -0.5);
          for (const x of [1, 2, 5, 6]) d(x, 4, c);
          return;
        }
        const rows = s.style === 'big' ? [3, 4] : [4];
        for (const y of rows) { d(1, y, '#ffffff'); d(6, y, '#ffffff'); d(2, y, s.color); d(5, y, s.color); }
        if (s.style === 'brows') for (const x of [1, 2, 5, 6]) d(x, 3, shade(all.hair.color, -0.25));
      },
    },
    {
      key: 'top', label: 'Oberteil', colors: CLOTH,
      styles: [['tshirt', 'T-Shirt'], ['stripes', 'Streifenshirt'], ['sweater', 'Pullover'], ['hoodie', 'Hoodie'], ['jacket', 'Jacke'], ['tank', 'Tanktop'], ['suit', 'Anzug'], ['none', 'Keins']],
      draw(ctx, s, all) {
        const c = s.color;
        const skin = all.skin.color;
        const sleeves = (rows) => both((a) => {
          band(ctx, `${a}Arm`, 'base', 0, rows - 1, c);
          rect(ctx, `${a}Arm`, 'base', 'top', 0, 0, 4, 4, c);
        });
        const neck = () => { dot(ctx, 'body', 'base', 'front', 3, 0, skin); dot(ctx, 'body', 'base', 'front', 4, 0, skin); };
        if (s.style === 'none') return;
        if (s.style === 'tank') {
          band(ctx, 'body', 'base', 2, 11, c);
          for (const f of ['front', 'back']) for (const x of [1, 6]) rect(ctx, 'body', 'base', f, x, 0, 1, 2, c);
          return;
        }
        box(ctx, 'body', 'base', c);
        if (s.style === 'tshirt') { sleeves(4); neck(); }
        if (s.style === 'stripes') {
          sleeves(4); neck();
          for (let y = 1; y < 12; y += 2) band(ctx, 'body', 'base', y, y, '#f2f2f2');
          both((a) => band(ctx, `${a}Arm`, 'base', 1, 1, '#f2f2f2'));
        }
        if (s.style === 'sweater' || s.style === 'hoodie') {
          sleeves(10);
          both((a) => band(ctx, `${a}Arm`, 'base', 9, 9, shade(c, -0.25), 0));
          band(ctx, 'body', 'base', 11, 11, shade(c, -0.25), 0);
        }
        if (s.style === 'hoodie') {
          const dk = shade(c, -0.2);
          rect(ctx, 'body', 'over', 'back', 1, 0, 6, 3, dk, 0.05);
          rect(ctx, 'body', 'over', 'top', 0, 0, 8, 2, dk, 0.05);
          rect(ctx, 'body', 'base', 'front', 2, 7, 4, 3, dk, 0.05);
          dot(ctx, 'body', 'base', 'front', 3, 1, '#f2f2f2');
          dot(ctx, 'body', 'base', 'front', 4, 1, '#f2f2f2');
          dot(ctx, 'body', 'base', 'front', 3, 2, '#f2f2f2');
          dot(ctx, 'body', 'base', 'front', 4, 2, '#f2f2f2');
        }
        if (s.style === 'jacket') {
          sleeves(10);
          rect(ctx, 'body', 'base', 'front', 3, 0, 2, 12, '#f2f2f2');
          rect(ctx, 'body', 'base', 'front', 2, 0, 1, 12, shade(c, -0.3), 0);
          rect(ctx, 'body', 'base', 'front', 5, 0, 1, 12, shade(c, -0.3), 0);
          neck();
        }
        if (s.style === 'suit') {
          sleeves(10);
          both((a) => band(ctx, `${a}Arm`, 'base', 9, 9, '#f2f2f2', 0));
          rect(ctx, 'body', 'base', 'front', 3, 0, 2, 6, '#f2f2f2', 0);
          dot(ctx, 'body', 'base', 'front', 2, 0, '#f2f2f2');
          dot(ctx, 'body', 'base', 'front', 5, 0, '#f2f2f2');
          rect(ctx, 'body', 'base', 'front', 3, 1, 2, 4, '#c0392b', 0.05);
        }
      },
    },
    {
      key: 'pants', label: 'Hose', colors: CLOTH,
      styles: [['long', 'Lang'], ['jeans', 'Jeans'], ['shorts', 'Shorts'], ['overall', 'Latzhose'], ['none', 'Keine']],
      draw(ctx, s) {
        const c = s.color;
        if (s.style === 'none') return;
        both((a) => {
          const leg = `${a}Leg`;
          if (s.style === 'shorts') { band(ctx, leg, 'base', 0, 4, c); rect(ctx, leg, 'base', 'top', 0, 0, 4, 4, c); return; }
          box(ctx, leg, 'base', c);
          if (s.style === 'jeans') {
            rect(ctx, leg, 'base', 'front', 1, 4, 2, 3, shade(c, 0.25), 0.05);
            band(ctx, leg, 'base', 11, 11, shade(c, -0.2), 0);
          }
        });
        if (s.style === 'overall') {
          band(ctx, 'body', 'base', 9, 11, c);
          rect(ctx, 'body', 'base', 'front', 2, 4, 4, 5, c);
          for (const f of ['front', 'back']) for (const x of [2, 5]) rect(ctx, 'body', 'base', f, x, 0, 1, 9, c);
          dot(ctx, 'body', 'base', 'front', 2, 4, '#f0c93d');
          dot(ctx, 'body', 'base', 'front', 5, 4, '#f0c93d');
        } else {
          band(ctx, 'body', 'base', 11, 11, shade(c, -0.15), 0.04);
        }
      },
    },
    {
      key: 'shoes', label: 'Schuhe', colors: CLOTH,
      styles: [['sneaker', 'Sneaker'], ['boots', 'Stiefel'], ['plain', 'Schlicht'], ['none', 'Barfuß']],
      draw(ctx, s) {
        if (s.style === 'none') return;
        both((a) => {
          const leg = `${a}Leg`;
          band(ctx, leg, 'base', s.style === 'boots' ? 8 : 10, 11, s.color);
          rect(ctx, leg, 'base', 'bottom', 0, 0, 4, 4, shade(s.color, -0.3), 0.04);
          if (s.style === 'sneaker') {
            band(ctx, leg, 'base', 11, 11, '#f2f2f2', 0.03);
            dot(ctx, leg, 'base', 'front', 1, 10, '#f2f2f2');
            dot(ctx, leg, 'base', 'front', 2, 10, '#f2f2f2');
          }
          if (s.style === 'boots') band(ctx, leg, 'base', 8, 8, shade(s.color, -0.3), 0);
        });
      },
    },
    {
      key: 'hair', label: 'Haare', colors: HAIR,
      styles: [['short', 'Kurz'], ['side', 'Seitenscheitel'], ['spiky', 'Stachelig'], ['long', 'Lang'], ['pony', 'Zopf'], ['bob', 'Bob'], ['none', 'Glatze']],
      draw(ctx, s) {
        const c = s.color;
        const H = (face, x, y, w, h, layer = 'base') => rect(ctx, 'head', layer, face, x, y, w, h, c, 0.12);
        if (s.style === 'none') return;
        H('top', 0, 0, 8, 8);
        if (s.style === 'short' || s.style === 'pony') {
          H('front', 0, 0, 8, 1); H('front', 0, 1, 1, 1); H('front', 7, 1, 1, 1);
          H('right', 0, 0, 8, 3); H('left', 0, 0, 8, 3); H('right', 0, 3, 4, 1); H('left', 4, 3, 4, 1);
          H('back', 0, 0, 8, 5);
        }
        if (s.style === 'pony') {
          H('back', 3, 2, 2, 6, 'over');
          rect(ctx, 'body', 'over', 'back', 3, 0, 2, 5, c, 0.12);
          rect(ctx, 'head', 'over', 'back', 3, 2, 2, 1, '#e04848', 0);
        }
        if (s.style === 'side') {
          H('front', 0, 0, 8, 1); H('front', 0, 1, 5, 1); H('front', 0, 2, 3, 1); H('front', 7, 1, 1, 1);
          H('right', 0, 0, 8, 4); H('left', 0, 0, 8, 3); H('back', 0, 0, 8, 5);
        }
        if (s.style === 'spiky') {
          H('front', 0, 0, 8, 1);
          for (const x of [0, 2, 5, 7]) H('front', x, 1, 1, 1);
          H('right', 0, 0, 8, 2); H('left', 0, 0, 8, 2); H('back', 0, 0, 8, 3);
          for (let y = 0; y < 8; y++) for (let x = (y % 2); x < 8; x += 2) H('top', x, y, 1, 1, 'over');
          for (const f of SIDES) for (let x = 0; x < 8; x += 2) H(f, x, 0, 1, 1, 'over');
        }
        if (s.style === 'long' || s.style === 'bob') {
          H('front', 0, 0, 8, 2); H('front', 0, 2, 1, 4); H('front', 7, 2, 1, 4);
          H('right', 0, 0, 8, 3); H('left', 0, 0, 8, 3); H('right', 0, 3, 5, 5); H('left', 3, 3, 5, 5);
          H('back', 0, 0, 8, 8);
          H('bottom', 0, 5, 8, 3);
        }
        if (s.style === 'long') {
          rect(ctx, 'body', 'over', 'back', 0, 0, 8, 5, c, 0.12);
          rect(ctx, 'body', 'over', 'right', 0, 0, 2, 3, c, 0.12);
          rect(ctx, 'body', 'over', 'left', 2, 0, 2, 3, c, 0.12);
        }
      },
    },
    {
      key: 'acc', label: 'Accessoire', colors: CLOTH,
      styles: [['none', 'Keins'], ['glasses', 'Brille'], ['shades', 'Sonnenbrille'], ['beanie', 'Mütze'], ['cap', 'Cap'], ['crown', 'Krone'], ['band', 'Stirnband'], ['phones', 'Kopfhörer'], ['scarf', 'Schal'], ['mask', 'Maske']],
      draw(ctx, s) {
        const c = s.color;
        const O = (face, x, y, w, h, col = c, v = 0.07) => rect(ctx, 'head', 'over', face, x, y, w, h, col, v);
        const k = '#16171b';
        if (s.style === 'glasses') {
          for (const x of [1, 2, 5, 6]) { O('front', x, 3, 1, 1, k, 0); O('front', x, 5, 1, 1, k, 0); }
          for (const x of [0, 3, 4, 7]) O('front', x, 4, 1, 1, k, 0);
          O('right', 5, 4, 3, 1, k, 0); O('left', 0, 4, 3, 1, k, 0);
        }
        if (s.style === 'shades') {
          O('front', 0, 4, 8, 1, k, 0); O('front', 1, 5, 2, 1, k, 0); O('front', 5, 5, 2, 1, k, 0);
          O('front', 1, 4, 1, 1, '#3a3d46', 0); O('front', 5, 4, 1, 1, '#3a3d46', 0);
          O('right', 5, 4, 3, 1, k, 0); O('left', 0, 4, 3, 1, k, 0);
        }
        if (s.style === 'beanie') {
          O('top', 0, 0, 8, 8);
          for (const f of SIDES) { O(f, 0, 0, 8, 2); O(f, 0, 2, 8, 1, shade(c, -0.25), 0.03); }
        }
        if (s.style === 'cap') {
          O('top', 0, 0, 8, 8);
          for (const f of SIDES) O(f, 0, 0, 8, 2);
          O('front', 0, 2, 8, 1, shade(c, -0.3), 0.03);
          O('front', 3, 0, 2, 2, '#f2f2f2', 0.03);
        }
        if (s.style === 'crown') {
          const g = '#f0c93d';
          for (const f of SIDES) {
            O(f, 0, 1, 8, 1, g);
            for (let x = 0; x < 8; x += 2) O(f, x, 0, 1, 1, g);
          }
          O('front', 3, 1, 1, 1, '#e04848', 0); O('front', 5, 1, 1, 1, '#3d9be0', 0); O('front', 1, 1, 1, 1, '#4caf50', 0);
        }
        if (s.style === 'band') for (const f of SIDES) O(f, 0, 2, 8, 1);
        if (s.style === 'phones') {
          O('top', 0, 3, 8, 2, k, 0.05);
          O('right', 2, 0, 4, 2, k, 0.05); O('left', 2, 0, 4, 2, k, 0.05);
          O('right', 2, 2, 4, 4); O('left', 2, 2, 4, 4);
        }
        if (s.style === 'scarf') {
          for (const f of SIDES) O(f, 0, 7, 8, 1);
          band(ctx, 'body', 'over', 0, 1, c);
          rect(ctx, 'body', 'over', 'top', 0, 0, 8, 4, c);
          rect(ctx, 'body', 'over', 'front', 5, 2, 2, 4, c);
        }
        if (s.style === 'mask') {
          O('front', 0, 5, 8, 3); O('right', 4, 5, 4, 3); O('left', 0, 5, 4, 3);
          O('right', 0, 5, 4, 1, shade(c, -0.3), 0); O('left', 4, 5, 4, 1, shade(c, -0.3), 0);
        }
      },
    },
  ];

  const DEFAULT = {
    skin: { color: SKIN[1] }, mouth: { style: 'smile' }, eyes: { style: 'normal', color: EYES[1] },
    top: { style: 'tshirt', color: CLOTH[5] }, pants: { style: 'jeans', color: CLOTH[6] },
    shoes: { style: 'sneaker', color: CLOTH[11] }, hair: { style: 'short', color: HAIR[2] }, acc: { style: 'none', color: CLOTH[0] },
  };

  // ---------- Zustand ----------
  const mk = () => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const preset = mk(); const paint = mk(); const comp = mk();
  const pctx = preset.getContext('2d');
  const actx = paint.getContext('2d', { willReadFrequently: true });
  const cctx = comp.getContext('2d', { willReadFrequently: true });
  let sel = structuredClone(DEFAULT);
  const cur = { part: 'head', layer: 'base', tool: 'pencil', color: '#e04848' };
  const undo = [];
  let cell = 12;
  let dirty = false;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem('nova-skin') || 'null');
      if (!saved) return;
      for (const c of CATS) if (saved.sel && saved.sel[c.key]) Object.assign(sel[c.key], saved.sel[c.key]);
      if (saved.paint) {
        const img = new Image();
        img.onload = () => { actx.drawImage(img, 0, 0); render(); };
        img.src = saved.paint;
      }
    } catch { /* gespeicherten Stand ignorieren */ }
  }
  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem('nova-skin', JSON.stringify({ sel, paint: paint.toDataURL() })); } catch { /* voll */ }
    }, 400);
  }

  function render() {
    pctx.clearRect(0, 0, SIZE, SIZE);
    for (const c of CATS) c.draw(pctx, sel[c.key], sel);
    cctx.clearRect(0, 0, SIZE, SIZE);
    cctx.drawImage(preset, 0, 0);
    cctx.drawImage(paint, 0, 0);
    document.querySelector('#skin-stage').style.setProperty('--skin', `url(${comp.toDataURL()})`);
    drawEditor();
    persist();
  }
  function requestRender() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; render(); });
  }

  // ---------- Preset-Leiste ----------
  function buildPresets() {
    const wrap = $('#skin-presets');
    wrap.replaceChildren();
    for (const c of CATS) {
      const s = sel[c.key];
      const block = el('div', { className: 'sk-cat' }, el('h3', { textContent: c.label }));
      if (c.styles) {
        block.append(el('div', { className: 'sk-chips' }, ...c.styles.map(([id, label]) => el('button', {
          className: `sk-chip${s.style === id ? ' active' : ''}`,
          textContent: label,
          onclick: () => { s.style = id; buildPresets(); render(); },
        }))));
      }
      if (c.colors) {
        const sw = el('div', { className: 'sk-swatches' });
        for (const col of c.colors) {
          const b = el('button', { className: `sk-swatch${s.color === col ? ' active' : ''}`, title: col });
          b.style.background = col;
          b.onclick = () => { s.color = col; buildPresets(); render(); };
          sw.append(b);
        }
        block.append(sw);
      }
      wrap.append(block);
    }
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function randomize() {
    for (const c of CATS) {
      if (c.styles) sel[c.key].style = pick(c.styles)[0];
      if (c.colors) sel[c.key].color = pick(c.colors);
    }
    if (Math.random() < 0.5) sel.acc.style = 'none';
    sel.skin.color = pick(SKIN.slice(0, 7));
    buildPresets();
    render();
  }

  // ---------- 2D-Editor ----------
  const cv = $('#skin-canvas');
  const ectx = cv.getContext('2d');
  function region() {
    const p = PARTS[cur.part];
    const [u, v] = p[cur.layer];
    return { p, u, v, cols: 2 * (p.w + p.d), rows: p.d + p.h };
  }
  function drawEditor() {
    const { p, u, v, cols, rows } = region();
    cell = Math.floor(Math.min(390 / cols, 380 / rows));
    cv.width = cols * cell;
    cv.height = rows * cell;
    const data = cctx.getImageData(u, v, cols, rows).data;
    const under = cur.layer === 'over' ? cctx.getImageData(p.base[0], p.base[1], cols, rows).data : null;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!faceAt(p, x, y)) continue;
        const i = (y * cols + x) * 4;
        ectx.fillStyle = (x + y) % 2 ? '#2a2f3f' : '#232735';
        ectx.fillRect(x * cell, y * cell, cell, cell);
        if (under) {
          ectx.fillStyle = `rgba(${under[i]},${under[i + 1]},${under[i + 2]},${(under[i + 3] / 255) * 0.3})`;
          ectx.fillRect(x * cell, y * cell, cell, cell);
        }
        if (data[i + 3]) {
          ectx.fillStyle = `rgba(${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3] / 255})`;
          ectx.fillRect(x * cell, y * cell, cell, cell);
        }
        ectx.strokeStyle = 'rgba(0,0,0,.28)';
        ectx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell, cell);
      }
    }
    // Flächen-Umrandungen
    ectx.strokeStyle = 'rgba(255,255,255,.55)';
    ectx.lineWidth = 2;
    for (const f of FACES) {
      const [fx, fy, fw, fh] = faceRect(p, cur.layer, f);
      ectx.strokeRect((fx - u) * cell, (fy - v) * cell, fw * cell, fh * cell);
    }
    ectx.lineWidth = 1;
  }
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cell);
    const y = Math.floor((e.clientY - r.top) / cell);
    const { p, u, v, cols, rows } = region();
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    const face = faceAt(p, x, y);
    return face ? { x, y, X: u + x, Y: v + y, face } : null;
  }
  const toHex = (d) => `#${[d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  function setColor(hex) {
    cur.color = hex;
    $('#skin-color').value = hex;
  }
  function pushUndo() {
    undo.push(actx.getImageData(0, 0, SIZE, SIZE));
    if (undo.length > 60) undo.shift();
  }
  function floodFill(c) {
    const { p, u, v, cols, rows } = region();
    const img = cctx.getImageData(u, v, cols, rows).data;
    const key = (x, y) => { const i = (y * cols + x) * 4; return `${img[i]},${img[i + 1]},${img[i + 2]},${img[i + 3]}`; };
    const target = key(c.x, c.y);
    const seen = new Set();
    const stack = [[c.x, c.y]];
    actx.fillStyle = cur.color;
    while (stack.length) {
      const [x, y] = stack.pop();
      const id = y * cols + x;
      if (x < 0 || y < 0 || x >= cols || y >= rows || seen.has(id)) continue;
      seen.add(id);
      if (faceAt(p, x, y) !== c.face || key(x, y) !== target) continue;
      actx.fillRect(u + x, v + y, 1, 1);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  function apply(c) {
    if (cur.tool === 'pencil') { actx.fillStyle = cur.color; actx.fillRect(c.X, c.Y, 1, 1); }
    if (cur.tool === 'eraser') actx.clearRect(c.X, c.Y, 1, 1);
    requestRender();
  }
  let drawing = false;
  cv.addEventListener('pointerdown', (e) => {
    const c = cellAt(e);
    if (!c) return;
    if (cur.tool === 'picker') {
      const d = cctx.getImageData(c.X, c.Y, 1, 1).data;
      if (d[3]) setColor(toHex(d));
      setTool('pencil');
      return;
    }
    pushUndo();
    if (cur.tool === 'fill') { floodFill(c); requestRender(); return; }
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    apply(c);
  });
  cv.addEventListener('pointermove', (e) => {
    const c = cellAt(e);
    $('#skin-hover').textContent = c ? FACE_NAMES[c.face] : '';
    if (drawing && c) apply(c);
  });
  cv.addEventListener('pointerup', () => { drawing = false; });
  cv.addEventListener('pointerleave', () => { $('#skin-hover').textContent = ''; });

  function setTool(t) {
    cur.tool = t;
    for (const b of document.querySelectorAll('#skin-tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  }
  function doUndo() {
    const last = undo.pop();
    if (last) { actx.putImageData(last, 0, 0); render(); }
  }

  // ---------- 3D-Vorschau (CSS-Würfel) ----------
  const S = 7;
  function build3d() {
    const model = $('#skin-model');
    const T = {
      front: (p) => `translateZ(${(p.d * S) / 2}px)`,
      back: (p) => `rotateY(180deg) translateZ(${(p.d * S) / 2}px)`,
      right: (p) => `rotateY(-90deg) translateZ(${(p.w * S) / 2}px)`,
      left: (p) => `rotateY(90deg) translateZ(${(p.w * S) / 2}px)`,
      top: (p) => `rotateX(90deg) translateZ(${(p.h * S) / 2}px)`,
      bottom: (p) => `rotateX(-90deg) translateZ(${(p.h * S) / 2}px)`,
    };
    for (const [name, p] of Object.entries(PARTS)) {
      for (const layer of ['base', 'over']) {
        const b = el('div', { className: 'sk-box' });
        const k = layer === 'over' ? (name === 'head' ? 1.12 : 1.16) : 1;
        b.style.transform = `translate3d(${p.x * S}px, ${(p.y - 16) * S}px, 0) scale3d(${k},${k},${k})`;
        for (const face of FACES) {
          const [u, v, fw, fh] = faceRect(p, layer, face);
          const f = el('div', { className: `sk-face${layer === 'base' ? ' solid' : ''}` });
          Object.assign(f.style, {
            width: `${fw * S}px`, height: `${fh * S}px`,
            marginLeft: `${(-fw * S) / 2}px`, marginTop: `${(-fh * S) / 2}px`,
            backgroundSize: `${SIZE * S}px ${SIZE * S}px`,
            backgroundPosition: `${-u * S}px ${-v * S}px`,
            transform: T[face](p),
          });
          b.append(f);
        }
        model.append(b);
      }
    }
    let ry = -28; let rx = -8; let drag = null;
    const stage = $('#skin-stage');
    const upd = () => { model.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`; };
    stage.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      ry += (e.clientX - drag[0]) * 0.7;
      rx = Math.max(-45, Math.min(45, rx - (e.clientY - drag[1]) * 0.5));
      drag = [e.clientX, e.clientY];
      upd();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    upd();
  }

  // ---------- Verdrahtung ----------
  const partSel = $('#skin-part');
  partSel.replaceChildren(...Object.entries(PARTS).map(([k, p]) => el('option', { value: k, textContent: p.label })));
  partSel.onchange = () => { cur.part = partSel.value; drawEditor(); };
  for (const b of document.querySelectorAll('#skin-layer [data-layer]')) {
    b.onclick = () => {
      cur.layer = b.dataset.layer;
      for (const o of document.querySelectorAll('#skin-layer [data-layer]')) o.classList.toggle('active', o === b);
      drawEditor();
    };
  }
  for (const b of document.querySelectorAll('#skin-tools [data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  $('#skin-color').oninput = (e) => { cur.color = e.target.value; if (cur.tool !== 'fill') setTool('pencil'); };
  const pal = $('#skin-palette');
  for (const col of ['#16171b', '#ffffff', ...CLOTH.slice(0, 9), ...SKIN.slice(0, 5), ...HAIR.slice(1, 6)]) {
    const b = el('button', { className: 'sk-swatch small', title: col, onclick: () => { setColor(col); if (cur.tool !== 'fill') setTool('pencil'); } });
    b.style.background = col;
    pal.append(b);
  }
  $('#skin-undo').onclick = doUndo;
  $('#skin-clear').onclick = () => {
    if (!confirm('Alle selbst gemalten Pixel entfernen? Die Presets bleiben erhalten.')) return;
    pushUndo();
    actx.clearRect(0, 0, SIZE, SIZE);
    render();
  };
  $('#skin-random').onclick = randomize;
  $('#skin-save').onclick = () => run(async () => {
    const file = await api.call('skin:save', comp.toDataURL('image/png'));
    if (file) toast(`Gespeichert: ${file}`, true);
  });
  $('#skin-upload').onclick = async () => {
    if (!confirm('Diesen Skin jetzt als Skin deines Minecraft-Kontos setzen? Dein aktueller Skin wird ersetzt.')) return;
    const btn = $('#skin-upload');
    btn.disabled = true;
    await run(async () => {
      await api.call('skin:upload', comp.toDataURL('image/png'));
      toast('Skin wurde auf dein Minecraft-Konto hochgeladen.', true);
    });
    btn.disabled = false;
  };
  document.addEventListener('keydown', (e) => {
    if ($('#view-skin').classList.contains('hidden')) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
  });

  setColor(cur.color);
  load();
  buildPresets();
  build3d();
  render();
})();
