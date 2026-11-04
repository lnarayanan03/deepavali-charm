#!/usr/bin/env python3
"""Synthesizes the lamp's sounds into ../sounds (mono 16-bit WAV, 32 kHz).

Everything is meant to sound like one small brass lamp, quietly:
  tink-s0..2, tink-m0..2  the little bell hanging under the lamp, soft and a bit firmer.
                          One bell, so one pitch; the variants only differ by a hair.
  chain-0..2              the chain links jingling as it moves
  ring                    a warm temple-bell ring, for the petal shower
  blow                    a soft breath of air that blows the flames out
  catch-0..2              a wick catching alight again
  whoosh-0..1             a cracker rocket going up, faint and far away
  pop-0..2                its burst: a soft distant pop and a little crackle (relight rocket)
  whoosh-big, boom-0..2,  the bigger show: a louder rocket, rounder booms, the closing
  boom-big, crackle       word-burst, and glitter crackling
  db-*                    the Dragon Ball charm: ball clinks, thunder, lightning, the light
                          pillar, the dragon's rise and growl, the hero's run, power-up,
                          energy wave, instant transmission, the catch, stones returning.
                          (Voices are not made here: drop your own clips in voices/.)

Levels are baked in (GNOME's sound player has no volume control), so each file is
scaled to its own quiet peak level below rather than to full scale.
"""
import os
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

RATE = 32000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')
rng = np.random.default_rng(11)


