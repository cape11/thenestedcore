import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEMES, QUALITY_PARTICLE_LIMITS } from '../constants/themes';
import { ThemeKey, Quality, AudioData } from '../types';
import { PARTICLE_TIERS } from '../constants/themes';
import { AnimationPreset } from '../constants/presets';

interface VisualizerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    themeKey: ThemeKey;
    quality: Quality;
    audioDataRef: React.MutableRefObject<AudioData>;
    preset: AnimationPreset;
    onAutoQualityChange?: (quality: Quality) => void;
}

// --- Curl Noise Helpers ---

const snoise = (x: number, y: number, z: number): number => {
    return (
        Math.sin(x * 1.7 + z * 0.3) * Math.cos(y * 2.1 - x * 0.7) +
        Math.sin(y * 1.3 + x * 0.9) * Math.cos(z * 1.8 + y * 0.4) +
        Math.sin(z * 2.4 - y * 1.1) * Math.cos(x * 1.5 + z * 0.6)
    ) / 3.0;
};

const CURL_GRID_SIZE = 16;
const CURL_GRID_TOTAL = CURL_GRID_SIZE * CURL_GRID_SIZE * CURL_GRID_SIZE;
const curlGridBuffer = new Float32Array(CURL_GRID_TOTAL * 3);

const CURL_WORLD_MIN = -15.0;
const CURL_WORLD_MAX =  15.0;
const CURL_WORLD_RANGE = CURL_WORLD_MAX - CURL_WORLD_MIN;

