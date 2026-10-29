// 3D couple mascots for the Millionaire mode: a capybara and Hello Kitty, each sitting in a
// "Who Wants to Be a Millionaire" hot-seat, lit like a TV studio (environment reflections, tone mapping, soft shadows).
// The characters are sculpted in code from superellipsoids (rounded boxes / squircles that can be tapered and
// pinched) with soft plush-toy materials, rather than plain spheres.
// Exposes window.Mascots3D = { init(canvas) -> boolean, react("yay" | "aww" | "win") } and fires "mascots3d-ready".
import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const SEAT_TOP = 1.01;

let renderer, scene, camera, canvas, chars = [], heart, clock, reaction = null;

// ---------- sculpting helpers ----------
const spow = (w, m) => Math.sign(w) * Math.abs(w) ** m;

// Superellipsoid with half-sizes a (x), b (y), c (z). e1 shapes the vertical profile, e2 the horizontal one:
// 1 = round, < 1 = boxier. `deform(x, y, z)` can then taper/pinch/bend the shape before normals are computed.
function sculpt(a, b, c, e1 = 1, e2 = 1, deform = null, seg = 48) {
  const g = new T.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = Math.asin(T.MathUtils.clamp(p.getY(i), -1, 1));
    const v = Math.atan2(p.getZ(i), p.getX(i));
    let x = a * spow(Math.cos(u), e1) * spow(Math.cos(v), e2);
    let y = b * spow(Math.sin(u), e1);
    let z = c * spow(Math.cos(u), e1) * spow(Math.sin(v), e2);
    if (deform) [x, y, z] = deform(x, y, z);
    p.setXYZ(i, x, y, z);
  }
  const m = mergeVertices(g); // weld the seam so the shading is smooth all the way round
  m.computeVertexNormals();
  return m;
}

const put = (geo, m, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) => {
  const x = new T.Mesh(geo, m);
  x.position.set(...pos);
  x.rotation.set(...rot);
  x.scale.set(...scale);
  return x;
};

// soft plush / vinyl-toy materials
const plush = (color, sheenColor = 0xffffff) =>
  new T.MeshPhysicalMaterial({ color, roughness: 0.62, sheen: 1, sheenColor, sheenRoughness: 0.55 });
const glossy = (color) => new T.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
const matte = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const EYE = new T.MeshPhysicalMaterial({ color: 0x120c0a, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 });
const SHINE = new T.MeshBasicMaterial({ color: 0xffffff });
const BLUSH = new T.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.45, depthWrite: false });

// Hello Kitty's signature black line: a slightly bigger back-face copy of a mesh.
const INK = new T.MeshBasicMaterial({ color: 0x1b1b1b, side: T.BackSide });
const WHISKER = new T.MeshBasicMaterial({ color: 0x1b1b1b });
const inked = (m, grow = 1.04) => {
  const o = new T.Mesh(m.geometry, INK);
  o.position.copy(m.position);
  o.rotation.copy(m.rotation);
  o.scale.copy(m.scale).multiplyScalar(grow);
  return [m, o];
};

// a glossy eye with a little highlight, on a group so it can blink (scale.y)
function makeEye(rx, ry, rz) {
  const g = new T.Group();
  g.add(put(sculpt(rx, ry, rz), EYE));
  g.add(put(new T.SphereGeometry(rx * 0.32, 12, 8), SHINE, [rx * 0.35, ry * 0.4, rz * 0.8]));
  return g;
}

// ---------- the Millionaire hot-seat ----------
function makeChair() {
  const g = new T.Group();
  const chrome = matte(0xe6e8ef, { metalness: 1, roughness: 0.12 });
  const leather = matte(0x1d1733, { roughness: 0.38, metalness: 0.05 });
  const backLeather = matte(0x1d1733, { roughness: 0.38, metalness: 0.05, side: T.DoubleSide });
  g.add(put(new T.CylinderGeometry(0.42, 0.48, 0.06, 48), chrome, [0, 0.03, 0]));
  g.add(put(new T.CylinderGeometry(0.05, 0.06, 0.85, 24), chrome, [0, 0.47, 0]));
  g.add(put(new T.TorusGeometry(0.3, 0.022, 16, 48), chrome, [0, 0.5, 0], [Math.PI / 2, 0, 0])); // foot ring
  g.add(put(sculpt(0.42, 0.075, 0.42, 0.35, 1), leather, [0, 0.94, 0]));                     // padded cushion
  g.add(put(new T.TorusGeometry(0.415, 0.02, 12, 64), chrome, [0, 0.9, 0], [Math.PI / 2, 0, 0]));
  // curved backrest wrapping around the back half of the seat
  const A = Math.PI * 0.9;
  g.add(put(new T.CylinderGeometry(0.43, 0.43, 0.7, 48, 1, true, Math.PI - A / 2, A), backLeather, [0, 1.33, 0]));
  const rim = new T.Group();
  rim.add(put(new T.TorusGeometry(0.43, 0.025, 12, 48, A), chrome, [0, 0, 0], [Math.PI / 2, 0, 0]));
  rim.position.y = 1.68;
  rim.rotation.y = A / 2 + Math.PI / 2;
  g.add(rim);
  return g;
}

