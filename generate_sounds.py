"""Generate click WAV files for the metronome — multiple sound kits."""
import struct
import math
import sys
import os
import random

def write_wav(filename: str, samples: list, sample_rate: int = 44100):
    """Write a list of float samples (-1..1) to a 16-bit mono WAV file."""
    num_samples = len(samples)
    data_size = num_samples * 2
    with open(filename, 'wb') as f:
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + data_size))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))
        f.write(struct.pack('<H', 1))   # PCM
        f.write(struct.pack('<H', 1))   # mono
        f.write(struct.pack('<I', sample_rate))
        f.write(struct.pack('<I', sample_rate * 2))
        f.write(struct.pack('<H', 2))
        f.write(struct.pack('<H', 16))
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        for s in samples:
            clamped = max(-1.0, min(1.0, s))
            f.write(struct.pack('<h', int(clamped * 32767)))

def gen_click(freq: float, duration_ms: int = 25, sample_rate: int = 44100):
    """Original sine click with exponential decay."""
    n = int(sample_rate * duration_ms / 1000)
    out = []
    for i in range(n):
        t = i / sample_rate
        env = math.exp(-t * 80)
        s = math.sin(2 * math.pi * freq * t) * env
        if i < sample_rate * 0.002:
            s += (math.sin(2 * math.pi * freq * 3 * t) * 0.3) * env
        out.append(s)
    return out

def gen_wood(freq: float, duration_ms: int = 30, sample_rate: int = 44100):
    """Woodblock / clave — band-pass filtered noise burst + resonant tone."""
    n = int(sample_rate * duration_ms / 1000)
    out = []
    for i in range(n):
        t = i / sample_rate
        env = math.exp(-t * 120)
        tone = math.sin(2 * math.pi * freq * t) * 0.6
        # Noise component for that wooden transient
        noise = (random.random() * 2 - 1) * 0.4
        if i > sample_rate * 0.003:
            noise *= 0.05  # Kill noise quickly after initial transient
        s = (tone + noise) * env
        out.append(s)
    return out

def gen_beep(freq: float, duration_ms: int = 40, sample_rate: int = 44100):
    """Clean digital beep — pure sine with smooth envelope."""
    n = int(sample_rate * duration_ms / 1000)
    out = []
    attack = int(sample_rate * 0.002)
    release = int(sample_rate * 0.008)
    for i in range(n):
        t = i / sample_rate
        # Smooth attack / sustain / release
        if i < attack:
            env = i / attack
        elif i > n - release:
            env = (n - i) / release
        else:
            env = math.exp(-t * 30)
        s = math.sin(2 * math.pi * freq * t) * env
        out.append(s)
    return out

