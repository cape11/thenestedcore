import React, { useRef, useState } from 'react';
import { ThemeKey, Quality } from './types';
import { THEMES, DEFAULT_THEME_KEY, DEFAULT_QUALITY } from './constants/themes';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useVisualizer } from './hooks/useVisualizer';
import { StatusPanel } from './components/StatusPanel';
import { ThemeSelector } from './components/ThemeSelector';
import { ControlPanel } from './components/ControlPanel';
import { loadPreset, savePreset, AnimationPreset } from './constants/presets';

export default function App() {
  const [themeKey, setThemeKey] = useState<ThemeKey>(DEFAULT_THEME_KEY);
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
  const [preset, setPreset] = useState<AnimationPreset>(loadPreset);
  const containerRef = useRef<HTMLDivElement>(null);

  const audio = useAudioEngine();
  
  useVisualizer({ 
    containerRef, 
    themeKey, 
    quality, 
    audioDataRef: audio.audioDataRef,
    preset
  });

  const handleQualityChange = () => {
    setQuality(prev => prev === 'HIGH' ? 'LOW' : 'HIGH');
  };

  const handlePresetChange = (key: keyof AnimationPreset, value: number) => {
    setPreset(prev => {
        const next = { ...prev, [key]: value };
        savePreset(next);
        return next;
    });
  };

  const handleReset = () => {
    window.location.reload();
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0a1520] font-sans text-white">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a3a4a] via-[#0a1520] to-[#0a252a] opacity-95 pointer-events-none z-0" />
      <div
        className="absolute inset-0 pointer-events-none z-0 transition-colors duration-1000"
        style={{ background: `radial-gradient(circle at 60% 40%, ${THEMES[themeKey].bgGradient} 0%, transparent 70%)` }}
      />

      {/* WebGL Container */}
      <div ref={containerRef} className="absolute inset-0 z-10 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* UI Panels */}
      <StatusPanel 
        themeKey={themeKey} 
        audioStatus={audio.audioStatus} 
        audioDataRef={audio.audioDataRef} 
        isPlaying={audio.isPlaying} 
      />
      
      <ThemeSelector 
        themeKey={themeKey} 
        quality={quality} 
        audioDataRef={audio.audioDataRef} 
        preset={preset}
        onThemeChange={setThemeKey} 
        onQualityChange={handleQualityChange} 
        onPresetChange={handlePresetChange}
      />
      
      <ControlPanel 
        sourceType={audio.sourceType}
        isPlaying={audio.isPlaying}
        themeKey={themeKey}
        audioDataRef={audio.audioDataRef}
        activeStationId={audio.activeStation?.id ?? null}
        onFileUpload={audio.handleFileUpload}
        onMicActivate={audio.activateMic}
        onSystemActivate={audio.activateSystemAudio}
        onRadioSelect={audio.activateRadio}
        onTogglePlay={audio.togglePlay}
        onReset={handleReset}
      />

      {/* CRT Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] z-30" />
    </div>
  );
}
