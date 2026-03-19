import React, { useEffect, useRef } from 'react';
import { THEMES } from '../../constants/themes';
import { ThemeKey, AudioData } from '../../types';
import { RadioStation } from '../../constants/radio';

interface StatusPanelProps {
    themeKey: ThemeKey;
    audioStatus: string;
    audioDataRef: React.MutableRefObject<AudioData>;
    isPlaying: boolean;
    isUIVisible: boolean;
    activeStation?: RadioStation | null;
    currentSong?: { artist: string; title: string } | null;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({
                                                            themeKey,
                                                            audioStatus,
                                                            audioDataRef,
                                                            isPlaying,
                                                            isUIVisible,
                                                            activeStation,
                                                            currentSong
                                                        }) => {
    const theme = THEMES[themeKey];
    const themeColorStr = `#${theme.glow.toString(16).padStart(6, '0')}`;

    const signalRef = useRef<HTMLDivElement>(null);
    const vuMeterRef = useRef<HTMLDivElement>(null);
    const animationFrameId = useRef<number | null>(null);

    useEffect(() => {
        const segments = 20;
        let frameCount = 0;

        const updateUI = () => {
            animationFrameId.current = requestAnimationFrame(updateUI);

            if (!isUIVisible) return;

            frameCount++;
            if (frameCount % 2 !== 0) return;

            if (!signalRef.current || !vuMeterRef.current) return;
            const data = audioDataRef.current;

            signalRef.current.style.opacity = (0.5 + data.bass * 0.5).toString();
            signalRef.current.style.boxShadow = `0 0 ${10 + data.bass * 20}px ${themeColorStr}`;
            signalRef.current.style.transform = `scaleY(${0.8 + data.bass * 0.4})`;

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
        };

        animationFrameId.current = requestAnimationFrame(updateUI);

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [themeColorStr, audioDataRef, isUIVisible]);

    let statusColor = 'bg-yellow-500';
    if (audioStatus.includes('ERROR') || audioStatus.includes('DENIED')) statusColor = 'bg-red-500';
    else if (isPlaying) statusColor = 'bg-green-500';

    return (
        <div className="absolute top-4 left-4 md:top-8 md:left-8 z-20 pointer-events-none select-none flex flex-col gap-4 font-mono">
            <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] pointer-events-none opacity-50 mix-blend-overlay" />

            <div className="flex items-start gap-4">
                <div
                    ref={signalRef}
                    className="w-2 h-12 transition-all duration-75 mt-1"
                    style={{ backgroundColor: themeColorStr }}
                />

                <div className="flex flex-col">
                    <p className="text-[8px] md:text-[10px] tracking-[0.5em] text-white/50 uppercase font-bold mb-1">
                        System // {theme.name.toUpperCase()}
                    </p>
                    <h1 className="text-xl md:text-2xl font-light tracking-[0.3em] text-white/90 uppercase border-b border-white/10 pb-2 mb-2 w-48 md:w-64 overflow-hidden text-ellipsis whitespace-nowrap"
                        style={{ textShadow: `0 0 10px ${themeColorStr}40` }}
                        title={activeStation ? activeStation.name : 'Data Terminal'}
                    >
                        {activeStation ? activeStation.name : 'Data Terminal'}
                    </h1>

                    {currentSong && activeStation && isPlaying && (
                        <div className="flex flex-col mb-3 max-w-48 md:max-w-64 border-l-2 pl-3 py-1 bg-white/[0.02]" style={{ borderColor: themeColorStr }}>
                            <p className="text-[11px] md:text-xs text-white/90 font-bold truncate tracking-widest uppercase" title={currentSong.title}>{currentSong.title}</p>
                            <p className="text-[9px] text-white/50 truncate tracking-[0.2em] uppercase mt-0.5" title={currentSong.artist}>{currentSong.artist}</p>
                        </div>
                    )}

                    {!currentSong && (
                        <div className="flex items-center gap-2 mb-3 max-w-[12rem] md:max-w-none">
                            <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`}
                                 style={{ boxShadow: isPlaying ? `0 0 8px ${statusColor}` : 'none' }} />
                            <p className="text-[10px] tracking-[0.2em] text-white/60 uppercase truncate">
                                {audioStatus}
                            </p>
                        </div>
                    )}

                    <div ref={vuMeterRef} className="flex gap-[2px] w-48 md:w-64 h-2">
                        {Array.from({ length: 20 }).map((_, i) => (
                            <div key={i} className="flex-1 transition-all duration-75" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};