const updateCurlGrid = (t: number, turbulence: number) => {
    const scale = 0.35 + (turbulence * 0.15);
    const ts = t * 0.12;
    const eps = 0.1;

    for (let xi = 0; xi < CURL_GRID_SIZE; xi++) {
        for (let yi = 0; yi < CURL_GRID_SIZE; yi++) {
            for (let zi = 0; zi < CURL_GRID_SIZE; zi++) {
                const wx = CURL_WORLD_MIN + (xi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;
                const wy = CURL_WORLD_MIN + (yi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;
                const wz = CURL_WORLD_MIN + (zi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;

                const sx = wx * scale, sy = wy * scale, sz = wz * scale;

                const dFy_dz = (snoise(sx, sy, sz + eps + ts) - snoise(sx, sy, sz - eps + ts)) / (2 * eps);
                const dFz_dy = (snoise(sx, sy + eps, sz + ts) - snoise(sx, sy - eps, sz + ts)) / (2 * eps);
                const dFz_dx = (snoise(sx + eps, sy, sz + ts) - snoise(sx - eps, sy, sz + ts)) / (2 * eps);
                const dFx_dz = (snoise(sx, sy, sz + eps + ts) - snoise(sx, sy, sz - eps + ts)) / (2 * eps);
                const dFx_dy = (snoise(sx, sy + eps, sz + ts) - snoise(sx, sy - eps, sz + ts)) / (2 * eps);
                const dFy_dx = (snoise(sx + eps, sy, sz + ts) - snoise(sx - eps, sy, sz + ts)) / (2 * eps);

                const idx = (xi * CURL_GRID_SIZE * CURL_GRID_SIZE + yi * CURL_GRID_SIZE + zi) * 3;
                curlGridBuffer[idx]     = dFy_dz - dFz_dy;
                curlGridBuffer[idx + 1] = dFz_dx - dFx_dz;
                curlGridBuffer[idx + 2] = dFx_dy - dFy_dx;
            }
        }
    }
};

// OPTIMIZATION 1: Pass an 'out' object to prevent garbage collection spikes (no more 15,000 objects generated per frame)
const sampleCurlGrid = (px: number, py: number, pz: number, out: { x: number, y: number, z: number }) => {
    const tx = Math.max(0, Math.min(1, (px - CURL_WORLD_MIN) / CURL_WORLD_RANGE));
    const ty = Math.max(0, Math.min(1, (py - CURL_WORLD_MIN) / CURL_WORLD_RANGE));
    const tz = Math.max(0, Math.min(1, (pz - CURL_WORLD_MIN) / CURL_WORLD_RANGE));

    const gx = Math.min(CURL_GRID_SIZE - 2, Math.floor(tx * (CURL_GRID_SIZE - 1)));
    const gy = Math.min(CURL_GRID_SIZE - 2, Math.floor(ty * (CURL_GRID_SIZE - 1)));
    const gz = Math.min(CURL_GRID_SIZE - 2, Math.floor(tz * (CURL_GRID_SIZE - 1)));

    const fx = tx * (CURL_GRID_SIZE - 1) - gx;
    const fy = ty * (CURL_GRID_SIZE - 1) - gy;
    const fz = tz * (CURL_GRID_SIZE - 1) - gz;

    const G = CURL_GRID_SIZE;
    const idx = (x: number, y: number, z: number) => (x * G * G + y * G + z) * 3;

    const i000 = idx(gx,   gy,   gz  );
    const i100 = idx(gx+1, gy,   gz  );
    const i010 = idx(gx,   gy+1, gz  );
    const i110 = idx(gx+1, gy+1, gz  );
    const i001 = idx(gx,   gy,   gz+1);
    const i101 = idx(gx+1, gy,   gz+1);
    const i011 = idx(gx,   gy+1, gz+1);
    const i111 = idx(gx+1, gy+1, gz+1);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const interpComponent = (offset: number) =>
        lerp(
            lerp(lerp(curlGridBuffer[i000+offset], curlGridBuffer[i100+offset], fx),
                lerp(curlGridBuffer[i010+offset], curlGridBuffer[i110+offset], fx), fy),
            lerp(lerp(curlGridBuffer[i001+offset], curlGridBuffer[i101+offset], fx),
                lerp(curlGridBuffer[i011+offset], curlGridBuffer[i111+offset], fx), fy),
            fz
        );

    out.x = interpComponent(0);
    out.y = interpComponent(1);
    out.z = interpComponent(2);
};

const detectParticleTier = (): 'HIGH' | 'LOW' | 'ULTRA_LOW' => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return 'ULTRA_LOW';

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'ULTRA_LOW';

    const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    if (maxTextures <= 8) return 'ULTRA_LOW';
    if (maxTextures <= 12) return 'LOW';
    return 'HIGH';
};

export const useVisualizer = ({
                                  containerRef,
                                  themeKey,
                                  quality,
                                  audioDataRef,
                                  preset,
                                  onAutoQualityChange
                              }: VisualizerProps) => {

    const themeRef = useRef(THEMES[themeKey]);
    const qualityRef = useRef(quality);
    const presetRef = useRef(preset);

    // OPTIMIZATION 2: Pre-allocate a small dynamic palette array instead of 15,000 individual THREE.Colors
    const currentPaletteRef = useRef<THREE.Color[]>([]);

    useEffect(() => { themeRef.current = THEMES[themeKey]; }, [themeKey]);
    useEffect(() => { qualityRef.current = quality; }, [quality]);
    useEffect(() => { presetRef.current = preset; }, [preset]);

    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const coreGroupRef = useRef<THREE.Group | null>(null);
    const outerIcoRef = useRef<THREE.Mesh | null>(null);

    const vertexSpritesRef = useRef<any[]>([]);
    const edgeCylindersRef = useRef<any[]>([]);
    const particlesRef = useRef<THREE.LineSegments | null>(null);
    const lightsRef = useRef<any>({});

    const animationFrameId = useRef<number | null>(null);

    const createGlowTexture = (colorHex: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        const color = new THREE.Color(colorHex);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.1, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.9)`);
        gradient.addColorStop(0.3, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.4)`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    };

    const createCoreTexture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    };

    const generateEnvironmentMap = (renderer: THREE.WebGLRenderer) => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();

        const envCanvas = document.createElement('canvas');
        envCanvas.width = 1024;
        envCanvas.height = 512;
        const ctx = envCanvas.getContext('2d')!;

        ctx.fillStyle = '#010204';
        ctx.fillRect(0, 0, 1024, 512);

        const addLightPanel = (x: number, y: number, w: number, h: number, color: string) => {
            const grad = ctx.createRadialGradient(x + w/2, y + h/2, 0, x + w/2, y + h/2, Math.max(w, h)/2);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, w, h);
        };

        addLightPanel(256, -100, 512, 300, 'rgba(150, 220, 255, 0.8)');
        addLightPanel(0, 400, 1024, 300, 'rgba(0, 100, 255, 0.5)');
        addLightPanel(-100, 200, 400, 200, 'rgba(74, 222, 128, 0.4)');
        addLightPanel(724, 200, 400, 200, 'rgba(0, 119, 255, 0.4)');

        const envTex = new THREE.CanvasTexture(envCanvas);
        envTex.mapping = THREE.EquirectangularReflectionMapping;

        const envMap = pmremGenerator.fromEquirectangular(envTex).texture;
        envTex.dispose();
        return envMap;
    };

    useEffect(() => {
        if (rendererRef.current) {
            rendererRef.current.setPixelRatio(
                quality === 'HIGH'
                    ? Math.min(window.devicePixelRatio, 2)
                    : quality === 'LOW'
                        ? Math.min(window.devicePixelRatio, 1.5)
                        : 1
            );
        }
    }, [quality]);

    useEffect(() => {
        if (!containerRef.current) return;

        const isHighQuality = qualityRef.current === 'HIGH';

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        scene.fog = new THREE.FogExp2(0x0a1622, 0.04);

        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
        camera.position.set(0, 0, 10);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({
            antialias: isHighQuality,
            alpha: true,
            powerPreference: isHighQuality ? "high-performance" : "default",
            precision: isHighQuality ? "highp" : "mediump",
        });
        renderer.setPixelRatio(
            qualityRef.current === 'HIGH'
                ? Math.min(window.devicePixelRatio, 2)
                : qualityRef.current === 'LOW'
                    ? Math.min(window.devicePixelRatio, 1.5)
                    : 1
        );
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enablePan = false;
        controls.minDistance = 3;
        controls.maxDistance = 25;
        controlsRef.current = controls;

        const handleResize = () => {
            if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
            const width = containerRef.current.clientWidth || window.innerWidth;
            const height = containerRef.current.clientHeight || window.innerHeight;
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(width, height);
        };

        const resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(containerRef.current);
        handleResize();

        const coreGroup = new THREE.Group();
        scene.add(coreGroup);
        coreGroupRef.current = coreGroup;

        const studioEnvMap = generateEnvironmentMap(renderer);

        const mainMat = isHighQuality
            ? new THREE.MeshPhysicalMaterial({
                color: 0x05080c,
                metalness: 1.0,
                roughness: 0.12,
                envMap: studioEnvMap,
                envMapIntensity: 1.5,
                flatShading: true,
                clearcoat: 1.0,
                clearcoatRoughness: 0.05,
            })
            : new THREE.MeshStandardMaterial({
                color: 0x05080c,
                metalness: 0.9,
                roughness: 0.2,
                envMap: studioEnvMap,
                envMapIntensity: 1.2,
                flatShading: true,
            });

        const icoGeo = new THREE.IcosahedronGeometry(1.6, 0);
        const outerIco = new THREE.Mesh(icoGeo, mainMat);
        coreGroup.add(outerIco);
        outerIcoRef.current = outerIco;

        const edgeGroup = new THREE.Group();
        const edgeGeo = new THREE.EdgesGeometry(icoGeo);
        const edgePos = edgeGeo.attributes.position.array;

        const edgeMat = isHighQuality
            ? new THREE.MeshPhysicalMaterial({
                color: 0x02050a,
                metalness: 1.0,
                roughness: 0.2,
                envMap: studioEnvMap,
                envMapIntensity: 1.0,
                flatShading: true,
                emissive: new THREE.Color(0x001133),
                emissiveIntensity: 0.2
            })
            : new THREE.MeshStandardMaterial({
                color: 0x02050a,
                metalness: 0.8,
                roughness: 0.3,
                envMap: studioEnvMap,
                envMapIntensity: 0.8,
                flatShading: true,
                emissive: new THREE.Color(0x001133),
                emissiveIntensity: 0.15
            });

        for (let i = 0; i < edgePos.length; i += 6) {
            const v1 = new THREE.Vector3(edgePos[i], edgePos[i+1], edgePos[i+2]);
            const v2 = new THREE.Vector3(edgePos[i+3], edgePos[i+4], edgePos[i+5]);
            const distance = v1.distanceTo(v2);
            const cylinderGeo = new THREE.CylinderGeometry(0.015, 0.015, distance, 6);
            const cylinder = new THREE.Mesh(cylinderGeo, edgeMat);
            const midPoint = v1.clone().lerp(v2, 0.5);
            cylinder.position.copy(midPoint);
            cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
            edgeGroup.add(cylinder);
            edgeCylindersRef.current.push({ mesh: cylinder });
        }
        edgeGroup.scale.setScalar(1.001);
        outerIco.add(edgeGroup);

        const glowTex = createGlowTexture(themeRef.current.glow);
        const coreTex = createCoreTexture();
        const vertexPos = icoGeo.attributes.position;
        const spriteMat = new THREE.SpriteMaterial({
            map: glowTex,
            color: themeRef.current.glow,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false
        });
        const coreMat = new THREE.SpriteMaterial({
            map: coreTex,
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false
        });

        for (let i = 0; i < vertexPos.count; i++) {
            const sprite = new THREE.Sprite(spriteMat.clone());
            const baseVec = new THREE.Vector3().fromBufferAttribute(vertexPos, i);
            sprite.position.copy(baseVec);
            sprite.scale.set(0.18, 0.18, 1);

            const coreSprite = new THREE.Sprite(coreMat.clone());
            coreSprite.scale.set(0.05, 0.05, 1);
            sprite.add(coreSprite);

            let pLight: THREE.PointLight | null = null;
            if (isHighQuality) {
                pLight = new THREE.PointLight(themeRef.current.glow, 1.2, 1.5);
                pLight.position.copy(baseVec).multiplyScalar(0.05);
                sprite.add(pLight);
            }

            outerIco.add(sprite);
            vertexSpritesRef.current.push({
                mesh: sprite,
                coreMesh: coreSprite,
                light: pLight,
                basePos: baseVec.clone(),
                spriteMat: sprite.material
            });
        }

        // --- Particle System ---
        const deviceTier = detectParticleTier();
        const tierOrder = ['ULTRA_LOW', 'LOW', 'HIGH'] as const;
        const effectiveTier = tierOrder[
            Math.min(tierOrder.indexOf(deviceTier), tierOrder.indexOf(qualityRef.current as any))
            ] ?? 'LOW';

        const ACTIVE_MAX = PARTICLE_TIERS[effectiveTier];

        const pGeo = new THREE.BufferGeometry();
        const pPosArray = new Float32Array(ACTIVE_MAX * 2 * 3);
        const pColorArray = new Float32Array(ACTIVE_MAX * 2 * 3);
        const pVels = new Float32Array(ACTIVE_MAX * 3);
        const pTrailLength = 0.002;
        const pLife = new Float32Array(ACTIVE_MAX);

        const vertices: THREE.Vector3[] = [];
        for (let i = 0; i < vertexPos.count; i++) {
            vertices.push(new THREE.Vector3().fromBufferAttribute(vertexPos, i));
        }

        for (let i = 0; i < ACTIVE_MAX; i++) {
            const i6 = i * 6;
            pPosArray[i6] = pPosArray[i6 + 1] = pPosArray[i6 + 2] = 9999;
            pPosArray[i6 + 3] = pPosArray[i6 + 4] = pPosArray[i6 + 5] = 9999;
            pLife[i] = 0;

            pColorArray[i6] = pColorArray[i6 + 1] = pColorArray[i6 + 2] = 0;
            pColorArray[i6 + 3] = pColorArray[i6 + 4] = pColorArray[i6 + 5] = 0;
        }

        pGeo.setAttribute('position', new THREE.BufferAttribute(pPosArray, 3));
        pGeo.setAttribute('color', new THREE.BufferAttribute(pColorArray, 3));

        const pMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const particles = new THREE.LineSegments(pGeo, pMat);
        particles.userData = {
            velocities: pVels,
            trailLength: pTrailLength,
            vertices,
            life: pLife,
            activeMax: ACTIVE_MAX
        };
        scene.add(particles);
        particlesRef.current = particles;

        // Lighting
        const ambLight = new THREE.AmbientLight(0x0a1c28, 0.4);
        scene.add(ambLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 0.6);
        mainLight.position.set(5, 5, 10);
        scene.add(mainLight);

        const blueBeam = new THREE.SpotLight(themeRef.current.accent, 4000, 150, Math.PI / 2.0, 0.4, 1);
        blueBeam.position.set(0, 0, 20);
        blueBeam.target.position.set(0, 0, 0);
        scene.add(blueBeam);
        scene.add(blueBeam.target);

        const blueBeamBack = new THREE.SpotLight(themeRef.current.accent, 3500, 150, Math.PI / 2.0, 0.4, 1);
        blueBeamBack.position.set(0, 0, -20);
        blueBeamBack.target.position.set(0, 0, 0);
        scene.add(blueBeamBack);
        scene.add(blueBeamBack.target);

        const blueFill = new THREE.PointLight(themeRef.current.accent, 400, 60);
        blueFill.position.set(-8, 8, 15);
        scene.add(blueFill);

        const blueFill2 = new THREE.PointLight(themeRef.current.accent, 300, 60);
        blueFill2.position.set(8, -8, -15);
        scene.add(blueFill2);

        lightsRef.current = { blueBeam, blueBeamBack, blueFill, blueFill2 };

        const tempNormal = new THREE.Vector3();
        const tempView = new THREE.Vector3();
        const tempPos = new THREE.Vector3();
        const targetColor = new THREE.Color();
        const worldVerticesCache = vertices.map(v => v.clone());
        let currentThemeKey = themeRef.current.name;

        let autoQualityChecked = false;
        const fpsHistory: number[] = [];
        let lastFpsCheck = performance.now();
        let frameCounter = 0;

        let initialLimit = qualityRef.current === 'ULTRA_LOW' ? Math.floor(ACTIVE_MAX * 0.5) : ACTIVE_MAX;
        const prevLimitRef = { current: initialLimit };
        const heartbeatRef = { current: 1.0 };

        // OPTIMIZATION 3: Flat arrays and pre-allocated objects for the loop
        const flatVerts = new Float32Array(worldVerticesCache.length * 3);
        const curlOut = { x: 0, y: 0, z: 0 };

        const animate = () => {
            if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

            const time = Date.now() / 1000;
            const activeTheme = themeRef.current;
            if (controlsRef.current) {
                controlsRef.current.update();
            }

            if (currentThemeKey !== activeTheme.name) {
                currentThemeKey = activeTheme.name;
                const newGlowTex = createGlowTexture(activeTheme.glow);
                vertexSpritesRef.current.forEach(v => {
                    v.spriteMat.map = newGlowTex;
                    v.spriteMat.needsUpdate = true;
                });
            }

            // Sync dynamic palette to avoid 15000 individual color lerps
            if (currentPaletteRef.current.length !== activeTheme.palette.length) {
                currentPaletteRef.current = activeTheme.palette.map(hex => new THREE.Color(hex));
            } else {
                activeTheme.palette.forEach((hex, idx) => {
                    targetColor.setHex(hex);
                    currentPaletteRef.current[idx].lerp(targetColor, 0.05);
                });
            }
            const dynamicPalette = currentPaletteRef.current;
            const paletteLen = dynamicPalette.length;

            if (sceneRef.current.fog instanceof THREE.FogExp2) {
                targetColor.setHex(activeTheme.accent);
                sceneRef.current.fog.color.lerp(targetColor, 0.05);
            }

            const { bass: sBass, treble: sTreble, amplitude: sAmp } = audioDataRef.current;
            const rs = presetRef.current.rotationSpeed;
            const br = presetRef.current.bassResponse;

            if (cameraRef.current) {
                const targetFov = 40 + (sBass * 15 * br);
                cameraRef.current.fov += (targetFov - cameraRef.current.fov) * 0.1;
                cameraRef.current.updateProjectionMatrix();
            }

            lightsRef.current.blueBeam.color.lerp(targetColor.setHex(activeTheme.accent), 0.05);
            lightsRef.current.blueBeamBack.color.lerp(targetColor.setHex(activeTheme.accent), 0.05);
            lightsRef.current.blueFill.color.lerp(targetColor.setHex(activeTheme.accent), 0.05);
            lightsRef.current.blueFill2.color.lerp(targetColor.setHex(activeTheme.accent), 0.05);

            if (coreGroupRef.current) {
                coreGroupRef.current.rotation.y = time * (0.2 * rs) + (sBass * 0.3 * br);
                coreGroupRef.current.rotation.x = time * (0.1 * rs);
                coreGroupRef.current.position.y = Math.sin(time * 0.8) * 0.15;
                coreGroupRef.current.position.x = Math.cos(time * 0.6) * 0.08;
            }

            const bassPeak = sBass * br;
            const targetScale = 1.0 + (bassPeak * 0.45) + (Math.sin(time * 1.5) * 0.02);

            const attack  = bassPeak > heartbeatRef.current - 1.0 ? 0.6 : 0.06;
            heartbeatRef.current += (targetScale - heartbeatRef.current) * attack;

            if (outerIcoRef.current) {
                outerIcoRef.current.scale.setScalar(heartbeatRef.current);
            }

            edgeCylindersRef.current.forEach(cyl => {
                const thickness = Math.min(1.5, 1.0 + (sBass * 0.8 * br));
                cyl.mesh.scale.set(thickness, 1.0, thickness);
                cyl.mesh.material.emissiveIntensity = 0.1 + (sTreble * 0.8);
            });

            vertexSpritesRef.current.forEach((v, i) => {
                const flicker = Math.sin(time * 2 + i * 0.8) * 0.1 + 0.9;
                const sizeMulti = 1.0 + (sBass * 0.3 * br) + (sTreble * 0.1);
                const intensityMulti = Math.min(1.5, 1.0 + (sTreble * 0.8) + (sBass * 0.4 * br));

                if (coreGroupRef.current && cameraRef.current) {
                    tempNormal.copy(v.basePos).normalize().applyEuler(coreGroupRef.current.rotation);
                    v.mesh.getWorldPosition(tempPos);
                    tempView.copy(cameraRef.current.position).sub(tempPos).normalize();
                    let dot = tempNormal.dot(tempView);
                    let visibility = THREE.MathUtils.smoothstep(dot, -0.6, 0.0);

                    v.mesh.material.opacity = Math.min(1.0, 0.7 + (sTreble * 0.2)) * flicker * visibility;
                    v.mesh.scale.setScalar(0.22 * sizeMulti);
                    v.mesh.material.color.lerp(targetColor.setHex(activeTheme.glow), 0.05);

                    v.coreMesh.scale.setScalar(0.07 + (sTreble * 0.04));
                    v.coreMesh.material.opacity = (0.5 + (sTreble * 0.4) * flicker) * visibility;

                    if (v.light) {
                        v.light.intensity = 1.0 * intensityMulti * flicker * presetRef.current.glowIntensity;
                        v.light.color.lerp(targetColor.setHex(activeTheme.glow), 0.05);
                    }
                    v.mesh.position.copy(v.basePos);
                }
            });

            if (particlesRef.current) {
                const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
                const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
                const vels = particlesRef.current.userData.velocities as Float32Array;
                const baseTrailLength = particlesRef.current.userData.trailLength;
                const vertices = particlesRef.current.userData.vertices;
                const life = particlesRef.current.userData.life;
                const activeMax = particlesRef.current.userData.activeMax as number;

                // Prepare flat array for lighting fast distance checks inside loop
                if (coreGroupRef.current) {
                    for (let j = 0; j < vertices.length; j++) {
                        const v = worldVerticesCache[j]
                            .copy(vertices[j])
                            .applyEuler(coreGroupRef.current.rotation)
                            .add(coreGroupRef.current.position);
                        flatVerts[j*3] = v.x;
                        flatVerts[j*3+1] = v.y;
                        flatVerts[j*3+2] = v.z;
                    }
                }

                const limit = qualityRef.current === 'ULTRA_LOW'
                    ? Math.floor(activeMax * 0.5)
                    : activeMax;

                if (limit !== prevLimitRef.current) {
                    for (let i = limit; i < activeMax; i++) {
                        const i6 = i * 6;
                        positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                        positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                    }
                    prevLimitRef.current = limit;
                    particlesRef.current.geometry.attributes.position.needsUpdate = true;
                }

                const turbulence = presetRef.current.turbulence ?? 0.3;
                frameCounter++;
                if (frameCounter % 2 === 0) {
                    updateCurlGrid(time, turbulence);
                }

                // Slightly boosted minimums to ensure HIGH preset feels fully populated
                let maxSpawnRate = Math.floor(Math.pow(sAmp, 1.8) * 6000 * presetRef.current.particleDensity);
                if (sAmp < 0.05) maxSpawnRate = 500 * presetRef.current.particleDensity;

                let spawnedThisFrame = 0;
                const VERY_CLOSE = 1.0;
                const vertexCount = vertices.length;

                for (let i = 0; i < limit; i++) {
                    const i6 = i * 6;
                    const i3 = i * 3;

                    if (life[i] <= 0) {
                        if (spawnedThisFrame < maxSpawnRate) {
                            spawnedThisFrame++;
                            life[i] = 1.5 + Math.random() * 2.0;

                            const angle = Math.random() * Math.PI * 2;

                            const closeRing = Math.random() > 0.3;
                            const radius = closeRing
                                ? 1.6 + Math.random() * 1.8
                                : 3.0 + Math.random() * 8.0;

                            const ySpawn = (Math.random() - 0.5) * (closeRing ? 3.5 : 12.0);

                            positions[i6]     = Math.cos(angle) * radius;
                            positions[i6 + 1] = ySpawn;
                            positions[i6 + 2] = Math.sin(angle) * radius;

                            const tangentX = -Math.sin(angle);
                            const tangentZ =  Math.cos(angle);
                            const burstForce = 0.008 + (sBass * sBass * 0.12 * br);
                            const tangentBias = 0.4;

                            vels[i3]     = (Math.cos(angle) * (1 - tangentBias) + tangentX * tangentBias) * (0.008 + Math.random() * 0.015) * burstForce;
                            vels[i3 + 1] = (0.003 + Math.random() * 0.015) * burstForce;
                            vels[i3 + 2] = (Math.sin(angle) * (1 - tangentBias) + tangentZ * tangentBias) * (0.008 + Math.random() * 0.015) * burstForce;
                        } else {
                            positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                            positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                            colors[i6] = colors[i6+1] = colors[i6+2] = 0;
                            colors[i6+3] = colors[i6+4] = colors[i6+5] = 0;
                            continue;
                        }
                    }

                    if (life[i] > 0) {
                        life[i] -= 0.008;

                        let px = positions[i6], py = positions[i6 + 1], pz = positions[i6 + 2];
                        let vx = vels[i3], vy = vels[i3 + 1], vz = vels[i3 + 2];

                        let distFromCenterSq = px*px + py*py + pz*pz;

                        // Reuses single curlOut object instead of creating millions per second
                        sampleCurlGrid(px, py, pz, curlOut);

                        const flowStrength = (0.00012 + (sAmp * 0.0003)) * (presetRef.current.particleDensity ?? 1.0);

                        let fx = curlOut.x * flowStrength;
                        let fy = curlOut.y * flowStrength * 0.25;
                        let fz = curlOut.z * flowStrength;

                        vy += 0.00008 + (sAmp * 0.0003);

                        if (sBass > 0.4) {
                            const bassDistort = (sBass - 0.4) * 0.0008 * br;
                            fx += curlOut.z * bassDistort;
                            fz -= curlOut.x * bassDistort;
                        }

                        let closestDistSq = Infinity;
                        let cVx = 0, cVy = 0, cVz = 0;

                        // Fast flattened loop over vertices
                        for (let j = 0; j < vertexCount; j++) {
                            const j3 = j * 3;
                            const dx = flatVerts[j3] - px, dy = flatVerts[j3+1] - py, dz = flatVerts[j3+2] - pz;
                            const dSq = dx*dx + dy*dy + dz*dz;
                            if (dSq < closestDistSq) {
                                closestDistSq = dSq;
                                cVx = dx; cVy = dy; cVz = dz;
                                if (dSq < VERY_CLOSE) break;
                            }
                        }

                        let isNearVertex = closestDistSq < 0.15;

                        if (closestDistSq < 60.0) {
                            let dist = Math.sqrt(closestDistSq);
                            let dirX = cVx / dist, dirY = cVy / dist, dirZ = cVz / dist;

                            let tx = dirZ, ty = 0, tz = -dirX;

                            fx += tx * (0.0003 / (dist + 0.1));
                            fz += tz * (0.0003 / (dist + 0.1));

                            let forceMag = (0.0002 + (sBass * 0.0008 * br)) / (closestDistSq + 0.5);
                            if (sBass > 0.55 && closestDistSq < 4.0) forceMag = -0.003 * sBass * br;

                            fx += dirX * forceMag;
                            fy += dirY * forceMag;
                            fz += dirZ * forceMag;
                        }

                        const dampBase = 0.955 + (turbulence * 0.01);
                        vx = (vx + fx) * dampBase;
                        vy = (vy + fy) * dampBase;
                        vz = (vz + fz) * dampBase;

                        px += vx; py += vy; pz += vz;

                        vels[i3] = vx; vels[i3 + 1] = vy; vels[i3 + 2] = vz;
                        positions[i6] = px; positions[i6 + 1] = py; positions[i6 + 2] = pz;

                        const currentSpeed = Math.sqrt(vx*vx + vy*vy + vz*vz);
                        const dynamicTrail = baseTrailLength + (currentSpeed * (0.6 + sAmp));

                        let speedInv = 1.0 / (currentSpeed || 1);
                        positions[i6 + 3] = px - (vx * speedInv * dynamicTrail);
                        positions[i6 + 4] = py - (vy * speedInv * dynamicTrail);
                        positions[i6 + 5] = pz - (vz * speedInv * dynamicTrail);

                        if (isNearVertex || distFromCenterSq > 625.0) {
                            life[i] = 0;
                            positions[i6] = positions[i6 + 1] = positions[i6 + 2] = 9999;
                            positions[i6 + 3] = positions[i6 + 4] = positions[i6 + 5] = 9999;
                            colors[i6] = colors[i6 + 1] = colors[i6 + 2] = 0;
                            colors[i6 + 3] = colors[i6 + 4] = colors[i6 + 5] = 0;
                        } else {
                            const fade = Math.max(0, life[i]);
                            const colorBoost = fade * (0.8 + (sAmp * 2.0) + (sBass * 3.0 * br));

                            // Look up pre-calculated palette color index
                            const pColor = dynamicPalette[i % paletteLen];
                            colors[i6] = Math.min(1, pColor.r * colorBoost);
                            colors[i6 + 1] = Math.min(1, pColor.g * colorBoost);
                            colors[i6 + 2] = Math.min(1, pColor.b * colorBoost);
                            colors[i6 + 3] = colors[i6];
                            colors[i6 + 4] = colors[i6 + 1];
                            colors[i6 + 5] = colors[i6 + 2];
                        }
                    }
                }
                particlesRef.current.geometry.attributes.position.needsUpdate = true;
                particlesRef.current.geometry.attributes.color.needsUpdate = true;
            }

            if (!autoQualityChecked && onAutoQualityChange) {
                const now = performance.now();
                const delta = now - lastFpsCheck;
                lastFpsCheck = now;

                if (delta > 0) fpsHistory.push(1000 / delta);

                if (fpsHistory.length >= 60) {
                    autoQualityChecked = true;
                    const avgFps = fpsHistory.reduce((a, b) => a + b) / fpsHistory.length;

                    if (avgFps < 45 && qualityRef.current === 'HIGH') {
                        rendererRef.current?.setPixelRatio(1);
                        onAutoQualityChange('LOW');
                    }
                }
            }

            rendererRef.current.render(sceneRef.current, cameraRef.current);
            animationFrameId.current = requestAnimationFrame(animate);
        };

        animationFrameId.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            resizeObserver.disconnect();
            controls.dispose();
            studioEnvMap.dispose();
            renderer.dispose();

            icoGeo.dispose();
            mainMat.dispose();
            edgeGeo.dispose();
            edgeMat.dispose();
            glowTex.dispose();
            coreTex.dispose();
            pGeo.dispose();
            pMat.dispose();

            if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
                containerRef.current.removeChild(renderer.domElement);
            }
        };
    }, []);
};