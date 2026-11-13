// Skin-Editor: Presets (prozedural gezeichnet) + eigene Malebene + 3D-Vorschau (auch zum Malen).
// Modelle: „Klassisch“ (Arme 4 Pixel breit) und „Schlank“ (Arme 3 Pixel breit).
(() => {
  const SIZE = 64;
  // Skin-Layout. x/y = Mittelpunkt im Modell (Pixel, y nach unten); w/x der Arme hängen vom Modell ab (setGeometry).
  const PARTS = {
    head: { label: 'Kopf', base: [0, 0], over: [32, 0], w: 8, h: 8, d: 8, x: 0, y: 4 },
    body: { label: 'Körper', base: [16, 16], over: [16, 32], w: 8, h: 12, d: 4, x: 0, y: 14 },
    rArm: { label: 'Rechter Arm', base: [40, 16], over: [40, 32], w: 4, h: 12, d: 4, x: -6, y: 14 },
    lArm: { label: 'Linker Arm', base: [32, 48], over: [48, 48], w: 4, h: 12, d: 4, x: 6, y: 14 },
    rLeg: { label: 'Rechtes Bein', base: [0, 16], over: [0, 32], w: 4, h: 12, d: 4, x: -2, y: 26 },
    lLeg: { label: 'Linkes Bein', base: [16, 48], over: [0, 48], w: 4, h: 12, d: 4, x: 2, y: 26 },
  };
  function setGeometry(model) {
    const w = model === 'slim' ? 3 : 4;
    PARTS.rArm.w = w; PARTS.lArm.w = w;
    PARTS.rArm.x = -(4 + w / 2); PARTS.lArm.x = 4 + w / 2;
  }
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
  // Spiegelbild (links ↔ rechts) einer Stelle: Kopf/Körper innerhalb des Teils, Arme/Beine auf das andere Glied.
  // Die rechte und linke Seitenfläche tauschen; auf jeder Fläche läuft x danach in Gegenrichtung.
  const OTHER = { head: 'head', body: 'body', rArm: 'lArm', lArm: 'rArm', rLeg: 'lLeg', lLeg: 'rLeg' };
  function mirrorOf(part, face, x, y) {
    const m = OTHER[part];
    const mface = face === 'right' ? 'left' : face === 'left' ? 'right' : face;
    const fw = faceRect(PARTS[m], 'base', mface)[2];
    return { part: m, face: mface, x: fw - 1 - x, y };
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
  const cur = { part: 'head', layer: 'base', tool: 'pencil', color: '#e04848', model: 'classic', usePresets: true, showOver: true, mirror: false };
  let recent = [];
  const undo = [];
  const redo = [];
  let cell = 12;
  let dirty = false;
  const stage = $('#skin-stage');

  // ---------- Speichern / Laden ----------
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('nova-skin') || 'null'); } catch { /* gespeicherten Stand ignorieren */ }
    if (!saved || typeof saved !== 'object') return;
    // Altes Format: nur { sel, paint } → klassisches Modell mit Presets.
    for (const c of CATS) {
      const s = saved.sel && saved.sel[c.key];
      if (!s || typeof s !== 'object') continue;
      if (c.styles && c.styles.some(([id]) => id === s.style)) sel[c.key].style = s.style;
      if (c.colors && isHex(s.color)) sel[c.key].color = s.color;
    }
    if (saved.model === 'slim') cur.model = 'slim';
    if (typeof saved.usePresets === 'boolean') cur.usePresets = saved.usePresets;
    if (typeof saved.showOver === 'boolean') cur.showOver = saved.showOver;
    if (typeof saved.mirror === 'boolean') cur.mirror = saved.mirror;
    if (isHex(saved.color)) cur.color = saved.color.toLowerCase();
    if (Array.isArray(saved.recent)) recent = saved.recent.filter(isHex).map((c) => c.toLowerCase()).slice(0, 12);
    setGeometry(cur.model);
    if (typeof saved.paint === 'string' && saved.paint.startsWith('data:image/png')) {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth === SIZE && img.naturalHeight === SIZE) { actx.drawImage(img, 0, 0); render(); }
      };
      img.src = saved.paint;
    }
  }
  let saveTimer;
  function persistNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem('nova-skin', JSON.stringify({
        v: 2, sel, paint: paint.toDataURL(), model: cur.model, usePresets: cur.usePresets,
        showOver: cur.showOver, mirror: cur.mirror, color: cur.color, recent,
      }));
    } catch { /* Speicher voll */ }
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 400);
  }
  window.addEventListener('beforeunload', persistNow);

  // ---------- Zusammensetzen ----------
  function compose() {
    pctx.clearRect(0, 0, SIZE, SIZE);
    if (cur.usePresets) for (const c of CATS) c.draw(pctx, sel[c.key], sel);
    cctx.clearRect(0, 0, SIZE, SIZE);
    cctx.drawImage(preset, 0, 0);
    cctx.drawImage(paint, 0, 0);
  }
  function render() {
    compose();
    stage.style.setProperty('--skin', `url(${comp.toDataURL()})`);
    drawEditor();
    persist();
  }
  function requestRender() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; render(); });
  }

  // ---------- Modell (klassisch / schlank) ----------
  // Spalte, die beim Wechsel 4px → 3px entfällt bzw. bei 3px → 4px verdoppelt wird: die Spalte direkt am Körper.
  function innerCol(part, face) {
    const front = face !== 'back';
    return (part === 'rArm') === front ? 3 : 0;
  }
  // Rechnet die Arm-Flächen der Malebene in das Layout des anderen Modells um und stellt die Geometrie um.
  function convertArms(to) {
    const img = actx.getImageData(0, 0, SIZE, SIZE);
    const dst = new Uint32Array(img.data.buffer);
    const src = dst.slice();
    const faces = [];
    for (const part of ['rArm', 'lArm']) {
      for (const layer of ['base', 'over']) {
        const [u, v] = PARTS[part][layer];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dst[(v + y) * SIZE + u + x] = 0;
        for (const face of FACES) faces.push({ part, layer, face, from: faceRect(PARTS[part], layer, face) });
      }
    }
    setGeometry(to);
    for (const f of faces) {
      const [ox, oy, ow] = f.from;
      const [nx, ny, nw, nh] = faceRect(PARTS[f.part], f.layer, f.face);
      const inner = innerCol(f.part, f.face);
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          let sx = x;
          if (nw < ow) sx = inner === 0 ? x + 1 : x;
          if (nw > ow) sx = inner === 0 ? Math.max(0, x - 1) : Math.min(x, ow - 1);
          dst[(ny + y) * SIZE + nx + x] = src[(oy + y) * SIZE + ox + sx];
        }
      }
    }
    actx.putImageData(img, 0, 0);
  }
  function setModel(model) {
    if (model !== 'classic' && model !== 'slim') return;
    if (model === cur.model) return;
    pushUndo();
    convertArms(model);
    cur.model = model;
    afterStateChange();
  }
  // Nach Änderungen an Modell/Presets/Sichtbarkeit: Bedienelemente, 3D-Figur und Bild neu aufbauen.
  function afterStateChange() {
    syncUi();
    build3d();
    render();
  }

  // ---------- Rückgängig / Wiederholen ----------
  const snapshot = () => ({ img: actx.getImageData(0, 0, SIZE, SIZE), usePresets: cur.usePresets, model: cur.model });
  function restore(s) {
    actx.putImageData(s.img, 0, 0);
    cur.usePresets = s.usePresets;
    cur.model = s.model;
    setGeometry(cur.model);
    afterStateChange();
  }
  function pushUndo() {
    undo.push(snapshot());
    if (undo.length > 60) undo.shift();
    redo.length = 0;
    syncHistory();
  }
  function doUndo() {
    const last = undo.pop();
    if (!last) return;
    redo.push(snapshot());
    restore(last);
  }
  function doRedo() {
    const next = redo.pop();
    if (!next) return;
    undo.push(snapshot());
    restore(next);
  }
  function syncHistory() {
    $('#skin-undo').disabled = !undo.length;
    $('#skin-redo').disabled = !redo.length;
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
    if (!cur.usePresets) {
      // Ein importierter Skin würde die Presets vollständig verdecken: Malebene leeren (lässt sich rückgängig machen).
      pushUndo();
      actx.clearRect(0, 0, SIZE, SIZE);
      cur.usePresets = true;
      toast('Presets eingeschaltet, der importierte Skin wurde ersetzt (Strg+Z macht das rückgängig).', true);
    }
    for (const c of CATS) {
      if (c.styles) sel[c.key].style = pick(c.styles)[0];
      if (c.colors) sel[c.key].color = pick(c.colors);
    }
    if (Math.random() < 0.5) sel.acc.style = 'none';
    sel.skin.color = pick(SKIN.slice(0, 7));
    buildPresets();
    afterStateChange();
  }

  // ---------- Werkzeuge (gemeinsam für 2D-Editor und 3D-Figur) ----------
  const toHex = (d) => `#${[d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  function setColor(hex) {
    cur.color = hex.toLowerCase();
    $('#skin-color').value = cur.color;
    $('#skin-color-chip').style.background = cur.color;
    $('#skin-color-hex').textContent = cur.color.toUpperCase();
    for (const b of document.querySelectorAll('#skin-palette .sk-swatch, #skin-recent .sk-swatch')) b.classList.toggle('active', b.dataset.col === cur.color);
  }
  function swatch(col) {
    const b = el('button', { className: 'sk-swatch small', title: col.toUpperCase(), onclick: () => { setColor(col); if (cur.tool !== 'fill') setTool('pencil'); persist(); } });
    b.dataset.col = col;
    b.style.background = col;
    return b;
  }
  function buildRecent() {
    const wrap = $('#skin-recent');
    wrap.replaceChildren(el('span', { className: 'muted', textContent: 'Zuletzt:' }), ...recent.map(swatch));
    if (!recent.length) wrap.append(el('span', { className: 'muted', textContent: '–' }));
    setColor(cur.color);
  }
  // Farbe wurde wirklich benutzt → an den Anfang der zuletzt verwendeten Farben.
  function useColor() {
    if (recent[0] === cur.color) return;
    recent = [cur.color, ...recent.filter((c) => c !== cur.color)].slice(0, 12);
    buildRecent();
  }
  function setTool(t) {
    cur.tool = t;
    for (const b of document.querySelectorAll('#skin-tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  }
  // Ziel(e) eines Pinselstrichs: die Stelle selbst und, bei „Spiegeln“, ihr Spiegelbild.
  function targets(part, face, x, y) {
    const list = [{ part, face, x, y }];
    if (cur.mirror) list.push(mirrorOf(part, face, x, y));
    return list;
  }
  function floodFill(part, layer, face, x, y) {
    compose();
    const [fx, fy, fw, fh] = faceRect(PARTS[part], layer, face);
    const img = new Uint32Array(cctx.getImageData(fx, fy, fw, fh).data.buffer);
    const target = img[y * fw + x];
    const seen = new Uint8Array(fw * fh);
    const stack = [[x, y]];
    actx.fillStyle = cur.color;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= fw || cy >= fh || seen[cy * fw + cx]) continue;
      seen[cy * fw + cx] = 1;
      if (img[cy * fw + cx] !== target) continue;
      actx.fillRect(fx + cx, fy + cy, 1, 1);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  function strokeAt(part, layer, face, x, y) {
    for (const t of targets(part, face, x, y)) {
      const [fx, fy] = faceRect(PARTS[t.part], layer, t.face);
      if (cur.tool === 'eraser') actx.clearRect(fx + t.x, fy + t.y, 1, 1);
      else { actx.fillStyle = cur.color; actx.fillRect(fx + t.x, fy + t.y, 1, 1); }
    }
    requestRender();
  }
  // Startet das aktuelle Werkzeug an einer Stelle. Liefert true, wenn ein Strich (Stift/Radierer) weiterläuft.
  function beginTool(part, layer, face, x, y) {
    if (cur.tool === 'picker') {
      compose();
      const [fx, fy] = faceRect(PARTS[part], layer, face);
      const d = cctx.getImageData(fx + x, fy + y, 1, 1).data;
      if (d[3]) setColor(toHex(d));
      setTool('pencil');
      persist();
      return false;
    }
    pushUndo();
    if (cur.tool !== 'eraser') useColor();
    if (cur.tool === 'fill') {
      for (const t of targets(part, face, x, y)) floodFill(t.part, layer, t.face, t.x, t.y);
      requestRender();
      return false;
    }
    strokeAt(part, layer, face, x, y);
    return true;
  }
  // Alle Rasterpunkte auf der Strecke a → b (damit schnelle Striche keine Lücken bekommen).
  function line(x0, y0, x1, y1, fn) {
    const dx = Math.abs(x1 - x0); const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let n = 0; n < 400; n++) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // ---------- 2D-Editor ----------
  const cv = $('#skin-canvas');
  const ectx = cv.getContext('2d');
  const cvWrap = cv.parentElement;
  function region() {
    const p = PARTS[cur.part];
    const [u, v] = p[cur.layer];
    return { p, u, v, cols: 2 * (p.w + p.d), rows: p.d + p.h };
  }
  function drawEditor() {
    const { p, u, v, cols, rows } = region();
    // Zellgröße so wählen, dass das Raster ohne Scrollbalken in den Bereich passt.
    const availW = cvWrap.clientWidth - 26;
    const availH = cvWrap.clientHeight - 26;
    cell = availW > 0 && availH > 0 ? Math.max(3, Math.min(34, Math.floor(Math.min(availW / cols, availH / rows)))) : 12;
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
        if (cell >= 6) {
          ectx.strokeStyle = 'rgba(0,0,0,.28)';
          ectx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell, cell);
        }
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
  function rawCell(e) {
    const r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell)];
  }
  // Rasterzelle → Fläche und Koordinaten innerhalb der Fläche (oder null außerhalb der Flächen).
  function cellInfo(x, y) {
    const { p, u, v, cols, rows } = region();
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    const face = faceAt(p, x, y);
    if (!face) return null;
    const [fx, fy] = faceRect(p, cur.layer, face);
    return { face, x: u + x - fx, y: v + y - fy };
  }
  let drawing = false;
  let last2d = null;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const raw = rawCell(e);
    const c = cellInfo(raw[0], raw[1]);
    if (!c) return;
    drawing = beginTool(cur.part, cur.layer, c.face, c.x, c.y);
    last2d = raw;
    if (drawing) { try { cv.setPointerCapture(e.pointerId); } catch { /* künstliches Ereignis */ } }
  });
  cv.addEventListener('pointermove', (e) => {
    const raw = rawCell(e);
    const c = cellInfo(raw[0], raw[1]);
    $('#skin-hover').textContent = c ? FACE_NAMES[c.face] : '';
    if (!drawing) return;
    line(last2d[0], last2d[1], raw[0], raw[1], (x, y) => {
      const k = cellInfo(x, y);
      if (k) strokeAt(cur.part, cur.layer, k.face, k.x, k.y);
    });
    last2d = raw;
  });
  const end2d = () => { drawing = false; };
  cv.addEventListener('pointerup', end2d);
  cv.addEventListener('pointercancel', end2d);
  cv.addEventListener('pointerleave', () => { $('#skin-hover').textContent = ''; });
  new ResizeObserver(() => drawEditor()).observe(cvWrap);

  // ---------- 3D-Vorschau (CSS-Würfel) ----------
  const PERSPECTIVE = 700;
  const model3d = $('#skin-model');
  let S = 7; // Bildschirm-Pixel pro Skin-Pixel
  let ry = -28; let rx = -8;
  // Die äußere Schicht steht etwas über (Kopf 0,5 px, sonst 0,25 px je Seite).
  const inflate = (name, layer) => (layer === 'over' ? (name === 'head' ? 0.5 : 0.25) : 0);
  function build3d() {
    const T = {
      front: (p) => `translateZ(${(p.d * S) / 2}px)`,
      back: (p) => `rotateY(180deg) translateZ(${(p.d * S) / 2}px)`,
      right: (p) => `rotateY(-90deg) translateZ(${(p.w * S) / 2}px)`,
      left: (p) => `rotateY(90deg) translateZ(${(p.w * S) / 2}px)`,
      top: (p) => `rotateX(90deg) translateZ(${(p.h * S) / 2}px)`,
      bottom: (p) => `rotateX(-90deg) translateZ(${(p.h * S) / 2}px)`,
    };
    model3d.replaceChildren();
    for (const [name, p] of Object.entries(PARTS)) {
      for (const layer of ['base', 'over']) {
        const b = el('div', { className: 'sk-box' });
        const i = 2 * inflate(name, layer);
        b.style.transform = `translate3d(${p.x * S}px, ${(p.y - 16) * S}px, 0) scale3d(${(p.w + i) / p.w},${(p.h + i) / p.h},${(p.d + i) / p.d})`;
        for (const face of FACES) {
          const [u, v, fw, fh] = faceRect(p, layer, face);
          const f = el('div', { className: `sk-face ${layer === 'base' ? 'solid' : 'over'}` });
          Object.assign(f.dataset, { part: name, layer, face });
          Object.assign(f.style, {
            width: `${fw * S}px`, height: `${fh * S}px`,
            marginLeft: `${(-fw * S) / 2}px`, marginTop: `${(-fh * S) / 2}px`,
            backgroundSize: `${SIZE * S}px ${SIZE * S}px`,
            backgroundPosition: `${-u * S}px ${-v * S}px`,
            transform: T[face](p),
          });
          b.append(f);
        }
        model3d.append(b);
      }
    }
    updRotation();
  }
  function updRotation() {
    model3d.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  }
  // Figur an die Größe der Vorschau anpassen.
  function fit3d() {
    const w = stage.clientWidth; const h = stage.clientHeight;
    if (!w || !h) return;
    const s = Math.max(4, Math.min(12, Math.floor(Math.min(h / 40, w / 24))));
    if (s !== S) { S = s; build3d(); }
  }
  new ResizeObserver(fit3d).observe(stage);

  // Sichtstrahl durch einen Bildschirmpunkt mit allen Quadern schneiden (gleiche Perspektive wie die CSS-Darstellung).
  // Liefert Treffer nach Entfernung sortiert: { part, layer, face, x, y, t, entry }.
  const rad = (deg) => (deg * Math.PI) / 180;
  const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
  const AXIS_FACES = [['right', 'left'], ['top', 'bottom'], ['back', 'front']];
  function cast(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const toModel = (v) => rotY(rotX(v, rad(-rx)), rad(-ry)).map((n) => n / S);
    const o = toModel([0, 0, PERSPECTIVE]);
    const d = toModel([clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), -PERSPECTIVE]);
    const hits = [];
    for (const [name, p] of Object.entries(PARTS)) {
      for (const layer of ['base', 'over']) {
        if (layer === 'over' && !cur.showOver) continue;
        const inf = inflate(name, layer);
        const c = [p.x, p.y - 16, 0];
        const half = [p.w / 2 + inf, p.h / 2 + inf, p.d / 2 + inf];
        let tIn = -Infinity; let tOut = Infinity; let aIn = 0; let aOut = 0;
        let miss = false;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(d[k]) < 1e-9) {
            if (Math.abs(o[k] - c[k]) > half[k]) miss = true;
            continue;
          }
          const t1 = (c[k] - half[k] - o[k]) / d[k];
          const t2 = (c[k] + half[k] - o[k]) / d[k];
          const lo = Math.min(t1, t2); const hi = Math.max(t1, t2);
          if (lo > tIn) { tIn = lo; aIn = k; }
          if (hi < tOut) { tOut = hi; aOut = k; }
        }
        if (miss || tIn > tOut || tIn <= 0) continue;
        const dims = [p.w, p.h, p.d];
        const hit = (t, axis, high, entry) => {
          const l = [0, 1, 2].map((k) => o[k] + t * d[k] - c[k]);
          // Anteil 0..1 entlang einer Achse, bei rev von der hohen Seite aus gemessen.
          const frac = (k, rev) => { const f = (l[k] + half[k]) / (2 * half[k]); return rev ? 1 - f : f; };
          const face = AXIS_FACES[axis][high ? 1 : 0];
          let fu; let fv; let fw; let fh;
          if (axis === 2) { fu = frac(0, !high); fv = frac(1); fw = dims[0]; fh = dims[1]; }
          else if (axis === 0) { fu = frac(2, high); fv = frac(1); fw = dims[2]; fh = dims[1]; }
          else { fu = frac(0); fv = frac(2, high); fw = dims[0]; fh = dims[2]; }
          const clamp = (f, n) => Math.max(0, Math.min(n - 1, Math.floor(f * n)));
          hits.push({ part: name, layer, face, x: clamp(fu, fw), y: clamp(fv, fh), t, entry });
        };
        hit(tIn, aIn, d[aIn] < 0, true);
        if (layer === 'over') hit(tOut, aOut, d[aOut] > 0, false);
      }
    }
    return hits.sort((a, b) => a.t - b.t);
  }
  // Auf welche Schicht die 3D-Figur malt: die im Editor gewählte; ist die äußere ausgeblendet, immer die innere.
  const layer3d = () => (cur.layer === 'over' && cur.showOver ? 'over' : 'base');
  function alphaAt(h) {
    const [fx, fy] = faceRect(PARTS[h.part], h.layer, h.face);
    return cctx.getImageData(fx + h.x, fy + h.y, 1, 1).data[3];
  }
  // Stelle unter dem Mauszeiger für das aktuelle Werkzeug (null = daneben → Figur drehen).
  function pick3d(clientX, clientY) {
    const hits = cast(clientX, clientY);
    if (cur.tool === 'picker') {
      // Pipette nimmt das, was man sieht: die vorderste nicht durchsichtige Stelle.
      compose();
      return hits.find((h) => alphaAt(h) > 0) || null;
    }
    const layer = layer3d();
    return hits.find((h) => h.entry && h.layer === layer) || null;
  }
  function selectPart(part) {
    if (cur.part === part) return;
    cur.part = part;
    $('#skin-part').value = part;
    drawEditor();
  }
  let mode3d = null; // 'paint' | 'rotate'
  let last3d = null;
  let lastHit = '';
  const hitKey = (h) => `${h.part}/${h.face}/${h.x}/${h.y}`;
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    const h = e.button === 0 ? pick3d(e.clientX, e.clientY) : null;
    try { stage.setPointerCapture(e.pointerId); } catch { /* künstliches Ereignis */ }
    last3d = [e.clientX, e.clientY];
    if (!h) { mode3d = 'rotate'; stage.classList.add('rotating'); return; }
    e.preventDefault();
    selectPart(h.part);
    lastHit = hitKey(h);
    mode3d = beginTool(h.part, h.layer, h.face, h.x, h.y) ? 'paint' : 'done';
  });
  stage.addEventListener('pointermove', (e) => {
    if (mode3d === 'rotate') {
      ry += (e.clientX - last3d[0]) * 0.7;
      rx = Math.max(-80, Math.min(80, rx - (e.clientY - last3d[1]) * 0.5));
      last3d = [e.clientX, e.clientY];
      updRotation();
      return;
    }
    if (mode3d === 'paint') {
      // Strecke seit dem letzten Ereignis in kleinen Schritten abtasten, damit keine Lücken entstehen.
      const dx = e.clientX - last3d[0]; const dy = e.clientY - last3d[1];
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(2, S / 2)));
      const layer = layer3d();
      for (let i = 1; i <= steps; i++) {
        const h = cast(last3d[0] + (dx * i) / steps, last3d[1] + (dy * i) / steps).find((k) => k.entry && k.layer === layer);
        if (!h || hitKey(h) === lastHit) continue;
        lastHit = hitKey(h);
        strokeAt(h.part, h.layer, h.face, h.x, h.y);
      }
      last3d = [e.clientX, e.clientY];
      return;
    }
    if (mode3d) return;
    const h = pick3d(e.clientX, e.clientY);
    stage.classList.toggle('over-figure', !!h);
    $('#skin-hover3d').textContent = h ? `${PARTS[h.part].label} · ${FACE_NAMES[h.face]} · ${h.layer === 'over' ? 'Außen' : 'Innen'}` : '';
  });
  const end3d = () => { mode3d = null; stage.classList.remove('rotating'); };
  stage.addEventListener('pointerup', end3d);
  stage.addEventListener('pointercancel', end3d);
  stage.addEventListener('pointerleave', () => { $('#skin-hover3d').textContent = ''; });

  // ---------- Import ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Die PNG-Datei ist beschädigt und kann nicht gelesen werden.'));
      img.src = src;
    });
  }
  // Altes 64×32-Format: linker Arm und linkes Bein entstehen (wie in Minecraft) als Spiegelbild der rechten Seite.
  function convertLegacy() {
    const img = actx.getImageData(0, 0, SIZE, SIZE);
    const px = new Uint32Array(img.data.buffer);
    const alpha = (i) => img.data[i * 4 + 3];
    // Alte Skins ohne Transparenz: eine vollständig deckende Hut-Schicht gilt als „kein Hut“.
    let opaque = true;
    for (let y = 0; y < 16 && opaque; y++) for (let x = 32; x < 64; x++) if (alpha(y * SIZE + x) < 128) { opaque = false; break; }
    if (opaque) for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) px[y * SIZE + x] = 0;
    for (const part of ['rArm', 'rLeg']) {
      for (const face of FACES) {
        const [fx, fy, fw, fh] = faceRect(PARTS[part], 'base', face);
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const m = mirrorOf(part, face, x, y);
            const [mx, my] = faceRect(PARTS[m.part], 'base', m.face);
            px[(my + m.y) * SIZE + mx + m.x] = px[(fy + y) * SIZE + fx + x];
          }
        }
      }
    }
    actx.putImageData(img, 0, 0);
  }
  // Schlankes Modell erkennen: dort bleiben die Spalten frei, die nur ein 4-Pixel-Arm belegt.
  function looksSlim() {
    const d = actx.getImageData(0, 0, SIZE, SIZE).data;
    const a = (x, y) => d[(y * SIZE + x) * 4 + 3];
    for (let y = 20; y < 32; y++) if (a(54, y) || a(55, y)) return false;
    return a(45, 24) > 0;
  }
  // Importiertes Bild wird zur bearbeitbaren Grundlage: in die Malebene, Presets aus.
  async function applyImport(res) {
    if (!res || typeof res.dataUrl !== 'string') throw new Error('Der Skin konnte nicht gelesen werden.');
    const img = await loadImage(res.dataUrl);
    const h = img.naturalHeight;
    if (img.naturalWidth !== SIZE || (h !== 64 && h !== 32)) {
      throw new Error(`Der Skin muss 64×64 oder 64×32 Pixel groß sein (diese Datei hat ${img.naturalWidth}×${h}).`);
    }
    pushUndo();
    actx.clearRect(0, 0, SIZE, SIZE);
    actx.drawImage(img, 0, 0);
    if (h === 32) { setGeometry('classic'); convertLegacy(); }
    cur.model = h === 32 ? 'classic' : res.model === 'slim' || res.model === 'classic' ? res.model : looksSlim() ? 'slim' : 'classic';
    setGeometry(cur.model);
    cur.usePresets = false;
    afterStateChange();
    return { legacy: h === 32, model: cur.model };
  }
  const modelName = (m) => (m === 'slim' ? 'Schlank' : 'Klassisch');
  async function importFrom(channel, btn, what) {
    btn.disabled = true;
    await run(async () => {
      const res = await api.call(channel);
      if (!res) return;
      const info = await applyImport(res);
      toast(`${what} geladen (Modell: ${modelName(info.model)}${info.legacy ? ', altes 64×32-Format umgerechnet' : ''}). Presets sind jetzt ausgeschaltet.`, true);
    });
    btn.disabled = false;
  }

  // ---------- Bedienelemente abgleichen ----------
  function syncUi() {
    for (const b of document.querySelectorAll('#skin-model-switch [data-model]')) b.classList.toggle('active', b.dataset.model === cur.model);
    for (const b of document.querySelectorAll('#skin-layer [data-layer]')) b.classList.toggle('active', b.dataset.layer === cur.layer);
    $('#skin-use-presets').checked = cur.usePresets;
    $('#skin-presets').classList.toggle('off', !cur.usePresets);
    $('#skin-mirror').checked = cur.mirror;
    $('#skin-show-over').checked = cur.showOver;
    stage.classList.toggle('hide-over', !cur.showOver);
    $('#skin-paint-layer').textContent = layer3d() === 'over' ? 'Außen' : 'Innen';
    syncHistory();
  }

  // ---------- Verdrahtung ----------
  const partSel = $('#skin-part');
  partSel.replaceChildren(...Object.entries(PARTS).map(([k, p]) => el('option', { value: k, textContent: p.label })));
  partSel.onchange = () => { cur.part = partSel.value; drawEditor(); };
  for (const b of document.querySelectorAll('#skin-layer [data-layer]')) {
    b.onclick = () => { cur.layer = b.dataset.layer; syncUi(); drawEditor(); };
  }
  for (const b of document.querySelectorAll('#skin-model-switch [data-model]')) b.onclick = () => setModel(b.dataset.model);
  for (const b of document.querySelectorAll('#skin-tools [data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  $('#skin-color').oninput = (e) => { setColor(e.target.value); if (cur.tool !== 'fill') setTool('pencil'); persist(); };
  $('#skin-palette').append(...['#16171b', '#ffffff', ...CLOTH.slice(0, 9), ...SKIN.slice(0, 5), ...HAIR.slice(1, 6)].map(swatch));
  $('#skin-use-presets').onchange = (e) => { cur.usePresets = e.target.checked; afterStateChange(); };
  $('#skin-mirror').onchange = (e) => { cur.mirror = e.target.checked; persist(); };
  $('#skin-show-over').onchange = (e) => { cur.showOver = e.target.checked; syncUi(); persist(); };
  $('#skin-undo').onclick = doUndo;
  $('#skin-redo').onclick = doRedo;
  $('#skin-clear').onclick = () => {
    if (!confirm('Alle selbst gemalten Pixel (auch einen importierten Skin) entfernen? Die Presets bleiben erhalten.')) return;
    pushUndo();
    actx.clearRect(0, 0, SIZE, SIZE);
    render();
  };
  $('#skin-new').onclick = () => {
    if (!confirm('Neuen Skin beginnen? Presets, Modell und alle gemalten Pixel werden auf den Anfangszustand zurückgesetzt.')) return;
    pushUndo();
    actx.clearRect(0, 0, SIZE, SIZE);
    sel = structuredClone(DEFAULT);
    cur.usePresets = true;
    cur.model = 'classic';
    setGeometry('classic');
    buildPresets();
    afterStateChange();
  };
  $('#skin-random').onclick = randomize;
  $('#skin-import').onclick = (e) => importFrom('skin:import', e.currentTarget, 'Skin-Datei');
  $('#skin-fetch').onclick = (e) => importFrom('skin:fetchAccount', e.currentTarget, 'Konto-Skin');
  const exportPng = () => { compose(); return comp.toDataURL('image/png'); };
  $('#skin-save').onclick = () => run(async () => {
    const file = await api.call('skin:save', exportPng());
    if (file) toast(`Gespeichert: ${file}`, true);
  });
  $('#skin-upload').onclick = async () => {
    if (!confirm(`Diesen Skin jetzt als Skin deines Minecraft-Kontos setzen (Modell: ${modelName(cur.model)})? Dein aktueller Skin wird ersetzt.`)) return;
    const btn = $('#skin-upload');
    btn.disabled = true;
    await run(async () => {
      await api.call('skin:upload', exportPng(), cur.model);
      toast('Skin wurde auf dein Minecraft-Konto hochgeladen.', true);
    });
    btn.disabled = false;
  };
  const KEY_TOOLS = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };
  document.addEventListener('keydown', (e) => {
    if ($('#view-skin').classList.contains('hidden') || e.altKey || e.metaKey) return;
    if (e.target instanceof Element && e.target.matches('select, textarea, input:not([type=color]):not([type=checkbox])')) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
      return;
    }
    if (KEY_TOOLS[key]) { e.preventDefault(); setTool(KEY_TOOLS[key]); }
  });

  // Für andere Teile des Launchers (z. B. die Kontoansicht): Skin von außen in den Editor laden.
  window.novaSkinEditor = { importSkin: (res) => applyImport(res) };

  load();
  buildRecent();
  buildPresets();
  syncUi();
  build3d();
  render();
})();
