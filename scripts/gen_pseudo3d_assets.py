#!/usr/bin/env python3
"""Deterministic 3D SDF -> Pre-baked 2.5D WebP & WebGL Slice Atlas Generator for Takasumi WorldBox.

Uses the `anime-pseudo-3d` voxel SDF + 3-step cel shading + orthographic ray-stacking
pipeline to generate lossless WebP assets under `public/img/worldbox/` and QA sheets.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "public" / "img" / "worldbox"
TOOLKIT_CANDIDATES = [
    os.environ.get("WORLDBOX_PSEUDO3D_TOOLKIT", ""),
    "/tmp/anime-pseudo-3d",
    str(Path.home() / ".gemini" / "skills" / "anime-pseudo-3d"),
]

GPU_SDF = None
QA_VALIDATOR = None
for cand in TOOLKIT_CANDIDATES:
    if cand and (Path(cand) / "toolkit" / "gpu_sdf.py").is_file():
        sys.path.insert(0, cand)
        os.environ.setdefault("ANIME_3D_FORCE_CPU", "1")
        from toolkit import gpu_sdf as GPU_SDF  # type: ignore
        from toolkit import qa_validator as QA_VALIDATOR  # type: ignore
        break

OUTLINE_RGB = (22, 24, 44)


# ---------------------------------------------------------------------------
# SDF Math & Cel Shading Helpers (mirrors anime-pseudo-3d/toolkit/gpu_sdf.py)
# ---------------------------------------------------------------------------

def make_grid(W: int, L: int, H: int, y_offset: float = 0.0):
    if GPU_SDF is not None:
        return GPU_SDF.make_grid(W, L, H, y_offset=y_offset)
    zz, yy, xx = np.mgrid[0:H, 0:L, 0:W].astype(np.float32)
    X = xx - (W - 1) / 2.0
    Y = yy - (L - 1) / 2.0 - y_offset
    Z = zz + 0.5
    return X, Y, Z


def smin(a, b, k: float):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def sd_sphere(X, Y, Z, cx: float, cy: float, cz: float, r: float):
    return np.sqrt((X - cx) ** 2 + (Y - cy) ** 2 + (Z - cz) ** 2) - r


def sd_ellipsoid(X, Y, Z, cx: float, cy: float, cz: float, rx: float, ry: float, rz: float):
    px = (X - cx) / max(rx, 1e-4)
    py = (Y - cy) / max(ry, 1e-4)
    pz = (Z - cz) / max(rz, 1e-4)
    k0 = np.sqrt(px * px + py * py + pz * pz) + 1e-8
    k1 = np.sqrt((px / max(rx, 1e-4)) ** 2 + (py / max(ry, 1e-4)) ** 2 + (pz / max(rz, 1e-4)) ** 2) + 1e-8
    return k0 * (k0 - 1.0) / k1


def sd_capsule(X, Y, Z, ax: float, ay: float, az: float, bx: float, by: float, bz: float,
               r0: float, r1: float | None = None):
    pax, pay, paz = X - ax, Y - ay, Z - az
    bax, bay, baz = bx - ax, by - ay, bz - az
    ba_len2 = bax * bax + bay * bay + baz * baz + 1e-8
    h = np.clip((pax * bax + pay * bay + paz * baz) / ba_len2, 0.0, 1.0)
    dx = pax - bax * h
    dy = pay - bay * h
    dz = paz - baz * h
    r = r0 if r1 is None else (r0 + (r1 - r0) * h)
    return np.sqrt(dx * dx + dy * dy + dz * dz) - r


def sd_box(X, Y, Z, cx: float, cy: float, cz: float, hx: float, hy: float, hz: float, round_r: float = 0.0):
    qx = np.abs(X - cx) - (hx - round_r)
    qy = np.abs(Y - cy) - (hy - round_r)
    qz = np.abs(Z - cz) - (hz - round_r)
    outside = np.sqrt(np.maximum(qx, 0.0) ** 2 + np.maximum(qy, 0.0) ** 2 + np.maximum(qz, 0.0) ** 2)
    inside = np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0.0)
    return outside + inside - round_r


def sd_cylinder_z(X, Y, Z, cx: float, cy: float, z0: float, z1: float,
                  r0: float, r1: float | None = None):
    h_frac = np.clip((Z - z0) / max(z1 - z0, 1e-6), 0.0, 1.0)
    r = r0 if r1 is None else (r0 + (r1 - r0) * h_frac)
    d_rad = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) - r
    d_z = np.maximum(z0 - Z, Z - z1)
    return np.maximum(d_rad, d_z)


def sd_cylinder_x(X, Y, Z, x0: float, x1: float, cy: float, cz: float, r: float):
    d_rad = np.sqrt((Y - cy) ** 2 + (Z - cz) ** 2) - r
    d_x = np.maximum(x0 - X, X - x1)
    return np.maximum(d_rad, d_x)


def sd_cone_z(X, Y, Z, cx: float, cy: float, z0: float, z1: float, rx0: float, ry0: float, rx1: float, ry1: float):
    t = np.clip((Z - z0) / max(z1 - z0, 1e-6), 0.0, 1.0)
    rx = np.maximum(rx0 + (rx1 - rx0) * t, 0.25)
    ry = np.maximum(ry0 + (ry1 - ry0) * t, 0.25)
    dx = X - cx
    dy = Y - cy
    r_norm = np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
    r_avg = 0.5 * (rx + ry)
    d_rad = (r_norm - 1.0) * r_avg
    d_z = np.maximum(z0 - Z, Z - z1)
    return np.maximum(d_rad, d_z)


def sd_rect_gable_roof(X, Y, Z, cx: float, cy: float, z0: float, z1: float,
                       hx: float, hy: float, ridge_along_x: bool = True):
    """Rectangular pitched gable prism with ridge line at top (zero circular/oval distortion)."""
    t = np.clip((Z - z0) / max(z1 - z0, 1e-6), 0.0, 1.0)
    if ridge_along_x:
        d_x = np.abs(X - cx) - hx
        d_y = np.abs(Y - cy) - np.maximum(hy * (1.0 - t * 0.90), 1.5)
    else:
        d_x = np.abs(X - cx) - np.maximum(hx * (1.0 - t * 0.90), 1.5)
        d_y = np.abs(Y - cy) - hy
    d_z = np.maximum(z0 - Z, Z - z1)
    return np.maximum(np.maximum(d_x, d_y), d_z)


def sd_rect_hip_roof(X, Y, Z, cx: float, cy: float, z0: float, z1: float,
                     hx: float, hy: float, top_sx: float = 0.42, top_sy: float = 0.22):
    """Rectangular hipped/mansard roof converging cleanly toward a rectangular ridge cap."""
    t = np.clip((Z - z0) / max(z1 - z0, 1e-6), 0.0, 1.0)
    cur_hx = np.maximum(hx * (1.0 - t * (1.0 - top_sx)), 1.5)
    cur_hy = np.maximum(hy * (1.0 - t * (1.0 - top_sy)), 1.5)
    d_x = np.abs(X - cx) - cur_hx
    d_y = np.abs(Y - cy) - cur_hy
    d_z = np.maximum(z0 - Z, Z - z1)
    return np.maximum(np.maximum(d_x, d_y), d_z)


def compute_normals(sdf: np.ndarray):
    if GPU_SDF is not None:
        return GPU_SDF.compute_normals(sdf)
    gz = np.gradient(sdf, axis=0)
    gy = np.gradient(sdf, axis=1)
    gx = np.gradient(sdf, axis=2)
    nlen = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-8
    return gx / nlen, gy / nlen, gz / nlen


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_ramp(base: tuple[int, int, int]) -> tuple[tuple[int, int, int], ...]:
    """Produce (hi, base, sh, deep) crisp cel-shading ramp from an RGB color."""
    r, g, b = base
    if max(r, g, b) - min(r, g, b) <= 6:
        hi = (min(255, int(r * 1.18 + 20)), min(255, int(g * 1.18 + 20)), min(255, int(b * 1.18 + 20)))
        sh = (max(0, int(r * 0.78)), max(0, int(g * 0.78)), max(0, int(b * 0.78)))
        deep = (max(0, int(r * 0.60)), max(0, int(g * 0.60)), max(0, int(b * 0.60)))
        return hi, (r, g, b), sh, deep
    hi = (min(255, int(r * 1.18 + 26)), min(255, int(g * 1.18 + 24)), min(255, int(b * 1.16 + 22)))
    sh = (max(0, int(r * 0.74)), max(0, int(g * 0.73)), max(0, int(b * 0.80 + 4)))
    deep = (max(0, int(r * 0.52)), max(0, int(g * 0.51)), max(0, int(b * 0.62 + 6)))
    return hi, (r, g, b), sh, deep


def shade_parts(
    parts: list[tuple[np.ndarray, tuple[int, int, int] | str, bool]],
    light_dir: tuple[float, float, float] = (-0.28, 0.42, 0.86),
    global_ao: np.ndarray | float = 0.0,
) -> np.ndarray:
    """Composite ordered/minimum-SDF parts into a clean (H, L, W, 4) uint8 RGBA volume.

    Uses a continuous C0 union_sdf everywhere (inside <= 0 and outside > 0) so surface
    normals on shallow pitched roofs never suffer exterior sentinel-jump staircase artifacts.
    """
    H, L, W = parts[0][0].shape
    vol = np.zeros((H, L, W, 4), dtype=np.uint8)
    best_sdf = np.full((H, L, W), 1e6, dtype=np.float32)
    union_sdf = np.full((H, L, W), 1e6, dtype=np.float32)
    best_idx = np.full((H, L, W), -1, dtype=np.int16)

    for idx, (sdf, _, _) in enumerate(parts):
        union_sdf = np.minimum(union_sdf, sdf)
        mask = (sdf <= 0.0) & (sdf < best_sdf)
        best_sdf = np.where(mask, sdf, best_sdf)
        best_idx = np.where(mask, idx, best_idx)

    # Continuous union SDF for smooth surface normals across slopes & joins
    nx, ny, nz = compute_normals(union_sdf)
    lx, ly, lz = light_dir
    ndotl = nx * lx + ny * ly + nz * lz - global_ao * 0.35

    for idx, (_, col_spec, unlit) in enumerate(parts):
        pm = best_idx == idx
        if not pm.any():
            continue
        base = hex_to_rgb(col_spec) if isinstance(col_spec, str) else col_spec
        if unlit:
            vol[pm, :3] = np.array(base, dtype=np.uint8)
        else:
            hi, mid, sh, deep = rgb_ramp(base)
            vol[pm & (ndotl > 0.48), :3] = np.array(hi, dtype=np.uint8)
            vol[pm & (ndotl <= 0.48) & (ndotl >= 0.04), :3] = np.array(mid, dtype=np.uint8)
            vol[pm & (ndotl < 0.04) & (ndotl >= -0.34), :3] = np.array(sh, dtype=np.uint8)
            vol[pm & (ndotl < -0.34), :3] = np.array(deep, dtype=np.uint8)
        vol[pm, 3] = 255
    return vol


def assert_no_clipping(vol: np.ndarray, label: str, allow_z_min: bool = True):
    a = vol[..., 3] > 0
    hits = {}
    if a[:, :, 0].any():
        hits["x_min"] = int(a[:, :, 0].sum())
    if a[:, :, -1].any():
        hits["x_max"] = int(a[:, :, -1].sum())
    if a[:, 0, :].any():
        hits["y_min"] = int(a[:, 0, :].sum())
    if a[:, -1, :].any():
        hits["y_max"] = int(a[:, -1, :].sum())
    if a[-1, :, :].any():
        hits["z_max"] = int(a[-1, :, :].sum())
    if not allow_z_min and a[0, :, :].any():
        hits["z_min"] = int(a[0, :, :].sum())
    if hits:
        raise ValueError(f"Voxel clipping in '{label}': {hits}")


def save_webp(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="WEBP", lossless=True, quality=100, method=4)


def save_slice_atlas(vol: np.ndarray, path: Path, cols: int):
    H, L, W, _ = vol.shape
    rows = int(math.ceil(H / cols))
    atlas = np.zeros((rows * L, cols * W, 4), dtype=np.uint8)
    for z in range(H):
        r, c = z // cols, z % cols
        atlas[r * L:(r + 1) * L, c * W:(c + 1) * W] = vol[z]
    save_webp(Image.fromarray(atlas, "RGBA"), path)


# ---------------------------------------------------------------------------
# True 3D Orthographic Raycaster -> Crisp 2x-SSAA Pixel Sprite + 1px Outline
# ---------------------------------------------------------------------------

def render_iso_raycast(
    vol: np.ndarray,
    heading_deg: float,
    out_w: int,
    out_h: int,
    pitch_deg: float = 38.0,
    scale: float = 1.0,
    z_scale: float = 1.0,
    base_y_ratio: float = 0.72,
    outline_rgb: tuple[int, int, int] = OUTLINE_RGB,
    building_mode: bool = False,
) -> Image.Image:
    """Orthographic front-to-back raycaster from voxel volume to crisp pixel art.

    In regular mode (vehicles, horses, objects):
      Model nose (+Y) points along screen direction `heading_deg` where:
      0=East(+X), 90=South(+Y), 180=West(-X), 270=North(-Y).
      `sy_rel = gy * sin(pitch) - z * cos(pitch) * z_scale`.
    In `building_mode`:
      Ground footprint maps 1:1 to screen Y (`gy`), with Z extruded at `z_scale`
      upward (`sy_rel = gy - z * z_scale`), aligned so bottom of footprint lands cleanly.
    """
    H, L, W, _ = vol.shape
    ss = 2
    sw, sh = out_w * ss, out_h * ss

    cx_out = sw * 0.5
    cy_base = sh * base_y_ratio

    sin_p = 1.0 if building_mode else math.sin(math.radians(pitch_deg))
    cos_z = z_scale if building_mode else math.cos(math.radians(pitch_deg)) * z_scale

    rad = math.radians(heading_deg)
    dx = math.cos(rad)
    dy = math.sin(rad)

    xs = (np.arange(sw, dtype=np.float32) + 0.5 - cx_out) / (ss * scale)
    ys = (np.arange(sh, dtype=np.float32) + 0.5 - cy_base) / (ss * scale)
    sy_grid, sx_grid = np.meshgrid(ys, xs, indexing="ij")

    gx = sx_grid
    cx_v = (W - 1) * 0.5
    cy_v = (L - 1) * 0.5

    rgba_ss = np.zeros((sh, sw, 4), dtype=np.uint8)
    filled = np.zeros((sh, sw), dtype=bool)

    # March top-to-bottom along camera ray
    z_step = 0.45
    z_vals = np.arange(H - 0.55, -0.05, -z_step, dtype=np.float32)

    for zf in z_vals:
        if filled.all():
            break
        zi = int(np.clip(round(float(zf)), 0, H - 1))
        sl = vol[zi]
        if not (sl[..., 3] > 0).any():
            continue

        gy = (sy_grid + zf * cos_z) / sin_p
        mx = -dy * gx + dx * gy + cx_v
        my = dx * gx + dy * gy + cy_v

        mxi = np.rint(mx).astype(np.int32)
        myi = np.rint(my).astype(np.int32)

        inb = (~filled) & (mxi >= 0) & (mxi < W) & (myi >= 0) & (myi < L)
        if not inb.any():
            continue

        ry, rx = np.where(inb)
        sampled = sl[myi[ry, rx], mxi[ry, rx]]
        hit = sampled[:, 3] > 0
        if not hit.any():
            continue

        hy = ry[hit]
        hx = rx[hit]
        rgba_ss[hy, hx] = sampled[hit]
        filled[hy, hx] = True

    # Downsample 2x2 SSAA with sharp alpha cutout & weighted RGB
    blocks = rgba_ss.reshape(out_h, ss, out_w, ss, 4).transpose(0, 2, 1, 3, 4).reshape(out_h, out_w, 4, 4)
    a_cov = (blocks[..., 3] > 0).mean(axis=2)
    out = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    solid = a_cov >= 0.45

    if solid.any():
        # Color average over filled sub-samples (avoid blending transparent black)
        w = (blocks[..., 3] > 0).astype(np.float32)[..., None]
        w_sum = np.maximum(w.sum(axis=2), 1.0)
        rgb = (blocks[..., :3].astype(np.float32) * w).sum(axis=2) / w_sum
        out[solid, :3] = np.clip(np.rint(rgb[solid]), 0, 255).astype(np.uint8)
        out[solid, 3] = 255

    # Clean 1px outer silhouette outline matching WorldBox sprites
    m = out[..., 3] > 0
    pad = np.pad(m, 1)
    ring = (~m) & (pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:])
    out[ring] = (*outline_rgb, 255)
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------------------
# Scope A: Vehicles (4 models, 72x72x42 slices & 64x64 16-dir sheets)
# ---------------------------------------------------------------------------

def build_vehicle_electric_scooter() -> np.ndarray:
    W, L, H = 72, 72, 42
    X, Y, Z = make_grid(W, L, H)

    # Front (+Y) and Rear (-Y) wheels + cyan rims
    tire_f = sd_cylinder_x(X, Y, Z, -2.5, 2.5, 19.0, 5.2, 4.4)
    tire_r = sd_cylinder_x(X, Y, Z, -2.5, 2.5, -19.0, 5.2, 4.4)
    tires = np.minimum(tire_f, tire_r)
    hubs = np.minimum(
        sd_cylinder_x(X, Y, Z, -2.8, 2.8, 19.0, 5.2, 2.2),
        sd_cylinder_x(X, Y, Z, -2.8, 2.8, -19.0, 5.2, 2.2),
    )

    # Rear mudguard + fork
    fender_r = sd_box(X, Y, Z, 0, -18.5, 9.6, 2.6, 4.2, 1.4, 0.8)
    fork_f = sd_capsule(X, Y, Z, 0, 19.0, 5.5, 0, 16.5, 11.5, 2.0, 1.8)

    # Main cyan battery deck + dark anti-slip footpad
    deck = sd_box(X, Y, Z, 0, -1.0, 8.2, 5.8, 15.5, 1.8, 0.9)
    trim_side = np.minimum(
        sd_box(X, Y, Z, -5.6, -1.0, 8.2, 0.9, 14.0, 1.3, 0.4),
        sd_box(X, Y, Z, 5.6, -1.0, 8.2, 0.9, 14.0, 1.3, 0.4),
    )
    grip = sd_box(X, Y, Z, 0, -1.5, 9.9, 3.8, 12.2, 0.7, 0.3)

    # Stem column + neck brace
    stem = sd_capsule(X, Y, Z, 0, 16.5, 9.5, 0, 11.5, 33.5, 1.9, 1.6)
    stem_collar = sd_box(X, Y, Z, 0, 14.5, 14.5, 2.4, 2.4, 3.0, 0.7)

    # Handlebar + rubber grips + LED display & headlight + taillight
    hbar = sd_capsule(X, Y, Z, -11.0, 11.2, 33.5, 11.0, 11.2, 33.5, 1.4, 1.4)
    grips = np.minimum(
        sd_capsule(X, Y, Z, -12.8, 11.2, 33.5, -7.8, 11.2, 33.5, 1.9, 1.9),
        sd_capsule(X, Y, Z, 7.8, 11.2, 33.5, 12.8, 11.2, 33.5, 1.9, 1.9),
    )
    dash = sd_box(X, Y, Z, 0, 11.5, 34.4, 2.8, 2.0, 1.0, 0.4)
    headlight = sd_sphere(X, Y, Z, 0, 14.6, 28.0, 2.2)
    taillight = sd_box(X, Y, Z, 0, -21.8, 9.8, 2.0, 1.0, 1.0, 0.4)

    vol = shade_parts([
        (headlight, "#fef08a", True),
        (taillight, "#ef4444", True),
        (dash, "#38bdf8", True),
        (grips, "#1e293b", False),
        (grip, "#1e293b", False),
        (hubs, "#e2e8f0", False),
        (tires, "#0f172a", False),
        (trim_side, "#e2e8f0", False),
        (hbar, "#e2e8f0", False),
        (stem_collar, "#e2e8f0", False),
        (fender_r, "#334155", False),
        (fork_f, "#cbd5e1", False),
        (stem, "#06b6d4", False),
        (deck, "#06b6d4", False),
    ])
    assert_no_clipping(vol, "electric_scooter")
    return vol


def build_vehicle_delivery_moped() -> np.ndarray:
    W, L, H = 72, 72, 42
    X, Y, Z = make_grid(W, L, H)

    tires = np.minimum(
        sd_cylinder_x(X, Y, Z, -3.5, 3.5, 18.0, 6.2, 5.4),
        sd_cylinder_x(X, Y, Z, -3.5, 3.5, -16.5, 6.2, 5.4),
    )
    hubs = np.minimum(
        sd_cylinder_x(X, Y, Z, -3.8, 3.8, 18.0, 6.2, 2.8),
        sd_cylinder_x(X, Y, Z, -3.8, 3.8, -16.5, 6.2, 2.8),
    )
    floorboard = sd_box(X, Y, Z, 0, 2.0, 8.8, 6.4, 9.0, 1.6, 0.8)
    front_shield = sd_ellipsoid(X, Y, Z, 0, 14.5, 16.5, 6.5, 5.5, 10.2)
    front_mudguard = sd_ellipsoid(X, Y, Z, 0, 18.0, 10.5, 4.4, 5.5, 3.0)
    front_stripe = sd_box(X, Y, Z, 0, 19.6, 17.5, 1.8, 1.4, 5.2, 0.5)
    headlight = sd_sphere(X, Y, Z, 0, 19.8, 22.8, 2.6)

    # Cockpit & windshield
    handle_cowling = sd_ellipsoid(X, Y, Z, 0, 12.0, 27.5, 5.8, 3.8, 2.8)
    windshield = sd_box(X, Y, Z, 0, 13.8, 32.5, 4.8, 1.2, 3.6, 0.5)
    grips = np.minimum(
        sd_capsule(X, Y, Z, -10.5, 11.2, 27.5, -5.5, 11.8, 27.5, 1.6, 1.6),
        sd_capsule(X, Y, Z, 5.5, 11.8, 27.5, 10.5, 11.2, 27.5, 1.6, 1.6),
    )

    # Rear engine body + padded seat
    rear_body = sd_ellipsoid(X, Y, Z, 0, -10.5, 13.5, 6.8, 10.5, 5.2)
    seat = sd_ellipsoid(X, Y, Z, 0, -4.5, 18.8, 5.2, 6.8, 2.6)

    # Signature White Insulated Delivery Box with Red Stripe
    cargo_box = sd_box(X, Y, Z, 0, -15.5, 25.5, 8.8, 8.2, 7.2, 1.2)
    cargo_lid = sd_box(X, Y, Z, 0, -15.5, 32.5, 9.2, 8.6, 1.4, 0.6)
    cargo_stripe = sd_box(X, Y, Z, 0, -15.5, 25.2, 9.1, 8.5, 1.6, 0.3)
    taillight = sd_box(X, Y, Z, 0, -21.2, 15.0, 3.6, 1.4, 1.4, 0.5)

    vol = shade_parts([
        (headlight, "#fef08a", True),
        (taillight, "#ef4444", True),
        (windshield, "#bae6fd", False),
        (grips, "#1e293b", False),
        (seat, "#1e293b", False),
        (hubs, "#cbd5e1", False),
        (tires, "#0f172a", False),
        (floorboard, "#334155", False),
        (cargo_stripe, "#ef4444", False),
        (cargo_lid, "#f8fafc", False),
        (cargo_box, "#f1f5f9", False),
        (front_stripe, "#ffffff", False),
        (handle_cowling, "#ef4444", False),
        (front_shield, "#ef4444", False),
        (front_mudguard, "#ef4444", False),
        (rear_body, "#ef4444", False),
    ])
    assert_no_clipping(vol, "delivery_moped")
    return vol


def build_vehicle_cargo_truck() -> np.ndarray:
    W, L, H = 72, 72, 42
    X, Y, Z = make_grid(W, L, H)

    # 4 Industrial Truck Wheels (2 axles x left/right)
    w_fl = sd_cylinder_x(X, Y, Z, -14.8, -9.2, 15.5, 6.2, 5.6)
    w_fr = sd_cylinder_x(X, Y, Z, 9.2, 14.8, 15.5, 6.2, 5.6)
    w_rl = sd_cylinder_x(X, Y, Z, -14.8, -9.2, -14.5, 6.2, 5.6)
    w_rr = sd_cylinder_x(X, Y, Z, 9.2, 14.8, -14.5, 6.2, 5.6)
    tires = np.minimum(np.minimum(w_fl, w_fr), np.minimum(w_rl, w_rr))

    hubs = np.minimum(
        np.minimum(
            sd_cylinder_x(X, Y, Z, -15.1, -9.0, 15.5, 6.2, 2.8),
            sd_cylinder_x(X, Y, Z, 9.0, 15.1, 15.5, 6.2, 2.8),
        ),
        np.minimum(
            sd_cylinder_x(X, Y, Z, -15.1, -9.0, -14.5, 6.2, 2.8),
            sd_cylinder_x(X, Y, Z, 9.0, 15.1, -14.5, 6.2, 2.8),
        ),
    )

    chassis = sd_box(X, Y, Z, 0, -0.5, 8.8, 11.8, 25.0, 2.4, 0.8)
    bumpers = np.minimum(
        sd_box(X, Y, Z, 0, 25.2, 7.6, 13.4, 1.8, 2.0, 0.7),
        sd_box(X, Y, Z, 0, -26.0, 7.6, 13.4, 1.8, 2.0, 0.7),
    )

    # Heavy Amber Forward Cab (+Y)
    cab_lower = sd_box(X, Y, Z, 0, 16.0, 15.8, 12.6, 9.0, 6.8, 1.4)
    cab_upper = sd_box(X, Y, Z, 0, 14.2, 26.2, 11.8, 7.2, 5.2, 1.4)
    windshield = sd_box(X, Y, Z, 0, 19.8, 26.2, 10.6, 2.2, 3.8, 0.7)
    side_win = np.minimum(
        sd_box(X, Y, Z, -11.6, 14.8, 26.2, 0.9, 4.6, 3.4, 0.4),
        sd_box(X, Y, Z, 11.6, 14.8, 26.2, 0.9, 4.6, 3.4, 0.4),
    )
    mirrors = np.minimum(
        sd_box(X, Y, Z, -14.2, 18.8, 24.5, 1.2, 1.4, 2.8, 0.4),
        sd_box(X, Y, Z, 14.2, 18.8, 24.5, 1.2, 1.4, 2.8, 0.4),
    )
    grille = sd_box(X, Y, Z, 0, 24.9, 13.8, 7.2, 0.8, 3.0, 0.4)
    headlights = np.minimum(
        sd_box(X, Y, Z, -9.6, 24.8, 13.0, 2.0, 0.9, 1.4, 0.4),
        sd_box(X, Y, Z, 9.6, 24.8, 13.0, 2.0, 0.9, 1.4, 0.4),
    )
    cab_lights = np.minimum(
        sd_sphere(X, Y, Z, -5.5, 17.5, 31.8, 1.2),
        np.minimum(sd_sphere(X, Y, Z, 0.0, 17.5, 31.8, 1.2), sd_sphere(X, Y, Z, 5.5, 17.5, 31.8, 1.2)),
    )

    # Rear Industrial Container + Cargo Trim + Taillights
    cargo = sd_box(X, Y, Z, 0, -9.5, 22.8, 13.6, 16.0, 12.2, 1.1)
    cargo_stripe = sd_box(X, Y, Z, 0, -9.5, 22.5, 14.0, 15.2, 2.2, 0.4)
    cargo_roof_cap = sd_box(X, Y, Z, 0, -9.5, 35.0, 13.0, 15.2, 1.2, 0.5)
    taillights = np.minimum(
        sd_box(X, Y, Z, -9.8, -25.8, 12.2, 2.2, 0.9, 1.5, 0.3),
        sd_box(X, Y, Z, 9.8, -25.8, 12.2, 2.2, 0.9, 1.5, 0.3),
    )

    vol = shade_parts([
        (headlights, "#fef08a", True),
        (taillights, "#ef4444", True),
        (cab_lights, "#fde047", True),
        (windshield, "#bae6fd", False),
        (side_win, "#bae6fd", False),
        (grille, "#1e293b", False),
        (mirrors, "#334155", False),
        (bumpers, "#334155", False),
        (hubs, "#94a3b8", False),
        (tires, "#0f172a", False),
        (chassis, "#334155", False),
        (cargo_stripe, "#334155", False),
        (cargo_roof_cap, "#fbbf24", False),
        (cargo, "#f59e0b", False),
        (cab_upper, "#f59e0b", False),
        (cab_lower, "#f59e0b", False),
    ])
    assert_no_clipping(vol, "cargo_truck")
    return vol


def build_vehicle_police_cruiser(siren_alt: bool = False) -> np.ndarray:
    W, L, H = 72, 72, 42
    X, Y, Z = make_grid(W, L, H)

    # 4 Wheels + alloy hubs
    tires = np.minimum(
        np.minimum(
            sd_cylinder_x(X, Y, Z, -13.8, -8.8, 15.2, 5.4, 4.9),
            sd_cylinder_x(X, Y, Z, 8.8, 13.8, 15.2, 5.4, 4.9),
        ),
        np.minimum(
            sd_cylinder_x(X, Y, Z, -13.8, -8.8, -14.8, 5.4, 4.9),
            sd_cylinder_x(X, Y, Z, 8.8, 13.8, -14.8, 5.4, 4.9),
        ),
    )
    hubs = np.minimum(
        np.minimum(
            sd_cylinder_x(X, Y, Z, -14.1, -8.5, 15.2, 5.4, 2.5),
            sd_cylinder_x(X, Y, Z, 8.5, 14.1, 15.2, 5.4, 2.5),
        ),
        np.minimum(
            sd_cylinder_x(X, Y, Z, -14.1, -8.5, -14.8, 5.4, 2.5),
            sd_cylinder_x(X, Y, Z, 8.5, 14.1, -14.8, 5.4, 2.5),
        ),
    )

    # Sleek Interceptor Sedan Body
    hood_trunk = sd_box(X, Y, Z, 0, 0.0, 12.2, 12.6, 24.5, 5.8, 2.2)
    push_bar = sd_box(X, Y, Z, 0, 25.4, 10.5, 7.6, 1.5, 3.2, 0.6)
    white_doors = sd_box(X, Y, Z, 0, -0.5, 13.0, 12.9, 10.5, 5.2, 1.4)
    gold_badge = np.minimum(
        sd_cylinder_z(X, Y, Z, -13.0, 0.0, 11.2, 15.0, 1.8),
        sd_cylinder_z(X, Y, Z, 13.0, 0.0, 11.2, 15.0, 1.8),
    )

    # Sloped Greenhouse Cabin + White Patrol Roof
    cabin_dark = sd_box(X, Y, Z, 0, -1.5, 20.8, 10.8, 12.2, 4.6, 2.2)
    roof_white = sd_box(X, Y, Z, 0, -2.0, 24.8, 10.4, 10.8, 1.8, 1.0)
    windshield = sd_box(X, Y, Z, 0, 10.2, 20.5, 9.6, 2.6, 3.2, 0.7)
    rear_win = sd_box(X, Y, Z, 0, -13.2, 20.5, 9.4, 2.4, 3.0, 0.7)
    side_win = np.minimum(
        sd_box(X, Y, Z, -10.8, -1.5, 20.6, 0.9, 9.6, 2.8, 0.4),
        sd_box(X, Y, Z, 10.8, -1.5, 20.6, 0.9, 9.6, 2.8, 0.4),
    )

    headlights = np.minimum(
        sd_box(X, Y, Z, -9.2, 24.2, 12.6, 2.4, 1.0, 1.5, 0.4),
        sd_box(X, Y, Z, 9.2, 24.2, 12.6, 2.4, 1.0, 1.5, 0.4),
    )
    taillights = np.minimum(
        sd_box(X, Y, Z, -8.8, -24.4, 13.0, 2.8, 1.0, 1.4, 0.4),
        sd_box(X, Y, Z, 8.8, -24.4, 13.0, 2.8, 1.0, 1.4, 0.4),
    )

    # Police Lightbar
    bar_mount = sd_box(X, Y, Z, 0, 0.0, 27.2, 9.8, 2.2, 0.9, 0.4)
    siren_l = sd_box(X, Y, Z, -5.2, 0.0, 29.2, 4.4, 2.1, 1.6, 0.7)
    siren_c = sd_box(X, Y, Z, 0.0, 0.0, 29.2, 1.6, 2.1, 1.6, 0.5)
    siren_r = sd_box(X, Y, Z, 5.2, 0.0, 29.2, 4.4, 2.1, 1.6, 0.7)

    col_l = "#38bdf8" if siren_alt else "#ef4444"
    col_r = "#ef4444" if siren_alt else "#38bdf8"

    vol = shade_parts([
        (siren_l, col_l, True),
        (siren_r, col_r, True),
        (siren_c, "#f8fafc", True),
        (headlights, "#fef08a", True),
        (taillights, "#ef4444", True),
        (gold_badge, "#facc15", True),
        (windshield, "#bae6fd", False),
        (rear_win, "#bae6fd", False),
        (side_win, "#bae6fd", False),
        (push_bar, "#334155", False),
        (bar_mount, "#334155", False),
        (hubs, "#e2e8f0", False),
        (tires, "#0f172a", False),
        (roof_white, "#f8fafc", False),
        (white_doors, "#f8fafc", False),
        (cabin_dark, "#0f172a", False),
        (hood_trunk, "#0f172a", False),
    ])
    assert_no_clipping(vol, "police_cruiser")
    return vol


# ---------------------------------------------------------------------------
# Scope B: Horse Racing (8 coats x 16 dir x 4 gallop frames, 64x64x48)
# ---------------------------------------------------------------------------

COAT_CONFIGS = [
    ("bay", "#8a5a2b", "#261912"),
    ("chestnut", "#c07a30", "#8a4a18"),
    ("dark_bay", "#4a3220", "#1e1612"),
    ("grey", "#b9bcc2", "#747b86"),
    ("brown", "#3a2e28", "#1a1412"),
    ("black", "#23232b", "#14141a"),
    ("liver_chestnut", "#6e3b16", "#3d1e0a"),
    ("white", "#f2f2ee", "#d4d4d8"),
]


def build_horse_frame(coat_hex: str, mane_hex: str, frame_idx: int) -> np.ndarray:
    W, L, H = 64, 64, 48
    X, Y, Z = make_grid(W, L, H)

    # 4-beat gallop kinematics
    phase = (frame_idx / 4.0) * math.tau
    bob = math.sin(phase - 0.6) * 1.8 + 1.5
    pitch_body = math.sin(phase) * 2.2
    front_swing = math.sin(phase) * 7.5
    rear_swing = -math.sin(phase + 0.6) * 7.5
    tail_lift = math.cos(phase) * 3.0

    bz = 18.0 + bob

    # Muscled torso + chest + croup
    chest = sd_ellipsoid(X, Y, Z, 0.0, 6.2, bz + pitch_body * 0.2, 6.4, 7.6, 6.8)
    barrel = sd_ellipsoid(X, Y, Z, 0.0, -1.2, bz, 6.2, 9.4, 6.4)
    croup = sd_ellipsoid(X, Y, Z, 0.0, -9.2, bz - pitch_body * 0.2, 6.3, 6.8, 6.5)
    body = smin(smin(chest, barrel, 2.2), croup, 2.2)

    # Neck & head
    head_nod = math.sin(phase + 0.8) * 1.4
    neck = sd_capsule(X, Y, Z, 0.0, 9.0, bz + 2.2, 0.0, 15.8, bz + 12.2 + head_nod, 4.4, 3.0)
    head_base = sd_ellipsoid(X, Y, Z, 0.0, 17.5, bz + 12.8 + head_nod, 3.0, 4.4, 3.4)
    muzzle = sd_capsule(X, Y, Z, 0.0, 17.5, bz + 12.8 + head_nod, 0.0, 23.0, bz + 9.2 + head_nod, 2.9, 1.9)
    head = smin(head_base, muzzle, 1.2)
    ears = np.minimum(
        sd_capsule(X, Y, Z, -2.0, 15.8, bz + 15.4 + head_nod, -2.3, 15.6, bz + 19.2 + head_nod, 1.1, 0.5),
        sd_capsule(X, Y, Z, 2.0, 15.8, bz + 15.4 + head_nod, 2.3, 15.6, bz + 19.2 + head_nod, 1.1, 0.5),
    )

    body_all = smin(body, smin(neck, head, 1.5), 1.2)
    body_all = np.minimum(body_all, ears)

    # Animated 4 legs (fore & hind with hooves)
    leg_fl = sd_capsule(X, Y, Z, -3.4, 7.8, bz - 2.5, -3.4, 9.2 + front_swing, 7.2 + max(0.0, front_swing * 0.45), 2.1, 1.4)
    leg_fr = sd_capsule(X, Y, Z, 3.4, 7.8, bz - 2.5, 3.4, 7.0 + front_swing * 0.75, 6.2 + max(0.0, front_swing * 0.35), 2.1, 1.4)
    leg_rl = sd_capsule(X, Y, Z, -3.6, -9.8, bz - 2.5, -3.6, -10.8 + rear_swing, 6.8 + max(0.0, -rear_swing * 0.4), 2.3, 1.5)
    leg_rr = sd_capsule(X, Y, Z, 3.6, -9.8, bz - 2.5, 3.6, -8.5 + rear_swing * 0.75, 6.0 + max(0.0, -rear_swing * 0.3), 2.3, 1.5)
    legs = np.minimum(np.minimum(leg_fl, leg_fr), np.minimum(leg_rl, leg_rr))

    hooves = np.minimum(
        np.minimum(
            sd_sphere(X, Y, Z, -3.4, 9.2 + front_swing, 6.6 + max(0.0, front_swing * 0.45), 1.6),
            sd_sphere(X, Y, Z, 3.4, 7.0 + front_swing * 0.75, 5.6 + max(0.0, front_swing * 0.35), 1.6),
        ),
        np.minimum(
            sd_sphere(X, Y, Z, -3.6, -10.8 + rear_swing, 6.2 + max(0.0, -rear_swing * 0.4), 1.6),
            sd_sphere(X, Y, Z, 3.6, -8.5 + rear_swing * 0.75, 5.4 + max(0.0, -rear_swing * 0.3), 1.6),
        ),
    )

    # Flowing Mane & Streaming Tail
    mane = smin(
        sd_capsule(X, Y, Z, 0.0, 14.2, bz + 15.6 + head_nod, 0.0, 8.2, bz + 7.2, 2.2, 2.0),
        sd_capsule(X, Y, Z, 0.0, 10.2, bz + 11.2, 0.0, 6.0, bz + 8.0 + tail_lift * 0.2, 2.0, 1.4),
        1.2,
    )
    tail = smin(
        sd_capsule(X, Y, Z, 0.0, -14.5, bz + 1.8, 0.0, -21.0, bz + 2.5 + tail_lift * 0.5, 2.3, 1.9),
        sd_capsule(X, Y, Z, 0.0, -20.0, bz + 2.4 + tail_lift * 0.5, 0.0, -25.8, bz - 1.2 + tail_lift * 0.8, 1.8, 1.0),
        1.4,
    )

    # Saddle & white saddle pad + bridle strap
    saddle_pad = sd_box(X, Y, Z, 0.0, -0.5, bz + 5.6, 6.8, 5.2, 1.8, 1.0)
    saddle = sd_box(X, Y, Z, 0.0, -0.2, bz + 6.9, 5.6, 3.8, 1.4, 0.9)
    bridle = sd_capsule(X, Y, Z, 0.0, 20.5, bz + 11.2 + head_nod, 0.0, 20.8, bz + 10.6 + head_nod, 2.2, 2.2)

    vol = shade_parts([
        (saddle, "#5c3a21", False),
        (saddle_pad, "#f8fafc", False),
        (bridle, "#332218", False),
        (hooves, "#1e1b2e", False),
        (mane, mane_hex, False),
        (tail, mane_hex, False),
        (legs, coat_hex, False),
        (body_all, coat_hex, False),
    ])
    assert_no_clipping(vol, f"horse_{coat_hex}_f{frame_idx}")
    return vol


# ---------------------------------------------------------------------------
# Scope C: Settlement Buildings (8 kinds x 4 facings, 32px/tile base)
# ---------------------------------------------------------------------------

# Neutral building colors + pure grayscale roof on house/cottage so client can
# smoothly tint roofs/walls by biome theme if desired, while base looks vivid.
GRAY_ROOF = "#969696"
GRAY_WALL = "#e4e4e4"


def build_settlement_building(kind: str, facing: str) -> np.ndarray:
    """Sculpt a rectangular 3D architectural building matching tile footprint `w*24 x h*24`."""
    is_wide = kind in ("city_hall", "vehicle_dealer")
    tiles_w = 6 if is_wide else 5
    tiles_h = 4
    T = 24
    base_hw = tiles_w * T * 0.5
    base_hl = tiles_h * T * 0.5
    W = int(tiles_w * T + 24)
    L = int(tiles_h * T + 24)
    H = 68
    X, Y, Z = make_grid(W, L, H)

    if facing == "s":
        f_dx, f_dy = 0.0, 1.0
    elif facing == "n":
        f_dx, f_dy = 0.0, -1.0
    elif facing == "e":
        f_dx, f_dy = 1.0, 0.0
    else:
        f_dx, f_dy = -1.0, 0.0

    # Raised masonry foundation + taller visible walls + corner pilasters
    plinth = sd_box(X, Y, Z, 0, 0, 3.0, base_hw - 2.0, base_hl - 2.0, 3.0, 0.5)
    wall_h = 28.0 if kind in ("city_hall", "vehicle_dealer") else 24.0
    wall = sd_box(X, Y, Z, 0, 0, 4.0 + wall_h * 0.5, base_hw - 3.2, base_hl - 3.2, wall_h * 0.5, 0.8)
    eaves = sd_box(X, Y, Z, 0, 0, wall_h + 3.8, base_hw - 1.2, base_hl - 1.2, 1.2, 0.4)

    parts: list[tuple[np.ndarray, tuple[int, int, int] | str, bool]] = []

    def add_windows(col: str, count: int = 3, y_pos: float | None = None, z_mid: float = 15.0):
        yp = (base_hl - 2.6) if y_pos is None else y_pos
        span = (base_hw - 16.0) * 2.0
        for wi in range(count):
            wx = -span * 0.5 + (wi + 0.5) * (span / count)
            frame = sd_box(X, Y, Z, wx, yp, z_mid, 5.6, 1.4, 5.2, 0.3)
            pane = sd_box(X, Y, Z, wx, yp + 0.4, z_mid, 4.2, 1.4, 3.8, 0.2)
            parts.append((pane, col, False))
            parts.append((frame, "#1e293b", False))

    def add_portico(z_center: float, span: float, color: str, stripe_col: str | None = None):
        if f_dx != 0:
            ax, ay = f_dx * (base_hw - 0.5), 0.0
            hx, hy = 4.6, span
        else:
            ax, ay = 0.0, f_dy * (base_hl - 0.5)
            hx, hy = span, 4.6
        box = sd_box(X, Y, Z, ax, ay, z_center, hx, hy, 2.0, 0.7)
        parts.append((box, color, False))
        if stripe_col:
            # Crisp alternating vertical trim ribs
            rib_count = 5
            for ri in range(rib_count):
                if ri % 2 == 1:
                    continue
                off = (-1.0 + 2.0 * ri / max(1, rib_count - 1)) * (span * 0.75)
                rx_i = ax if f_dx != 0 else off
                ry_i = off if f_dx != 0 else ay
                rib = sd_box(
                    X, Y, Z, rx_i, ry_i, z_center + 0.9,
                    max(1.2, hx * 0.85 if f_dx != 0 else span / (rib_count * 1.6)),
                    max(1.2, hy * 0.85 if f_dy != 0 else span / (rib_count * 1.6)),
                    1.2, 0.2,
                )
                parts.append((rib, stripe_col, False))

    if kind == "vehicle_dealer":
        roof_col, accent_col = "#0284c7", "#38bdf8"
        roof_slab = sd_box(X, Y, Z, 0, 0, wall_h + 6.5, base_hw - 0.6, base_hl - 0.6, 3.2, 0.7)
        roof_cap = sd_box(X, Y, Z, 0, 0, wall_h + 9.5, base_hw - 8.0, base_hl - 8.0, 1.8, 0.5)
        neon_trim = sd_box(X, Y, Z, 0, 0, wall_h + 4.4, base_hw - 0.2, base_hl - 0.2, 0.9, 0.2)
        c_hx, c_hy = (8.5, 16.0) if f_dx != 0 else (16.0, 8.5)
        car_body = sd_box(X, Y, Z, 0, 0, wall_h + 14.0, c_hx, c_hy, 3.4, 1.3)
        car_top = sd_box(X, Y, Z, -f_dy * 1.5, -f_dx * 1.5, wall_h + 18.8, c_hx * 0.56, c_hy * 0.72, 2.4, 1.0)
        glass_s = sd_box(X, Y, Z, 0, base_hl - 2.6, 15.5, base_hw - 12.0, 1.3, 8.8, 0.4)
        glass_frame = sd_box(X, Y, Z, 0, base_hl - 2.9, 15.5, base_hw - 10.0, 1.2, 10.2, 0.4)
        if f_dx != 0:
            parts.append((sd_box(X, Y, Z, f_dx * (base_hw - 2.6), 0, 15.5, 1.4, base_hl - 12.0, 8.8, 0.4), "#bae6fd", False))
        parts.extend([
            (glass_s, "#bae6fd", False),
            (glass_frame, "#0f172a", False),
            (neon_trim, accent_col, True),
            (car_top, "#e0f2fe", False),
            (car_body, accent_col, False),
            (roof_cap, "#0369a1", False),
            (roof_slab, roof_col, False),
        ])
    elif kind == "city_hall":
        roof1 = sd_rect_hip_roof(X, Y, Z, 0, 0, wall_h + 4.2, wall_h + 14.0, base_hw - 0.5, base_hl - 0.5, 0.55, 0.45)
        tower = sd_box(X, Y, Z, 0, -2.0, wall_h + 19.5, 15.5, 13.5, 7.5, 0.8)
        clock_rim = sd_cylinder_z(X, Y, Z, 0, 11.4, wall_h + 16.5, wall_h + 23.0, 5.2)
        clock_face = sd_cylinder_z(X, Y, Z, 0, 11.8, wall_h + 17.2, wall_h + 22.3, 4.0)
        spire = sd_rect_hip_roof(X, Y, Z, 0, -2.0, wall_h + 26.8, wall_h + 36.5, 16.0, 14.0, 0.12, 0.12)
        pillars = None
        for px in (-base_hw + 14, -22.0, 22.0, base_hw - 14):
            p = sd_cylinder_z(X, Y, Z, px, base_hl - 2.2, 3.0, wall_h + 3.5, 2.7)
            pillars = p if pillars is None else np.minimum(pillars, p)
        add_windows("#bae6fd", count=4, z_mid=15.0)
        parts.extend([
            (clock_face, "#fef08a", True),
            (clock_rim, "#312e81", False),
            (spire, "#3730a3", False),
            (tower, "#e0e7ff", False),
            (pillars, "#f8fafc", False),
            (roof1, "#4f46e5", False),
        ])
    elif kind == "convenience":
        roof = sd_box(X, Y, Z, 0, 0, wall_h + 6.0, base_hw - 0.8, base_hl - 0.8, 2.8, 0.6)
        parapet = sd_box(
            X, Y, Z,
            f_dx * (base_hw - 5.0),
            f_dy * (base_hl - 4.0),
            wall_h + 10.5,
            4.2 if f_dx != 0 else 24.0,
            20.0 if f_dx != 0 else 4.2,
            3.2,
            0.6,
        )
        stripe = sd_box(X, Y, Z, 0, 0, wall_h + 4.2, base_hw - 0.3, base_hl - 0.3, 1.1, 0.2)
        add_portico(17.5, base_hl - 10.0 if f_dx != 0 else base_hw - 10.0, "#0d9488", "#f8fafc")
        store_win = sd_box(X, Y, Z, 0, base_hl - 2.6, 11.5, base_hw - 14.0, 1.3, 5.2, 0.3)
        store_frame = sd_box(X, Y, Z, 0, base_hl - 2.9, 11.5, base_hw - 12.2, 1.2, 6.2, 0.3)
        ac_unit = sd_box(X, Y, Z, -24.0, -14.0, wall_h + 10.2, 7.5, 6.0, 3.0, 0.5)
        parts.extend([
            (store_win, "#bae6fd", False),
            (store_frame, "#1e293b", False),
            (stripe, "#2dd4bf", True),
            (parapet, "#115e59", False),
            (ac_unit, "#cbd5e1", False),
            (roof, "#0f766e", False),
        ])
    elif kind == "cafe":
        ridge_x = f_dx == 0
        roof = sd_rect_hip_roof(X, Y, Z, 0, 0, wall_h + 4.0, wall_h + 18.0, base_hw + 0.5, base_hl + 0.5, 0.55 if ridge_x else 0.16, 0.16 if ridge_x else 0.55)
        ridge_beam = sd_box(
            X, Y, Z, 0, 0, wall_h + 18.4,
            base_hw * 0.55 if ridge_x else 4.0,
            4.0 if ridge_x else base_hl * 0.55,
            1.4, 0.4,
        )
        add_portico(17.0, base_hl - 10.0 if f_dx != 0 else base_hw - 12.0, "#ea580c", "#f8fafc")
        cup_sign = sd_cylinder_z(
            X, Y, Z,
            f_dx * (base_hw - 16.0) if f_dx != 0 else 22.0,
            f_dy * (base_hl - 12.0) if f_dy != 0 else 10.0,
            wall_h + 12.0,
            wall_h + 20.5,
            5.6,
            4.2,
        )
        add_windows("#fde68a", count=3, z_mid=11.5)
        parts.extend([
            (cup_sign, "#f8fafc", False),
            (ridge_beam, "#9a3412", False),
            (roof, "#c2410c", False),
        ])
    elif kind == "bank_kiosk":
        cornice = sd_box(X, Y, Z, 0, 0, wall_h + 5.5, base_hw + 0.2, base_hl + 0.2, 2.5, 0.6)
        roof = sd_rect_hip_roof(X, Y, Z, 0, 0, wall_h + 7.5, wall_h + 18.0, base_hw - 5.0, base_hl - 5.0, 0.45, 0.35)
        finial = sd_box(X, Y, Z, 0, -2.0, wall_h + 20.5, 10.0, 7.0, 2.6, 0.8)
        finial_gold = sd_sphere(X, Y, Z, 0, -2.0, wall_h + 24.5, 3.4)
        cols = None
        for cx_p in (-42.0, -16.0, 16.0, 42.0):
            c = sd_cylinder_z(X, Y, Z, cx_p, base_hl - 2.2, 3.0, wall_h + 3.5, 2.8)
            cols = c if cols is None else np.minimum(cols, c)
        add_windows("#fef08a", count=2, z_mid=14.0)
        parts.extend([
            (finial_gold, "#fde047", True),
            (finial, "#d97706", False),
            (cols, "#f8fafc", False),
            (roof, "#b45309", False),
            (cornice, "#92400e", False),
        ])
    elif kind == "smith_workshop":
        roof = sd_rect_gable_roof(X, Y, Z, 0, 0, wall_h + 4.0, wall_h + 18.0, base_hw + 0.5, base_hl + 0.5, ridge_along_x=(f_dx == 0))
        ridge_beam = sd_box(X, Y, Z, 0, 0, wall_h + 18.2, base_hw + 0.8 if f_dx == 0 else 4.2, 4.2 if f_dx == 0 else base_hl + 0.8, 1.4, 0.3)
        chimney = sd_box(X, Y, Z, -28.0, -16.0, wall_h + 15.5, 8.2, 8.2, 10.5, 0.8)
        chimney_lip = sd_box(X, Y, Z, -28.0, -16.0, wall_h + 26.2, 9.4, 9.4, 1.5, 0.4)
        ember = sd_cylinder_z(X, Y, Z, -28.0, -16.0, wall_h + 25.0, wall_h + 28.0, 4.8)
        forge_glow = sd_box(
            X, Y, Z,
            f_dx * (base_hw - 2.2) if f_dx != 0 else 20.0,
            f_dy * (base_hl - 2.2) if f_dy != 0 else base_hl - 2.2,
            11.0,
            1.6 if f_dx != 0 else 9.0,
            9.0 if f_dx != 0 else 1.6,
            5.5,
            0.6,
        )
        add_windows("#fed7aa", count=2, z_mid=13.5)
        parts.extend([
            (ember, "#fb923c", True),
            (forge_glow, "#f97316", True),
            (chimney_lip, "#451a03", False),
            (chimney, "#78350f", False),
            (ridge_beam, "#451a03", False),
            (roof, "#7c2d12", False),
        ])
    elif kind == "house":
        ridge_x = f_dx == 0
        roof = sd_rect_hip_roof(X, Y, Z, 0, 0, wall_h + 4.0, wall_h + 20.0, base_hw + 1.0, base_hl + 1.0, 0.56 if ridge_x else 0.14, 0.14 if ridge_x else 0.56)
        dormer_y = -18.0 if facing == "n" else 18.0
        dormer_x = f_dx * 20.0 if f_dx != 0 else 0.0
        dormer = sd_box(X, Y, Z, dormer_x, dormer_y, wall_h + 11.5, 11.0, 9.0, 5.2, 0.6)
        dormer_win = sd_box(X, Y, Z, dormer_x, dormer_y + (8.6 if dormer_y >= 0 else -8.6), wall_h + 11.0, 5.4, 1.4, 3.2, 0.2)
        chimney = sd_box(X, Y, Z, 32.0, -14.0, wall_h + 14.0, 5.2, 5.2, 7.5, 0.5)
        add_windows("#bae6fd", count=3, z_mid=14.5)
        parts.extend([
            (dormer_win, "#bae6fd", False),
            (chimney, "#7f1d1d", False),
            (dormer, GRAY_WALL, False),
            (roof, GRAY_ROOF, False),
        ])
    else:  # cottage
        roof = sd_rect_gable_roof(X, Y, Z, 0, 0, wall_h + 3.5, wall_h + 19.5, base_hw + 1.2, base_hl + 1.2, ridge_along_x=(f_dx == 0))
        chimney = sd_box(X, Y, Z, -28.0, -12.0, wall_h + 13.0, 4.8, 4.8, 6.8, 0.5)
        flower_box = sd_box(X, Y, Z, -22.0 if f_dx <= 0 else 22.0, base_hl - 1.8, 10.5, 8.2, 2.2, 2.2, 0.4)
        flowers = sd_box(X, Y, Z, -22.0 if f_dx <= 0 else 22.0, base_hl - 1.8, 13.0, 7.4, 1.8, 1.4, 0.5)
        add_windows("#fef08a", count=2, z_mid=14.0)
        parts.extend([
            (flowers, "#f472b6", False),
            (flower_box, "#78350f", False),
            (chimney, "#9a3412", False),
            (roof, GRAY_ROOF, False),
        ])

    if kind not in ("convenience", "cafe"):
        add_portico(18.0, 14.0, "#475569")

    parts.append((eaves, "#334155", False))
    parts.append((wall, GRAY_WALL if kind in ("house", "cottage") else "#f1f5f9", False))
    parts.append((plinth, "#475569", False))

    vol = shade_parts(parts)
    assert_no_clipping(vol, f"building_{kind}_{facing}")

    out_w = tiles_w * 28 + 8
    out_h = tiles_h * 28 + 60
    img = render_iso_raycast(
        vol,
        heading_deg=90.0,
        out_w=out_w,
        out_h=out_h,
        scale=28.0 / T,
        z_scale=0.84,
        base_y_ratio=(out_h - 4 - tiles_h * 14) / out_h,
        building_mode=True,
    )
    return img


# ---------------------------------------------------------------------------
# Scope D: Surface Objects (20 cols x 2 rows) & World Props (9 cols x 1 row)
# ---------------------------------------------------------------------------

def render_obj_cell(vol: np.ndarray, scale: float = 0.95, pitch: float = 40.0, base_y_ratio: float = 0.72) -> Image.Image:
    return render_iso_raycast(
        vol,
        heading_deg=90.0,
        out_w=64,
        out_h=64,
        pitch_deg=pitch,
        scale=scale,
        base_y_ratio=base_y_ratio,
    )


def build_surface_object_sprite(obj_id: str, alt: bool) -> Image.Image:
    W, L, H = 56, 56, 48
    X, Y, Z = make_grid(W, L, H)
    parts: list[tuple[np.ndarray, str, bool]] = []

    if obj_id == "berry_bush":
        l1 = sd_ellipsoid(X, Y, Z, -7, 2, 11, 10, 9, 9)
        l2 = sd_ellipsoid(X, Y, Z, 7, 1, 11, 10, 9, 9)
        l3 = sd_ellipsoid(X, Y, Z, 0, -4, 14, 11, 10, 10)
        l4 = sd_ellipsoid(X, Y, Z, 0, 2, 18, 9, 8, 8)
        bush = smin(smin(l1, l2, 2.5), smin(l3, l4, 2.5), 2.5)
        if not alt:
            berries = None
            for bx, by, bz in [(-8, 8, 13), (8, 7, 13), (-3, 7, 20), (5, 4, 21), (0, -6, 22), (-10, -2, 14), (10, -3, 14)]:
                b = sd_sphere(X, Y, Z, bx, by, bz, 2.5)
                berries = b if berries is None else np.minimum(berries, b)
            parts.append((berries, "#e5484d", False))
        parts.append((bush, "#4b7b38" if alt else "#2f6121", False))

    elif obj_id == "herb_patch":
        stems = None
        for idx, (lx, ly, lh) in enumerate([(-8, 3, 18), (0, 6, 20), (8, 2, 17), (-4, -5, 19), (6, -6, 16)]):
            s = sd_capsule(X, Y, Z, lx * 0.7, ly * 0.7, 2.0, lx * 1.1, ly * 1.1, (7.0 if alt else lh), 2.6, 1.0)
            stems = s if stems is None else np.minimum(stems, s)
            if not alt and idx < 3:
                bud = sd_sphere(X, Y, Z, lx * 1.1, ly * 1.1, lh + 1.0, 2.3)
                parts.append((bud, "#a8c256", True))
        parts.append((stems, "#3e7d2c", False))

    elif obj_id == "mushroom_patch":
        stems = None
        caps = None
        spots = None
        coords = [(-7, 2, 13, 8.5), (7, 4, 10, 6.8), (1, -6, 16, 9.2)]
        for mx, my, mh, cr in coords:
            h_cur = mh * 0.55 if alt else mh
            st = sd_cylinder_z(X, Y, Z, mx, my, 1.5, h_cur, 3.0 if cr > 8 else 2.2)
            stems = st if stems is None else np.minimum(stems, st)
            if not alt:
                cap = sd_ellipsoid(X, Y, Z, mx, my, h_cur, cr, cr, cr * 0.55)
                caps = cap if caps is None else np.minimum(caps, cap)
                sp = sd_sphere(X, Y, Z, mx + cr * 0.35, my + cr * 0.35, h_cur + cr * 0.35, 1.6)
                spots = sp if spots is None else np.minimum(spots, sp)
        if spots is not None:
            parts.append((spots, "#fef3c7", True))
        if caps is not None:
            parts.append((caps, "#b0483e", False))
        parts.append((stems, "#e8dcc4", False))

    elif obj_id == "flower_meadow":
        fol = sd_ellipsoid(X, Y, Z, 0, 0, 4.5, 15, 14, 3.8)
        if not alt:
            cols = ["#e87aa8", "#ffd23e", "#ffffff", "#b48ce8"]
            pts = [(-9, 5, 11), (8, 6, 10), (0, 8, 12), (-6, -5, 12), (7, -4, 11), (-1, -1, 13), (3, 2, 11)]
            for i, (fx, fy, fz) in enumerate(pts):
                head = sd_ellipsoid(X, Y, Z, fx, fy, fz, 3.4, 3.4, 1.8)
                parts.append((head, cols[i % len(cols)], True))
        parts.append((fol, "#3e7d2c", False))

    elif obj_id == "beehive":
        stand = sd_cylinder_z(X, Y, Z, 0, 0, 1.5, 6.0, 11.0, 9.0)
        hive = smin(
            sd_ellipsoid(X, Y, Z, 0, 0, 10.0, 11.5, 11.5, 4.2),
            smin(sd_ellipsoid(X, Y, Z, 0, 0, 16.5, 10.2, 10.2, 4.0),
                 sd_ellipsoid(X, Y, Z, 0, 0, 22.0, 7.6, 7.6, 3.8), 1.5),
            1.5,
        )
        hole = sd_sphere(X, Y, Z, 0, 10.2, 13.0, 2.8)
        parts.append((hole, "#3f260e", False))
        parts.append((hive, "#9a7428" if alt else "#eab308", False))
        parts.append((stand, "#78350f", False))

    elif obj_id == "bird_nest":
        outer = sd_ellipsoid(X, Y, Z, 0, 0, 6.0, 14.0, 13.0, 4.8)
        inner = sd_ellipsoid(X, Y, Z, 0, 0, 9.2, 9.5, 8.8, 3.8)
        ring = np.maximum(outer, -inner)
        if not alt:
            e1 = sd_ellipsoid(X, Y, Z, -3.5, 0.5, 7.8, 3.2, 2.5, 2.8)
            e2 = sd_ellipsoid(X, Y, Z, 3.6, -0.5, 7.8, 3.2, 2.5, 2.8)
            parts.append((np.minimum(e1, e2), "#e8eef2", False))
        parts.append((ring, "#8a5a2b", False))

    elif obj_id in ("copper_vein", "coal_vein", "rare_vein", "crystal_cluster", "mithril_vein"):
        r1 = sd_ellipsoid(X, Y, Z, -3, 2, 10, 13, 12, 10)
        r2 = sd_ellipsoid(X, Y, Z, 6, -3, 13, 11, 10, 13)
        r3 = sd_ellipsoid(X, Y, Z, 0, 0, 8, 16, 14, 7)
        rock = smin(smin(r1, r2, 3.0), r3, 3.0)
        if not alt:
            if obj_id == "crystal_cluster":
                c1 = sd_cone_z(X, Y, Z, 0, 0, 8, 38, 7.0, 7.0, 1.0, 1.0)
                c2 = sd_cone_z(X, Y, Z, -8, 5, 6, 30, 5.2, 5.2, 0.8, 0.8)
                c3 = sd_cone_z(X, Y, Z, 8, 4, 6, 28, 4.8, 4.8, 0.8, 0.8)
                c4 = sd_cone_z(X, Y, Z, 3, -7, 7, 29, 4.4, 4.4, 0.8, 0.8)
                cryst = np.minimum(np.minimum(c1, c2), np.minimum(c3, c4))
                parts.append((cryst, "#7dd3fc", True))
            else:
                ore_col = {
                    "copper_vein": "#d97736",
                    "coal_vein": "#1e2028",
                    "rare_vein": "#facc15",
                    "mithril_vein": "#6ee7b7",
                }[obj_id]
                ore = None
                for ox, oy, oz, r in [(-5, 9, 14, 3.5), (7, 5, 17, 3.2), (1, -5, 21, 3.0), (8, -6, 11, 2.8)]:
                    nug = sd_sphere(X, Y, Z, ox, oy, oz, r)
                    ore = nug if ore is None else np.minimum(ore, nug)
                parts.append((ore, ore_col, obj_id == "rare_vein" or obj_id == "mithril_vein"))
        parts.append((rock, "#4b5563" if obj_id == "mithril_vein" else "#55565f", False))

    elif obj_id == "sulfur_vent":
        cone = sd_cone_z(X, Y, Z, 0, 0, 1.5, 16.0, 17.5, 16.5, 8.0, 7.5)
        crater = sd_cylinder_z(X, Y, Z, 0, 0, 12.0, 17.0, 5.2)
        rock = np.maximum(cone, -crater)
        brim = sd_cone_z(X, Y, Z, 0, 0, 13.5, 16.5, 7.8, 7.3, 5.0, 4.8)
        pool = sd_cylinder_z(X, Y, Z, 0, 0, 11.5, 14.0, 4.8)
        parts.append((pool, "#ca8a04" if alt else "#facc15", True))
        parts.append((brim, "#ca8a04" if alt else "#eab308", False))
        parts.append((rock, "#6b7280", False))

    elif obj_id in ("ruins_chest", "cave_chest", "dungeon_chest"):
        wood_col, band_col = {
            "ruins_chest": ("#8a5a2b", "#facc15"),
            "cave_chest": ("#7c4d25", "#cbd5e1"),
            "dungeon_chest": ("#4b3832", "#94a3b8"),
        }[obj_id]
        base = sd_box(X, Y, Z, 0, 0, 9.0, 14.0, 10.0, 7.5, 1.0)
        if alt:  # Open chest!
            lid = sd_box(X, Y, Z, 0, -8.0, 21.0, 14.2, 3.0, 6.8, 1.0)
            hollow = sd_box(X, Y, Z, 0, 1.0, 15.8, 11.2, 7.5, 1.6, 0.3)
            parts.append((hollow, "#1e1612", False))
        else:
            lid = sd_box(X, Y, Z, 0, 0, 17.5, 14.4, 10.4, 3.6, 1.6)
            lock = sd_box(X, Y, Z, 0, 10.6, 13.5, 2.8, 1.2, 2.8, 0.4)
            parts.append((lock, band_col, True))
        bands = np.minimum(
            sd_box(X, Y, Z, -8.5, 0, 12.5, 1.6, 10.8, 8.2, 0.4),
            sd_box(X, Y, Z, 8.5, 0, 12.5, 1.6, 10.8, 8.2, 0.4),
        )
        parts.append((bands, band_col, False))
        parts.append((lid, wood_col, False))
        parts.append((base, wood_col, False))

    elif obj_id == "hot_spring":
        water_outer = sd_ellipsoid(X, Y, Z, 0, 0, 4.5, 18.0, 16.0, 2.5)
        water_inner = sd_ellipsoid(X, Y, Z, 1.0 if alt else -1.0, 0.5 if alt else -0.5, 5.2, 11.5, 9.5, 2.2)
        stones = None
        for angle in range(0, 360, 36):
            sx = math.cos(math.radians(angle)) * 18.2
            sy = math.sin(math.radians(angle)) * 15.8
            r = 4.2 + (angle % 72 == 0) * 1.2
            st = sd_sphere(X, Y, Z, sx, sy, 6.0, r)
            stones = st if stones is None else np.minimum(stones, st)
        parts.append((water_inner, "#7dd3fc", True))
        parts.append((water_outer, "#38bdf8", False))
        parts.append((stones, "#71717a", False))

    elif obj_id == "ancient_pillar":
        plinth = sd_box(X, Y, Z, 0, 0, 3.5, 10.5, 10.5, 2.8, 0.6)
        shaft = sd_cylinder_z(X, Y, Z, 0, 0, 6.0, 31.0 if alt else 35.0, 6.5, 5.8)
        cap = sd_box(X, Y, Z, 0, 0, (32.5 if alt else 36.5), 9.8, 9.8, 2.4, 0.6)
        moss = sd_ellipsoid(X, Y, Z, -4.5, 4.5, 15.0, 4.5, 4.0, 7.0)
        parts.append((moss, "#4d7c0f", False))
        parts.append((cap, "#9ca3af", False))
        parts.append((plinth, "#71717a", False))
        parts.append((shaft, "#d1d5db", False))

    elif obj_id in ("fallen_log", "driftwood"):
        bark_col = "#7c4a21" if obj_id == "fallen_log" else "#a8906a"
        heart_col = "#d6a972" if obj_id == "fallen_log" else "#e2d4b7"
        trunk = sd_capsule(X, Y, Z, -17.0, 1.0, 8.0, 17.0, -2.0, 7.5, 6.8, 5.8)
        ring = sd_cylinder_x(X, Y, Z, -19.2, -16.2, 1.0, 8.0, 5.4)
        if obj_id == "fallen_log" and not alt:
            moss = sd_ellipsoid(X, Y, Z, 6.0, 0.0, 13.5, 7.0, 4.5, 3.0)
            parts.append((moss, "#3f7d2c", False))
        parts.append((ring, heart_col, False))
        parts.append((trunk, bark_col, False))

    else:  # gold_door
        frame = sd_box(X, Y, Z, 0, 0, 19.0, 16.0, 5.5, 17.0, 1.2)
        door_panel = sd_box(X, Y, Z, 0, 1.2, 17.0, 12.5 if not alt else 5.0, 4.8, 14.5, 0.6)
        emblem = sd_cylinder_z(X, Y, Z, 0, 5.6, 14.0, 21.0, 4.2)
        parts.append((emblem, "#fde047", True))
        parts.append((door_panel, "#a16207", False))
        parts.append((frame, "#facc15", False))

    vol = shade_parts(parts)
    assert_no_clipping(vol, f"obj_{obj_id}_{int(alt)}")
    return render_obj_cell(vol, scale=1.05, pitch=38.0, base_y_ratio=0.72)


def build_world_prop_sprite(prop_id: str) -> Image.Image:
    W, L, H = 56, 56, 52
    X, Y, Z = make_grid(W, L, H)
    parts: list[tuple[np.ndarray, str, bool]] = []

    if prop_id in ("lamp_day", "lamp_night"):
        lit = prop_id == "lamp_night"
        base = sd_cylinder_z(X, Y, Z, 0, 0, 1.5, 6.0, 5.8, 4.2)
        pole = sd_cylinder_z(X, Y, Z, 0, 0, 5.0, 32.0, 2.4, 2.0)
        head = sd_box(X, Y, Z, 0, 0, 36.5, 5.2, 5.2, 4.5, 1.6)
        cap = sd_cone_z(X, Y, Z, 0, 0, 40.5, 45.0, 6.5, 6.5, 1.2, 1.2)
        parts.append((head, "#fde047" if lit else "#cbd5e1", lit))
        parts.append((cap, "#1e293b", False))
        parts.append((pole, "#334155", False))
        parts.append((base, "#1e293b", False))

    elif prop_id == "cave_entrance":
        mound = smin(sd_ellipsoid(X, Y, Z, 0, -3, 14, 22, 17, 15), sd_ellipsoid(X, Y, Z, 0, -2, 8, 24, 19, 8), 3.0)
        cavern = sd_box(X, Y, Z, 0, 8, 10, 9.5, 12.0, 9.5, 2.5)
        rock = np.maximum(mound, -cavern)
        beams = np.minimum(
            np.minimum(sd_box(X, Y, Z, -10, 9, 10, 2.2, 2.5, 9.5, 0.4), sd_box(X, Y, Z, 10, 9, 10, 2.2, 2.5, 9.5, 0.4)),
            sd_box(X, Y, Z, 0, 9, 20.5, 12.5, 2.8, 2.2, 0.4),
        )
        void_in = sd_box(X, Y, Z, 0, 4.0, 9.5, 8.0, 5.0, 8.5, 1.5)
        parts.append((beams, "#78350f", False))
        parts.append((void_in, "#090b10", True))
        parts.append((rock, "#52525b", False))

    elif prop_id == "dungeon_entrance":
        fort = sd_box(X, Y, Z, 0, -2, 15, 20, 16, 13, 1.2)
        arch = sd_box(X, Y, Z, 0, 10, 10, 9, 8, 10, 3.0)
        main = np.maximum(fort, -arch)
        bat1 = sd_box(X, Y, Z, -14, -14, 30, 5, 5, 5, 0.5)
        bat2 = sd_box(X, Y, Z, 14, -14, 30, 5, 5, 5, 0.5)
        void_in = sd_box(X, Y, Z, 0, 6, 9, 7.5, 5.0, 8.5, 1.5)
        torch = np.minimum(sd_sphere(X, Y, Z, -12, 13.5, 18, 2.0), sd_sphere(X, Y, Z, 12, 13.5, 18, 2.0))
        parts.append((torch, "#fb923c", True))
        parts.append((void_in, "#090b10", True))
        parts.append((np.minimum(bat1, bat2), "#475569", False))
        parts.append((main, "#334155", False))

    elif prop_id == "ruins_entrance":
        arch_l = sd_box(X, Y, Z, -11, 0, 13, 4.5, 11, 12, 0.8)
        arch_r = sd_box(X, Y, Z, 11, 0, 13, 4.5, 11, 12, 0.8)
        lintel = sd_box(X, Y, Z, 0, 0, 26.5, 16.5, 11.5, 3.5, 0.8)
        vine = sd_ellipsoid(X, Y, Z, 8, 5, 23, 7, 5, 5)
        void_in = sd_box(X, Y, Z, 0, 0, 11, 7.2, 9.0, 10.5, 0.8)
        parts.append((vine, "#4d7c0f", False))
        parts.append((void_in, "#090b10", True))
        parts.append((lintel, "#a8a29e", False))
        parts.append((np.minimum(arch_l, arch_r), "#d6d3d1", False))

    elif prop_id == "abandoned_camp":
        tent = sd_rect_gable_roof(X, Y, Z, -4, -3, 2, 23, 12, 13, ridge_along_x=False)
        tent_door = sd_box(X, Y, Z, -4, 9.5, 8, 5.2, 2.2, 6.2, 0.4)
        fire_ring = sd_cylinder_z(X, Y, Z, 12, 10, 2, 5.5, 5.5)
        ashes = sd_sphere(X, Y, Z, 12, 10, 6.0, 2.6)
        parts.append((ashes, "#fb923c", True))
        parts.append((fire_ring, "#57534e", False))
        parts.append((tent_door, "#78350f", False))
        parts.append((tent, "#d97706", False))

    elif prop_id == "ancient_shrine":
        p_l = sd_cylinder_z(X, Y, Z, -11, 0, 2, 26, 2.8)
        p_r = sd_cylinder_z(X, Y, Z, 11, 0, 2, 26, 2.8)
        beam1 = sd_box(X, Y, Z, 0, 0, 23, 15, 2.6, 1.8, 0.4)
        beam2 = sd_box(X, Y, Z, 0, 0, 27.5, 18.5, 3.4, 2.2, 0.6)
        altar = sd_box(X, Y, Z, 0, -2, 6.0, 7.0, 5.0, 4.0, 0.5)
        parts.append((altar, "#94a3b8", False))
        parts.append((beam2, "#dc2626", False))
        parts.append((beam1, "#dc2626", False))
        parts.append((np.minimum(p_l, p_r), "#b91c1c", False))

    elif prop_id == "watchtower_ruins":
        base = sd_box(X, Y, Z, 0, 0, 14, 14, 14, 12, 1.0)
        notch = sd_box(X, Y, Z, 7, 7, 25, 8, 8, 6)
        merlons = np.minimum(
            sd_box(X, Y, Z, -10, -10, 29, 4, 4, 4, 0.4),
            sd_box(X, Y, Z, -10, 10, 29, 4, 4, 4, 0.4),
        )
        slit = sd_box(X, Y, Z, -2, 14.2, 15, 1.8, 1.2, 4.5, 0.2)
        tower = np.maximum(np.minimum(base, merlons), -notch)
        parts.append((slit, "#1e293b", False))
        parts.append((tower, "#78716c", False))

    else:  # sunken_ruins
        water = sd_ellipsoid(X, Y, Z, 0, 0, 3.5, 21, 19, 2.0)
        c1 = sd_cylinder_z(X, Y, Z, -8, 3, 2, 20, 3.8)
        c2 = sd_cylinder_z(X, Y, Z, 9, -4, 2, 15, 3.8)
        slab = sd_box(X, Y, Z, 1, 2, 8.5, 11, 6, 3.5, 0.6)
        parts.append((np.minimum(c1, np.minimum(c2, slab)), "#94a3b8", False))
        parts.append((water, "#0ea5e9", False))

    vol = shade_parts(parts)
    assert_no_clipping(vol, f"prop_{prop_id}")
    return render_obj_cell(vol, scale=1.0, pitch=38.0, base_y_ratio=0.76)


# ---------------------------------------------------------------------------
# Atlas Assembly & QA Runners
# ---------------------------------------------------------------------------

def generate_vehicles(qa_dir: Path | None):
    makers: dict[str, Callable[[], np.ndarray]] = {
        "electric_scooter": build_vehicle_electric_scooter,
        "delivery_moped": build_vehicle_delivery_moped,
        "cargo_truck": build_vehicle_cargo_truck,
        "police_cruiser": lambda: build_vehicle_police_cruiser(False),
    }
    qa_tiles: list[Image.Image] = []
    for vid, fn in makers.items():
        vol = fn()
        save_slice_atlas(vol, OUT_ROOT / "vehicles" / f"{vid}_slices.webp", cols=7)

        if vid == "police_cruiser":
            vol_alt = build_vehicle_police_cruiser(True)
            save_slice_atlas(vol_alt, OUT_ROOT / "vehicles" / "police_cruiser_siren2_slices.webp", cols=7)
            sheet = Image.new("RGBA", (64 * 16, 64 * 2), (0, 0, 0, 0))
            for d in range(16):
                hd = d * 22.5
                f0 = render_iso_raycast(vol, hd, 64, 64, pitch_deg=38.0, scale=1.05, base_y_ratio=0.68)
                f1 = render_iso_raycast(vol_alt, hd, 64, 64, pitch_deg=38.0, scale=1.05, base_y_ratio=0.68)
                sheet.alpha_composite(f0, (d * 64, 0))
                sheet.alpha_composite(f1, (d * 64, 64))
                if d in (0, 2, 4, 12):
                    qa_tiles.append(f0)
            save_webp(sheet, OUT_ROOT / "vehicles" / f"{vid}_16dir.webp")
        else:
            sheet = Image.new("RGBA", (64 * 16, 64), (0, 0, 0, 0))
            for d in range(16):
                f = render_iso_raycast(vol, d * 22.5, 64, 64, pitch_deg=38.0, scale=1.05, base_y_ratio=0.68)
                sheet.alpha_composite(f, (d * 64, 0))
                if d in (0, 2, 4, 12):
                    qa_tiles.append(f)
            save_webp(sheet, OUT_ROOT / "vehicles" / f"{vid}_16dir.webp")

    if qa_dir is not None:
        qa_dir.mkdir(parents=True, exist_ok=True)
        qa = Image.new("RGBA", (4 * 128, 4 * 128), (30, 41, 59, 255))
        for i, im in enumerate(qa_tiles):
            big = im.resize((128, 128), Image.NEAREST)
            qa.alpha_composite(big, ((i % 4) * 128, (i // 4) * 128))
        qa.save(qa_dir / "qa_vehicles.png")


def generate_racing(qa_dir: Path | None):
    qa_samples: list[Image.Image] = []
    for coat_slug, coat_hex, mane_hex in COAT_CONFIGS:
        sheet = Image.new("RGBA", (56 * 16, 56 * 4), (0, 0, 0, 0))
        for f_idx in range(4):
            vol = build_horse_frame(coat_hex, mane_hex, f_idx)
            for d in range(16):
                spr = render_iso_raycast(vol, d * 22.5, 56, 56, pitch_deg=38.0, scale=0.92, base_y_ratio=0.68)
                sheet.alpha_composite(spr, (d * 56, f_idx * 56))
                if coat_slug in ("bay", "white", "chestnut") and f_idx == 1 and d in (0, 4, 8):
                    qa_samples.append(spr)
        save_webp(sheet, OUT_ROOT / "racing" / f"horse_{coat_slug}_16dir.webp")

    if qa_dir is not None:
        qa_dir.mkdir(parents=True, exist_ok=True)
        qa = Image.new("RGBA", (3 * 112, 3 * 112), (46, 108, 46, 255))
        for i, im in enumerate(qa_samples):
            qa.alpha_composite(im.resize((112, 112), Image.NEAREST), ((i % 3) * 112, (i // 3) * 112))
        qa.save(qa_dir / "qa_horses.png")


def generate_buildings(qa_dir: Path | None):
    kinds = [
        "city_hall",
        "vehicle_dealer",
        "convenience",
        "cafe",
        "bank_kiosk",
        "smith_workshop",
        "house",
        "cottage",
    ]
    facings = ["s", "n", "e", "w"]
    qa_s: list[tuple[str, Image.Image]] = []
    for k in kinds:
        for f in facings:
            im = build_settlement_building(k, f)
            save_webp(im, OUT_ROOT / "buildings" / f"{k}_{f}.webp")
            if f == "s":
                qa_s.append((k, im))

    if qa_dir is not None:
        qa_dir.mkdir(parents=True, exist_ok=True)
        qa = Image.new("RGBA", (4 * 192, 2 * 168), (58, 92, 62, 255))
        for i, (_, im) in enumerate(qa_s):
            col, row = i % 4, i // 4
            ox = col * 192 + (192 - im.width) // 2
            oy = row * 168 + (168 - im.height)
            qa.alpha_composite(im, (ox, oy))
        qa.save(qa_dir / "qa_buildings.png")


SURFACE_OBJ_ORDER = [
    "berry_bush",
    "herb_patch",
    "mushroom_patch",
    "flower_meadow",
    "beehive",
    "bird_nest",
    "copper_vein",
    "coal_vein",
    "rare_vein",
    "crystal_cluster",
    "mithril_vein",
    "sulfur_vent",
    "ruins_chest",
    "cave_chest",
    "dungeon_chest",
    "hot_spring",
    "ancient_pillar",
    "fallen_log",
    "driftwood",
    "gold_door",
]

WORLD_PROP_ORDER = [
    "lamp_day",
    "lamp_night",
    "cave_entrance",
    "dungeon_entrance",
    "ruins_entrance",
    "abandoned_camp",
    "ancient_shrine",
    "watchtower_ruins",
    "sunken_ruins",
]


def generate_objects(qa_dir: Path | None):
    atlas = Image.new("RGBA", (64 * len(SURFACE_OBJ_ORDER), 64 * 2), (0, 0, 0, 0))
    for col, oid in enumerate(SURFACE_OBJ_ORDER):
        atlas.alpha_composite(build_surface_object_sprite(oid, False), (col * 64, 0))
        atlas.alpha_composite(build_surface_object_sprite(oid, True), (col * 64, 64))
    save_webp(atlas, OUT_ROOT / "objects" / "surface_objects.webp")

    props = Image.new("RGBA", (64 * len(WORLD_PROP_ORDER), 64), (0, 0, 0, 0))
    for col, pid in enumerate(WORLD_PROP_ORDER):
        props.alpha_composite(build_world_prop_sprite(pid), (col * 64, 0))
    save_webp(props, OUT_ROOT / "objects" / "world_props.webp")

    if qa_dir is not None:
        qa_dir.mkdir(parents=True, exist_ok=True)
        # Composite 5x4 grid at 2x nearest zoom
        qa = Image.new("RGBA", (10 * 96, 6 * 96), (52, 78, 56, 255))
        for i in range(len(SURFACE_OBJ_ORDER)):
            cell = atlas.crop((i * 64, 0, (i + 1) * 64, 64)).resize((96, 96), Image.NEAREST)
            qa.alpha_composite(cell, ((i % 10) * 96, (i // 10) * 96))
        for i in range(len(WORLD_PROP_ORDER)):
            cell = props.crop((i * 64, 0, (i + 1) * 64, 64)).resize((96, 96), Image.NEAREST)
            qa.alpha_composite(cell, (i * 96, 3 * 96))
        qa.save(qa_dir / "qa_objects.png")


def main():
    parser = argparse.ArgumentParser(description="Generate WorldBox Pseudo-3D lossless WebP sprites.")
    parser.add_argument("--scope", choices=["vehicles", "racing", "buildings", "objects", "all"], default="all")
    parser.add_argument("--qa-dir", type=Path, default=None, help="Optional directory to output visual QA contact sheets.")
    args = parser.parse_args()

    if args.scope in ("vehicles", "all"):
        print("Generating vehicles (slices + 16-dir WebP)...")
        generate_vehicles(args.qa_dir)
    if args.scope in ("racing", "all"):
        print("Generating racing horses (8 coats x 16-dir x 4 gallop frames)...")
        generate_racing(args.qa_dir)
    if args.scope in ("buildings", "all"):
        print("Generating settlement buildings (8 kinds x 4 facings)...")
        generate_buildings(args.qa_dir)
    if args.scope in ("objects", "all"):
        print("Generating surface objects & world props atlases...")
        generate_objects(args.qa_dir)
    print("Done generating WorldBox pseudo-3D WebP assets.")


if __name__ == "__main__":
    main()
