"use client";
import { useEffect, useRef, useState } from "react";
import { WbIcon } from "./WbIcon";
import { VEHICLE_SPECS, type VehicleItemId } from "@/lib/worldbox/player/vehicles";
import { VEHICLE_SPRITE_META, directionIndex16 } from "@/lib/worldbox/world/pseudo3d";

const RENDER_MODES = [
  { id: 2, label: "SMOOTH AA" },
  { id: 0, label: "PIXEL+AA" },
  { id: 1, label: "RETRO PX" },
  { id: 3, label: "SILKY 3D" },
] as const;

const PITCH_PRESETS = [24, 38, 60] as const;

export function VehicleCardThumb({
  vehicleId,
  active,
}: {
  vehicleId: VehicleItemId;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const meta = VEHICLE_SPRITE_META[vehicleId];
    const img = new Image();
    img.src = meta.dirSheetSrc;
    let raf = 0;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (img.complete && img.naturalWidth > 0) {
        const dir = active ? Math.floor((now / 150) % meta.dirs) : 2;
        const row = meta.dirRows > 1 ? Math.floor(now / 180) % meta.dirRows : 0;
        ctx.imageSmoothingEnabled = false;
        const drawSize = 56;
        const dx = Math.round((canvas.width - drawSize) / 2);
        const dy = Math.round((canvas.height - drawSize) / 2);
        ctx.drawImage(
          img,
          dir * meta.cellSize,
          row * meta.cellSize,
          meta.cellSize,
          meta.cellSize,
          dx,
          dy,
          drawSize,
          drawSize,
        );
      }
      if (active || !img.complete) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    img.onload = () => draw(performance.now());
    raf = window.requestAnimationFrame(draw);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [vehicleId, active]);

  return (
    <canvas
      ref={canvasRef}
      width={76}
      height={50}
      aria-hidden="true"
      style={{ width: 76, height: 50, display: "block", imageRendering: "pixelated" }}
    />
  );
}

