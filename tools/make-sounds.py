#!/usr/bin/env python3
"""Synthesizes the wind-chime, bell, wind and flame sounds in ../sounds (mono 16-bit WAV).

Chimes are tuned to a pentatonic scale so any random run of notes sounds like a
little melody. Each note is a few inharmonic partials with exponential decay,
like a struck metal tube.
"""
import math, random, struct, wave, os

RATE = 32000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')

def write(name, samples):
    peak = max(abs(x) for x in samples) or 1
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.5 * 32767)) for x in samples))

def tone(f0, partials, dur, attack=0.002):
    n = int(RATE * dur)
    out = [0.0] * n
    for ratio, amp, decay in partials:
        f = f0 * ratio
        if f > RATE * 0.45:
            continue
        ph = random.random() * 6.28
        beat = 1 + random.uniform(-0.0015, 0.0015)   # a slight shimmer
        for i in range(n):
            t = i / RATE
            env = math.exp(-t * decay) * min(1, t / attack)
            out[i] += amp * env * math.sin(2 * math.pi * f * beat * t + ph)
    # fade the last bit so it never clicks
    tail = int(RATE * 0.05)
    for i in range(tail):
        out[n - 1 - i] *= i / tail
    return out

random.seed(7)
# C major pentatonic, high and bright like brass chime tubes
notes = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0, 2349.3]
for k, f in enumerate(notes):
    write(f'chime-{k}.wav', tone(f, [(1, 1.0, 2.2), (2.76, 0.45, 4.5), (5.40, 0.22, 8), (8.93, 0.1, 13)], 2.4))
# the brass bell under the lamp: lower, longer, with a hum
write('bell.wav', tone(523.25, [(0.5, 0.35, 1.2), (1, 1.0, 1.6), (1.19, 0.5, 2.2), (1.5, 0.3, 3), (2.0, 0.4, 3.5), (2.74, 0.15, 6)], 3.2))
print('wrote', sorted(os.listdir(OUT)))

def noise(dur, env, lp, hp=0.0, gain=1.0):
    """white noise through a one-pole low-pass (lp may vary over time) and a gentle high-pass"""
    n = int(RATE * dur)
    out, y, hy, px = [], 0.0, 0.0, 0.0
    for i in range(n):
        t = i / RATE
        x = random.uniform(-1, 1)
        a = min(1, 2 * math.pi * lp(t) / RATE)
        y += a * (x - y)
        hy = y - px + hy * (1 - min(1, 2 * math.pi * hp / RATE)) if hp else y
        px = y
        out.append(hy * env(t) * gain)
    return out

# a gust of wind: swells up, howls a little, dies away
gust = noise(1.8,
             lambda t: math.sin(math.pi * min(1, t / 1.8)) ** 1.6,
             lambda t: 380 + 900 * math.sin(math.pi * min(1, t / 1.8)) + 200 * math.sin(t * 9),
             hp=120)
write('wind.wav', gust)

# a wick catching: a soft scratch then a low "fwoomp" as the flame takes
def ignite():
    scratch = noise(0.12, lambda t: math.exp(-t * 30), lambda t: 5000, hp=1500)
    whoomp = noise(0.7, lambda t: min(1, t / 0.05) * math.exp(-t * 5.5), lambda t: 260 + 500 * math.exp(-t * 6), hp=60, gain=2.2)
    out = [0.0] * len(whoomp)
    for i, v in enumerate(scratch):
        out[i] += v * 0.6
    for i, v in enumerate(whoomp):
        j = i + int(RATE * 0.03)
        if j < len(out):
            out[j] += v
    return out
write('ignite.wav', ignite())
print('wrote wind.wav, ignite.wav')
