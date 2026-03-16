# The Nested Core — 3D Audio Visualizer

> An immersive real-time audio visualizer built with React, Three.js and WebAudio API.
> Aesthetics inspired by the industrial sci-fi world of Half-Life: Alyx.
> 
> **[Live Demo](https://nested-core.web.app/)**

## Features
- Real-time 3D geometric core with reactive particle physics
- Three visual themes: Combine, Resonance, Synthwave
- Audio sources: file upload, microphone, system audio capture
- Orbit controls (drag to rotate, scroll to zoom)
- HIGH / LOW quality toggle (40k / 5k particles)
- CRT scanline overlay aesthetic

## Tech Stack
- React 19 + TypeScript
- Three.js (WebGL renderer, geometry, particles)
- Web Audio API (AnalyserNode, FFT)
- Tailwind CSS v4
- Vite

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Controls
| Action | Input |
|---|---|
| Rotate view | Click + drag |
| Zoom | Scroll wheel |
| Upload audio | File button |
| Use microphone | Mic button |
| System audio | System button (shares screen) |

## Project Structure
```
src/
├── components/     # UI panels (Status, ThemeSelector, ControlPanel)
├── hooks/          # useAudioEngine, useVisualizer
├── constants/      # THEMES, MAX_PARTICLES
├── types/          # Shared TypeScript types
└── App.tsx
```

## License
Apache-2.0
