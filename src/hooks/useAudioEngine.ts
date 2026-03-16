import { useState, useRef, useEffect, useCallback } from 'react';
import { AudioSourceType, AudioData } from '../types';
import { RADIO_STATIONS, RadioStation } from '../constants/radio';

const smoothAudio = (current: number, target: number, attack: number, release: number) => {
    return target > current
        ? current + (target - current) * attack
        : current + (target - current) * release;
};

export const useAudioEngine = () => {
    const [audioStatus, setAudioStatus] = useState('AWAITING AUDIO STREAM');
    const [isPlaying, setIsPlaying] = useState(false);
    const [sourceType, setSourceType] = useState<AudioSourceType>('none');
    const [activeStation, setActiveStation] = useState<RadioStation | null>(null);
    
    // Use Ref instead of state for high-frequency data
    const audioDataRef = useRef<AudioData>({ bass: 0, treble: 0, amplitude: 0, dataArray: null });

    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);
    const smoothedBassRef = useRef(0);
    const smoothedTrebleRef = useRef(0);
    const smoothedAmplitudeRef = useRef(0);
    const isPlayingRef = useRef(false);
    const animationFrameId = useRef<number | null>(null);
    const radioElementRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    const initAudio = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioCtxRef.current.createAnalyser();
            analyserRef.current.fftSize = 512;
            dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
        }
    };

    const startTickLoop = useCallback(() => {
        const tick = () => {
            let bass = 0;
            let treble = 0;
            let amplitude = 0;

            if (analyserRef.current && dataArrayRef.current && isPlayingRef.current) {
                analyserRef.current.getByteFrequencyData(dataArrayRef.current);

                let bassSum = 0;
                for (let i = 0; i < 5; i++) bassSum += dataArrayRef.current[i];
                bass = bassSum / 5;

                let trebleSum = 0;
                for (let i = 50; i < 150; i++) trebleSum += dataArrayRef.current[i];
                treble = trebleSum / 100;

                let ampSum = 0;
                for (let i = 0; i < analyserRef.current.frequencyBinCount; i++) ampSum += dataArrayRef.current[i];
                amplitude = ampSum / analyserRef.current.frequencyBinCount;

                smoothedBassRef.current = smoothAudio(smoothedBassRef.current, bass / 255, 0.8, 0.08);
                smoothedTrebleRef.current = smoothAudio(smoothedTrebleRef.current, treble / 255, 0.6, 0.1);
                smoothedAmplitudeRef.current = smoothAudio(smoothedAmplitudeRef.current, amplitude / 255, 0.5, 0.1);
            } else {
                const time = Date.now() / 1000;
                smoothedBassRef.current = smoothAudio(smoothedBassRef.current, (Math.sin(time * 3) * 0.5 + 0.5) * 0.4, 0.1, 0.1);
                smoothedTrebleRef.current = smoothAudio(smoothedTrebleRef.current, (Math.cos(time * 8) * 0.5 + 0.5) * 0.2, 0.1, 0.1);
                smoothedAmplitudeRef.current = smoothAudio(smoothedAmplitudeRef.current, 0.05, 0.1, 0.1);
            }

            const amp = Math.max(0, smoothedAmplitudeRef.current);
            document.body.style.setProperty('--audio-amp', amp.toString());

            audioDataRef.current = {
                bass: Math.max(0, smoothedBassRef.current),
                treble: Math.max(0, smoothedTrebleRef.current),
                amplitude: amp,
                dataArray: dataArrayRef.current
            };

            animationFrameId.current = requestAnimationFrame(tick);
        };
        
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = requestAnimationFrame(tick);
    }, []);

    useEffect(() => {
        startTickLoop();
        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [startTickLoop]);

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        initAudio();
        setSourceType('file');
        setAudioStatus('DECODING AUDIO DATA...');

        const reader = new FileReader();
        reader.onload = async (event) => {
            const buffer = await audioCtxRef.current!.decodeAudioData(event.target?.result as ArrayBuffer);
            if (sourceRef.current) sourceRef.current.disconnect();

            const source = audioCtxRef.current!.createBufferSource();
            source.buffer = buffer;
            source.connect(analyserRef.current!);
            analyserRef.current!.connect(audioCtxRef.current!.destination);
            source.start(0);

            sourceRef.current = source;
            setIsPlaying(true);
            setAudioStatus('AUDIO FILE SYNCED');
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const activateMic = useCallback(async () => {
        try {
            initAudio();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (sourceRef.current) sourceRef.current.disconnect();

            const source = audioCtxRef.current!.createMediaStreamSource(stream);
            source.connect(analyserRef.current!);

            sourceRef.current = source;
            setSourceType('mic');
            setIsPlaying(true);
            setAudioStatus('MIC SENSOR ACTIVE');
        } catch (err) {
            setAudioStatus('ERROR: MIC ACCESS DENIED');
        }
    }, []);

    const activateSystemAudio = useCallback(async () => {
        try {
            initAudio();
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (stream.getAudioTracks().length === 0) throw new Error("No audio track");

            if (sourceRef.current) sourceRef.current.disconnect();
            const source = audioCtxRef.current!.createMediaStreamSource(stream);
            source.connect(analyserRef.current!);

            sourceRef.current = source;
            setSourceType('system');
            setIsPlaying(true);
            setAudioStatus('PC AUDIO LINKED');

            stream.getVideoTracks()[0].onended = () => {
                setIsPlaying(false);
                setAudioStatus('AWAITING AUDIO STREAM');
            };
        } catch (err: any) {
            setAudioStatus(`ERROR: ${err.message.toUpperCase()}`);
        }
    }, []);

    const activateRadio = useCallback(async (station: RadioStation) => {
        try {
            initAudio();

            // Limpiar fuente anterior
            if (radioElementRef.current) {
                radioElementRef.current.pause();
                radioElementRef.current.src = '';
            }
            if (sourceRef.current) sourceRef.current.disconnect();

            setAudioStatus('CONNECTING TO STREAM...');

            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.src = station.url;
            audio.preload = 'none';
            radioElementRef.current = audio;

            const source = audioCtxRef.current!.createMediaElementSource(audio);
            source.connect(analyserRef.current!);
            analyserRef.current!.connect(audioCtxRef.current!.destination);
            sourceRef.current = source;

            await audio.play();

            setSourceType('radio');
            setActiveStation(station);
            setIsPlaying(true);
            setAudioStatus(`STREAM: ${station.name.toUpperCase()}`);
        } catch (err: any) {
            setAudioStatus(`ERROR: STREAM UNAVAILABLE`);
            setSourceType('none');
        }
    }, []);

    const togglePlay = useCallback(() => {
        if (!audioCtxRef.current) return;
        if (isPlaying) {
            audioCtxRef.current.suspend();
            if (sourceType === 'radio' && radioElementRef.current) radioElementRef.current.pause();
            setIsPlaying(false);
            setAudioStatus('SYSTEM PAUSED');
        } else {
            audioCtxRef.current.resume();
            if (sourceType === 'radio' && radioElementRef.current) radioElementRef.current.play();
            setIsPlaying(true);
            setAudioStatus(
                sourceType === 'mic' ? 'MIC SENSOR ACTIVE' :
                sourceType === 'system' ? 'PC AUDIO LINKED' :
                sourceType === 'radio' ? `STREAM: ${activeStation?.name.toUpperCase()}` :
                'AUDIO FILE SYNCED'
            );
        }
    }, [isPlaying, sourceType, activeStation]);

    return {
        audioStatus,
        isPlaying,
        sourceType,
        audioDataRef,
        activeStation,
        handleFileUpload,
        activateMic,
        activateSystemAudio,
        activateRadio,
        togglePlay
    };
};
