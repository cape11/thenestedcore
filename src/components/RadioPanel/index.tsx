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
        <div className="relative">
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
                <div className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-56 bg-black/80 border border-white/10 backdrop-blur-md flex flex-col z-30">
                    <p className="text-[8px] uppercase tracking-[0.4em] text-white/30 px-3 pt-3 pb-2 border-b border-white/10">
                        Live Streams
                    </p>
                    {RADIO_STATIONS.map(station => (
                        <button
                            key={station.id}
                            onClick={() => { onSelectStation(station); setOpen(false); }}
                            className={`flex flex-col px-3 py-2.5 text-left transition-all duration-200 border-b border-white/5 last:border-0 hover:bg-white/5 ${
                                activeStationId === station.id ? 'bg-white/5' : ''
                            }`}
                        >
                            <div className="flex items-center justify-between w-full">
                                <span className="text-[10px] uppercase tracking-widest text-white/80">
                                    {station.name}
                                </span>
                                {activeStationId === station.id && (
                                    <div
                                        className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0 ml-2"
                                        style={{ backgroundColor: themeColorStr }}
                                    />
                                )}
                            </div>
                            <span className="text-[8px] tracking-wider text-white/30 mt-0.5">
                                {station.genre}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};