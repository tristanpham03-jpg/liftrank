"""
Generates SBLift's exercise illustrations (original artwork, owned by the
project) as small SVGs in public/exercises/<slug>.svg.

  python3 scripts/exercise-art.py

Style: side view, rounded silver figure on a transparent background, muted
equipment, primary muscles in peach and secondary in lavender (the app's
ambient-glass accents). Poses are simplified but anatomically ordered
(joint positions follow the real movement); muscle overlays only mark the
muscles listed for the exercise in the catalog.
"""
import math, os

BODY = "#cfd5e1"
GEAR = "#6b7385"
GEAR_LIGHT = "#8d95a7"
PRIMARY = "#ff8f73"
SECONDARY = "#b5a0ff"
W = {"torso": 15, "thigh": 11.5, "shin": 9, "upper": 8, "fore": 7, "foot": 6}

def seg(a, b, w, color=BODY, op=1):
    return f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"{f" stroke-opacity=\"{op}\"" if op < 1 else ""}/>'

def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def muscle(a, b, t0, t1, side, width, color, offset):
    """A highlight along part of a body segment, nudged to one side (+1 / -1 = left/right of a→b)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    nx, ny = -dy / n * side * offset, dx / n * side * offset
    p, q = lerp(a, b, t0), lerp(a, b, t1)
    return seg((p[0] + nx, p[1] + ny), (q[0] + nx, q[1] + ny), width, color, 0.95)

def head(c, r=7.5):
    return f'<circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="{r}" fill="{BODY}"/>'

def plate(c, r=13):
    return (f'<circle cx="{c[0]}" cy="{c[1]}" r="{r}" fill="none" stroke="{GEAR_LIGHT}" stroke-width="3.5"/>'
            f'<circle cx="{c[0]}" cy="{c[1]}" r="{r*0.38:.1f}" fill="none" stroke="{GEAR}" stroke-width="2.5"/>'
            f'<circle cx="{c[0]}" cy="{c[1]}" r="2" fill="{GEAR_LIGHT}"/>')

def gear(*pts, w=3.5, color=GEAR):
    d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f} {y:.1f}" for i, (x, y) in enumerate(pts))
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'

def svg(title, parts, view="0 0 160 120"):
    body = "\n  ".join(parts)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img" aria-label="{title}">\n'
            f'  <title>{title}</title>\n  {body}\n</svg>\n')

# Square crops framed on the figure, for 40 px thumbnails.
THUMB = {
    "barbell-bench-press": "24 2 118 118",
    "lat-pulldown": "38 0 108 108",
    "barbell-back-squat": "26 22 88 88",
    "deadlift": "32 28 84 84",
    "incline-smith-press": "34 0 108 108",
}
scenes = {}

FLOOR = gear((14, 106), (146, 106), w=2, color="#3b4252")

def figure(j, extra_front=()):
    """Draws limbs far-to-near; j = joints dict."""
    out = []
    out.append(seg(j["hip"], j["knee"], W["thigh"]))
    out.append(seg(j["knee"], j["ankle"], W["shin"]))
    out.append(seg(j["ankle"], j["toe"], W["foot"]))
    out.append(seg(j["hip"], j["shoulder"], W["torso"]))
    out.append(head(j["head"]))
    return out

def arm(j):
    return [seg(j["shoulder"], j["elbow"], W["upper"]), seg(j["elbow"], j["hand"], W["fore"])]

# ── Barbell Bench Press: lying on a flat bench, bar pressed up over the chest ──
j = dict(head=(36, 64), shoulder=(48, 67), hip=(96, 68), knee=(120, 70), ankle=(124, 101), toe=(134, 102),
         elbow=(52, 47), hand=(52, 28))
parts = [FLOOR,
         gear((28, 78), (110, 78), w=5),            # bench pad
         gear((38, 78), (38, 105)), gear((100, 78), (100, 105)),
         gear((52, 28), (52, 14), w=2.5, color=GEAR)]  # bar (end-on) under the plate
parts += figure(j) + arm(j)
parts += [muscle(j["shoulder"], j["hip"], 0.04, 0.32, -1, 6, PRIMARY, 4),      # chest (front of torso faces up)
          muscle(j["shoulder"], j["elbow"], 0.05, 0.3, 1, 5, SECONDARY, 0),     # front shoulder
          muscle(j["shoulder"], j["elbow"], 0.35, 0.95, 1, 4, SECONDARY, 1.5),  # triceps (faces the feet when the arm points up)
          plate((52, 24))]
scenes["barbell-bench-press"] = ("Barbell bench press", parts)

# ── Lat Pulldown: seated, thighs under the pad, reaching up to the wide bar (top of the rep) ──
j = dict(head=(55, 37), shoulder=(63, 47), hip=(60, 77), knee=(88, 75), ankle=(90, 102), toe=(100, 103),
         elbow=(71, 31), hand=(76, 17))
parts = [FLOOR,
         gear((132, 6), (132, 105), w=5), gear((122, 105), (142, 105), w=4),           # column + base
         gear((132, 6), (80, 6), w=4), f'<circle cx="80" cy="9" r="3" fill="none" stroke="{GEAR_LIGHT}" stroke-width="2.5"/>',
         gear((80, 12), (80, 16), w=1.8, color=GEAR_LIGHT),                             # cable
         gear((64, 17), (92, 17), w=4, color=GEAR_LIGHT),                               # bar
         gear((44, 83), (76, 83), w=5), gear((60, 83), (60, 105)), gear((48, 105), (74, 105), w=3),  # seat
         gear((96, 64), (96, 105), w=3), f'<circle cx="90" cy="67" r="5" fill="{GEAR}"/>']  # thigh pad
parts += figure(j) + arm(j)
parts += [muscle(j["hip"], j["shoulder"], 0.22, 0.78, -1, 6, PRIMARY, 4.5),       # lats (back of torso)
          muscle(j["hip"], j["shoulder"], 0.8, 0.98, -1, 5, SECONDARY, 4),       # upper back
          muscle(j["shoulder"], j["elbow"], 0.0, 0.22, -1, 5, SECONDARY, 1),     # rear shoulder
          muscle(j["shoulder"], j["elbow"], 0.35, 0.9, -1, 4, SECONDARY, 1.5)]   # biceps (face back with the arm overhead)
scenes["lat-pulldown"] = ("Lat pulldown", parts)

# ── Barbell Back Squat: bottom position, bar on the upper back, hips back, thighs near parallel ──
j = dict(head=(84, 36), shoulder=(76, 46), hip=(52, 76), knee=(84, 74), ankle=(78, 102), toe=(94, 103),
         elbow=(62, 56), hand=(70, 42))
parts = [FLOOR]
parts += figure(j) + arm(j)
parts += [plate((65, 40), r=10),
          muscle(j["hip"], j["knee"], 0.12, 0.85, -1, 5, PRIMARY, 3.5),          # quads (front/top of thigh)
          muscle(j["hip"], j["knee"], 0.0, 0.18, 1, 6, PRIMARY, 2.5),            # glutes
          muscle(j["hip"], j["knee"], 0.3, 0.8, 1, 4, SECONDARY, 4),             # hamstrings (underside)
          muscle(j["hip"], j["shoulder"], 0.1, 0.4, -1, 5, SECONDARY, 4.5)]      # lower back
scenes["barbell-back-squat"] = ("Barbell back squat", parts)

# ── Deadlift: start position, flat back, bar over mid-foot, arms straight ──
j = dict(head=(96, 42), shoulder=(86, 50), hip=(54, 62), knee=(82, 80), ankle=(76, 102), toe=(94, 103),
         elbow=(87, 68), hand=(88, 88))
parts = [FLOOR]
parts += figure(j) + arm(j)
parts += [plate((88, 92)),
          muscle(j["hip"], j["knee"], 0.0, 0.2, 1, 6, PRIMARY, 2.5),             # glutes
          muscle(j["hip"], j["knee"], 0.2, 0.85, 1, 4.5, PRIMARY, 3.5),          # hamstrings (back of thigh)
          muscle(j["hip"], j["shoulder"], 0.08, 0.45, -1, 5, PRIMARY, 4.5),      # lower back (top of torso)
          muscle(j["hip"], j["shoulder"], 0.65, 0.98, -1, 5, SECONDARY, 4.5),    # upper back / traps
          muscle(j["hip"], j["knee"], 0.25, 0.85, -1, 4, SECONDARY, 3.5),        # quads
          muscle(j["elbow"], j["hand"], 0.15, 0.85, 1, 4, SECONDARY, 0)]         # forearms (grip)
scenes["deadlift"] = ("Deadlift", parts)

# ── Incline Smith Press: on an incline bench, bar on the Smith rails pressed over the upper chest ──
j = dict(head=(54, 46), shoulder=(64, 56), hip=(96, 80), knee=(118, 76), ankle=(120, 102), toe=(130, 103),
         elbow=(66, 37), hand=(66, 20))
parts = [FLOOR,
         gear((66, 6), (66, 105), w=2.5, color=GEAR),                                    # Smith rail
         gear((60, 62), (98, 88), w=5), gear((96, 88), (116, 88), w=5),                  # backrest + seat
         gear((104, 88), (104, 105)), gear((74, 70), (74, 105))]
parts += figure(j) + arm(j)
parts += [plate((66, 18)),
          muscle(j["shoulder"], j["hip"], 0.04, 0.28, 1, 6, PRIMARY, 4.5),        # upper chest
          muscle(j["shoulder"], j["elbow"], 0.0, 0.28, -1, 5, SECONDARY, 0),     # front shoulder
          muscle(j["shoulder"], j["elbow"], 0.35, 0.95, 1, 4, SECONDARY, 1.5)]   # triceps
scenes["incline-smith-press"] = ("Incline Smith press", parts)

out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "exercises")
os.makedirs(out_dir, exist_ok=True)
for slug, (title, parts) in scenes.items():
    for name, content in ((f"{slug}.svg", svg(title, parts)), (f"{slug}-thumb.svg", svg(title, [p for p in parts if p is not FLOOR], THUMB[slug]))):
        with open(os.path.join(out_dir, name), "w") as f:
            f.write(content)
        print(f"{name}  {len(content)} bytes")
