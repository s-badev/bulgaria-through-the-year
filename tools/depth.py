"""Depth route A: Depth Anything V2 Small (Apache-2.0) on CPU via torch + transformers.

Input : assets/source/ndk-photo.png (1672x941)
Output: assets/source/work/depth-raw16.png  (16-bit, relative inverse depth, 65535 = nearest)
        assets/source/work/depth-meta.json  (versions, model id, sizes)
Run   : .venv/Scripts/python.exe tools/depth.py
"""
import json, os, sys
import numpy as np
import torch
import transformers
from PIL import Image
from transformers import AutoModelForDepthEstimation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source", "ndk-photo.png")
WORK = os.path.join(ROOT, "assets", "source", "work")
MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
os.makedirs(WORK, exist_ok=True)

img = Image.open(SRC).convert("RGB")
W, H = img.size
model = AutoModelForDepthEstimation.from_pretrained(MODEL).eval()
mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
std = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def run(short_side):
    # multiples of the ViT patch size (14)
    h = int(round(short_side / 14)) * 14
    w = int(round(short_side * W / H / 14)) * 14
    x = np.asarray(img.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - mean) / std
    t = torch.from_numpy(x).permute(2, 0, 1).unsqueeze(0)
    with torch.no_grad():
        d = model(pixel_values=t).predicted_depth  # (1, h, w) relative inverse depth
    d = torch.nn.functional.interpolate(d.unsqueeze(1), size=(H, W), mode="bicubic", align_corners=False)[0, 0]
    d = d.numpy().astype(np.float64)
    return d, (w, h)


torch.manual_seed(0)
coarse, s1 = run(518)   # globally consistent
fine, s2 = run(798)     # sharper edges


def norm(a):
    lo, hi = np.percentile(a, 0.1), np.percentile(a, 99.9)
    return np.clip((a - lo) / (hi - lo + 1e-9), 0, 1)


c, f = norm(coarse), norm(fine)
# Merge: low frequencies from the coarse pass, high frequencies from the fine pass.
def box(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    cs = p.cumsum(0).cumsum(1)
    cs = np.pad(cs, ((1, 0), (1, 0)))
    return (cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]) / (k * k)


def lowpass(a, r=24):
    return box(box(box(a, r), r), r)


merged = np.clip(lowpass(c) + (f - lowpass(f)), 0, 1)
Image.fromarray((merged * 65535).astype(np.uint16)).save(os.path.join(WORK, "depth-raw16.png"))
meta = {
    "route": "A",
    "model": MODEL,
    "license": "Apache-2.0",
    "torch": torch.__version__,
    "transformers": transformers.__version__,
    "numpy": np.__version__,
    "python": sys.version.split()[0],
    "passes": [{"input": list(s1)}, {"input": list(s2)}],
    "merge": "low-pass(coarse) + high-pass(fine), box^3 r=24",
    "meaning": "relative inverse depth, 1 = nearest, 0 = farthest (sky)",
}
json.dump(meta, open(os.path.join(WORK, "depth-meta.json"), "w"), indent=2)
print("depth ok", merged.shape, float(merged.min()), float(merged.max()), meta["torch"], meta["transformers"])
