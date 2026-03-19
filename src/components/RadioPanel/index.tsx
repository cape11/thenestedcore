import React, { useState } from 'react';
import { Radio, Loader } from 'lucide-react';
import { RADIO_STATIONS, RadioStation } from '../../constants/radio';
import { THEMES } from '../../constants/themes';
import { ThemeKey } from '../../types';

interface RadioPanelProps {
    themeKey: ThemeKey;
    activeStationId: string | null;
    isConnecting: boolean;
    onSelectStation: (station: RadioStation) => void;
}

export const RadioPanel: React.FC<RadioPanelProps> = ({
                                                          themeKey,
                                                          activeStationId,
                                                          isConnecting,
                                                          onSelectStation
                                                      }) => {
    const [open, setOpen] = useState(false);
    const theme = THEMES[themeKey];
    const themeColorStr = `#${theme.glow.toString(16).padStart(6, '0')}`;

    return (
        <div className="relative pointer-events-auto">
            <button
                onClick={() => setOpen(o => !o)}
                className="flex flex-col items-center gap-3 group"
                aria-label="Open Radio"
            >
                <div
                    className="w-12 h-12 md:w-14 md:h-14 border border-white/20 flex items-center justify-center bg-black/40 text-white/50 backdrop-blur-md transition-all duration-300 group-hover:text-white group-hover:-translate-y-[1px]"
                    style={open ? { boxShadow: `inset 0 0 15px ${themeColorStr}40, 0 0 10px ${themeColorStr}40`, color: 'white' } : {}}
                >
                    {isConnecting
                        ? <Loader size={18} className="animate-spin" />
                        : <Radio size={18} className="relative z-10" />
                    }
                </div>
                <span className="text-[9px] md:text-[10px] uppercase tracking-[0.4em] text-white/40 group-hover:text-white/80 transition-colors">
                    Radio
                </span>
            </button>

            {open && (
                <div className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-64 bg-black/80 border border-white/10 backdrop-blur-md flex flex-col z-30 max-h-[350px] overflow-hidden rounded-t-sm shadow-2xl">
                    <div className="p-3 border-b border-white/10 bg-black/40 flex justify-between items-center sticky top-0 z-10">
                        <span className="text-[9px] uppercase tracking-[0.4em] text-white/50 font-bold">
                            Live Streams
                        </span>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColorStr, boxShadow: `0 0 8px ${themeColorStr}` }} />
                    </div>

                    <div className="flex flex-col overflow-y-auto custom-scrollbar p-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                        {RADIO_STATIONS.map(station => (
                            <button
                                key={station.id}
                                onClick={() => { onSelectStation(station); setOpen(false); }}
                                className={`flex flex-col px-3 py-3 text-left transition-all duration-200 border border-transparent rounded-sm mb-1 last:mb-0 ${
                                    activeStationId === station.id
                                        ? 'bg-white/10 border-white/20'
                                        : 'hover:bg-white/5 hover:border-white/10'
                                }`}
                            >
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[10px] uppercase tracking-widest text-white/90 font-bold">
                                        {station.name}
                                    </span>
                                    {activeStationId === station.id && (
                                        <div className="flex gap-1 items-center ml-2">
                                            <div className="w-1 h-2 animate-[pulse_1s_ease-in-out_infinite]" style={{ backgroundColor: themeColorStr }} />
                                            <div className="w-1 h-3 animate-[pulse_1.2s_ease-in-out_infinite]" style={{ backgroundColor: themeColorStr }} />
                                            <div className="w-1 h-1.5 animate-[pulse_0.8s_ease-in-out_infinite]" style={{ backgroundColor: themeColorStr }} />
                                        </div>
                                    )}
                                </div>
                                <span className="text-[8px] tracking-[0.2em] text-white/40 mt-1 uppercase">
                                    {station.genre}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};