def write(name, x, peak, loud=None):
    """scale to a loudness `loud` (RMS of the first half second) if given, never
    going over `peak` (fraction of full scale); fade the ends; save"""
    x = np.asarray(x, dtype=np.float64)
    fade = min(len(x) // 4, int(RATE * 0.06))
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x[:16] *= np.linspace(0, 1, 16)
    k = peak / (np.max(np.abs(x)) or 1)
    if loud:
        k = min(k, loud / (np.sqrt(np.mean(x[:RATE // 2] ** 2)) or 1))
    x = x * k
    wavfile.write(os.path.join(OUT, f'{name}.wav'), RATE, (x * 32767).astype(np.int16))


def t_axis(dur):
    return np.arange(int(RATE * dur)) / RATE


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'bandpass', fs=RATE, output='sos'), x)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, 'lowpass', fs=RATE, output='sos'), x)


def modes(f0, parts, dur, attack=0.003):
    """a struck metal object: decaying partials [(ratio, amp, decay/s)], each split into
    two slightly detuned modes so it shimmers gently like real brass"""
    t = t_axis(dur)
    out = np.zeros_like(t)
    for ratio, amp, decay in parts:
        f = f0 * ratio
        if f > RATE * 0.42:
            continue
        for split, share in ((1.0, 0.6), (1.0 + rng.uniform(0.0008, 0.002), 0.4)):
            ph = rng.uniform(0, 2 * np.pi)
            out += share * amp * np.exp(-t * decay) * np.sin(2 * np.pi * f * split * t + ph)
    return out * np.minimum(1, t / attack)


def strike(dur, lo, hi, decay):
    """the soft knock of a clapper: a tiny burst of filtered noise"""
    t = t_axis(dur)
    return band(rng.uniform(-1, 1, len(t)), lo, hi) * np.exp(-t * decay)


def mix(*parts):
    n = max(int(at * RATE) + len(p) for at, p in parts)
    out = np.zeros(n)
    for at, p in parts:
        i = int(at * RATE)
        out[i:i + len(p)] += p[:n - i]
    return out


os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.wav'):
        os.remove(os.path.join(OUT, f))

# --- the little bell under the lamp (a small brass ghanti, about A5) ---
BELL = 880.0
BELL_PARTS = [(1.0, 1.0, 3.0), (2.32, 0.32, 6.5), (3.86, 0.14, 11), (5.62, 0.05, 17)]
for k in range(3):
    f0 = BELL * (1 + rng.uniform(-0.006, 0.006))
    soft = modes(f0, [(r, a * (0.55 if r > 2 else 1), d) for r, a, d in BELL_PARTS], 2.2, attack=0.006)
    soft = mix((0, soft), (0, strike(0.02, 1500, 5000, 300) * 0.04))
    write(f'tink-s{k}', lowpass(soft, 4500), 0.14, loud=0.03)
    firm = modes(f0, BELL_PARTS, 2.4, attack=0.003)
    firm = mix((0, firm), (0, strike(0.02, 1800, 7000, 260) * 0.07))
    write(f'tink-m{k}', firm, 0.2, loud=0.05)

# --- chain links jingling: a quick scatter of tiny high clinks ---
for k in range(3):
    n = rng.integers(5, 9)
    parts = []
    at = 0.0
    for _ in range(n):
        f = rng.uniform(3200, 6200)
        clink = modes(f, [(1, 1, rng.uniform(55, 90)), (1.47, 0.4, 120)], 0.12, attack=0.0008)
        parts.append((at, clink * rng.uniform(0.35, 1.0)))
        at += rng.uniform(0.012, 0.045)
    rattle = strike(at + 0.05, 2500, 8000, 25) * 0.05
    write(f'chain-{k}', lowpass(mix((0, rattle), *parts), 7000), 0.07)

# --- temple bell ring for the petal shower: warm and round, about E5 ---
ring = modes(659.3, [(0.5, 0.22, 0.9), (1.0, 1.0, 1.3), (1.19, 0.42, 1.9), (1.5, 0.28, 2.4),
                     (2.0, 0.3, 3.0), (2.61, 0.1, 4.5), (3.3, 0.05, 6)], 3.6, attack=0.005)
ring = mix((0, ring), (0, strike(0.03, 800, 3500, 160) * 0.05))
write('ring', lowpass(ring, 5000), 0.18, loud=0.045)

# --- a soft breath that blows the lamp out: "phoooo", the flames flutter at the end ---
t = t_axis(2.0)
env = np.minimum(1, t / 0.18) ** 1.5 * np.exp(-np.maximum(0, t - 0.5) * 2.4)
breath = band(rng.uniform(-1, 1, len(t)), 220, 1300) * env
# a gentle sweep down in brightness as the breath runs out
breath = 0.6 * breath + 0.4 * lowpass(breath, 500)
flutter = 1 + 0.35 * np.sin(2 * np.pi * 17 * t) * np.clip((t - 0.6) / 0.4, 0, 1) * np.exp(-np.maximum(0, t - 1.0) * 3)
write('blow', breath * flutter, 0.12)

# --- a wick catching: a tiny crackle and a soft rising "fff" as the flame takes ---
for k in range(3):
    t = t_axis(0.9)
    env = np.minimum(1, t / 0.12) * np.exp(-t * 4.5)
    fff = band(rng.uniform(-1, 1, len(t)), 350, 1800) * env
    parts = [(0, fff)]
    for _ in range(rng.integers(2, 4)):
        parts.append((rng.uniform(0.0, 0.25), strike(0.01, 2000, 6000, 900) * rng.uniform(0.3, 0.7)))
    write(f'catch-{k}', lowpass(mix(*parts), 3500), 0.06)

# --- crackers, heard from across the street: quiet and soft ---
for k in range(2):
    t = t_axis(1.2)
    env = np.minimum(1, t / 0.5) ** 2 * np.exp(-np.maximum(0, t - 0.9) * 10)
    noise = rng.uniform(-1, 1, len(t))
    # a breathy rising "fsss": the brightness climbs as the rocket rises
    lo, hi = band(noise, 600, 1600), band(noise, 1800, 4200)
    rise = np.clip(t / 1.0, 0, 1)
    write(f'whoosh-{k}', (lo * (1 - rise) + hi * rise) * env, 0.035)

for k in range(3):
    t = t_axis(1.4)
    # a low, rounded thump, as if from a distance
    thump = band(rng.uniform(-1, 1, len(t)), 60, 420, 2) * np.exp(-t * 14) * np.minimum(1, t / 0.004)
    thump = lowpass(thump, 900)
    parts = [(0, thump)]
    # then the sparks fizz and crackle softly as they fall
    for _ in range(rng.integers(10, 16)):
        parts.append((rng.uniform(0.12, 0.9), strike(0.008, 2500, 7000, 1100) * rng.uniform(0.08, 0.22)))
    write(f'pop-{k}', lowpass(mix(*parts), 6000), 0.1, loud=0.02)


# --- the bigger crackers show ---
t = t_axis(1.5)
env = np.minimum(1, t / 0.6) ** 2 * np.exp(-np.maximum(0, t - 1.2) * 10)
noise = rng.uniform(-1, 1, len(t))
rise = np.clip(t / 1.3, 0, 1)
write('whoosh-big', (band(noise, 500, 1400) * (1 - rise) + band(noise, 1600, 5000) * rise) * env, 0.07)


def boom(dur, lo, hi, decay, crackles, peak, loud):
    t = t_axis(dur)
    thump = band(rng.uniform(-1, 1, len(t)), lo, hi, 2) * np.exp(-t * decay) * np.minimum(1, t / 0.003)
    parts = [(0, lowpass(thump, 1200))]
    for _ in range(crackles):
        parts.append((rng.uniform(0.15, dur * 0.8), strike(0.008, 2500, 8000, 1000) * rng.uniform(0.08, 0.3)))
    return lowpass(mix(*parts), 7000)


for k in range(3):
    write(f'boom-{k}', boom(2.0, 40, 360, 7, rng.integers(18, 28), 0.2, 0.04), 0.2, loud=0.04)
write('boom-big', boom(3.0, 30, 300, 4.5, 50, 0.28, 0.06), 0.28, loud=0.06)
parts = [(rng.uniform(0, 1.0), strike(0.006, 3000, 9000, 1400) * rng.uniform(0.2, 0.6)) for _ in range(60)]
write('crackle', lowpass(mix(*parts), 9000), 0.09)

# --- Dragon Ball charm ---
# picking a ball up, and two of them touching: a glassy little clink
write('db-pick', modes(1900, [(1, 1, 30), (2.7, 0.3, 60)], 0.4, attack=0.001), 0.08)
write('db-clink', mix((0, modes(2600, [(1, 1, 22), (2.4, 0.4, 40)], 0.6, attack=0.0008)),
                      (0.03, modes(3100, [(1, 0.7, 26)], 0.5, attack=0.0008))), 0.1)
# all seven together: a shimmering rising chime
t = t_axis(1.6)
sh = sum(np.sin(2 * np.pi * f * (1 + 0.25 * t) * t) * np.exp(-t * 1.2) for f in (523, 659, 784, 1047))
write('db-gather', sh * np.minimum(1, t / 0.4) * (1 + 0.3 * np.sin(2 * np.pi * 9 * t)), 0.12)


def rumble(dur, f_lo, f_hi, attack, decay):
    t = t_axis(dur)
    n = band(rng.uniform(-1, 1, len(t)), f_lo, f_hi, 2)
    return n * np.minimum(1, t / attack) * np.exp(-np.maximum(0, t - attack) * decay)


# thunder: a crack and a long rolling rumble
crack = strike(0.15, 800, 6000, 22)
roll = rumble(4.0, 30, 220, 0.25, 0.9) * (1 + 0.5 * np.sin(2 * np.pi * 1.7 * t_axis(4.0)))
write('db-thunder', mix((0, crack * 0.6), (0.05, roll)), 0.3, loud=0.08)
for k in range(2):
    zap = strike(0.5, 1200, 9000, 9) * (1 + 0.6 * np.sign(np.sin(2 * np.pi * 60 * t_axis(0.5))))
    write(f'db-zap-{k}', mix((0, zap), (0.02, rumble(1.2, 40, 300, 0.02, 3) * 0.6)), 0.22)
# the pillar of light: a bright swelling roar
t = t_axis(2.6)
pil = band(rng.uniform(-1, 1, len(t)), 300, 3000) * np.minimum(1, t / 0.15) * np.exp(-t * 0.9)
pil += 0.5 * np.sin(2 * np.pi * (110 + 60 * t) * t) * np.exp(-t * 0.8)
write('db-pillar', lowpass(pil, 5000), 0.22, loud=0.06)
# the dragon rising, a deep whooshing wind; and its growl
write('db-rise', rumble(3.2, 60, 700, 1.2, 1.4), 0.2, loud=0.05)
t = t_axis(2.0)
growl = band(rng.uniform(-1, 1, len(t)), 50, 400, 2) * (0.6 + 0.4 * np.sin(2 * np.pi * 23 * t))
growl += 0.4 * np.sin(2 * np.pi * 55 * t + 3 * np.sin(2 * np.pi * 7 * t))
write('db-growl', growl * np.minimum(1, t / 0.3) * np.exp(-np.maximum(0, t - 1.2) * 3), 0.3, loud=0.07)
# vanishing into light, the balls flying off, and coming back as stones
t = t_axis(2.0)
write('db-vanish', sum(np.sin(2 * np.pi * f * (1 + 0.6 * t) * t) for f in (880, 1320, 1760)) *
      np.exp(-t * 1.8) * np.minimum(1, t / 0.1), 0.1)
write('db-scatter', rumble(1.2, 1500, 6000, 0.05, 3), 0.1)
parts = [(rng.uniform(0, 0.9), mix((0, modes(rng.uniform(300, 500), [(1, 1, 30)], 0.3, 0.001)),
                                   (0, strike(0.05, 200, 1500, 80) * 0.6))) for _ in range(7)]
write('db-return', mix((0, rumble(1.0, 2000, 6000, 0.6, 4) * 0.3), *[(a + 0.6, p) for a, p in parts]), 0.14)
t = t_axis(1.8)
write('db-awake', sum(np.sin(2 * np.pi * f * t) * np.exp(-t * 1.6) for f in (659, 988, 1319)) * np.minimum(1, t / 0.5), 0.09)
# quick running footsteps
parts = [(i * 0.13, strike(0.06, 100, 900, 70) * (0.6 + 0.4 * (i % 2))) for i in range(12)]
write('db-run', mix(*parts), 0.14)
# power-up (used when no voice clip is given): a climbing roar that bursts
t = t_axis(2.6)
f = 60 + 160 * (t / 2.6) ** 2
pw = band(rng.uniform(-1, 1, len(t)), 80, 2500) * (t / 2.6) ** 1.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(f) / RATE)
write('db-power', pw * (1 + 0.3 * np.sin(2 * np.pi * 31 * t)), 0.25, loud=0.04)
write('db-burst', mix((0, strike(0.4, 200, 6000, 9)), (0, rumble(2.0, 30, 250, 0.01, 2.2))), 0.3, loud=0.07)
# energy wave charging (fallback for the voice), then the blast itself
t = t_axis(1.6)
hum = np.sin(2 * np.pi * np.cumsum(180 + 500 * (t / 1.6) ** 2) / RATE) * (t / 1.6)
write('db-charge', hum + 0.3 * band(rng.uniform(-1, 1, len(t)), 1500, 6000) * (t / 1.6), 0.15)
t = t_axis(2.4)
blast = band(rng.uniform(-1, 1, len(t)), 150, 3500) * np.minimum(1, t / 0.04) * np.exp(-np.maximum(0, t - 1.4) * 3)
blast += 0.5 * np.sin(2 * np.pi * 85 * t) * np.exp(-t * 1.2)
write('db-blast', blast, 0.28, loud=0.08)
# instant transmission: a short "shunk"
t = t_axis(0.35)
write('db-zip', np.sin(2 * np.pi * np.cumsum(2400 - 5000 * t) / RATE) * np.exp(-t * 14) +
      strike(0.35, 3000, 9000, 30) * 0.4, 0.12)
write('db-catch', mix((0, strike(0.2, 200, 4000, 18)), (0, rumble(1.8, 40, 400, 0.01, 2.5))), 0.26, loud=0.07)
t = t_axis(1.4)
write('db-absorb', np.sin(2 * np.pi * np.cumsum(900 - 600 * t) / RATE) * np.exp(-t * 2.5) +
      0.3 * strike(1.4, 2000, 8000, 3), 0.12)

print('wrote', ' '.join(sorted(os.listdir(OUT))))
