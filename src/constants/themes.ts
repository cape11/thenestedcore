import { Quality } from '../types';

export const PARTICLE_TIERS = {
    HIGH:       15000,
    LOW:         5000,
    ULTRA_LOW:   1500,
} as const;

export const MAX_PARTICLES = 15000;

export const THEMES = {
    combine: {
        name: 'Combine',
        glow: 0x4ade80,
        accent: 0x0077ff,
        bgGradient: 'rgba(0, 119, 255, 0.15)',
        palette: [0x00ffff, 0x00aaff, 0x0077ff, 0x44eeff, 0xffffff, 0x00e5ff]
    },
    resonance: {
        name: 'Resonance',
        glow: 0xff6600,
        accent: 0xff2200,
        bgGradient: 'rgba(255, 68, 0, 0.2)',
        palette: [0xff4400, 0xff2200, 0xff8800, 0xffaa00, 0xffffff, 0xcc0000, 0xffaa00]
    },
    synthwave: {
        name: 'Synthwave',
        glow: 0xff00aa,
        accent: 0x00ffff,
        bgGradient: 'rgba(255, 0, 255, 0.2)',
        palette: [0xff00ff, 0x00ffff, 0xff00aa, 0xaa00ff, 0xffffff, 0x00e5ff, 0xff00ff]
    },
    xen: {
        name: 'Xen',
        glow: 0x39ff14,
        accent: 0x7b2fff,
        bgGradient: 'rgba(100, 20, 200, 0.18)',
        palette: [0x39ff14, 0x00ff88, 0x7b2fff, 0xc800ff, 0x00ffcc, 0xffffff, 0x44ff44]
    }
};

export const DEFAULT_THEME_KEY = 'combine';
export const DEFAULT_QUALITY = 'HIGH';

export const QUALITY_PARTICLE_LIMITS: Record<Quality, number> = {
    HIGH: 15000,
    LOW: 5000,
    ULTRA_LOW: 1500,
};