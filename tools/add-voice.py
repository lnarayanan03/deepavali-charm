#!/usr/bin/env python3
"""Adds one of your own voice clips to the Dragon Ball show.

    tools/add-voice.py <audio file> <kamehameha|scream|bye> [start-seconds] [length-seconds]

  kamehameha  plays as he charges the energy wave (the wave fires 1.6 s in, so a clip
              that ends with the "HA!" about then lines up best)
  scream      plays as he powers up (about 2.7 s until his hair flashes gold)
  bye         plays as he turns to you and salutes, just before he teleports away

The clip is trimmed, turned to mono WAV, levelled to match the other sounds and saved
to voices/goku-<name>.wav (for the GNOME extension) and to the desktop app's voices
folder. WAV works as is; other formats (mp3, m4a, ...) need ffmpeg installed.
Voice clips are kept out of git.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

RATE = 32000
NAMES = ('kamehameha', 'scream', 'bye')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
APP_DIRS = [os.path.expanduser('~/.config/Deepavali Charm/voices'),
            os.path.expanduser('~/Library/Application Support/Deepavali Charm/voices'),
            os.path.join(os.environ.get('APPDATA', '/nonexistent'), 'Deepavali Charm', 'voices')]

if len(sys.argv) < 3 or sys.argv[2] not in NAMES:
    sys.exit(__doc__)
src, name = sys.argv[1], sys.argv[2]
start = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
length = float(sys.argv[4]) if len(sys.argv) > 4 else None

with tempfile.TemporaryDirectory() as tmp:
    wav = src
    if not src.lower().endswith('.wav'):
        if not shutil.which('ffmpeg'):
            sys.exit('That file is not a WAV. Install ffmpeg (sudo apt install ffmpeg), or convert it to WAV first.')
        wav = os.path.join(tmp, 'in.wav')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ac', '1', '-ar', str(RATE), wav], check=True)
    rate, x = wavfile.read(wav)

x = x.astype(np.float64)
if x.ndim > 1:
    x = x.mean(axis=1)
if np.issubdtype(x.dtype, np.floating) and np.max(np.abs(x)) > 1.5:
    x /= 32768.0
if rate != RATE:
    x = resample_poly(x, RATE, rate)
x = x[int(start * RATE):]
if length:
    x = x[:int(length * RATE)]
if not len(x):
    sys.exit('Nothing left after trimming.')
# level it like the show's own effects: about as loud as the energy-wave blast
x = x / (np.max(np.abs(x)) or 1) * 0.3
rms = np.sqrt(np.mean(x ** 2)) or 1
x *= min(1, 0.07 / rms)
fade = min(len(x) // 4, int(RATE * 0.05))
x[-fade:] *= np.linspace(1, 0, fade)
x[:64] *= np.linspace(0, 1, 64)
out = (x * 32767).astype(np.int16)

for d in [os.path.join(ROOT, 'voices')] + [p for p in APP_DIRS if os.path.isdir(os.path.dirname(p))]:
    os.makedirs(d, exist_ok=True)
    wavfile.write(os.path.join(d, f'goku-{name}.wav'), RATE, out)
    print('saved', os.path.join(d, f'goku-{name}.wav'), f'({len(x) / RATE:.1f} s)')
