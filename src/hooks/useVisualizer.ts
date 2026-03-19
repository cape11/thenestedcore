import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEMES, QUALITY_PARTICLE_LIMITS } from '../constants/themes';
import { ThemeKey, Quality, AudioData } from '../types';
import { PARTICLE_TIERS } from '../constants/themes';
import { AnimationPreset } from '../constants/presets';

// ---------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------

const snoise = (x: number, y: number, z: number): number => {
    return (
        Math.sin(x * 1.7 + z * 0.3) * Math.cos(y * 2.1 - x * 0.7) +
        Math.sin(y * 1.3 + x * 0.9) * Math.cos(z * 1.8 + y * 0.4) +
        Math.sin(z * 2.4 - y * 1.1) * Math.cos(x * 1.5 + z * 0.6)
    ) / 3.0;
};

// ---------------------------------------------------------------------------
// Curl grid (chunked update)
// ---------------------------------------------------------------------------

const CURL_GRID_SIZE  = 16;
const CURL_GRID_TOTAL = CURL_GRID_SIZE * CURL_GRID_SIZE * CURL_GRID_SIZE;
const curlGridBuffer  = new Float32Array(CURL_GRID_TOTAL * 3);

const CURL_WORLD_MIN   = -15.0;
const CURL_WORLD_MAX   =  15.0;
const CURL_WORLD_RANGE = CURL_WORLD_MAX - CURL_WORLD_MIN;

let curlGridOffset = 0;