export default function VehiclePseudo3DViewer({ vehicleId }: { vehicleId: VehicleItemId }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderMode, setRenderMode] = useState<number>(2);
  const [pitchDeg, setPitchDeg] = useState<number>(38);
  const [autoSpin, setAutoSpin] = useState<boolean>(true);
  const [webglFallback, setWebglFallback] = useState<boolean>(false);

  const stateRef = useRef({
    vehicleId,
    renderMode: 2,
    pitchDeg: 38,
    autoSpin: true,
    angleRad: 0.62,
    dragActive: false,
    dragLastX: 0,
  });

  stateRef.current.vehicleId = vehicleId;
  stateRef.current.renderMode = renderMode;
  stateRef.current.pitchDeg = pitchDeg;
  stateRef.current.autoSpin = autoSpin;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      setWebglFallback(true);
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      const imgs: Partial<Record<VehicleItemId, HTMLImageElement>> = {};
      for (const vid of Object.keys(VEHICLE_SPRITE_META) as VehicleItemId[]) {
        const im = new Image();
        im.src = VEHICLE_SPRITE_META[vid].dirSheetSrc;
        imgs[vid] = im;
      }
      let raf2d = 0;
      let lastT = performance.now();
      const tick2d = (now: number) => {
        const dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;
        const st = stateRef.current;
        if (st.autoSpin && !st.dragActive) st.angleRad += dt * 1.1;
        const rect = canvas.getBoundingClientRect();
        const cw = Math.max(1, Math.round(rect.width));
        const ch = Math.max(1, Math.round(rect.height));
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        ctx2d.fillStyle = "#0b1428";
        ctx2d.fillRect(0, 0, cw, ch);
        const im = imgs[st.vehicleId];
        const meta = VEHICLE_SPRITE_META[st.vehicleId];
        if (im && im.complete && im.naturalWidth > 0) {
          const deg = ((st.angleRad * 180) / Math.PI) % 360;
          const dir = directionIndex16(deg);
          const row = meta.dirRows > 1 ? Math.floor(now / 180) % meta.dirRows : 0;
          const size = Math.min(cw, ch) * 0.78;
          ctx2d.imageSmoothingEnabled = false;
          ctx2d.drawImage(
            im,
            dir * meta.cellSize,
            row * meta.cellSize,
            meta.cellSize,
            meta.cellSize,
            (cw - size) * 0.5,
            (ch - size) * 0.5,
            size,
            size,
          );
        }
        raf2d = window.requestAnimationFrame(tick2d);
      };
      raf2d = window.requestAnimationFrame(tick2d);
      return () => {
        window.cancelAnimationFrame(raf2d);
      };
    }

    setWebglFallback(false);
    const hasDeriv = Boolean(gl.getExtension("OES_standard_derivatives"));

    const compileShader = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error("shader alloc failed");
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
      }
      return sh;
    };

    const createProgram = (vsSrc: string, fsSrc: string) => {
      const p = gl.createProgram();
      if (!p) throw new Error("program alloc failed");
      const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p) || "program link failed");
      }
      return p;
    };

    const bgProg = createProgram(
      `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
      `,
      `
      precision mediump float;
      varying vec2 vUv;
      uniform vec2 uRes;
      uniform float uTime;
      void main() {
        vec2 px = vUv * uRes;
        vec2 dv = vUv - vec2(0.5, 0.5);
        float vig = 1.0 - dot(dv, dv) * 0.35;
        vec3 col = vec3(0.051, 0.086, 0.175) * clamp(vig, 0.78, 1.05);
        float stepPx = 24.0;
        vec2 g = mod(px - 0.5 * mod(uRes, stepPx), stepPx);
        if (g.x < 1.1 || g.y < 1.1) {
          col = mix(col, vec3(0.11, 0.18, 0.34), 0.55);
        }
        float ring = abs(length((vUv - vec2(0.5, 0.58)) * vec2(uRes.x / max(uRes.y, 1.0), 1.8)) - 0.34);
        if (ring < 0.012) {
          col = mix(col, vec3(0.22, 0.74, 0.97), 0.35 + 0.15 * sin(uTime * 2.2));
        }
        gl_FragColor = vec4(col, 1.0);
      }
      `,
    );

    const stackProg = createProgram(
      `
      attribute vec2 aCorner;
      attribute vec3 aSlice;
      uniform vec2 uFboSize;
      uniform vec2 uPivot;
      uniform vec2 uSliceDim;
      uniform float uAngle;
      uniform float uSquash;
      uniform float uSpacing;
      varying vec2 vLocalUV;
      varying vec2 vTileOrigin;
      void main() {
        vec2 p = aCorner * uSliceDim;
        float ca = cos(uAngle);
        float sa = sin(uAngle);
        vec2 rot = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
        vec2 stacked = vec2(rot.x, rot.y * uSquash - aSlice.x * uSpacing);
        vec2 pos = uPivot + stacked;
        vec2 ndc = (pos / uFboSize) * 2.0 - 1.0;
        ndc.y = -ndc.y;
        gl_Position = vec4(ndc, 0.0, 1.0);
        vLocalUV = aCorner + 0.5;
        vTileOrigin = aSlice.yz;
      }
      `,
      (hasDeriv ? "#extension GL_OES_standard_derivatives : enable\n" : "") +
        `
      precision highp float;
      uniform sampler2D uAtlas;
      uniform vec2 uSliceDim;
      uniform vec2 uAtlasGrid;
      uniform int uMode;
      varying vec2 vLocalUV;
      varying vec2 vTileOrigin;

      vec4 fetchTexel(vec2 tc) {
        vec2 c = clamp(tc, vec2(0.0), uSliceDim - vec2(1.0));
        vec2 uv = (vTileOrigin + (c + 0.5) / uSliceDim) / uAtlasGrid;
        return texture2D(uAtlas, uv);
      }

      void main() {
        vec2 tCoord = vLocalUV * uSliceDim - 0.5;
        if (uMode == 2) {
          vec4 c = fetchTexel(floor(tCoord + 0.5));
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb, 1.0);
          return;
        }
        vec2 fl = floor(tCoord);
        vec2 fr = fract(tCoord);
        vec2 w;
        if (uMode == 0) {
          ` +
        (hasDeriv
          ? `
          vec2 fw = clamp(fwidth(tCoord), vec2(0.05), vec2(0.95));
          w = clamp((fr - 0.5) / fw + 0.5, 0.0, 1.0);
          `
          : `
          w = smoothstep(0.28, 0.72, fr);
          `) +
        `
        } else {
          w = fr * fr * (3.0 - 2.0 * fr);
        }
        vec4 c00 = fetchTexel(fl);
        vec4 c10 = fetchTexel(fl + vec2(1.0, 0.0));
        vec4 c01 = fetchTexel(fl + vec2(0.0, 1.0));
        vec4 c11 = fetchTexel(fl + vec2(1.0, 1.0));
        float w00 = (1.0 - w.x) * (1.0 - w.y);
        float w10 = w.x * (1.0 - w.y);
        float w01 = (1.0 - w.x) * w.y;
        float w11 = w.x * w.y;
        float a = c00.a * w00 + c10.a * w10 + c01.a * w01 + c11.a * w11;
        if (a < 0.06) discard;
        vec3 rgbSum = c00.rgb * (c00.a * w00) + c10.rgb * (c10.a * w10)
                    + c01.rgb * (c01.a * w01) + c11.rgb * (c11.a * w11);
        vec3 rgb = rgbSum / max(a, 1e-4);
        float outA = (uMode == 0) ? smoothstep(0.24, 0.72, a) : smoothstep(0.18, 0.78, a);
        if (outA < 0.02) discard;
        gl_FragColor = vec4(rgb * outA, outA);
      }
      `,
    );

    const compProg = createProgram(
      `
      attribute vec2 aPos;
      uniform vec4 uRect;
      uniform vec2 uRes;
      varying vec2 vUv;
      void main() {
        vec2 p = uRect.xy + aPos * (uRect.zw * 0.5);
        vec2 ndc = (p / uRes) * 2.0 - 1.0;
        ndc.y = -ndc.y;
        gl_Position = vec4(ndc, 0.0, 1.0);
        vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
      }
      `,
      (hasDeriv ? "#extension GL_OES_standard_derivatives : enable\n" : "") +
        `
      precision highp float;
      uniform sampler2D uFboTex;
      uniform vec2 uTexel;
      uniform vec2 uVirtSize;
      uniform float uOutRad;
      uniform vec3 uOutCol;
      uniform int uCompMode;
      uniform float uDotSize;
      varying vec2 vUv;

      vec4 sampleCell(vec2 cellIdx, vec2 gridDim) {
        vec2 uv = (clamp(cellIdx, vec2(0.0), gridDim - vec2(1.0)) + 0.5) / gridDim;
        return texture2D(uFboTex, uv);
      }

      vec4 samplePixelAA(vec2 pCoord, vec2 gridDim) {
        vec2 fl = floor(pCoord - 0.5);
        vec2 fr = fract(pCoord - 0.5);
        ` +
        (hasDeriv
          ? `
        vec2 fw = clamp(fwidth(pCoord) * 1.15, vec2(0.04), vec2(0.42));
        vec2 w = clamp((fr - 0.5) / fw + 0.5, 0.0, 1.0);
        `
          : `
        vec2 w = smoothstep(0.36, 0.64, fr);
        `) +
        `
        vec4 c00 = sampleCell(fl, gridDim);
        vec4 c10 = sampleCell(fl + vec2(1.0, 0.0), gridDim);
        vec4 c01 = sampleCell(fl + vec2(0.0, 1.0), gridDim);
        vec4 c11 = sampleCell(fl + vec2(1.0, 1.0), gridDim);
        return mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
      }

      void main() {
        if (uCompMode == 0 || uCompMode == 1) {
          vec2 gridDim = uVirtSize / max(uDotSize, 1.0);
          vec2 pCoord = vUv * gridDim;
          vec2 cell = floor(pCoord);
          vec4 fg;
          float outA = 0.0;
          if (uCompMode == 1) {
            fg = sampleCell(cell, gridDim);
            float solid = step(0.42, fg.a);
            if (solid > 0.5) {
              vec3 rgb = fg.rgb / max(fg.a, 1e-4);
              rgb = floor(rgb * 28.0 + 0.5) / 28.0;
              fg = vec4(rgb, 1.0);
            } else {
              fg = vec4(0.0);
            }
            float m = max(
              max(sampleCell(cell + vec2(1.0, 0.0), gridDim).a, sampleCell(cell + vec2(-1.0, 0.0), gridDim).a),
              max(sampleCell(cell + vec2(0.0, 1.0), gridDim).a, sampleCell(cell + vec2(0.0, -1.0), gridDim).a)
            );
            outA = step(0.42, m);
          } else {
            fg = samplePixelAA(pCoord, gridDim);
            float aFirm = smoothstep(0.16, 0.68, fg.a);
            vec3 rgb = fg.rgb / max(fg.a, 1e-4);
            rgb = mix(rgb, floor(rgb * 42.0 + 0.5) / 42.0, 0.35);
            fg = vec4(rgb * aFirm, aFirm);
            float m = max(
              max(samplePixelAA(pCoord + vec2(1.0, 0.0), gridDim).a, samplePixelAA(pCoord + vec2(-1.0, 0.0), gridDim).a),
              max(samplePixelAA(pCoord + vec2(0.0, 1.0), gridDim).a, samplePixelAA(pCoord + vec2(0.0, -1.0), gridDim).a)
            );
            outA = smoothstep(0.22, 0.64, m);
          }
          if (fg.a < 0.01 && outA < 0.01) discard;
          vec3 outPremul = uOutCol * outA;
          gl_FragColor = vec4(fg.rgb + outPremul * (1.0 - fg.a), fg.a + outA * (1.0 - fg.a));
          return;
        }
        vec4 fg = texture2D(uFboTex, vUv);
        vec2 d = uTexel * uOutRad;
        vec2 dd = d * 0.70710678;
        float m = fg.a;
        m = max(m, texture2D(uFboTex, vUv + vec2(d.x, 0.0)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(-d.x, 0.0)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(0.0, d.y)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(0.0, -d.y)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(dd.x, dd.y)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(-dd.x, dd.y)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(dd.x, -dd.y)).a);
        m = max(m, texture2D(uFboTex, vUv + vec2(-dd.x, -dd.y)).a);
        float outA = smoothstep(0.18, 0.62, m);
        if (outA < 0.01) discard;
        vec3 outPremul = uOutCol * outA;
        gl_FragColor = vec4(fg.rgb + outPremul * (1.0 - fg.a), fg.a + outA * (1.0 - fg.a));
      }
      `,
    );

    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const buildStackVBO = (sliceCount: number, cols: number, subLayers: number) => {
      const total = sliceCount * subLayers;
      const data = new Float32Array(total * 6 * 5);
      const corners = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [-0.5, 0.5],
        [0.5, -0.5],
        [0.5, 0.5],
      ];
      let ptr = 0;
      for (let z = 0; z < sliceCount; z++) {
        const col = z % cols;
        const row = (z / cols) | 0;
        for (let s = 0; s < subLayers; s++) {
          const zf = z + s / subLayers;
          for (let k = 0; k < 6; k++) {
            data[ptr++] = corners[k][0];
            data[ptr++] = corners[k][1];
            data[ptr++] = zf;
            data[ptr++] = col;
            data[ptr++] = row;
          }
        }
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { buf, count: total * 6 };
    };

    const virtW = 128;
    const virtH = 112;
    const ss = 2;
    const pxW = virtW * ss;
    const pxH = virtH * ss;
    const fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pxW, pxH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const vbo1x = buildStackVBO(42, 7, 1);
    const vbo2x = buildStackVBO(42, 7, 2);

    const bgLoc = {
      aPos: gl.getAttribLocation(bgProg, "aPos"),
      uRes: gl.getUniformLocation(bgProg, "uRes"),
      uTime: gl.getUniformLocation(bgProg, "uTime"),
    };
    const stLoc = {
      aCorner: gl.getAttribLocation(stackProg, "aCorner"),
      aSlice: gl.getAttribLocation(stackProg, "aSlice"),
      uFboSize: gl.getUniformLocation(stackProg, "uFboSize"),
      uPivot: gl.getUniformLocation(stackProg, "uPivot"),
      uSliceDim: gl.getUniformLocation(stackProg, "uSliceDim"),
      uAngle: gl.getUniformLocation(stackProg, "uAngle"),
      uSquash: gl.getUniformLocation(stackProg, "uSquash"),
      uSpacing: gl.getUniformLocation(stackProg, "uSpacing"),
      uAtlas: gl.getUniformLocation(stackProg, "uAtlas"),
      uAtlasGrid: gl.getUniformLocation(stackProg, "uAtlasGrid"),
      uMode: gl.getUniformLocation(stackProg, "uMode"),
    };
    const cpLoc = {
      aPos: gl.getAttribLocation(compProg, "aPos"),
      uRect: gl.getUniformLocation(compProg, "uRect"),
      uRes: gl.getUniformLocation(compProg, "uRes"),
      uFboTex: gl.getUniformLocation(compProg, "uFboTex"),
      uTexel: gl.getUniformLocation(compProg, "uTexel"),
      uVirtSize: gl.getUniformLocation(compProg, "uVirtSize"),
      uOutRad: gl.getUniformLocation(compProg, "uOutRad"),
      uOutCol: gl.getUniformLocation(compProg, "uOutCol"),
      uCompMode: gl.getUniformLocation(compProg, "uCompMode"),
      uDotSize: gl.getUniformLocation(compProg, "uDotSize"),
    };

    const atlasCache = new Map<string, WebGLTexture>();
    const pendingUrls = new Set<string>();

    const getSliceTex = (src: string): WebGLTexture | null => {
      const hit = atlasCache.get(src);
      if (hit) return hit;
      if (pendingUrls.has(src)) return null;
      pendingUrls.add(src);
      const im = new Image();
      im.onload = () => {
        if (disposed) return;
        const t = gl.createTexture();
        if (!t) return;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        atlasCache.set(src, t);
      };
      im.src = src;
      return null;
    };

    // Prewarm all vehicle slice atlases immediately
    for (const vid of Object.keys(VEHICLE_SPRITE_META) as VehicleItemId[]) {
      const m = VEHICLE_SPRITE_META[vid];
      getSliceTex(m.sliceAtlasSrc);
      if (m.sirenAltSliceAtlasSrc) getSliceTex(m.sirenAltSliceAtlasSrc);
    }

    let disposed = false;
    let rafId = 0;
    let lastTs = performance.now();

    const render = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      const st = stateRef.current;

      if (st.autoSpin && !st.dragActive) {
        st.angleRad = (st.angleRad + dt * 0.78) % (Math.PI * 2);
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.floor(rect.width * dpr));
      const ch = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const meta = VEHICLE_SPRITE_META[st.vehicleId];
      const useAltSiren = meta.sirenAltSliceAtlasSrc && Math.floor(now / 180) % 2 === 1;
      const texSrc =
        useAltSiren && meta.sirenAltSliceAtlasSrc ? meta.sirenAltSliceAtlasSrc : meta.sliceAtlasSrc;
      const atlasTex = getSliceTex(texSrc) ?? getSliceTex(meta.sliceAtlasSrc);

      const pitchRad = (st.pitchDeg * Math.PI) / 180;
      const squash = Math.sin(pitchRad);
      const spacing = Math.cos(pitchRad);

      if (atlasTex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, pxW, pxH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const activeVbo = st.renderMode === 2 || st.renderMode === 3 ? vbo2x : vbo1x;
        gl.useProgram(stackProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, activeVbo.buf);
        gl.enableVertexAttribArray(stLoc.aCorner);
        gl.enableVertexAttribArray(stLoc.aSlice);
        gl.vertexAttribPointer(stLoc.aCorner, 2, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(stLoc.aSlice, 3, gl.FLOAT, false, 20, 8);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.uniform1i(stLoc.uAtlas, 0);
        gl.uniform2f(stLoc.uFboSize, virtW, virtH);
        gl.uniform2f(stLoc.uPivot, virtW * 0.5, virtH * 0.56 + meta.sliceCount * 0.36 * spacing);
        gl.uniform2f(stLoc.uSliceDim, meta.sliceW, meta.sliceH);
        gl.uniform2f(stLoc.uAtlasGrid, meta.atlasCols, meta.atlasRows);
        gl.uniform1f(stLoc.uAngle, st.angleRad);
        gl.uniform1f(stLoc.uSquash, squash);
        gl.uniform1f(stLoc.uSpacing, spacing);
        gl.uniform1i(stLoc.uMode, st.renderMode === 3 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, activeVbo.count);
        gl.disableVertexAttribArray(stLoc.aCorner);
        gl.disableVertexAttribArray(stLoc.aSlice);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.viewport(0, 0, cw, ch);
      gl.disable(gl.BLEND);
      gl.useProgram(bgProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(bgLoc.aPos);
      gl.vertexAttribPointer(bgLoc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(bgLoc.uRes, cw, ch);
      gl.uniform1f(bgLoc.uTime, now * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(bgLoc.aPos);

      if (atlasTex) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const unitPx = Math.min(cw / virtW, ch / virtH) * 1.15;
        const dispW = virtW * unitPx;
        const dispH = virtH * unitPx;
        gl.useProgram(compProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(cpLoc.aPos);
        gl.vertexAttribPointer(cpLoc.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.uniform1i(cpLoc.uFboTex, 0);
        gl.uniform4f(cpLoc.uRect, cw * 0.5, ch * 0.52, dispW, dispH);
        gl.uniform2f(cpLoc.uRes, cw, ch);
        gl.uniform2f(cpLoc.uTexel, 1 / pxW, 1 / pxH);
        gl.uniform2f(cpLoc.uVirtSize, virtW, virtH);
        gl.uniform1f(cpLoc.uOutRad, ss * 1.12);
        gl.uniform3f(cpLoc.uOutCol, 22 / 255, 24 / 255, 44 / 255);
        gl.uniform1i(cpLoc.uCompMode, st.renderMode);
        gl.uniform1f(cpLoc.uDotSize, 1.35);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(cpLoc.aPos);
      }

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      for (const tex of atlasCache.values()) gl.deleteTexture(tex);
      atlasCache.clear();
      gl.deleteTexture(fboTex);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(vbo1x.buf);
      gl.deleteBuffer(vbo2x.buf);
      gl.deleteBuffer(quadBuf);
      gl.deleteProgram(bgProg);
      gl.deleteProgram(stackProg);
      gl.deleteProgram(compProg);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  const spec = VEHICLE_SPECS[vehicleId];

  return (
    <div
      className="wb-mmo-card"
      style={{
        marginBottom: 12,
        padding: 10,
        background: "rgba(9, 14, 24, 0.92)",
        borderColor: "rgba(56, 189, 248, 0.35)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 158,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          background: "#0b1428",
          touchAction: "none",
          cursor: "grab",
        }}
        onPointerDown={(e) => {
          stateRef.current.dragActive = true;
          stateRef.current.dragLastX = e.clientX;
          setAutoSpin(false);
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!stateRef.current.dragActive) return;
          const dx = e.clientX - stateRef.current.dragLastX;
          stateRef.current.dragLastX = e.clientX;
          stateRef.current.angleRad += dx * 0.015;
        }}
        onPointerUp={(e) => {
          stateRef.current.dragActive = false;
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
        }}
        onPointerCancel={() => {
          stateRef.current.dragActive = false;
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label={`${spec.name} 3D プレビュー`}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            borderRadius: 6,
            background: "rgba(10, 16, 28, 0.78)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            fontSize: 11,
            color: "#e0f2fe",
            pointerEvents: "none",
          }}
        >
          <WbIcon name="car" size={12} color="#38bdf8" />
          <strong>{spec.name}</strong>
          <span style={{ color: "#94a3b8" }}>
            {webglFallback ? "2.5D フォールバック" : "WebGL 2-Pass 3D"}
          </span>
        </div>
        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 8,
            fontSize: 10,
            color: "#94a3b8",
            background: "rgba(10, 16, 28, 0.72)",
            padding: "2px 7px",
            borderRadius: 5,
            pointerEvents: "none",
          }}
        >
          ドラッグで360°回転
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 8,
        }}
      >
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {RENDER_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="wb-mmo-btn"
              onClick={() => setRenderMode(m.id)}
              style={{
                padding: "3px 8px",
                fontSize: 10.5,
                background:
                  renderMode === m.id ? "rgba(56, 189, 248, 0.25)" : "rgba(30, 41, 59, 0.75)",
                border:
                  renderMode === m.id
                    ? "1px solid rgba(56, 189, 248, 0.75)"
                    : "1px solid rgba(148, 163, 184, 0.25)",
                color: renderMode === m.id ? "#e0f2fe" : "#94a3b8",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {PITCH_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="wb-mmo-btn"
              onClick={() => setPitchDeg(p)}
              style={{
                padding: "3px 7px",
                fontSize: 10.5,
                background: pitchDeg === p ? "rgba(250, 204, 21, 0.2)" : "rgba(30, 41, 59, 0.75)",
                border:
                  pitchDeg === p
                    ? "1px solid rgba(250, 204, 21, 0.7)"
                    : "1px solid rgba(148, 163, 184, 0.25)",
                color: pitchDeg === p ? "#fde047" : "#94a3b8",
              }}
            >
              {p}°
            </button>
          ))}
          <button
            type="button"
            className="wb-mmo-btn"
            onClick={() => setAutoSpin((s) => !s)}
            style={{
              padding: "3px 8px",
              fontSize: 10.5,
              background: autoSpin ? "rgba(74, 222, 128, 0.18)" : "rgba(30, 41, 59, 0.75)",
              border: autoSpin
                ? "1px solid rgba(74, 222, 128, 0.65)"
                : "1px solid rgba(148, 163, 184, 0.25)",
              color: autoSpin ? "#86efac" : "#94a3b8",
            }}
          >
            {autoSpin ? "自動回転 ON" : "自動回転 OFF"}
          </button>
        </div>
      </div>
    </div>
  );
}