def gen_drum(is_kick: bool, duration_ms: int = 50, sample_rate: int = 44100):
    """Drum kit — acoustic rock kit. Think John Bonham / Chad Smith."""
    out = []
    if is_kick:
        # === ROCK KICK DRUM ===
        # Acoustic 22" kick: beater attack + resonant shell + natural low end
        # Kept short so it doesn't bleed at high BPMs
        dur = max(duration_ms, 150)
        n = int(sample_rate * dur / 1000)

        phase_acc = 0.0
        dt = 1.0 / sample_rate

        for i in range(n):
            t = i / sample_rate

            # --- Beater slap (felt beater hitting the head) ---
            attack = 0.0
            if t < 0.006:
                att_env = (1 - t / 0.006) ** 1.5
                attack += math.sin(2 * math.pi * 1200 * t) * att_env * 0.5
                attack += math.sin(2 * math.pi * 2200 * t) * att_env * 0.3
                attack += (random.random() * 2 - 1) * att_env * 0.45

            # --- Shell resonance ---
            freq_body = 78 + 40 * math.exp(-t * 30)
            phase_acc += 2 * math.pi * freq_body * dt

            if t < 0.004:
                body_env = t / 0.004
            elif t < 0.020:
                body_env = 1.0 - (t - 0.004) * 3.0
                body_env = max(body_env, 0.7)
            else:
                body_env = 0.7 * math.exp(-(t - 0.020) * 22)  # Faster decay

            body = math.sin(phase_acc) * body_env * 0.85
            body += math.sin(phase_acc * 2.0) * body_env * 0.25 * math.exp(-t * 30)
            body += math.sin(phase_acc * 3.0) * body_env * 0.08 * math.exp(-t * 45)

            # --- Low-end resonance ---
            low_env = 0.0
            if t < 0.008:
                low_env = t / 0.008
            else:
                low_env = math.exp(-(t - 0.008) * 14)  # Tighter tail
            low = math.sin(2 * math.pi * 55 * t) * low_env * 0.4

            # --- Shell rattle ---
            rattle = 0.0
            if t < 0.04:
                r_env = math.exp(-t * 70)
                rattle = math.sin(2 * math.pi * 320 * t) * r_env * 0.08
                rattle += math.sin(2 * math.pi * 480 * t) * r_env * 0.05

            s = attack + body + low + rattle
            s = math.tanh(s * 1.4) * 0.9
            out.append(s)

    else:
        # === CLOSED HI-HAT (acoustic) ===
        # Bright, tight — real stick on a 14" hi-hat
        dur = max(duration_ms, 80)
        n = int(sample_rate * dur / 1000)
        prev_hp1 = 0.0
        prev_hp2 = 0.0

        for i in range(n):
            t = i / sample_rate

            # Envelope: real stick hit — instant, fast decay with tiny ring
            if t < 0.0003:
                env = t / 0.0003
            elif t < 0.008:
                env = 1.0 - (t - 0.0003) * 50  # fast drop
                env = max(env, 0.4)
            elif t < 0.025:
                env = 0.4 * math.exp(-(t - 0.008) * 80)
            else:
                env = 0.08 * math.exp(-(t - 0.025) * 40)  # sizzle tail

            # Noise — two-pole HP for that crispy metallic wash
            noise = (random.random() * 2 - 1)
            hp1 = noise - prev_hp1
            prev_hp1 = noise * 0.1
            hp2 = hp1 - prev_hp2
            prev_hp2 = hp1 * 0.1

            # Metallic partials — asymmetric like real cymbals
            metal = 0.0
            metal += math.sin(2 * math.pi * 3200 * t + 0.3) * 0.14
            metal += math.sin(2 * math.pi * 4700 * t + 1.1) * 0.18
            metal += math.sin(2 * math.pi * 6100 * t + 0.7) * 0.16
            metal += math.sin(2 * math.pi * 7900 * t + 2.0) * 0.12
            metal += math.sin(2 * math.pi * 10300 * t + 1.5) * 0.08
            metal += math.sin(2 * math.pi * 13100 * t + 0.4) * 0.04

            # Stick click (wood on metal)
            stick = 0.0
            if t < 0.003:
                stick_env = (1 - t / 0.003) ** 2
                stick = (random.random() * 2 - 1) * stick_env * 0.35
                stick += math.sin(2 * math.pi * 8000 * t) * stick_env * 0.15

            s = (hp2 * 0.5 + metal + stick) * env
            s = math.tanh(s * 1.6) * 0.7
            out.append(s)
    return out

if __name__ == '__main__':
    sounds_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src-tauri', 'sounds')
    os.makedirs(sounds_dir, exist_ok=True)

    # Kit 1: Click (original)
    write_wav(os.path.join(sounds_dir, 'click_high.wav'), gen_click(1200, 25))
    write_wav(os.path.join(sounds_dir, 'click_low.wav'), gen_click(800, 20))

    # Kit 2: Woodblock
    write_wav(os.path.join(sounds_dir, 'wood_high.wav'), gen_wood(1800, 30))
    write_wav(os.path.join(sounds_dir, 'wood_low.wav'), gen_wood(1200, 25))

    # Kit 3: Digital beep
    write_wav(os.path.join(sounds_dir, 'beep_high.wav'), gen_beep(880, 40))
    write_wav(os.path.join(sounds_dir, 'beep_low.wav'), gen_beep(660, 35))

    # Kit 4: Drum kit
    random.seed(42)  # Reproducible noise
    write_wav(os.path.join(sounds_dir, 'drum_high.wav'), gen_drum(True, 150))
    write_wav(os.path.join(sounds_dir, 'drum_low.wav'), gen_drum(False, 80))

    print("Generated all sound kits: click, wood, beep, drum")
