/*
  Lens shader.

  A WebGL fragment shader models each piece of glass as a real object: a thick
  slab whose face is flat and whose rim rolls over in a convex bevel. From that
  surface it renders two images for the shape:

    map  – where every point of the glass sees the backdrop from. A ray comes
           straight down, meets the tilted surface, is bent by Snell's law and
           crosses the slab; red/green store how far it lands from where it
           entered. The bevel is steepest at the very edge, so the rim reaches
           furthest: it shows a squeezed, mirrored strip of what lies deeper
           under the glass, easing into the undistorted face.
    spec – the light the surface catches: a crisp rim that is brightest facing
           the key light (upper left) and its reflection (lower right), with a
           soft glow across the bevel.

  A shader cannot read the page behind an element, so the bending itself is
  applied by the browser (see glass.js). This file decides what shape the lens is.

  Glass changes size all the time: a button grows into a search field, a menu
  grows out of a button. A lens drawn for one size and stretched to another is
  wrong (a round button's light pulled wide is an oval, not a capsule), and
  drawing a new one for every frame is too slow. So a lens is not drawn at the
  element's size at all. Both images are rendered for a small tile: the four
  corners, each with one sliver of straight edge between them. Corners keep
  their size wherever the tile is used and only the slivers stretch, which is
  exact, because a straight edge looks the same all the way along. One tile
  fits every size of the same corner.
*/
(function () {
  'use strict';
  const NT = window.NT;

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // y runs downward, like the page
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uSize;     // element size in CSS px
    uniform float uRadius;  // corner radius
    uniform float uBezel;   // width of the bevel
    uniform float uTilt;    // how far the surface leans over at the very edge, radians
    uniform float uCurve;   // how quickly the bevel levels out toward the face
    uniform float uThick;   // depth of glass the bent ray crosses
    uniform float uIor;     // index of refraction
    uniform float uReach;   // shift in px that maps to a full-scale channel value
    uniform int uMode;      // 0 = refraction map, 1 = specular light

    float roundRect(vec2 p) {
      vec2 q = abs(p) - (uSize * 0.5 - uRadius);
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
    }

    void main() {
      vec2 p = (vUv - 0.5) * uSize;
      float d = roundRect(p);
      float e = 0.75;
      vec2 g = vec2(roundRect(p + vec2(e, 0.0)) - roundRect(p - vec2(e, 0.0)),
                    roundRect(p + vec2(0.0, e)) - roundRect(p - vec2(0.0, e)));
      vec2 outward = dot(g, g) > 1e-8 ? normalize(g) : vec2(0.0);

      float x = clamp(-d / uBezel, 0.0, 1.0);  // 0 at the edge, 1 where the face is flat
      float lean = pow(1.0 - x, uCurve);       // 1 at the edge, 0 on the face

      if (uMode == 0) {
        vec2 shift = vec2(0.0);
        if (d < 0.0) {
          float tilt = uTilt * lean;
          vec3 normal = vec3(outward * sin(tilt), cos(tilt));
          vec3 ray = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / uIor);
          shift = ray.xy / max(-ray.z, 0.05) * uThick;
        }
        gl_FragColor = vec4(0.5 + 0.5 * clamp(shift / uReach, -1.0, 1.0), 0.5, 1.0);
        return;
      }

      float depth = -d;
      float inside = 1.0 - smoothstep(-0.6, 0.4, d);
      float facing = dot(outward, normalize(vec2(-0.56, -0.83))); // toward the key light
      float key = pow(max(facing, 0.0), 1.6);
      float bounce = pow(max(-facing, 0.0), 2.4);

      float rim = 1.0 - smoothstep(0.0, 1.4, depth);
      float light = rim * (0.16 + 0.84 * key + 0.6 * bounce) + lean * (0.2 * key + 0.1 * bounce);
      float shade = lean * 0.1 * max(-facing, 0.0) * (1.0 - rim);

      light = clamp(light, 0.0, 1.0) * inside;
      shade = clamp(shade, 0.0, 1.0) * inside;
      gl_FragColor = vec4(vec3(light), clamp(light + shade, 0.0, 1.0)); // premultiplied
    }`;

  const UNIFORMS = ['uSize', 'uRadius', 'uBezel', 'uTilt', 'uCurve', 'uThick', 'uIor', 'uReach', 'uMode'];

  const canvas = document.createElement('canvas');
  let gl = null, uniforms = null, failed = false;

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; });

  function init() {
    if (gl || failed) return !!gl;
    try {
      const ctx = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!ctx) throw new Error('no webgl');
      const compile = (type, src) => {
        const s = ctx.createShader(type);
        ctx.shaderSource(s, src);
        ctx.compileShader(s);
        if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) throw new Error(ctx.getShaderInfoLog(s));
        return s;
      };
      const program = ctx.createProgram();
      ctx.attachShader(program, compile(ctx.VERTEX_SHADER, VERT));
      ctx.attachShader(program, compile(ctx.FRAGMENT_SHADER, FRAG));
      ctx.linkProgram(program);
      if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) throw new Error(ctx.getProgramInfoLog(program));
      ctx.useProgram(program);
      ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
      ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
      const pos = ctx.getAttribLocation(program, 'aPos');
      ctx.enableVertexAttribArray(pos);
      ctx.vertexAttribPointer(pos, 2, ctx.FLOAT, false, 0, 0);
      uniforms = {};
      for (const name of UNIFORMS) uniforms[name] = ctx.getUniformLocation(program, name);
      gl = ctx;
    } catch (e) {
      failed = true;
      console.warn('Lens shader unavailable:', e && e.message);
    }
    return !!gl;
  }

  // How far a ray is thrown sideways, per unit of glass depth, by a surface leaning `tilt` radians.
  const throwOf = (tilt, ior) => Math.tan(tilt - Math.asin(Math.sin(tilt) / ior));

  // Draws a square tile `px` pixels across that stands for `size` CSS px. Returns its
  // RGBA rows from the top down.
  function draw(mode, px, size, o, thick, reach) {
    const width = px, height = px;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uniforms.uSize, size, size);
    gl.uniform1f(uniforms.uRadius, o.radius);
    gl.uniform1f(uniforms.uBezel, o.bezel);
    gl.uniform1f(uniforms.uTilt, o.tilt);
    gl.uniform1f(uniforms.uCurve, o.curve);
    gl.uniform1f(uniforms.uThick, thick);
    gl.uniform1f(uniforms.uIor, o.ior);
    gl.uniform1f(uniforms.uReach, reach);
    gl.uniform1i(uniforms.uMode, mode);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // WebGL hands rows back from the bottom up.
    const stride = width * 4;
    const rows = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y++) rows.set(pixels.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
    return rows;
  }

  // The `w` × `h` block at (x, y) of an image `width` pixels wide.
  function crop(pixels, width, x, y, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
      const from = ((y + j) * width + x) * 4;
      out.set(pixels.subarray(from, from + w * 4), j * w * 4);
    }
    return out;
  }

  /*
    The pixels are read straight from the GPU and written out as a PNG here.
    canvas.toDataURL() would be shorter, but privacy-minded browsers add random
    noise to it, and noise in a refraction map shows up as grain in the glass.
  */
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c >>> 0;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let c = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
    view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return out;
  }

  // pixels: RGBA rows from the top down.
  async function png(pixels, width, height, premultiplied) {
    const stride = width * 4;
    const rows = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const src = y * stride;
      const row = pixels.subarray(src, src + stride);
      if (premultiplied) {
        for (let i = 0; i < stride; i += 4) {
          const a = row[i + 3];
          if (a === 0 || a === 255) continue;
          row[i] = Math.min(255, Math.round(row[i] * 255 / a));
          row[i + 1] = Math.min(255, Math.round(row[i + 1] * 255 / a));
          row[i + 2] = Math.min(255, Math.round(row[i + 2] * 255 / a));
        }
      }
      const dst = y * (stride + 1);
      rows[dst] = 1; // each byte is stored as its difference from the pixel to the left
      for (let i = 0; i < stride; i++) rows[dst + 1 + i] = row[i] - (i >= 4 ? row[i - 4] : 0);
    }
    const packed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const head = new Uint8Array(13);
    const view = new DataView(head.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    head[8] = 8; // bits per channel
    head[9] = 6; // RGBA
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', packed), chunk('IEND', new Uint8Array(0))];
    let text = '';
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 0x8000) text += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
    }
    return 'data:image/png;base64,' + btoa(text);
  }

  const EDGE = 2; // px of straight edge kept between two corners of a tile

  // Whole-surface magnification is a plain ramp: every point looks a little further
  // toward the centre, in proportion to its distance from it. Red falls from left to
  // right and green from top to bottom, each passing through "no shift" in the middle.
  // The same image serves every lens; the filter decides how steep it is (glass.js).
  // It is see-through, so laying it over a lens's map mixes the two shifts into one.
  //
  // It is also tiny. An image inside a filter costs time on every frame in proportion
  // to its size (a 256 px ramp took 10 ms a frame here), and a straight ramp loses
  // nothing by being stretched from 16 px: the browser interpolates between them.
  const RAMP_ALPHA = 64, RAMP_SIZE = 16;
  let rampUrl = null;
  function ramp() {
    if (!rampUrl) {
      const n = RAMP_SIZE, step = 255 / (n - 1), pixels = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) pixels.set([255 - x * step, 255 - y * step, 128, RAMP_ALPHA], (y * n + x) * 4);
      }
      rampUrl = png(pixels, n, n, false);
    }
    return rampUrl;
  }

  NT.lens = {
    available: () => typeof CompressionStream === 'function' && init(),
    ramp,
    // The ramp's value falls by 1 between the centres of its first and last pixel: over
    // this share of its width.
    rampSpan: (RAMP_SIZE - 1) / RAMP_SIZE,
    // How far from the middle value it can be trusted: the outermost pixel on each side
    // is where the browser's interpolation stops being a straight line.
    rampMost: (RAMP_SIZE - 3) / (RAMP_SIZE - 1) / 2,
    rampAlpha: RAMP_ALPHA / 255,
    /*
      o: { radius, bezel, throw, tilt, curve, ior, dpr }
         throw – how far, in px, the very edge reaches into the glass

      Resolves to null if the lens could not be rendered, otherwise to
        corner – the larger of radius and bezel: what a corner has to contain
        cut    – that in whole px: the tile is cut this far in from each side
        reach  – shift in px that a full-scale value in the map stands for
        pieces – the map as eight images, row by row, without the (flat) middle
        spec   – the light layer, whole; slice – its corner size in image pixels
        specCut – that corner in CSS px
    */
    async render(o) {
      if (!init()) return null;
      try {
        const cut = Math.max(1, Math.ceil(Math.max(o.radius, o.bezel)));
        const thick = o.throw / throwOf(o.tilt, o.ior);
        // The edge bends most, so it sets the largest shift the map has to encode.
        const reach = Math.max(1, o.throw * 1.02);
        // The map varies smoothly and is resampled by the filter, so 1× is enough for it;
        // the light layer has a hairline rim and is drawn at the screen's density.
        const size = cut * 2 + EDGE;
        const slice = Math.ceil(cut * o.dpr), across = slice * 2 + Math.max(2, Math.round(EDGE * o.dpr));
        // Both are drawn before anything is awaited: the one canvas is shared by every lens.
        const map = draw(0, size, size, o, thick, reach);
        const spec = draw(1, across, across / o.dpr, o, thick, reach);
        const spans = [[0, cut], [cut, EDGE], [cut + EDGE, cut]];
        const jobs = [];
        spans.forEach(([y, h], row) => spans.forEach(([x, w], col) => {
          if (row !== 1 || col !== 1) jobs.push(png(crop(map, size, x, y, w, h), w, h, false));
        }));
        jobs.push(png(spec, across, across, true));
        const urls = await Promise.all(jobs);
        return { corner: Math.max(o.radius, o.bezel), cut, reach, throw: o.throw, pieces: urls.slice(0, 8), spec: urls[8], slice, specCut: slice / o.dpr };
      } catch (e) {
        return null;
      }
    },
  };
})();