const updateCurlGridChunked = (t: number, turbulence: number, chunkCount: number) => {
    const scale  = 0.35 + turbulence * 0.15;
    const ts     = t * 0.12;
    const eps    = 0.1;
    const total  = CURL_GRID_TOTAL;
    const perChunk = Math.ceil(total / chunkCount);
    const start  = curlGridOffset;
    const end    = Math.min(start + perChunk, total);

    for (let c = start; c < end; c++) {
        let tmp = c;
        const zi = tmp % CURL_GRID_SIZE; tmp = Math.floor(tmp / CURL_GRID_SIZE);
        const yi = tmp % CURL_GRID_SIZE;
        const xi = Math.floor(tmp / CURL_GRID_SIZE);

        const wx = CURL_WORLD_MIN + (xi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;
        const wy = CURL_WORLD_MIN + (yi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;
        const wz = CURL_WORLD_MIN + (zi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE;

        const sx = wx * scale, sy = wy * scale, sz = wz * scale;

        const dFy_dz = (snoise(sx, sy,        sz + eps + ts) - snoise(sx, sy,        sz - eps + ts)) / (2 * eps);
        const dFz_dy = (snoise(sx, sy + eps,   sz       + ts) - snoise(sx, sy - eps,   sz       + ts)) / (2 * eps);
        const dFz_dx = (snoise(sx + eps, sy,   sz       + ts) - snoise(sx - eps, sy,   sz       + ts)) / (2 * eps);
        const dFx_dz = (snoise(sx, sy,        sz + eps + ts) - snoise(sx, sy,        sz - eps + ts)) / (2 * eps);
        const dFx_dy = (snoise(sx, sy + eps,   sz       + ts) - snoise(sx, sy - eps,   sz       + ts)) / (2 * eps);
        const dFy_dx = (snoise(sx + eps, sy,   sz       + ts) - snoise(sx - eps, sy,   sz       + ts)) / (2 * eps);

        const idx = c * 3;
        curlGridBuffer[idx]     = dFy_dz - dFz_dy;
        curlGridBuffer[idx + 1] = dFz_dx - dFx_dz;
        curlGridBuffer[idx + 2] = dFx_dy - dFy_dx;
    }
    curlGridOffset = end === total ? 0 : end;
};

const sampleCurlGrid = (px: number, py: number, pz: number, out: { x: number; y: number; z: number }) => {
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

    const i000 = idx(gx,   gy,   gz  ); const i100 = idx(gx+1, gy,   gz  );
    const i010 = idx(gx,   gy+1, gz  ); const i110 = idx(gx+1, gy+1, gz  );
    const i001 = idx(gx,   gy,   gz+1); const i101 = idx(gx+1, gy,   gz+1);
    const i011 = idx(gx,   gy+1, gz+1); const i111 = idx(gx+1, gy+1, gz+1);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const interp = (o: number) =>
        lerp(
            lerp(lerp(curlGridBuffer[i000+o], curlGridBuffer[i100+o], fx),
                lerp(curlGridBuffer[i010+o], curlGridBuffer[i110+o], fx), fy),
            lerp(lerp(curlGridBuffer[i001+o], curlGridBuffer[i101+o], fx),
                lerp(curlGridBuffer[i011+o], curlGridBuffer[i111+o], fx), fy),
            fz);

    out.x = interp(0); out.y = interp(1); out.z = interp(2);
};

const detectParticleTier = (): 'HIGH' | 'LOW' | 'ULTRA_LOW' => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return 'ULTRA_LOW';
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'ULTRA_LOW';
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    if (maxTex <= 8)  return 'ULTRA_LOW';
    if (maxTex <= 12) return 'LOW';
    return 'HIGH';
};

export const useVisualizer = ({
                                  containerRef,
                                  themeKey,
                                  quality,
                                  audioDataRef,
                                  preset,
                                  onAutoQualityChange,
                              }: VisualizerProps) => {

    const themeRef   = useRef(THEMES[themeKey]);
    const qualityRef = useRef(quality);
    const presetRef  = useRef(preset);
    const currentPaletteRef = useRef<THREE.Color[]>([]);

    useEffect(() => { themeRef.current   = THEMES[themeKey]; }, [themeKey]);
    useEffect(() => { qualityRef.current = quality;          }, [quality]);
    useEffect(() => { presetRef.current  = preset;           }, [preset]);

    const sceneRef      = useRef<THREE.Scene | null>(null);
    const cameraRef     = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef   = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef   = useRef<OrbitControls | null>(null);
    const coreGroupRef  = useRef<THREE.Group | null>(null);
    const outerIcoRef   = useRef<THREE.Mesh | null>(null);
    const vertexSpritesRef  = useRef<any[]>([]);
    const edgeCylindersRef  = useRef<any[]>([]);
    const particlesRef  = useRef<THREE.Points | null>(null);
    const lightsRef     = useRef<any>({});
    const animationFrameId = useRef<number | null>(null);

    // Highly feathered simulated optical bloom
    const createGlowTexture = (colorHex: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const color = new THREE.Color(colorHex);

        const coreColor = color.clone().lerp(new THREE.Color(0xffffff), 0.8);

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0,   'rgba(255,255,255,1)');
        gradient.addColorStop(0.05, `rgba(${coreColor.r*255|0},${coreColor.g*255|0},${coreColor.b*255|0},1.0)`);
        gradient.addColorStop(0.2, `rgba(${color.r*255|0},${color.g*255|0},${color.b*255|0},0.6)`);
        gradient.addColorStop(0.5, `rgba(${color.r*255|0},${color.g*255|0},${color.b*255|0},0.15)`);
        gradient.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(canvas);
    };

    const createCoreTexture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0,   'rgba(255,255,255,1)');
        g.addColorStop(0.2, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.5, 'rgba(200,255,200,0.2)');
        g.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    };

    const generateEnvironmentMap = (renderer: THREE.WebGLRenderer) => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const envCanvas = document.createElement('canvas');
        envCanvas.width = 1024; envCanvas.height = 512;
        const ctx = envCanvas.getContext('2d')!;
        ctx.fillStyle = '#010204';
        ctx.fillRect(0, 0, 1024, 512);
        const addPanel = (x:number,y:number,w:number,h:number,color:string) => {
            const gr = ctx.createRadialGradient(x+w/2,y+h/2,0,x+w/2,y+h/2,Math.max(w,h)/2);
            gr.addColorStop(0, color); gr.addColorStop(1, 'transparent');
            ctx.fillStyle = gr; ctx.fillRect(x,y,w,h);
        };
        addPanel(256,-100,512,300,'rgba(150,220,255,0.8)');
        addPanel(0,400,1024,300,'rgba(0,100,255,0.5)');
        addPanel(-100,200,400,200,'rgba(74,222,128,0.4)');
        addPanel(724,200,400,200,'rgba(0,119,255,0.4)');
        const envTex = new THREE.CanvasTexture(envCanvas);
        envTex.mapping = THREE.EquirectangularReflectionMapping;
        const envMap = pmrem.fromEquirectangular(envTex).texture;
        envTex.dispose();
        return envMap;
    };

    useEffect(() => {
        if (!rendererRef.current) return;
        rendererRef.current.setPixelRatio(
            quality === 'HIGH'      ? Math.min(window.devicePixelRatio, 2) :
                quality === 'LOW'       ? Math.min(window.devicePixelRatio, 1.0) :
                    0.5
        );
    }, [quality]);

    useEffect(() => {
        if (!containerRef.current) return;

        const isHigh = qualityRef.current === 'HIGH';

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        scene.fog = new THREE.FogExp2(0x0a1622, 0.04);

        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
        camera.position.set(0, 0, 10);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({
            antialias: isHigh,
            alpha: true,
            powerPreference: 'high-performance',
            precision: isHigh ? 'highp' : 'mediump',
        });
        renderer.setPixelRatio(
            qualityRef.current === 'HIGH'     ? Math.min(window.devicePixelRatio, 2) :
                qualityRef.current === 'LOW'      ? Math.min(window.devicePixelRatio, 1.0) :
                    0.5
        );
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width   = '100%';
        renderer.domElement.style.height  = '100%';
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping  = true;
        controls.dampingFactor  = 0.05;
        controls.enablePan      = false;
        controls.minDistance    = 3;
        controls.maxDistance    = 25;
        controlsRef.current = controls;

        const handleResize = () => {
            if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
            const w = containerRef.current.clientWidth  || window.innerWidth;
            const h = containerRef.current.clientHeight || window.innerHeight;
            cameraRef.current.aspect = w / h;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(w, h);
        };
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);
        handleResize();

        const coreGroup = new THREE.Group();
        scene.add(coreGroup);
        coreGroupRef.current = coreGroup;

        // --- Deep Space Background ---
        const starGroup = new THREE.Group();
        scene.add(starGroup);
        const starsGeo = new THREE.BufferGeometry();
        const starsCount = 3000;
        const starsPos = new Float32Array(starsCount * 3);
        const starsColor = new Float32Array(starsCount * 3);
        for(let i = 0; i < starsCount; i++) {
            const r = 40 + Math.random() * 150;
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(2 * Math.random() - 1);
            starsPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
            starsPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            starsPos[i*3+2] = r * Math.cos(phi);
            const c = new THREE.Color().setHSL(0.55 + Math.random()*0.1, 0.8, 0.5 + Math.random()*0.5);
            starsColor[i*3] = c.r; starsColor[i*3+1] = c.g; starsColor[i*3+2] = c.b;
        }
        starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
        starsGeo.setAttribute('color', new THREE.BufferAttribute(starsColor, 3));

        const starCanv = document.createElement('canvas');
        starCanv.width = 8; starCanv.height = 8;
        const starCtx = starCanv.getContext('2d')!;
        const starGrad = starCtx.createRadialGradient(4,4,0,4,4,4);
        starGrad.addColorStop(0, 'rgba(255,255,255,1)');
        starGrad.addColorStop(1, 'rgba(255,255,255,0)');
        starCtx.fillStyle = starGrad; starCtx.fillRect(0,0,8,8);
        const starTex = new THREE.CanvasTexture(starCanv);

        const starsMat = new THREE.PointsMaterial({
            size: 0.8, vertexColors: true, map: starTex,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const starSystem = new THREE.Points(starsGeo, starsMat);
        starGroup.add(starSystem);

        const nebulaGroup = new THREE.Group();
        scene.add(nebulaGroup);
        const nebulaSprites: {mesh: THREE.Sprite, baseOpacity: number}[] = [];
        const nebulaTex = createGlowTexture(0xffffff);
        for(let i=0; i<8; i++) {
            const mat = new THREE.SpriteMaterial({
                map: nebulaTex, color: 0xffffff, transparent: true,
                opacity: 0.05 + Math.random() * 0.1,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const sprite = new THREE.Sprite(mat);
            const size = 60 + Math.random() * 80;
            sprite.scale.set(size, size, 1);
            sprite.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, -40 - Math.random() * 40);
            nebulaGroup.add(sprite);
            nebulaSprites.push({ mesh: sprite, baseOpacity: mat.opacity });
        }

        const studioEnvMap = generateEnvironmentMap(renderer);

        const mainMat = isHigh
            ? new THREE.MeshPhysicalMaterial({
                color: 0x05080c, metalness: 1.0, roughness: 0.12,
                envMap: studioEnvMap, envMapIntensity: 1.5,
                flatShading: true, clearcoat: 1.0, clearcoatRoughness: 0.05,
            })
            : qualityRef.current === 'ULTRA_LOW'
                ? new THREE.MeshBasicMaterial({ color: 0x05080c })
                : new THREE.MeshStandardMaterial({
                    color: 0x05080c, metalness: 0.9, roughness: 0.2,
                    envMap: studioEnvMap, envMapIntensity: 1.2, flatShading: true,
                });

        const icoGeo = new THREE.IcosahedronGeometry(1.6, 0);
        const outerIco = new THREE.Mesh(icoGeo, mainMat);
        coreGroup.add(outerIco);
        outerIcoRef.current = outerIco;

        const edgeGroup = new THREE.Group();
        const edgeGeo   = new THREE.EdgesGeometry(icoGeo);
        const edgePos   = edgeGeo.attributes.position.array;
        const edgeMat   = isHigh
            ? new THREE.MeshPhysicalMaterial({
                color: 0x02050a, metalness: 1.0, roughness: 0.2,
                envMap: studioEnvMap, envMapIntensity: 1.0,
                flatShading: true,
                emissive: new THREE.Color(0x001133), emissiveIntensity: 0.2,
            })
            : qualityRef.current === 'ULTRA_LOW'
                ? new THREE.MeshBasicMaterial({ color: 0x02050a })
                : new THREE.MeshStandardMaterial({
                    color: 0x02050a, metalness: 0.8, roughness: 0.3,
                    envMap: studioEnvMap, envMapIntensity: 0.8, flatShading: true,
                    emissive: new THREE.Color(0x001133), emissiveIntensity: 0.15,
                });

        for (let i = 0; i < edgePos.length; i += 6) {
            const v1 = new THREE.Vector3(edgePos[i],   edgePos[i+1], edgePos[i+2]);
            const v2 = new THREE.Vector3(edgePos[i+3], edgePos[i+4], edgePos[i+5]);
            const dist = v1.distanceTo(v2);
            const cylGeo = new THREE.CylinderGeometry(0.015, 0.015, dist, 6);
            const cyl = new THREE.Mesh(cylGeo, edgeMat);
            cyl.position.copy(v1.clone().lerp(v2, 0.5));
            cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v2.clone().sub(v1).normalize());
            edgeGroup.add(cyl);
            edgeCylindersRef.current.push({ mesh: cyl });
        }
        edgeGroup.scale.setScalar(1.001);
        outerIco.add(edgeGroup);

        // --- Laser Connectors System ---
        const edgeCount = edgePos.length / 6;
        const laserGroup = new THREE.Group();
        outerIco.add(laserGroup);

        const laserBaseGeo = new THREE.CylinderGeometry(1, 1, 1, 8);

        type LaserConnector = {
            outer: THREE.Mesh,
            matOuter: THREE.MeshBasicMaterial,
            active: boolean,
            life: number,
            v1: THREE.Vector3,
            v2: THREE.Vector3,
            u: THREE.Vector3,
            v: THREE.Vector3,
            idx: number
        };
        const laserConnectors: LaserConnector[] = [];

        for (let i = 0; i < edgeCount; i++) {
            const v1 = new THREE.Vector3(edgePos[i*6], edgePos[i*6+1], edgePos[i*6+2]);
            const v2 = new THREE.Vector3(edgePos[i*6+3], edgePos[i*6+4], edgePos[i*6+5]);
            const dist = v1.distanceTo(v2);

            // Compute local orthogonal vectors for the wave offsets
            const dir = v2.clone().sub(v1).normalize();
            let up = new THREE.Vector3(0, 1, 0);
            if (Math.abs(dir.y) > 0.99) up.set(1, 0, 0);
            const uVec = new THREE.Vector3().crossVectors(dir, up).normalize();
            const vVec = new THREE.Vector3().crossVectors(dir, uVec).normalize();

            const matOuter = new THREE.MeshBasicMaterial({
                color: themeRef.current.glow,
                transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            });

            const outer = new THREE.Mesh(laserBaseGeo, matOuter);

            outer.position.copy(v1.clone().lerp(v2, 0.5));
            outer.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v2.clone().sub(v1).normalize());
            outer.scale.set(0.01, dist, 0.01);

            laserGroup.add(outer);
            laserConnectors.push({ outer, matOuter, active: false, life: 0, v1, v2, u: uVec, v: vVec, idx: i });
        }

        // Ray/Energy Line geometry setup
        const SEGMENTS_PER_LASER = 20;
        const laserCoreGeo = new THREE.BufferGeometry();
        const laserCorePos = new Float32Array(edgeCount * SEGMENTS_PER_LASER * 2 * 3);
        laserCoreGeo.setAttribute('position', new THREE.BufferAttribute(laserCorePos, 3).setUsage(THREE.DynamicDrawUsage));
        const laserCoreMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const laserCoreLines = new THREE.LineSegments(laserCoreGeo, laserCoreMat);
        laserGroup.add(laserCoreLines);

        const glowTex  = createGlowTexture(themeRef.current.glow);
        const coreTex  = createCoreTexture();
        const vertexPos = icoGeo.attributes.position;
        const spriteMat = new THREE.SpriteMaterial({
            map: glowTex, color: themeRef.current.glow,
            transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        });
        const coreMat = new THREE.SpriteMaterial({
            map: coreTex, color: 0xffffff,
            transparent: true, opacity: 1.0,
            blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
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
            if (isHigh) {
                pLight = new THREE.PointLight(themeRef.current.glow, 4.0, 5.0);
                pLight.position.copy(baseVec).multiplyScalar(0.08);
                sprite.add(pLight);
            }
            outerIco.add(sprite);
            vertexSpritesRef.current.push({
                mesh: sprite, coreMesh: coreSprite, light: pLight,
                basePos: baseVec.clone(), spriteMat: sprite.material,
            });
        }

        // ===================================================================
        //  PARTICLE SYSTEM
        // ===================================================================

        const deviceTier  = detectParticleTier();
        const tierOrder   = ['ULTRA_LOW', 'LOW', 'HIGH'] as const;
        const effectiveTier = tierOrder[
            Math.min(tierOrder.indexOf(deviceTier), tierOrder.indexOf(qualityRef.current as any))
            ] ?? 'LOW';

        const ACTIVE_MAX = PARTICLE_TIERS[effectiveTier];

        const pPosArray   = new Float32Array(ACTIVE_MAX * 6);
        const pColorArray = new Float32Array(ACTIVE_MAX * 6);
        const pVel        = new Float32Array(ACTIVE_MAX * 3);
        const pLife       = new Float32Array(ACTIVE_MAX);
        const TRAIL_LEN   = 0.004;

        for (let i = 0; i < ACTIVE_MAX; i++) {
            const i6 = i * 6;
            pPosArray[i6] = pPosArray[i6+1] = pPosArray[i6+2] = 9999;
            pPosArray[i6+3] = pPosArray[i6+4] = pPosArray[i6+5] = 9999;
            pLife[i] = 0;
        }

        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPosArray,   3).setUsage(THREE.DynamicDrawUsage));
        pGeo.setAttribute('color',    new THREE.BufferAttribute(pColorArray, 3).setUsage(THREE.DynamicDrawUsage));

        const pMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent:  true,
            opacity:      0.85,
            blending:     THREE.AdditiveBlending,
            depthWrite:   false,
        });

        const particles = new THREE.LineSegments(pGeo, pMat);
        particles.frustumCulled = false;

        particles.userData = {
            velocities: pVel,
            life:       pLife,
            activeMax:  ACTIVE_MAX,
            trailLen:   TRAIL_LEN,
        };
        scene.add(particles);
        particlesRef.current = particles as any;

        const icoVertices: THREE.Vector3[] = [];
        for (let i = 0; i < vertexPos.count; i++) {
            icoVertices.push(new THREE.Vector3().fromBufferAttribute(vertexPos, i));
        }
        const worldVerticesCache = icoVertices.map(v => v.clone());
        const flatVerts = new Float32Array(icoVertices.length * 3);

        const faceNormals: THREE.Vector3[] = [];
        const faceCentres: THREE.Vector3[] = [];
        const rawPos = icoGeo.attributes.position.array as Float32Array;
        const rawIdx = icoGeo.index ? icoGeo.index.array : null;
        const faceCount = rawIdx ? rawIdx.length / 3 : rawPos.length / 9;
        const faceRawVerts = new Float32Array(faceCount * 9);

        for (let f = 0; f < faceCount; f++) {
            let ax: number, ay: number, az: number;
            let bx: number, by: number, bz: number;
            let cx: number, cy: number, cz: number;
            if (rawIdx) {
                const ia = rawIdx[f*3]*3, ib = rawIdx[f*3+1]*3, ic = rawIdx[f*3+2]*3;
                ax = rawPos[ia]; ay = rawPos[ia+1]; az = rawPos[ia+2];
                bx = rawPos[ib]; by = rawPos[ib+1]; bz = rawPos[ib+2];
                cx = rawPos[ic]; cy = rawPos[ic+1]; cz = rawPos[ic+2];
            } else {
                const f9 = f * 9;
                ax = rawPos[f9];   ay = rawPos[f9+1]; az = rawPos[f9+2];
                bx = rawPos[f9+3]; by = rawPos[f9+4]; bz = rawPos[f9+5];
                cx = rawPos[f9+6]; cy = rawPos[f9+7]; cz = rawPos[f9+8];
            }
            const f9o = f * 9;
            faceRawVerts[f9o]   = ax; faceRawVerts[f9o+1] = ay; faceRawVerts[f9o+2] = az;
            faceRawVerts[f9o+3] = bx; faceRawVerts[f9o+4] = by; faceRawVerts[f9o+5] = bz;
            faceRawVerts[f9o+6] = cx; faceRawVerts[f9o+7] = cy; faceRawVerts[f9o+8] = cz;

            const abx = bx-ax, aby = by-ay, abz = bz-az;
            const acx = cx-ax, acy = cy-ay, acz = cz-az;
            const nx = aby*acz - abz*acy;
            const ny = abz*acx - abx*acz;
            const nz = abx*acy - aby*acx;
            const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) + 0.0001;
            faceNormals.push(new THREE.Vector3(nx/nl, ny/nl, nz/nl));
            faceCentres.push(new THREE.Vector3((ax+bx+cx)/3, (ay+by+cy)/3, (az+bz+cz)/3));
        }

        const numFaces = faceNormals.length;
        const worldFaceNormalsFlat = new Float32Array(numFaces * 3);
        const worldFaceCentresFlat = new Float32Array(numFaces * 3);

        const ambLight = new THREE.AmbientLight(0x0a1c28, 0.4);
        scene.add(ambLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 0.6);
        mainLight.position.set(5, 5, 10);
        scene.add(mainLight);

        const blueBeam = new THREE.SpotLight(themeRef.current.accent, 4000, 150, Math.PI / 2.0, 0.4, 1);
        blueBeam.position.set(0, 0, 20);
        blueBeam.target.position.set(0, 0, 0);
        scene.add(blueBeam); scene.add(blueBeam.target);

        const blueBeamBack = new THREE.SpotLight(themeRef.current.accent, 3500, 150, Math.PI / 2.0, 0.4, 1);
        blueBeamBack.position.set(0, 0, -20);
        blueBeamBack.target.position.set(0, 0, 0);
        scene.add(blueBeamBack); scene.add(blueBeamBack.target);

        const blueFill  = new THREE.PointLight(themeRef.current.accent, 400, 60);
        blueFill.position.set(-8, 8, 15);
        scene.add(blueFill);

        const blueFill2 = new THREE.PointLight(themeRef.current.accent, 300, 60);
        blueFill2.position.set(8, -8, -15);
        scene.add(blueFill2);

        lightsRef.current = { blueBeam, blueBeamBack, blueFill, blueFill2 };

        const tempNormal = new THREE.Vector3();
        const tempView   = new THREE.Vector3();
        const tempPos    = new THREE.Vector3();
        const targetColor = new THREE.Color();
        let   currentThemeKey = themeRef.current.name;
        const fpsHistory: number[] = [];
        let   lastFpsCheck = performance.now();
        let   frameCounter  = 0;

        let   initialLimit = qualityRef.current === 'ULTRA_LOW' ? Math.floor(ACTIVE_MAX * 0.5) : ACTIVE_MAX;
        const prevLimitRef = { current: initialLimit };
        const heartbeatRef = { current: 1.0 };
        const curlOut = { x: 0, y: 0, z: 0 };

        let lastTime = performance.now();

        const animate = () => {
            if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

            const now = performance.now();
            let dt = (now - lastTime) / 1000;
            if (dt > 0.1) dt = 0.016;
            lastTime = now;
            const fpsScale = dt * 60;

            const time = Date.now() / 1000;
            const activeTheme = themeRef.current;

            if (controlsRef.current) controlsRef.current.update();

            if (currentThemeKey !== activeTheme.name) {
                currentThemeKey = activeTheme.name;
                const newGlowTex = createGlowTexture(activeTheme.glow);
                vertexSpritesRef.current.forEach(v => {
                    v.spriteMat.map = newGlowTex;
                    v.spriteMat.needsUpdate = true;
                });
            }

            if (currentPaletteRef.current.length !== activeTheme.palette.length) {
                currentPaletteRef.current = activeTheme.palette.map(hex => new THREE.Color(hex));
            } else {
                activeTheme.palette.forEach((hex, idx) => {
                    targetColor.setHex(hex);
                    if (currentPaletteRef.current[idx].getHex() !== hex) {
                        currentPaletteRef.current[idx].lerp(targetColor, 0.05);
                    }
                });
            }
            const dynamicPalette = currentPaletteRef.current;

            if (sceneRef.current.fog instanceof THREE.FogExp2) {
                targetColor.setHex(activeTheme.accent);
                if (sceneRef.current.fog.color.getHex() !== activeTheme.accent) {
                    sceneRef.current.fog.color.lerp(targetColor, 0.05);
                }
            }

            const { bass: sBass, treble: sTreble, amplitude: sAmp } = audioDataRef.current;
            const presetVars = presetRef.current;
            const rs = presetVars.rotationSpeed ?? 1.0;
            const br = presetVars.bassResponse ?? 1.0;

            if (cameraRef.current) {
                const targetFov = 40 + sBass * 15 * br;
                if (Math.abs(cameraRef.current.fov - targetFov) > 0.1) {
                    cameraRef.current.fov += (targetFov - cameraRef.current.fov) * 0.1;
                    cameraRef.current.updateProjectionMatrix();
                }
            }

            targetColor.setHex(activeTheme.accent);
            if (lightsRef.current.blueBeam.color.getHex() !== activeTheme.accent) {
                lightsRef.current.blueBeam.color.lerp(targetColor, 0.05);
                lightsRef.current.blueBeamBack.color.lerp(targetColor, 0.05);
                lightsRef.current.blueFill.color.lerp(targetColor, 0.05);
                lightsRef.current.blueFill2.color.lerp(targetColor, 0.05);
            }

            if (coreGroupRef.current) {
                coreGroupRef.current.rotation.y = time * (0.2 * rs) + sBass * 0.3 * br;
                coreGroupRef.current.rotation.x = time * (0.1 * rs);
                coreGroupRef.current.position.y = Math.sin(time * 0.8) * 0.15;
                coreGroupRef.current.position.x = Math.cos(time * 0.6) * 0.08;
            }

            const bassPeak   = sBass * br;
            const targetScale = 1.0 + bassPeak * 0.45 + Math.sin(time * 1.5) * 0.02;
            const attack = bassPeak > heartbeatRef.current - 1.0 ? 0.6 : 0.06;
            heartbeatRef.current += (targetScale - heartbeatRef.current) * attack;
            if (outerIcoRef.current) outerIcoRef.current.scale.setScalar(heartbeatRef.current);

            const edgeThick   = Math.min(1.5, 1.0 + sBass * 0.8 * br);
            const edgeEmissive = 0.1 + sTreble * 0.8;
            edgeCylindersRef.current.forEach(cyl => {
                cyl.mesh.scale.set(edgeThick, 1.0, edgeThick);
                cyl.mesh.material.emissiveIntensity = edgeEmissive;
            });

            const sizeMulti      = 1.0 + sBass * 0.3 * br + sTreble * 0.1;
            const intensityMulti = Math.min(1.5, 1.0 + sTreble * 0.8 + sBass * 0.4 * br);
            targetColor.setHex(activeTheme.glow);

            if (coreGroupRef.current && cameraRef.current) {
                const coreRot = coreGroupRef.current.rotation;
                const camPos  = cameraRef.current.position;
                vertexSpritesRef.current.forEach((v, i) => {
                    const flicker = Math.sin(time * 2 + i * 0.8) * 0.1 + 0.9;
                    tempNormal.copy(v.basePos).normalize().applyEuler(coreRot);
                    v.mesh.getWorldPosition(tempPos);
                    tempView.copy(camPos).sub(tempPos).normalize();
                    const dot = tempNormal.dot(tempView);
                    const vis = THREE.MathUtils.smoothstep(dot, -0.6, 0.0);
                    v.mesh.material.opacity = Math.min(1.0, 0.7 + sTreble * 0.2) * flicker * vis;

                    // Boosted bloom scale to match reference
                    v.mesh.scale.setScalar(0.8 * sizeMulti);

                    if (v.mesh.material.color.getHex() !== activeTheme.glow) {
                        v.mesh.material.color.lerp(targetColor, 0.05);
                    }
                    v.coreMesh.scale.setScalar(0.06 + sTreble * 0.03);
                    v.coreMesh.material.opacity = (0.5 + sTreble * 0.4 * flicker) * vis;
                    if (v.light) {
                        v.light.intensity = 1.0 * intensityMulti * flicker * presetRef.current.glowIntensity;
                        if (v.light.color.getHex() !== activeTheme.glow) {
                            v.light.color.lerp(targetColor, 0.05);
                        }
                    }

                    // Vertex Drifting Logic (Organic movement away from structural corners)
                    const driftX = Math.sin(time * 1.5 + i * 2.1) * 0.08 * (0.2 + sAmp);
                    const driftY = Math.cos(time * 1.3 + i * 1.8) * 0.08 * (0.2 + sAmp);
                    const driftZ = Math.sin(time * 1.7 + i * 2.5) * 0.08 * (0.2 + sAmp);
                    v.mesh.position.copy(v.basePos).add(new THREE.Vector3(driftX, driftY, driftZ));
                });
            }

            // --- Background Animation (Static Stars & Pulsuating Nebula) ---
            nebulaSprites.forEach((ns, i) => {
                const pColor = dynamicPalette[i % Math.max(1, dynamicPalette.length)];
                if (pColor && ns.mesh.material.color.getHex() !== pColor.getHex()) {
                    ns.mesh.material.color.lerp(pColor, 0.02);
                }
                ns.mesh.material.opacity = ns.baseOpacity * (1.0 + sBass * br * 0.8);
            });

            // --- Laser Connectors Animation (Flowing Energy Rays) ---
            if ((presetVars.lasersEnabled ?? 1) === 1) {
                const laserIntensity = Math.max(0, (sBass * br - 0.55) * 2.5);

                if (laserIntensity > 0.05 && Math.random() > 0.7) {
                    const numToTrigger = Math.floor(Math.random() * 3) + 1;
                    for (let i = 0; i < numToTrigger; i++) {
                        const rIdx = Math.floor(Math.random() * laserConnectors.length);
                        if (!laserConnectors[rIdx].active) {
                            laserConnectors[rIdx].active = true;
                            laserConnectors[rIdx].life = 1.0;
                        }
                    }
                }

                let maxCoreOpacity = 0;
                const cPos = laserCoreLines.geometry.attributes.position.array as Float32Array;

                laserConnectors.forEach(laser => {
                    if (laser.active) {
                        laser.life -= dt * 1.5; // Controls the total time the ray stays active
                        if (laser.life <= 0) {
                            laser.active = false;
                            laser.matOuter.opacity = 0;
                            // Clear core geometry for this laser
                            const baseIdx = laser.idx * SEGMENTS_PER_LASER * 2 * 3;
                            for(let j=0; j<SEGMENTS_PER_LASER*2*3; j++) cPos[baseIdx+j] = 0;
                        } else {
                            const flash = Math.pow(laser.life, 1.5);

                            // Dim the outer cylinder, let the dynamic inner ray be the focal point
                            laser.matOuter.opacity = flash * 0.2 * laserIntensity;

                            const thickness = 0.02 + flash * 0.05;
                            laser.outer.scale.set(thickness, laser.outer.scale.y, thickness);
                            laser.matOuter.color.setHex(activeTheme.glow);

                            // The inner bright line
                            maxCoreOpacity = Math.max(maxCoreOpacity, flash * 1.5 * laserIntensity);

                            const baseIdx = laser.idx * SEGMENTS_PER_LASER * 2 * 3;
                            let pIdx = baseIdx;
                            const dx = laser.v2.x - laser.v1.x;
                            const dy = laser.v2.y - laser.v1.y;
                            const dz = laser.v2.z - laser.v1.z;

                            // Physics for the traveling ray
                            const travel = Math.min(1.0, (1.0 - laser.life) * 4.0); // Travel from v1 to v2 extremely fast at spawn
                            const freq = 12.0;
                            const speed = 40.0;
                            const amplitude = 0.25 * flash;

                            const getPosAt = (t: number) => {
                                const actualT = Math.min(travel, t); // Clamp the line up to the current travel distance
                                let x = laser.v1.x + dx * actualT;
                                let y = laser.v1.y + dy * actualT;
                                let z = laser.v1.z + dz * actualT;

                                if (actualT > 0 && actualT < 1) {
                                    // Complex waveform generation for the energy beam effect
                                    const wave1 = Math.sin(actualT * freq - time * speed);
                                    const wave2 = Math.cos(actualT * freq * 1.3 + time * speed * 1.2);

                                    // High frequency electrical jitter running through the wave
                                    const jitter = Math.sin(actualT * 50.0 - time * 100.0) * 0.15;

                                    // Envelope forces the wave to connect smoothly to the vertices at start (0) and end (1)
                                    const envelope = Math.sin(actualT * Math.PI);

                                    // Apply orthogonal offsets (u, v) locally along the edge trajectory
                                    x += (laser.u.x * wave1 + laser.v.x * wave2 + laser.u.x * jitter) * amplitude * envelope;
                                    y += (laser.u.y * wave1 + laser.v.y * wave2 + laser.u.y * jitter) * amplitude * envelope;
                                    z += (laser.u.z * wave1 + laser.v.z * wave2 + laser.u.z * jitter) * amplitude * envelope;
                                }
                                return { x, y, z };
                            };

                            let prev = getPosAt(0);
                            for (let s = 1; s <= SEGMENTS_PER_LASER; s++) {
                                const curr = getPosAt(s / SEGMENTS_PER_LASER);
                                cPos[pIdx++] = prev.x; cPos[pIdx++] = prev.y; cPos[pIdx++] = prev.z;
                                cPos[pIdx++] = curr.x; cPos[pIdx++] = curr.y; cPos[pIdx++] = curr.z;
                                prev = curr;
                            }
                        }
                    }
                });

                laserCoreLines.material.opacity = maxCoreOpacity;
                laserCoreLines.geometry.attributes.position.needsUpdate = true;
            } else {
                // Instantly hide all lasers if toggled off
                laserConnectors.forEach(laser => {
                    if (laser.active) {
                        laser.active = false;
                        laser.matOuter.opacity = 0;
                        const baseIdx = laser.idx * SEGMENTS_PER_LASER * 2 * 3;
                        const cPos = laserCoreLines.geometry.attributes.position.array as Float32Array;
                        for(let j=0; j<SEGMENTS_PER_LASER*2*3; j++) cPos[baseIdx+j] = 0;
                    }
                });
                laserCoreLines.material.opacity = 0;
                laserCoreLines.geometry.attributes.position.needsUpdate = true;
            }


            // =================================================================
            //  PARTICLE UPDATE (Optimized DOD Physics Loop)
            // =================================================================

            if (particlesRef.current) {
                const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
                const colors    = particlesRef.current.geometry.attributes.color.array    as Float32Array;
                const vels      = particlesRef.current.userData.velocities as Float32Array;
                const life      = particlesRef.current.userData.life       as Float32Array;
                const activeMax = particlesRef.current.userData.activeMax  as number;
                const trailLen  = particlesRef.current.userData.trailLen   as number;

                // Sync the particle color strictly to the light's glow color
                const glowColor = new THREE.Color(activeTheme.glow);
                const cr = glowColor.r, cg = glowColor.g, cb = glowColor.b;

                const currentScale = heartbeatRef.current;

                if (coreGroupRef.current) {
                    const rot = coreGroupRef.current.rotation;
                    const pos = coreGroupRef.current.position;

                    const tN = new THREE.Vector3();
                    const tC = new THREE.Vector3();

                    for (let j = 0; j < icoVertices.length; j++) {
                        const v = worldVerticesCache[j].copy(icoVertices[j]).multiplyScalar(currentScale).applyEuler(rot).add(pos);
                        flatVerts[j*3]   = v.x;
                        flatVerts[j*3+1] = v.y;
                        flatVerts[j*3+2] = v.z;
                    }
                    for (let f = 0; f < numFaces; f++) {
                        tN.copy(faceNormals[f]).applyEuler(rot);
                        tC.copy(faceCentres[f]).multiplyScalar(currentScale).applyEuler(rot).add(pos);

                        const f3 = f * 3;
                        worldFaceNormalsFlat[f3]   = tN.x;
                        worldFaceNormalsFlat[f3+1] = tN.y;
                        worldFaceNormalsFlat[f3+2] = tN.z;

                        worldFaceCentresFlat[f3]   = tC.x;
                        worldFaceCentresFlat[f3+1] = tC.y;
                        worldFaceCentresFlat[f3+2] = tC.z;
                    }
                }

                const limit = qualityRef.current === 'ULTRA_LOW' ? Math.floor(activeMax * 0.5) : activeMax;

                if (limit !== prevLimitRef.current) {
                    for (let i = limit; i < activeMax; i++) {
                        const i6 = i * 6;
                        positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                        positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                    }
                    prevLimitRef.current = limit;
                    particlesRef.current.geometry.attributes.position.needsUpdate = true;
                }

                const turbulence = presetVars.turbulence ?? 0.3;
                frameCounter++;
                const chunkCount = qualityRef.current === 'HIGH' ? 2 : qualityRef.current === 'LOW' ? 4 : 8;
                updateCurlGridChunked(time, turbulence, chunkCount);

                const spawnMul = qualityRef.current === 'ULTRA_LOW' ? 0.35 : qualityRef.current === 'LOW' ? 0.65 : 1.0;
                const density  = presetVars.particleDensity ?? 1.0;
                const baseSpawn  = Math.floor(600 * density * spawnMul);
                const audioSpawn = Math.floor(Math.pow(sAmp, 1.3) * 6000 * density * spawnMul);
                let maxSpawn = baseSpawn + audioSpawn;
                let spawned  = 0;

                const ICO_RADIUS   = 1.6 * currentScale;
                const INNER_RADIUS = ICO_RADIUS * 0.92;
                const INNER_SQ     = INNER_RADIUS * INNER_RADIUS;

                const pSpeedMult = presetVars.particleSpeed ?? 1.0;
                const pTrailMult = presetVars.particleTrail ?? 1.0;
                const pLifeMult  = presetVars.particleLife ?? 1.0;

                const OUTER_RADIUS = ICO_RADIUS + 2.5 * pSpeedMult;
                const OUTER_SQ     = OUTER_RADIUS * OUTER_RADIUS;

                for (let i = 0; i < limit; i++) {
                    const i6 = i * 6;
                    const i3 = i * 3;

                    if (life[i] <= 0) {
                        if (spawned < maxSpawn) {
                            spawned++;

                            life[i] = (1.2 + Math.random() * 1.6) * pLifeMult;

                            const fIdx = Math.floor(Math.random() * numFaces);
                            const f3   = fIdx * 3;
                            const f9   = fIdx * 9;

                            const fnx = worldFaceNormalsFlat[f3];
                            const fny = worldFaceNormalsFlat[f3+1];
                            const fnz = worldFaceNormalsFlat[f3+2];

                            let u = Math.random(), v = Math.random();
                            if (u + v > 1) { u = 1 - u; v = 1 - v; }
                            const w  = 1 - u - v;
                            const lx = u*faceRawVerts[f9]   + v*faceRawVerts[f9+3] + w*faceRawVerts[f9+6];
                            const ly = u*faceRawVerts[f9+1] + v*faceRawVerts[f9+4] + w*faceRawVerts[f9+7];
                            const lz = u*faceRawVerts[f9+2] + v*faceRawVerts[f9+5] + w*faceRawVerts[f9+8];

                            const spawnPt = new THREE.Vector3(lx, ly, lz);
                            spawnPt.multiplyScalar(currentScale);

                            if (coreGroupRef.current) {
                                spawnPt.applyEuler(coreGroupRef.current.rotation);
                                spawnPt.add(coreGroupRef.current.position);
                            }

                            const off = 0.02 + Math.random() * 0.06;
                            positions[i6]   = spawnPt.x + fnx * off;
                            positions[i6+1] = spawnPt.y + fny * off;
                            positions[i6+2] = spawnPt.z + fnz * off;
                            positions[i6+3] = positions[i6];
                            positions[i6+4] = positions[i6+1];
                            positions[i6+5] = positions[i6+2];

                            const tx = fnz, ty = -fnx, tz = fny;
                            const tl = Math.sqrt(tx*tx + ty*ty + tz*tz) + 0.001;
                            const angle = Math.random() * Math.PI * 2;
                            const cos = Math.cos(angle), sin = Math.sin(angle);
                            const d   = (tx/tl)*fnx + (ty/tl)*fny + (tz/tl)*fnz;
                            const rtx = (tx/tl)*cos + (fny*(tz/tl) - fnz*(ty/tl))*sin + fnx*d*(1-cos);
                            const rty = (ty/tl)*cos + (fnz*(tx/tl) - fnx*(tz/tl))*sin + fny*d*(1-cos);
                            const rtz = (tz/tl)*cos + (fnx*(ty/tl) - fny*(tx/tl))*sin + fnz*d*(1-cos);

                            const spd = (0.005 + Math.random() * 0.01) * (1.0 + sBass * br) * pSpeedMult;
                            vels[i3]   = rtx * spd;
                            vels[i3+1] = rty * spd;
                            vels[i3+2] = rtz * spd;

                        } else {
                            positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                            positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                            colors[i6] = colors[i6+1] = colors[i6+2] = 0;
                            colors[i6+3] = colors[i6+4] = colors[i6+5] = 0;
                            continue;
                        }
                    }

                    if (life[i] > 0) {
                        life[i] -= dt;

                        let px = positions[i6], py = positions[i6+1], pz = positions[i6+2];
                        let vx = vels[i3],      vy = vels[i3+1],      vz = vels[i3+2];

                        let bestFace = 0;
                        let bestDot = -Infinity;
                        for (let f = 0; f < numFaces; f++) {
                            const f3 = f * 3;
                            const dot = px * worldFaceNormalsFlat[f3] + py * worldFaceNormalsFlat[f3+1] + pz * worldFaceNormalsFlat[f3+2];
                            if (dot > bestDot) {
                                bestDot = dot;
                                bestFace = f;
                            }
                        }

                        const bf3 = bestFace * 3;
                        const fnx = worldFaceNormalsFlat[bf3], fny = worldFaceNormalsFlat[bf3+1], fnz = worldFaceNormalsFlat[bf3+2];
                        const fcx = worldFaceCentresFlat[bf3], fcy = worldFaceCentresFlat[bf3+1], fcz = worldFaceCentresFlat[bf3+2];

                        const dx = px - fcx, dy = py - fcy, dz = pz - fcz;
                        const signedDist = dx * fnx + dy * fny + dz * fnz;

                        const pLen = Math.sqrt(px*px + py*py + pz*pz) + 0.0001;
                        const snx = px / pLen, sny = py / pLen, snz = pz / pLen;

                        const bnx = fnx * 0.6 + snx * 0.4;
                        const bny = fny * 0.6 + sny * 0.4;
                        const bnz = fnz * 0.6 + snz * 0.4;
                        const bnLen = Math.sqrt(bnx*bnx + bny*bny + bnz*bnz) + 0.0001;
                        const nx = bnx / bnLen, ny = bny / bnLen, nz = bnz / bnLen;

                        const rideH  = (0.04 + sAmp * 0.08) * currentScale;

                        const error = rideH - signedDist;
                        const magneticPull = error * 0.035;

                        vx += nx * magneticPull;
                        vy += ny * magneticPull;
                        vz += nz * magneticPull;

                        const vn = vx * nx + vy * ny + vz * nz;
                        vx -= nx * vn * 0.85;
                        vy -= ny * vn * 0.85;
                        vz -= nz * vn * 0.85;

                        sampleCurlGrid(px, py, pz, curlOut);
                        const flow = (0.00025 + sAmp * 0.0006 + sBass * 0.0004 * br) * density * pSpeedMult;
                        let cfx = curlOut.x * flow, cfy = curlOut.y * flow, cfz = curlOut.z * flow;
                        const cfn = cfx * nx + cfy * ny + cfz * nz;
                        vx += cfx - nx * cfn;
                        vy += cfy - ny * cfn;
                        vz += cfz - nz * cfn;

                        if (sBass > 0.3) {
                            const b = (sBass - 0.3) * 0.0015 * br * pSpeedMult;
                            vx += nx * b;
                            vy += ny * b;
                            vz += nz * b;
                        }

                        if (sTreble > 0.2) {
                            const t2 = sTreble * 0.0004 * pSpeedMult;
                            const rx = Math.random()-0.5, ry = Math.random()-0.5, rz = Math.random()-0.5;
                            const rn2 = rx * nx + ry * ny + rz * nz;
                            vx += (rx - nx * rn2) * t2;
                            vy += (ry - ny * rn2) * t2;
                            vz += (rz - nz * rn2) * t2;
                        }

                        if (qualityRef.current !== 'ULTRA_LOW') {
                            let closestVertSq = Infinity;
                            let cvx = 0, cvy = 0, cvz = 0;
                            for (let j = 0; j < icoVertices.length; j++) {
                                const j3 = j*3;
                                const ddx = flatVerts[j3]-px, ddy = flatVerts[j3+1]-py, ddz = flatVerts[j3+2]-pz;
                                const dSq = ddx*ddx + ddy*ddy + ddz*ddz;
                                if (dSq < closestVertSq) { closestVertSq = dSq; cvx = ddx; cvy = ddy; cvz = ddz; }
                            }
                            if (closestVertSq < 6.0 * currentScale * currentScale) {
                                const vd  = Math.sqrt(closestVertSq) + 0.001;
                                const str = 0.0001 / (closestVertSq + 0.3);
                                const txv = cvy * nz - cvz * ny;
                                const tyv = cvz * nx - cvx * nz;
                                const tzv = cvx * ny - cvy * nx;
                                vx += txv * str * 2.5 * pSpeedMult;
                                vy += tyv * str * 2.5 * pSpeedMult;
                                vz += tzv * str * 2.5 * pSpeedMult;
                                vx += (cvx/vd) * str * pSpeedMult;
                                vy += (cvy/vd) * str * pSpeedMult;
                                vz += (cvz/vd) * str * pSpeedMult;
                            }
                        }

                        const maxSpd = 0.8 * pSpeedMult;
                        const vSq = vx*vx + vy*vy + vz*vz;
                        if (vSq > maxSpd*maxSpd) {
                            const scale = maxSpd / Math.sqrt(vSq);
                            vx *= scale; vy *= scale; vz *= scale;
                        }

                        const damp = 1.0 - (0.05 + (1.0 - turbulence) * 0.02);
                        vx *= damp; vy *= damp; vz *= damp;

                        const pSq = px*px + py*py + pz*pz;
                        if (pSq < INNER_SQ && pSq > 0.001) {
                            const pLen2 = Math.sqrt(pSq);
                            const nx2 = px/pLen2, ny2 = py/pLen2, nz2 = pz/pLen2;
                            const push = INNER_RADIUS - pLen2;
                            px += nx2 * (push + 0.01);
                            py += ny2 * (push + 0.01);
                            pz += nz2 * (push + 0.01);
                            const vDotN2 = vx*nx2 + vy*ny2 + vz*nz2;
                            if (vDotN2 < 0) {
                                vx -= nx2 * vDotN2 * 1.5;
                                vy -= ny2 * vDotN2 * 1.5;
                                vz -= nz2 * vDotN2 * 1.5;
                            }
                        }

                        px += vx * fpsScale;
                        py += vy * fpsScale;
                        pz += vz * fpsScale;

                        vels[i3] = vx; vels[i3+1] = vy; vels[i3+2] = vz;

                        const spd2 = Math.sqrt(vSq) + 0.0001;
                        const dynTrail = (trailLen + spd2 * (0.3 + sAmp * 0.5)) * pTrailMult;
                        const sInv = 1.0 / spd2;
                        positions[i6]   = px;
                        positions[i6+1] = py;
                        positions[i6+2] = pz;
                        positions[i6+3] = px - vx * sInv * dynTrail;
                        positions[i6+4] = py - vy * sInv * dynTrail;
                        positions[i6+5] = pz - vz * sInv * dynTrail;

                        const newSq = px*px + py*py + pz*pz;
                        if (life[i] <= 0 || signedDist > 3.0 * currentScale || newSq > OUTER_SQ * 1.2) {
                            life[i] = 0;
                            positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                            positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                            colors[i6] = colors[i6+1] = colors[i6+2] = 0;
                            colors[i6+3] = colors[i6+4] = colors[i6+5] = 0;
                        } else {
                            const rawLife = Math.max(0, life[i]);
                            const maxAge  = 2.0 * pLifeMult;
                            const t01     = rawLife / maxAge;
                            const fadeIn  = Math.min(1.0, (1.0 - t01) * 5.0);
                            const fadeOut = Math.min(1.0, t01 * 3.0);
                            const env     = Math.min(fadeIn, fadeOut);

                            const bright = env * (0.8 + sAmp * 1.5 + sBass * 2.0 * br + sTreble * 0.8);

                            // Perfect monochromatic color matching the active theme's glow
                            const r = Math.min(1, cr * bright);
                            const g = Math.min(1, cg * bright);
                            const b = Math.min(1, cb * bright);

                            colors[i6]   = r; colors[i6+1] = g; colors[i6+2] = b;
                            colors[i6+3] = r * 0.25; colors[i6+4] = g * 0.25; colors[i6+5] = b * 0.25;
                        }
                    }
                }

                const activeRange = limit * 6;
                particlesRef.current.geometry.attributes.position.updateRange = { offset: 0, count: activeRange };
                particlesRef.current.geometry.attributes.color.updateRange    = { offset: 0, count: activeRange };
                particlesRef.current.geometry.attributes.position.needsUpdate = true;
                particlesRef.current.geometry.attributes.color.needsUpdate    = true;
            }

            if (onAutoQualityChange) {
                const nowMs = performance.now();
                const delta = nowMs - lastFpsCheck;
                lastFpsCheck = nowMs;
                if (delta > 0) fpsHistory.push(1000 / delta);
                if (fpsHistory.length >= 60) {
                    const avgFps = fpsHistory.reduce((a,b) => a+b) / fpsHistory.length;
                    if (avgFps < 45) {
                        if (qualityRef.current === 'HIGH') {
                            renderer.setPixelRatio(1.5);
                            onAutoQualityChange('LOW');
                            fpsHistory.length = 0;
                        } else if (qualityRef.current === 'LOW') {
                            renderer.setPixelRatio(0.75);
                            onAutoQualityChange('ULTRA_LOW');
                            fpsHistory.length = 0;
                        } else {
                            fpsHistory.length = 0;
                        }
                    } else if (fpsHistory.length > 200) {
                        fpsHistory.shift();
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

            starsGeo.dispose();
            starsMat.dispose();
            starTex.dispose();
            nebulaTex.dispose();
            laserBaseGeo.dispose();
            laserCoreGeo.dispose();
            laserCoreMat.dispose();

            if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
                containerRef.current.removeChild(renderer.domElement);
            }
        };
    }, []);
};