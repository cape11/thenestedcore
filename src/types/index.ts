export type ThemeKey = 'combine' | 'resonance' | 'synthwave';

export type AudioSourceType = 'none' | 'file' | 'mic' | 'system';

export interface AudioData {
  bass: number;
  treble: number;
  amplitude: number;
  dataArray: Uint8Array | null;
}

export type Quality = 'HIGH' | 'LOW';