// ---------- capybara (built on the cushion at y = 0, facing +z) ----------
function makeCapybara() {
  const g = new T.Group();
  const fur = plush(0xb8804c, 0xffd7a8);
  const furLight = plush(0xd6a676, 0xfff0d8);
  const furDark = plush(0x8e5b33, 0xe0b080);
  const ink = matte(0x2a1810, { roughness: 0.4 });

  // pear-shaped sitting body, wider at the bottom
  g.add(put(sculpt(0.29, 0.3, 0.27, 0.85, 0.9, (x, y, z) => { const s = 1 - y * 0.55; return [x * s, y, z * s]; }), fur, [0, 0.3, -0.03]));
  g.add(put(sculpt(0.17, 0.19, 0.08, 0.9, 1), furLight, [0, 0.27, 0.19]));                      // tummy
  for (const s of [-1, 1]) {
    g.add(put(sculpt(0.13, 0.09, 0.19, 0.8, 0.9), fur, [s * 0.2, 0.08, 0.06]));                   // haunches
    g.add(put(sculpt(0.07, 0.04, 0.09, 0.7, 0.8), furDark, [s * 0.19, 0.03, 0.26]));             // back feet
    g.add(put(sculpt(0.055, 0.12, 0.06, 0.9, 1), fur, [s * 0.1, 0.2, 0.25], [0.25, 0, 0]));       // front legs
    g.add(put(sculpt(0.055, 0.035, 0.065, 0.8, 0.9), furDark, [s * 0.1, 0.08, 0.29]));           // front paws
  }

  // the big boxy head with its long, blunt muzzle
  const head = new T.Group();
  head.position.set(0, 0.74, 0.05);
  head.scale.setScalar(1.12);
  head.add(put(sculpt(0.25, 0.22, 0.3, 0.62, 0.72, (x, y, z) => [x * (1 - Math.max(0, z) * 0.35), y + Math.max(0, z) * 0.06 * (y < 0 ? -1 : 0), z]), fur));
  head.add(put(sculpt(0.185, 0.145, 0.13, 0.7, 0.85), furDark, [0, -0.06, 0.24]));                 // muzzle
  for (const s of [-1, 1]) {
    head.add(put(sculpt(0.022, 0.014, 0.012), ink, [s * 0.055, 0.0, 0.365], [0, 0, s * 0.5]));  // nostrils
    const eye = makeEye(0.045, 0.045, 0.03);
    eye.position.set(s * 0.215, 0.08, 0.11);
    eye.rotation.y = s * 1.0;
    head.add(eye);
    (head.userData.eyes ||= []).push(eye);
    // sleepy, chill eyelids: the capybara look
    head.add(put(sculpt(0.055, 0.03, 0.04, 1, 1), fur, [s * 0.218, 0.108, 0.11], [0.15, s * 1.0, 0]));
    head.add(put(sculpt(0.065, 0.055, 0.03, 0.8, 0.9), furDark, [s * 0.17, 0.22, -0.15], [0, s * -0.4, 0])); // tiny ears
    head.add(put(new T.SphereGeometry(0.055, 16, 12), BLUSH, [s * 0.19, -0.03, 0.17], [0, s * 0.6, 0], [1, 0.6, 0.25]));
  }
  head.add(put(new T.TorusGeometry(0.035, 0.007, 8, 24, Math.PI), ink, [0, -0.12, 0.355], [0, 0, Math.PI])); // little smile
  // the mandarin on top (the capybara meme)
  head.add(put(sculpt(0.1, 0.085, 0.1, 1, 1, (x, y, z) => [x, y - 0.02 * Math.exp(-(x * x + z * z) / 0.002), z]), glossy(0xff8a1c), [0, 0.3, -0.03]));
  head.add(put(sculpt(0.055, 0.008, 0.025, 1, 1, (x, y, z) => [x, y + x * x * 3, z]), plush(0x58b947), [0.04, 0.395, -0.03], [0, 0.4, 0.3]));
  g.add(head);
  return { group: g, head };
}

