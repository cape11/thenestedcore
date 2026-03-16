export type ThemeKey = 'combine' | 'resonance' | 'synthwave' | 'xen';

export type AudioSourceType = 'none' | 'file' | 'mic' | 'system' | 'radio';

export interface AudioData {
  bass: number;
  treble: number;
  amplitude: number;
  dataArray: Uint8Array | null;
}

export type Quality = 'HIGH' | 'LOW' | 'ULTRA_LOW';
