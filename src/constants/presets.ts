export interface AnimationPreset {
    rotationSpeed: number;    // multiplier sobre time * 0.2 — default 1.0
    bassResponse: number;     // multiplier sobre todos los sBass * factor — default 1.0
    particleDensity: number;  // multiplier sobre maxSpawnRate — default 1.0
    glowIntensity: number;    // multiplier sobre vertex light intensity — default 1.0
    turbulence: number;       // 0.0 = flujo puro tipo agua, 1.0 = más caótico — default 0.3
    particleSpeed: number;    // NEW: Velocity multiplier
    particleTrail: number;    // NEW: Length of the segment tail
    particleLife: number;     // NEW: Lifespan multiplier
}

export const DEFAULT_PRESET: AnimationPreset = {
    rotationSpeed: 1.0,
    bassResponse: 1.0,
    particleDensity: 1.0,
    glowIntensity: 1.0,
    turbulence: 0.3,
    particleSpeed: 1.0,
    particleTrail: 1.0,
    particleLife: 1.0,
};

export const PRESET_STORAGE_KEY = 'nested-core-preset';

export const loadPreset = (): AnimationPreset => {
    try {
        const stored = localStorage.getItem(PRESET_STORAGE_KEY);
        if (stored) return { ...DEFAULT_PRESET, ...JSON.parse(stored) };
    } catch {}
    return { ...DEFAULT_PRESET };
};

export const savePreset = (preset: AnimationPreset): void => {
    try {
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(preset));
    } catch {}
};