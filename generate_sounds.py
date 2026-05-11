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

def gen_chime(direction: str = "up", sample_rate: int = 44100):
    """Two-tone chime for drill step transitions.
    'up' = ascending (C5→E5), 'down' = descending (E5→C5)."""
    freq1, freq2 = (523.25, 659.25) if direction == "up" else (659.25, 523.25)
    tone_ms = 60      # Each tone duration
    gap_ms = 20       # Gap between tones
    n_tone = int(sample_rate * tone_ms / 1000)
    n_gap = int(sample_rate * gap_ms / 1000)
    out = []
    for freq in [freq1, freq2]:
        attack = int(sample_rate * 0.002)
        release = int(sample_rate * 0.015)
        for i in range(n_tone):
            t = i / sample_rate
            if i < attack:
                env = i / attack
            elif i > n_tone - release:
                env = (n_tone - i) / release
            else:
                env = math.exp(-t * 20)
            s = math.sin(2 * math.pi * freq * t) * env
            # Add a soft harmonic for a bell-like quality
            s += math.sin(2 * math.pi * freq * 2 * t) * env * 0.15
            s += math.sin(2 * math.pi * freq * 3 * t) * env * 0.05
            out.append(s * 0.7)
        # Add gap between tones
        out.extend([0.0] * n_gap)
    return out

def gen_hihat(duration_ms: int = 60, sample_rate: int = 44100):
    """Closed hi-hat / metallic accent layer for drum kit.
    Inharmonic partials + broadband noise give a realistic metallic 'tsss'."""
    n = int(sample_rate * duration_ms / 1000)
    out = []
    # Inharmonic metallic partials (simulates cymbal alloy resonances)
    freqs = [7900, 9950, 12500, 15750, 19800]
    for i in range(n):
        t = i / sample_rate
        # Very fast attack (0.5ms), ~14ms half-life decay
        if t < 0.0005:
            env = t / 0.0005
        else:
            env = math.exp(-t * 50)
        noise = (random.random() * 2 - 1) * 0.6
        metallic = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs) * 0.5
        s = (noise + metallic) * env
        s = math.tanh(s * 1.2) * 0.8
        out.append(s)
    return out

def gen_crash(duration_ms: int = 100, sample_rate: int = 44100):
    """Crash cymbal splash — mid-freq metallic wash for drum accent third layer.
    Lower, denser partials than the hi-hat give it a fuller cymbal quality."""
    n = int(sample_rate * duration_ms / 1000)
    out = []
    # Inharmonic partials spread across mid-high range (crash character vs hi-hat's sizzle)
    freqs = [2800, 3900, 5100, 6400, 8100, 10200, 12800]
    for i in range(n):
        t = i / sample_rate
        if t < 0.0008:
            env = t / 0.0008
        else:
            env = math.exp(-t * 18)  # Slower decay (~38ms half-life) vs hi-hat's 14ms
        noise = (random.random() * 2 - 1) * 0.5
        metallic = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs) * 0.55
        s = (noise + metallic) * env
        s = math.tanh(s * 1.1) * 0.75
        out.append(s)
    return out

def gen_drum(is_kick: bool, duration_ms: int = 50, sample_rate: int = 44100):
    """Drum kit sounds for metronome.
    Accent (is_kick=True): Kick drum — sub-bass pitch sweep, punchy thump.
    Regular (is_kick=False): Snare hit — noise-heavy crack with fast decay."""
    out = []
    if is_kick:
        # === KICK DRUM ===
        # Realism comes from three layers:
        #   1. Sub-bass body (pitch sweep 150→52Hz, must be FAST — real kicks sweep in <10ms)
        #   2. Knock/punch component (~130Hz, faster decay) — the "weight" of the hit
        #   3. Beater click (2-6kHz tones + noise) — the most important for realism
        dur = 180  # ms
        n = int(sample_rate * dur / 1000)
        phase_sub = 0.0
        phase_knock = 0.0

        for i in range(n):
            t = i / sample_rate

            # 1. Sub-bass: pitch sweep 150 → 52Hz, completes in ~10ms (rate 280)
            freq_sub = 52 + 98 * math.exp(-t * 280)
            phase_sub += 2 * math.pi * freq_sub / sample_rate

            # 2. Knock: resonant mid-bass 160 → 90Hz, faster decay
            freq_knock = 90 + 70 * math.exp(-t * 200)
            phase_knock += 2 * math.pi * freq_knock / sample_rate

            # Amplitude envelope: instant attack, ~110ms decay for sub
            if t < 0.001:
                env_sub = t / 0.001
            else:
                env_sub = math.exp(-(t - 0.001) * 12)

            # Knock envelope: punchier, faster decay
            env_knock = math.exp(-t * 40)

            # 3. Beater/click: 3kHz + 5.5kHz tonal knock + broadband noise (first 8ms)
            beater = 0.0
            if t < 0.008:
                click_env = (1 - t / 0.008) ** 1.8
                beater = (
                    math.sin(2 * math.pi * 3000 * t) * 0.45 +
                    math.sin(2 * math.pi * 5500 * t) * 0.2 +
                    (random.random() * 2 - 1) * 0.35
                ) * click_env

            tone_sub = math.sin(phase_sub) * 0.8 + math.sin(phase_sub * 2) * 0.12
            tone_knock = math.sin(phase_knock) * 0.5

            s = tone_sub * env_sub + tone_knock * env_knock * 0.55 + beater * 0.85
            s = math.tanh(s * 1.35) * 0.88
            out.append(s)

    else:
        # === SNARE DRUM ===
        # Snare = mostly noise. Sine tones make it sound like a bell.
        # The "crack" is a broadband noise burst; the wire rattle is decaying noise.
        dur = 130  # ms
        n = int(sample_rate * dur / 1000)

        for i in range(n):
            t = i / sample_rate

            # Initial crack transient (first 4ms — very dense noise)
            crack = 0.0
            if t < 0.004:
                crack_env = (1 - t / 0.004) ** 1.5
                crack = (random.random() * 2 - 1) * crack_env * 0.9

            # Snare body noise (wire rattle + head) — decays over ~80ms
            body_env = math.exp(-t * 28)
            body_noise = (random.random() * 2 - 1) * body_env * 0.65

            # Low-frequency head thump — kept very short and quiet
            # (just enough to feel like something was hit, not a bell tone)
            head_env = math.exp(-t * 60)
            head = math.sin(2 * math.pi * 185 * t) * head_env * 0.18

            s = crack + body_noise + head
            s = math.tanh(s * 1.3) * 0.78
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
    write_wav(os.path.join(sounds_dir, 'drum_metal.wav'), gen_hihat(60))
    write_wav(os.path.join(sounds_dir, 'drum_crash.wav'), gen_crash(100))

    print("Generated all sound kits: click, wood, beep, drum")

    # Chime sounds for drill step transitions
    write_wav(os.path.join(sounds_dir, 'chime_up.wav'), gen_chime("up"))
    write_wav(os.path.join(sounds_dir, 'chime_down.wav'), gen_chime("down"))
    print("Generated chime sounds: chime_up, chime_down")