// ---------- Hello Kitty (built on the cushion at y = 0, facing +z) ----------
function makeKitty() {
  const g = new T.Group();
  const white = plush(0xffffff, 0xffeef4);
  const blue = plush(0x2f6fd6, 0x9cc4ff);
  const yellow = plush(0xffd22e, 0xfff3b0);
  const red = glossy(0xe1213a);

  // overalls: a soft bell shape, wider at the bottom
  g.add(...inked(put(sculpt(0.2, 0.2, 0.17, 0.8, 0.9, (x, y, z) => { const s = 1 - y * 1.1; return [x * s, y, z * s]; }), blue, [0, 0.21, 0]), 1.03));
  g.add(put(sculpt(0.16, 0.08, 0.14, 0.9, 1), yellow, [0, 0.4, -0.005]));                       // shirt
  g.add(put(sculpt(0.095, 0.075, 0.03, 0.4, 0.5), blue, [0, 0.33, 0.15]));                      // bib
  for (const s of [-1, 1]) {
    g.add(put(new T.SphereGeometry(0.018, 12, 8), yellow, [s * 0.055, 0.37, 0.18]));            // buttons
    g.add(...inked(put(sculpt(0.055, 0.12, 0.055, 0.9, 1), white, [s * 0.21, 0.3, 0.02], [0, 0, s * 0.55])));   // arms
    g.add(...inked(put(sculpt(0.075, 0.065, 0.11, 0.8, 0.9), white, [s * 0.09, 0.05, 0.16])));               // feet
  }

  const head = new T.Group();
  head.position.set(0, 0.77, 0.02);
  // her wide, slightly squarish head, a touch narrower at the top
  head.add(...inked(put(sculpt(0.44, 0.32, 0.33, 0.8, 0.82, (x, y, z) => [x * (1 - Math.max(0, y) * 0.35), y, z]), white), 1.025));
  const earGeo = new T.LatheGeometry([[0.001, -0.02], [0.13, 0], [0.11, 0.1], [0.07, 0.18], [0.025, 0.22], [0.001, 0.228]].map(([x, y]) => new T.Vector2(x, y)), 32);
  for (const s of [-1, 1]) {
    head.add(...inked(put(earGeo, white, [s * 0.25, 0.2, 0], [0, 0, -s * 0.55], [1, 1, 0.75]), 1.06));
    const eye = makeEye(0.034, 0.05, 0.02);
    eye.position.set(s * 0.17, -0.01, 0.31);
    eye.rotation.y = s * 0.25;
    head.add(eye);
    (head.userData.eyes ||= []).push(eye);
    for (let k = 0; k < 3; k++) {                                                                 // whiskers
      head.add(put(new T.CapsuleGeometry(0.007, 0.2, 4, 8), WHISKER,
        [s * 0.43, -0.07 + k * 0.06, 0.17], [0, 0, Math.PI / 2 + s * (k - 1) * 0.2]));
    }
  }
  head.add(...inked(put(sculpt(0.04, 0.027, 0.022), yellow, [0, -0.075, 0.325]), 1.12));      // nose
  // the red bow on her left ear (viewer's right): two pinched lobes and a knot
  const bow = new T.Group();
  bow.position.set(0.26, 0.29, 0.08);
  bow.rotation.set(0.15, 0, -0.35);
  const lobe = sculpt(0.11, 0.085, 0.05, 0.75, 0.75, (x, y, z) => [x, y * (0.45 + 0.55 * Math.min(1, Math.abs(x) / 0.11 + 0.15)), z]);
  for (const s of [-1, 1]) bow.add(...inked(put(lobe, red, [s * 0.1, 0, 0], [0, 0, s * 0.2]), 1.05));
  bow.add(...inked(put(sculpt(0.05, 0.048, 0.05, 0.8, 0.8), red, [0, 0, 0.02]), 1.08));
  head.add(bow);
  g.add(head);
  return { group: g, head };
}

function makeHeart() {
  const s = new T.Shape();
  s.moveTo(0, -0.6);
  s.bezierCurveTo(-0.1, -0.45, -0.75, -0.1, -0.5, 0.3);
  s.bezierCurveTo(-0.3, 0.6, 0, 0.45, 0, 0.25);
  s.bezierCurveTo(0, 0.45, 0.3, 0.6, 0.5, 0.3);
  s.bezierCurveTo(0.75, -0.1, 0.1, -0.45, 0, -0.6);
  const geo = new T.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 8, curveSegments: 32 });
  geo.center();
  const m = new T.Mesh(geo, new T.MeshPhysicalMaterial({ color: 0xff4f8b, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x4a0a20 }));
  m.scale.setScalar(0.28);
  m.position.set(0, 1.75, 0.15);
  return m;
}

