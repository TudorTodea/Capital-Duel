// 3D couple mascots for the Millionaire mode: a capybara and Hello Kitty, each sitting in a
// "Who Wants to Be a Millionaire" hot-seat. Everything is built from three.js primitives (no model files).
// Exposes window.Mascots3D = { init(canvas) -> boolean, react("yay" | "aww" | "win") }.
(() => {
  const T = window.THREE;
  let renderer, scene, camera, canvas, chars = [], heart, clock, reaction = null;

  const mat = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
  const mesh = (geo, m, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) => {
    const x = new T.Mesh(geo, m);
    x.position.set(...pos);
    x.scale.set(...scale);
    x.rotation.set(...rot);
    return x;
  };
  const sphere = (r, m, pos, scale, rot) => mesh(new T.SphereGeometry(r, 32, 24), m, pos, scale, rot);
  const capsule = (r, len, m, pos, scale, rot) => mesh(new T.CapsuleGeometry(r, len, 8, 20), m, pos, scale, rot);

  // Cartoon outline: a slightly bigger back-face copy in black, like a 2D ink line around the shape.
  const INK = new T.MeshBasicMaterial({ color: 0x1f1f1f, side: T.BackSide });
  function inked(m, grow = 1.06) {
    const o = new T.Mesh(m.geometry, INK);
    o.position.copy(m.position);
    o.rotation.copy(m.rotation);
    o.scale.copy(m.scale).multiplyScalar(grow);
    return [m, o];
  }

  // ---------- the Millionaire hot-seat ----------
  function makeChair() {
    const g = new T.Group();
    const chrome = mat(0xd9dce8, { metalness: 0.85, roughness: 0.22 });
    const leather = mat(0x1d1733, { roughness: 0.45, metalness: 0.1 });
    const backLeather = mat(0x1d1733, { roughness: 0.45, metalness: 0.1, side: T.DoubleSide });
    g.add(mesh(new T.CylinderGeometry(0.42, 0.48, 0.06, 40), chrome, [0, 0.03, 0]));
    g.add(mesh(new T.CylinderGeometry(0.05, 0.06, 0.85, 20), chrome, [0, 0.47, 0]));
    g.add(mesh(new T.TorusGeometry(0.3, 0.022, 12, 40), chrome, [0, 0.5, 0], [1, 1, 1], [Math.PI / 2, 0, 0])); // foot ring
    g.add(mesh(new T.CylinderGeometry(0.42, 0.4, 0.14, 40), leather, [0, 0.94, 0]));
    g.add(mesh(new T.TorusGeometry(0.415, 0.02, 10, 48), chrome, [0, 1.01, 0], [1, 1, 1], [Math.PI / 2, 0, 0]));
    // curved backrest wrapping around the back half of the seat
    const A = Math.PI * 0.9;
    g.add(mesh(new T.CylinderGeometry(0.43, 0.43, 0.7, 40, 1, true, Math.PI - A / 2, A), backLeather, [0, 1.33, 0]));
    const rim = new T.Group();
    rim.add(mesh(new T.TorusGeometry(0.43, 0.025, 10, 40, A), chrome, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]));
    rim.position.y = 1.68;
    rim.rotation.y = A / 2 + Math.PI / 2;
    g.add(rim);
    return g;
  }

  // ---------- capybara (sits facing +z) ----------
  function makeCapybara() {
    const g = new T.Group();
    const fur = mat(0xa8754a, { roughness: 0.9 });
    const furDark = mat(0x87582f, { roughness: 0.9 });
    const snoutFur = mat(0x96653c, { roughness: 0.9 });
    const black = mat(0x140c06, { roughness: 0.3 });
    const white = mat(0xffffff, { roughness: 0.2 });

    g.add(sphere(0.36, fur, [0, 1.34, -0.02], [1, 1.1, 1.05]));                       // barrel body
    g.add(sphere(0.16, fur, [-0.24, 1.1, 0.08], [1, 0.7, 1.3]));                      // haunches
    g.add(sphere(0.16, fur, [0.24, 1.1, 0.08], [1, 0.7, 1.3]));
    g.add(capsule(0.055, 0.2, furDark, [-0.13, 1.16, 0.26], [1, 1, 1], [0.15, 0, 0])); // front legs
    g.add(capsule(0.055, 0.2, furDark, [0.13, 1.16, 0.26], [1, 1, 1], [0.15, 0, 0]));

    const head = new T.Group();
    head.position.set(0, 1.78, 0.14);
    head.scale.setScalar(1.3);
    head.add(capsule(0.2, 0.22, fur, [0, 0, 0], [0.95, 1.12, 1], [Math.PI / 2, 0, 0]));  // long boxy head
    head.add(sphere(0.17, snoutFur, [0, -0.03, 0.26], [1, 0.95, 0.8]));                 // blunt snout
    head.add(sphere(0.022, black, [-0.06, 0.06, 0.385]));                                // nostrils
    head.add(sphere(0.022, black, [0.06, 0.06, 0.385]));
    for (const s of [-1, 1]) {
      head.add(sphere(0.04, black, [s * 0.165, 0.1, 0.04]));                            // little eyes, high on the head
      head.add(sphere(0.012, white, [s * 0.18, 0.115, 0.07]));
      head.add(sphere(0.065, furDark, [s * 0.14, 0.23, -0.13], [1, 0.8, 0.5]));          // tiny ears
    }
    head.add(sphere(0.11, mat(0xff8c1a, { roughness: 0.5 }), [0, 0.33, -0.02]));        // the mandarin on top
    head.add(sphere(0.045, mat(0x4caf50), [0.05, 0.44, -0.02], [1.4, 0.4, 0.8], [0, 0, 0.5]));
    g.add(head);
    return { group: g, head };
  }

  // ---------- Hello Kitty (sits facing +z) ----------
  function makeKitty() {
    const g = new T.Group();
    const white = mat(0xffffff, { roughness: 0.5 });
    const red = mat(0xe8243c, { roughness: 0.45 });
    const yellow = mat(0xffd400, { roughness: 0.5 });
    const blue = mat(0x2f6fd6, { roughness: 0.6 });
    const black = mat(0x1f1f1f, { roughness: 0.3 });

    g.add(sphere(0.27, blue, [0, 1.24, 0], [1, 1, 0.95]));                              // overalls
    g.add(sphere(0.2, yellow, [0, 1.43, -0.01]));                                        // shirt
    g.add(mesh(new T.BoxGeometry(0.2, 0.15, 0.05), blue, [0, 1.42, 0.17]));             // overalls bib
    for (const s of [-1, 1]) {
      g.add(...inked(capsule(0.075, 0.12, white, [s * 0.12, 1.1, 0.2], [1, 1, 1], [Math.PI / 2, 0, 0]), 1.08)); // legs
      g.add(...inked(capsule(0.06, 0.14, white, [s * 0.25, 1.36, 0.06], [1, 1, 1], [0, 0, s * 0.6]), 1.1));   // arms
    }

    const head = new T.Group();
    head.position.set(0, 1.86, 0.02);
    head.add(...inked(sphere(0.42, white, [0, 0, 0], [1.25, 0.95, 0.95]), 1.035));       // wide head
    for (const s of [-1, 1]) {
      head.add(...inked(mesh(new T.ConeGeometry(0.14, 0.24, 24), white, [s * 0.3, 0.36, 0], [1, 1, 0.8], [0, 0, -s * 0.42]), 1.1));
      head.add(sphere(0.045, black, [s * 0.2, 0.01, 0.385], [0.8, 1.25, 0.5]));          // eyes
      for (let k = 0; k < 3; k++) {                                                       // whiskers
        head.add(mesh(new T.CylinderGeometry(0.008, 0.008, 0.3, 6), black,
          [s * 0.53, -0.1 + k * 0.07, 0.22], [1, 1, 1], [0, 0, Math.PI / 2 + s * (k - 1) * 0.18]));
      }
    }
    head.add(...inked(sphere(0.045, yellow, [0, -0.08, 0.4], [1.3, 0.9, 0.6]), 1.15));   // nose
    // the red bow on her left ear (viewer's right)
    const bow = new T.Group();
    bow.position.set(0.32, 0.38, 0.08);
    bow.rotation.z = -0.3;
    bow.add(...inked(sphere(0.11, red, [-0.11, 0, 0], [1, 0.8, 0.5], [0, 0, 0.4]), 1.08));
    bow.add(...inked(sphere(0.11, red, [0.11, 0, 0], [1, 0.8, 0.5], [0, 0, -0.4]), 1.08));
    bow.add(...inked(sphere(0.06, red, [0, 0, 0.02]), 1.12));
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
    const geo = new T.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 6, curveSegments: 24 });
    geo.center();
    const m = new T.Mesh(geo, mat(0xff4f8b, { roughness: 0.3, emissive: 0x6a0f2e }));
    m.scale.setScalar(0.28);
    m.position.set(0, 1.75, 0.15);
    return m;
  }

  function init(c) {
    if (!T) return false;
    try {
      canvas = c;
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(32, 2, 0.1, 50);
    camera.position.set(0, 1.7, 4.6);
    camera.lookAt(0, 1.22, 0);

    scene.add(new T.HemisphereLight(0xffffff, 0x2a1a50, 0.85));
    const key = new T.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 4);
    scene.add(key);
    const rim = new T.PointLight(0xb08cff, 1.2, 8);
    rim.position.set(0, 3, -2);
    scene.add(rim);

    // glowing stage floor, like the show's lit-up circle
    scene.add(mesh(new T.CircleGeometry(2.6, 64), mat(0x140f2a, { roughness: 0.4, metalness: 0.3 }), [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]));
    scene.add(mesh(new T.RingGeometry(2.3, 2.45, 64), new T.MeshBasicMaterial({ color: 0x6d5cff, transparent: true, opacity: 0.55 }), [0, 0.005, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]));

    const seats = [
      { x: -0.95, rotY: 0.95, make: makeCapybara },
      { x: 0.95, rotY: -0.3, make: makeKitty },
    ];
    seats.forEach((s, i) => {
      const seat = new T.Group();
      seat.position.x = s.x;
      seat.rotation.y = s.rotY;
      seat.add(makeChair());
      seat.add(mesh(new T.RingGeometry(0.5, 0.6, 48), new T.MeshBasicMaterial({ color: i ? 0xff6fa5 : 0xffd166, transparent: true, opacity: 0.6 }),
        [0, 0.01, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]));
      const c = s.make();
      seat.add(c.group);
      scene.add(seat);
      chars.push({ ...c, seat, baseRotY: s.rotY, phase: i * 1.7 });
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
    // keep both chairs in frame on narrow (phone) canvases by backing the camera off
    camera.position.z = camera.aspect < 2.2 ? 4.6 * (2.2 / camera.aspect) ** 0.8 : 4.6;
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
      c.group.position.y = Math.sin(t * 2 + c.phase) * 0.012 + jump;
      c.group.position.x = shake;
      c.group.rotation.y = spin;
      c.head.rotation.z = Math.sin(t * 1.3 + c.phase) * 0.07;
      c.head.rotation.x = droop;
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
})();
