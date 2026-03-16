import React, { useEffect, useRef } from 'react';
import { Mic, Play, Pause, Upload, Monitor } from 'lucide-react';
import { AudioSourceType, ThemeKey, AudioData } from '../../types';
import { THEMES } from '../../constants/themes';
import { RadioPanel } from '../RadioPanel';
import { RadioStation } from '../../constants/radio';

interface ControlPanelProps {
    sourceType: AudioSourceType;
    isPlaying: boolean;
    themeKey: ThemeKey;
    audioDataRef: React.MutableRefObject<AudioData>;
    activeStationId: string | null;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onMicActivate: () => void;
    onSystemActivate: () => void;
    onRadioSelect: (station: RadioStation) => void;
    onTogglePlay: () => void;
    onReset: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
    sourceType,
    isPlaying,
    themeKey,
    audioDataRef,
    activeStationId,
    onFileUpload,
    onMicActivate,
    onSystemActivate,
    onRadioSelect,
    onTogglePlay,
    onReset
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

        const totalBars = 128;
        const barWidth = canvas.width / totalBars;

        const draw = () => {
            const data = audioDataRef.current;
            if (data && data.dataArray) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const step = Math.floor((data.dataArray.length / 2) / totalBars);
                
                for (let i = 0; i < totalBars; i++) {
                    const dataIndex = i * step;
                    const value = data.dataArray[dataIndex] || 0;
                    const percent = value / 255;
                    const height = percent * canvas.height;
                    
                    const intensityAlpha = 0.3 + (percent * 0.7);
                    
                    ctx.fillStyle = themeColorStr;
                    ctx.globalAlpha = intensityAlpha;
                    ctx.fillRect(i * barWidth, canvas.height - height, Math.max(1, barWidth - 1), height);
                }
            }
            animationFrameId.current = requestAnimationFrame(draw);
        };

        animationFrameId.current = requestAnimationFrame(draw);

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [themeColorStr, audioDataRef]);

    return (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-4 flex flex-col items-center gap-6 font-mono pointer-events-auto">
            
            {/* 128 Bar Spectrum */}
            <div className="w-full flex justify-center opacity-80 mix-blend-screen">
                <canvas 
                    ref={canvasRef} 
                    width={512} 
                    height={32} 
                    className="w-full max-w-lg h-8"
                />
            </div>

            <div className="flex flex-wrap justify-center gap-6 md:gap-10">
                {sourceType === 'none' ? (
                    <>
                        <label className="flex flex-col items-center gap-3 cursor-pointer group" aria-label="Upload Audio File">
                            <div className="w-12 h-12 md:w-14 md:h-14 border border-white/20 flex items-center justify-center bg-black/40 text-white/50 backdrop-blur-md transition-all duration-300 group-hover:text-white group-hover:-translate-y-[1px]"
                                 style={{ 
                                     boxShadow: 'none'
                                 }}
                            >
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: `inset 0 0 15px ${themeColorStr}40, 0 0 10px ${themeColorStr}40` }} />
                                <Upload size={18} className="relative z-10" />
                            </div>
                            <span className="text-[9px] md:text-[10px] uppercase tracking-[0.4em] text-white/40 group-hover:text-white/80 transition-colors">File</span>
                            <input type="file" accept="audio/*" onChange={onFileUpload} className="hidden" />
                        </label>

                        <button onClick={onMicActivate} className="flex flex-col items-center gap-3 group" aria-label="Activate Microphone">
                            <div className="w-12 h-12 md:w-14 md:h-14 border border-white/20 flex items-center justify-center bg-black/40 text-white/50 backdrop-blur-md transition-all duration-300 group-hover:text-white group-hover:-translate-y-[1px]">
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: `inset 0 0 15px ${themeColorStr}40, 0 0 10px ${themeColorStr}40` }} />
                                <Mic size={18} className="relative z-10" />
                            </div>
                            <span className="text-[9px] md:text-[10px] uppercase tracking-[0.4em] text-white/40 group-hover:text-white/80 transition-colors">Mic</span>
                        </button>

                        <button onClick={onSystemActivate} className="flex flex-col items-center gap-3 group" aria-label="Capture System Audio">
                            <div className="w-12 h-12 md:w-14 md:h-14 border border-white/20 flex items-center justify-center bg-black/40 text-white/50 backdrop-blur-md transition-all duration-300 group-hover:text-white group-hover:-translate-y-[1px]">
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: `inset 0 0 15px ${themeColorStr}40, 0 0 10px ${themeColorStr}40` }} />
                                <Monitor size={18} className="relative z-10" />
                            </div>
                            <span className="text-[9px] md:text-[10px] uppercase tracking-[0.4em] text-white/40 group-hover:text-white/80 transition-colors">System</span>
                        </button>
                        
                        <RadioPanel
                            themeKey={themeKey}
                            activeStationId={activeStationId}
                            isConnecting={false}
                            onSelectStation={onRadioSelect}
                        />
                    </>
                ) : (
                    <div className="flex items-center gap-6 md:gap-10">
                        <button
                            onClick={onTogglePlay}
                            aria-label={isPlaying ? "Pause Audio" : "Play Audio"}
                            className="group relative w-16 h-16 md:w-20 md:h-20 border border-white/30 flex items-center justify-center bg-black/40 text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px]"
                        >
                            <div className="absolute inset-0 opacity-50 group-hover:opacity-100 transition-opacity duration-300" 
                                 style={{ boxShadow: `inset 0 0 20px ${themeColorStr}60, 0 0 15px ${themeColorStr}60` }} />
                            <div className="relative z-10">
                                {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                            </div>
                        </button>

                        {sourceType === 'radio' && (
                            <RadioPanel
                                themeKey={themeKey}
                                activeStationId={activeStationId}
                                isConnecting={false}
                                onSelectStation={onRadioSelect}
                            />
                        )}
                    </div>
                )}
            </div>

            <button
                onClick={onReset}
                aria-label="Reset System Engine"
                className="mt-4 text-[8px] uppercase tracking-[0.6em] text-white/20 hover:text-white/80 transition-colors duration-500"
            >
                [ SYS_RESET ]
            </button>
        </div>
    );
};