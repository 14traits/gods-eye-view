"""YOLOv8n (ONNX, CPU) over cctv/cam_*.jpg and cctv/nyc/*.jpg -> cctv/detections.json.
Model auto-downloads to tools/live/models/yolov8n.onnx (git-ignored)."""
import glob, json, os, sys, time, requests
import numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MODEL = os.path.join(HERE, 'models', 'yolov8n.onnx')
MODEL_URL = 'https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx'
KEEP = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck', 9: 'traffic light', 11: 'stop sign'}
CONF, IOU, S = 0.16, 0.45, 640
if not os.path.exists(MODEL):
    os.makedirs(os.path.dirname(MODEL), exist_ok=True)
    open(MODEL, 'wb').write(requests.get(MODEL_URL, timeout=120).content)
sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
inp = sess.get_inputs()[0].name

def nms(b, s, thr):
    order = s.argsort()[::-1]; keep = []
    while order.size:
        i = order[0]; keep.append(i)
        xx0 = np.maximum(b[i, 0], b[order[1:], 0]); yy0 = np.maximum(b[i, 1], b[order[1:], 1])
        xx1 = np.minimum(b[i, 2], b[order[1:], 2]); yy1 = np.minimum(b[i, 3], b[order[1:], 3])
        inter = np.clip(xx1 - xx0, 0, None) * np.clip(yy1 - yy0, 0, None)
        a = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
        iou = inter / (a[i] + a[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= thr]
    return keep

def detect(path):
    im = Image.open(path).convert('RGB'); W, H = im.size
    r = min(S / W, S / H); nw, nh = round(W * r), round(H * r); px, py = (S - nw) // 2, (S - nh) // 2
    canvas = Image.new('RGB', (S, S), (114, 114, 114)); canvas.paste(im.resize((nw, nh), Image.BILINEAR), (px, py))
    x = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    p = sess.run(None, {inp: x})[0][0].T  # 8400 x 84
    sc = p[:, 4:]; cls = sc.argmax(1); conf = sc.max(1)
    m = (conf >= CONF) & np.isin(cls, list(KEEP))
    p, cls, conf = p[m], cls[m], conf[m]
    if not len(p): return []
    b = np.stack([p[:, 0] - p[:, 2] / 2, p[:, 1] - p[:, 3] / 2, p[:, 0] + p[:, 2] / 2, p[:, 1] + p[:, 3] / 2], 1)
    out = []
    for c in np.unique(cls):  # class-wise NMS
        idx = np.where(cls == c)[0]
        for k in nms(b[idx], conf[idx], IOU):
            j = idx[k]; x0, y0, x1, y1 = b[j]
            x0 = min(max((x0 - px) / r / W, 0), 1); x1 = min(max((x1 - px) / r / W, 0), 1)
            y0 = min(max((y0 - py) / r / H, 0), 1); y1 = min(max((y1 - py) / r / H, 0), 1)
            if x1 - x0 > 0 and y1 - y0 > 0:
                out.append([round(float(x0), 4), round(float(y0), 4), round(float(x1), 4), round(float(y1), 4), round(float(conf[j]), 3), KEEP[int(c)]])
    return sorted(out, key=lambda d: -d[4])

COL = {'person': (255, 60, 60), 'car': (60, 200, 255), 'truck': (255, 180, 0), 'bus': (255, 0, 255), 'bicycle': (0, 255, 120),
       'motorcycle': (180, 255, 0), 'traffic light': (255, 255, 255), 'stop sign': (255, 0, 0)}
def render(path, dets, dst):
    im = Image.open(path).convert('RGB'); W, H = im.size; d = ImageDraw.Draw(im)
    for x0, y0, x1, y1, c, n in dets:
        d.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], outline=COL[n], width=2)
        d.text((x0 * W + 2, max(0, y0 * H - 11)), f'{n} {c:.2f}', fill=COL[n])
    im.save(dst, quality=90)

if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(ROOT, 'cctv', 'cam_*.jpg'))) + sorted(glob.glob(os.path.join(ROOT, 'cctv', 'nyc', '*.jpg')))
    res, tot, t0 = {}, Counter(), time.time()
    for f in files:
        rel = os.path.relpath(f, os.path.join(ROOT, 'cctv'))
        res[rel] = detect(f); tot.update(d[5] for d in res[rel])
    dt = time.time() - t0
    json.dump(res, open(os.path.join(ROOT, 'cctv', 'detections.json'), 'w'), separators=(',', ':'))
    print('images', len(files), 'secs', round(dt, 1), 'ms/img', round(1000 * dt / max(1, len(files))))
    print('totals', dict(tot.most_common()), 'all', sum(tot.values()))
    print('nyc totals', dict(Counter(d[5] for k, v in res.items() if k.startswith('nyc/') for d in v)))
    picks = sys.argv[1:] or [max((k for k in res if k.startswith('nyc/')), key=lambda k: len(res[k])),
                             max((k for k in res if not k.startswith('nyc/')), key=lambda k: len(res[k])),
                             max(res, key=lambda k: sum(d[5] == 'person' for d in res[k]))]
    for i, k in enumerate(picks, 1):
        render(os.path.join(ROOT, 'cctv', k), res[k], os.path.join(HERE, f'det_check_{i}.jpg')); print('render', i, k, len(res[k]))