function init(c) {
  try {
    canvas = c;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  scene = new T.Scene();
  // studio reflections: chrome, leather and fur all pick up a soft "room" around them
  scene.environment = new T.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new T.PerspectiveCamera(32, 2, 0.1, 50);
  camera.position.set(0, 1.8, 4.6);

  scene.add(new T.HemisphereLight(0xffffff, 0x2a1a50, 0.35));
  const key = new T.DirectionalLight(0xfff4e8, 2);
  key.position.set(2.5, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -1, near: 1, far: 15 });
  key.shadow.radius = 4;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new T.PointLight(0xb08cff, 14, 0, 2); // purple back light, like the show's studio glow
  rim.position.set(0, 3, -2);
  scene.add(rim);

  // glossy stage floor, like the show's lit-up circle
  const floor = put(new T.CircleGeometry(2.6, 96), matte(0x140f2a, { roughness: 0.25, metalness: 0.4 }), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(put(new T.RingGeometry(2.3, 2.45, 96), new T.MeshBasicMaterial({ color: 0x6d5cff, transparent: true, opacity: 0.55 }), [0, 0.005, 0], [-Math.PI / 2, 0, 0]));

  const seats = [
    { x: -0.95, rotY: 0.7, make: makeCapybara },
    { x: 0.95, rotY: -0.3, make: makeKitty },
  ];
  seats.forEach((s, i) => {
    const seat = new T.Group();
    seat.position.x = s.x;
    seat.rotation.y = s.rotY;
    seat.add(makeChair());
    seat.add(put(new T.RingGeometry(0.5, 0.6, 64), new T.MeshBasicMaterial({ color: i ? 0xff6fa5 : 0xffd166, transparent: true, opacity: 0.6 }),
      [0, 0.01, 0], [-Math.PI / 2, 0, 0]));
    const c = s.make();
    c.group.position.y = SEAT_TOP;
    seat.add(c.group);
    seat.traverse((o) => {
      if (o.isMesh && o.material !== INK && o.material !== BLUSH) { o.castShadow = true; o.receiveShadow = true; }
    });
    scene.add(seat);
    chars.push({ ...c, eyes: c.head.userData.eyes, phase: i * 1.7, nextBlink: 1.5 + i * 1.3 });
  });
  heart = makeHeart();
  scene.add(heart);

  clock = new T.Clock();
  resize();
  new ResizeObserver(resize).observe(canvas.parentElement);
  renderer.setAnimationLoop(frame);
  return true;
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // frame the two characters (not the whole stage): back off just enough to fit them both
  // side to side (narrow phones) and top to bottom (wide desktops)
  const tanHalf = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = Math.max(1.65 / (tanHalf * camera.aspect), 1.0 / tanHalf);
  camera.lookAt(0, 1.47, 0);
  camera.updateProjectionMatrix();
}

function frame() {
  if (!canvas.clientWidth || document.hidden) return; // hidden (other mode / lobby): skip the work
  const t = clock.getElapsedTime();
  let jump = 0, spin = 0, droop = 0, shake = 0, pulse = 0;
  if (reaction) {
    const dur = { yay: 0.9, aww: 0.8, win: 2.7 }[reaction.type];
    const p = (t - reaction.t0) / dur;
    if (p >= 1) reaction = null;
    else if (reaction.type === "aww") {
      droop = Math.sin(p * Math.PI) * 0.4;
      shake = Math.sin(p * Math.PI * 6) * 0.035 * (1 - p);
    } else {
      const q = reaction.type === "win" ? (p * 3) % 1 : p;
      jump = Math.sin(q * Math.PI) * 0.18;
      spin = q * Math.PI * 2;
      pulse = Math.sin(q * Math.PI) * 0.4;
    }
  }
  for (const c of chars) {
    c.group.position.y = SEAT_TOP + Math.sin(t * 2 + c.phase) * 0.012 + jump;
    c.group.position.x = shake;
    c.group.rotation.y = spin;
    c.head.rotation.z = Math.sin(t * 1.3 + c.phase) * 0.07;
    c.head.rotation.x = droop;
    // blink every few seconds (eyes squash shut for ~0.12s)
    if (t > c.nextBlink + 0.12) c.nextBlink = t + 2.5 + Math.random() * 3;
    const shut = t > c.nextBlink ? 0.1 : 1;
    for (const e of c.eyes) e.scale.y = shut;
  }
  heart.rotation.y = t * 1.4;
  heart.position.y = 1.75 + Math.sin(t * 2.2) * 0.05;
  heart.scale.setScalar(0.28 * (1 + pulse));
  renderer.render(scene, camera);
}

window.Mascots3D = {
  init,
  react(type) {
    if (clock) reaction = { type, t0: clock.getElapsedTime() };
  },
};
window.dispatchEvent(new Event("mascots3d-ready"));
