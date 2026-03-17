import React, { useEffect, useRef } from 'react';
import { THEMES } from '../../constants/themes';
import { ThemeKey, Quality, AudioData } from '../../types';
import { PresetPanel } from '../PresetPanel';
import { AnimationPreset } from '../../constants/presets';

interface ThemeSelectorProps {
    themeKey: ThemeKey;
    quality: Quality;
    audioDataRef: React.MutableRefObject<AudioData>;
    preset: AnimationPreset;
    onThemeChange: (key: ThemeKey) => void;
    onQualityChange: () => void;
    onPresetChange: (key: keyof AnimationPreset, value: number) => void;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({ 
    themeKey, 
    quality, 
    audioDataRef, 
    preset,
    onThemeChange, 
    onQualityChange,
    onPresetChange
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const theme = THEMES[themeKey];
    const themeColorStr = `#${theme.glow.toString(16).padStart(6, '0')}`;
    const animationFrameId = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let frameCount = 0;

        const draw = () => {
            animationFrameId.current = requestAnimationFrame(draw);

            frameCount++;
            if (frameCount % 2 !== 0) return;

            const data = audioDataRef.current;
            if (data && data.dataArray) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const barWidth = canvas.width / 32;
                
                for (let i = 0; i < 32; i++) {
                    const value = data.dataArray[i] || 0;
                    const percent = value / 255;
                    const height = percent * canvas.height;
                    
                    ctx.fillStyle = themeColorStr;
                    ctx.globalAlpha = 0.5 + (percent * 0.5);
                    ctx.fillRect(i * barWidth, canvas.height - height, barWidth - 1, height);
                }
            }
        };

        animationFrameId.current = requestAnimationFrame(draw);

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [themeColorStr, audioDataRef]);

    return (
        <div className="absolute top-16 md:top-24 right-4 md:right-8 z-20 flex flex-col items-end gap-6 font-mono pointer-events-auto max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden pb-4 pr-2 custom-scrollbar">
            {/* Mini Spectrum */}
            <div className="flex flex-col items-end gap-2 bg-black/40 p-3 border border-white/10 backdrop-blur-md">
                <span className="text-[8px] uppercase tracking-[0.4em] text-white/40">Signal Auth</span>
                <canvas 
                    ref={canvasRef} 
                    width={80} 
                    height={20} 
                    className="opacity-80"
                />
            </div>

            {/* Themes */}
            <div className="flex flex-col items-end gap-2 w-full md:w-auto">
                <span className="text-[8px] uppercase tracking-[0.4em] text-white/40 mb-1">Visual Matrix</span>
                
                {/* Mobile: Native Select, Desktop: Buttons */}
                <select 
                    className="md:hidden bg-black/40 border border-white/20 text-white/80 text-[10px] uppercase tracking-widest p-2 outline-none w-full"
                    value={themeKey}
                    onChange={(e) => onThemeChange(e.target.value as ThemeKey)}
                >
                    {(Object.keys(THEMES) as ThemeKey[]).map((key) => (
                        <option key={key} value={key}>{THEMES[key as ThemeKey].name}</option>
                    ))}
                </select>

                <div className="hidden md:flex flex-col gap-2 w-full">
                    {(Object.keys(THEMES) as ThemeKey[]).map((key) => {
                        const isActive = themeKey === key;
                        const tColorStr = `#${THEMES[key].glow.toString(16).padStart(6, '0')}`;
                        
                        return (
                            <button
                                key={key}
                                onClick={() => onThemeChange(key as ThemeKey)}
                                className={`group relative flex items-center justify-between w-32 px-3 py-2 text-[9px] uppercase tracking-widest border transition-all duration-300 ${
                                    isActive 
                                        ? 'border-white/40 bg-white/5 text-white' 
                                        : 'border-white/10 bg-black/20 text-white/40 hover:border-white/30 hover:text-white/80 hover:-translate-y-[1px]'
                                }`}
                            >
                                <span>{THEMES[key].name}</span>
                                <div 
                                    className={`w-1.5 h-1.5 rounded-none transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-20 group-hover:opacity-60'}`}
                                    style={{ 
                                        backgroundColor: tColorStr,
                                        boxShadow: isActive ? `0 0 8px ${tColorStr}` : 'none'
                                    }}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Quality */}
            <div className="flex flex-col items-end gap-2 mt-2">
                <button
                    onClick={onQualityChange}
                    className="group relative px-4 py-2 text-[9px] uppercase tracking-[0.3em] border border-white/10 bg-black/40 text-white/50 hover:border-white/40 hover:text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] w-32"
                >
                    <span>SYS_QUAL: {quality}</span>
                </button>
            </div>

            {/* Presets */}
            <PresetPanel
                themeKey={themeKey}
                preset={preset}
                onPresetChange={onPresetChange}
            />
        </div>
    );
};