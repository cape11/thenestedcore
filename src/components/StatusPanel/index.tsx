import React, { useEffect, useRef } from 'react';
import { THEMES } from '../../constants/themes';
import { ThemeKey, AudioData } from '../../types';

interface StatusPanelProps {
    themeKey: ThemeKey;
    audioStatus: string;
    audioDataRef: React.MutableRefObject<AudioData>;
    isPlaying: boolean;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({ themeKey, audioStatus, audioDataRef, isPlaying }) => {
    const theme = THEMES[themeKey];
    const themeColorStr = `#${theme.glow.toString(16).padStart(6, '0')}`;

    const signalRef = useRef<HTMLDivElement>(null);
    const vuMeterRef = useRef<HTMLDivElement>(null);
    const animationFrameId = useRef<number | null>(null);

    useEffect(() => {
        const segments = 20;
        
        const updateUI = () => {
            if (!signalRef.current || !vuMeterRef.current) return;
            const data = audioDataRef.current;
            
            // Update signal
            signalRef.current.style.opacity = (0.5 + data.bass * 0.5).toString();
            signalRef.current.style.boxShadow = `0 0 ${10 + data.bass * 20}px ${themeColorStr}`;
            signalRef.current.style.transform = `scaleY(${0.8 + data.bass * 0.4})`;
            
            // Update VU meter
            const activeSegments = Math.floor(data.amplitude * segments);
            const children = vuMeterRef.current.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLDivElement;
                if (i < activeSegments) {
                    child.style.backgroundColor = themeColorStr;
                    child.style.opacity = (0.8 + data.amplitude * 0.2).toString();
                } else {
                    child.style.backgroundColor = 'rgba(255,255,255,0.1)';
                    child.style.opacity = '0.3';
                }
            }
            
            animationFrameId.current = requestAnimationFrame(updateUI);
        };
        
        animationFrameId.current = requestAnimationFrame(updateUI);
        
        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [themeColorStr, audioDataRef]);

    let statusColor = 'bg-yellow-500';
    if (audioStatus.includes('ERROR') || audioStatus.includes('DENIED')) statusColor = 'bg-red-500';
    else if (isPlaying) statusColor = 'bg-green-500';

    return (
        <div className="absolute top-8 left-8 z-20 pointer-events-none select-none flex flex-col gap-4 font-mono">
            {/* Scanline Overlay specific to panel */}
            <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] pointer-events-none opacity-50 mix-blend-overlay" />
            
            <div className="flex items-start gap-4">
                {/* Signal Indicator */}
                <div 
                    ref={signalRef}
                    className="w-2 h-12 transition-all duration-75"
                    style={{ backgroundColor: themeColorStr }} 
                />
                
                <div className="flex flex-col">
                    <p className="text-[10px] tracking-[0.5em] text-white/50 uppercase font-bold mb-1">
                        System // {theme.name.toUpperCase()}
                    </p>
                    <h1 className="text-2xl font-light tracking-[0.3em] text-white/90 uppercase border-b border-white/10 pb-2 mb-2 w-64"
                        style={{ textShadow: `0 0 10px ${themeColorStr}40` }}>
                        Data Terminal
                    </h1>

                    <div className="flex items-center gap-2 mb-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} 
                             style={{ boxShadow: isPlaying ? `0 0 8px ${statusColor}` : 'none' }} />
                        <p className="text-[10px] tracking-[0.2em] text-white/60 uppercase">
                            {audioStatus}
                        </p>
                    </div>

                    {/* Industrial VU Meter */}
                    <div ref={vuMeterRef} className="flex gap-[2px] w-64 h-2">
                        {Array.from({ length: 20 }).map((_, i) => (
                            <div key={i} className="flex-1 transition-all duration-75" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
