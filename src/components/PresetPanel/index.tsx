import React from 'react';
import { AnimationPreset } from '../../constants/presets';
import { THEMES } from '../../constants/themes';
import { ThemeKey } from '../../types';

interface PresetPanelProps {
    themeKey: ThemeKey;
    preset: AnimationPreset;
    onPresetChange: (key: keyof AnimationPreset, value: number) => void;
}

const SLIDERS: { key: keyof AnimationPreset; label: string; min: number; max: number; step: number }[] = [
    { key: 'rotationSpeed',   label: 'Rotation',  min: 0, max: 2,   step: 0.05 },
    { key: 'bassResponse',    label: 'Bass',       min: 0, max: 3,   step: 0.05 },
    { key: 'particleDensity', label: 'Particles',  min: 0, max: 2,   step: 0.05 },
    { key: 'glowIntensity',   label: 'Glow',       min: 0, max: 2,   step: 0.05 },
    { key: 'turbulence',      label: 'Turbulence', min: 0, max: 1,   step: 0.05 },
];

export const PresetPanel: React.FC<PresetPanelProps> = ({ themeKey, preset, onPresetChange }) => {
    const theme = THEMES[themeKey];
    const themeColorStr = `#${theme.glow.toString(16).padStart(6, '0')}`;

    return (
        <div className="flex flex-col gap-2 bg-black/40 border border-white/10 backdrop-blur-md p-3 w-40">
            <span className="text-[8px] uppercase tracking-[0.4em] text-white/40 mb-1">Sys Config</span>
            {SLIDERS.map(({ key, label, min, max, step }) => (
                <div key={key} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                        <span className="text-[8px] uppercase tracking-widest text-white/40">{label}</span>
                        <span className="text-[8px] text-white/60" style={{ color: themeColorStr }}>
                            {preset[key].toFixed(2)}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={preset[key]}
                        onChange={e => onPresetChange(key, parseFloat(e.target.value))}
                        className="w-full h-[2px] appearance-none bg-white/10 cursor-pointer"
                        style={{ accentColor: themeColorStr }}
                    />
                </div>
            ))}
        </div>
    );
};