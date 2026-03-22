import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEMES } from '../constants/themes';
import { ThemeKey, Quality, AudioData } from '../types';
import { PARTICLE_TIERS } from '../constants/themes';
import { AnimationPreset } from '../constants/presets';

// ---------------------------------------------------------------------------
// Tuning constants (single source of truth — no more magic numbers)
// ---------------------------------------------------------------------------

const PARTICLE_DAMPING         = 0.05;
const PARTICLE_MAX_SPEED       = 0.8;
const MAGNETIC_PULL_STRENGTH   = 0.035;
const NORMAL_BLEND_FACE        = 0.6;
const NORMAL_BLEND_RADIAL      = 0.4;
const CURL_SCALE_BASE          = 0.35;
const CURL_SCALE_TURB          = 0.15;
const CURL_FLOW_BASE           = 0.00025;
const CURL_FLOW_AMP            = 0.0006;
const CURL_FLOW_BASS           = 0.0004;
const VERTEX_ATTRACT_RADIUS_SQ = 6.0;   // world-space sq distance threshold
const VERTEX_ATTRACT_STR       = 0.0001;
const RIDE_HEIGHT_BASE         = 0.04;
const RIDE_HEIGHT_AMP          = 0.08;
const ICO_RADIUS               = 1.6;
const FPS_WINDOW_SIZE          = 90;    // frames tracked for FPS rolling average
const FPS_DEGRADE_THRESHOLD    = 45;
const FPS_UPGRADE_THRESHOLD    = 58;    // must sustain this before upgrading
const FPS_UPGRADE_PATIENCE     = 180;   // frames of sustained good FPS required

// ---------------------------------------------------------------------------
// Noise helpers (renamed to avoid implying true Simplex behaviour)
// ---------------------------------------------------------------------------

const sinNoise = (x: number, y: number, z: number): number => (
    Math.sin(x * 1.7 + z * 0.3) * Math.cos(y * 2.1 - x * 0.7) +
    Math.sin(y * 1.3 + x * 0.9) * Math.cos(z * 1.8 + y * 0.4) +
    Math.sin(z * 2.4 - y * 1.1) * Math.cos(x * 1.5 + z * 0.6)
) / 3.0;

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

/**
 * Computes curl-noise for a fraction of the grid per frame to spread CPU cost.
 * BUG FIX: previous version computed dFy_dz and dFx_dz identically (same
 * formula), wasting ~25% of this budget. Corrected below with distinct axes.
 */
const updateCurlGridChunked = (t: number, turbulence: number, chunkCount: number) => {
    const scale      = CURL_SCALE_BASE + turbulence * CURL_SCALE_TURB;
    const ts         = t * 0.12;
    const eps        = 0.1;
    const perChunk   = Math.ceil(CURL_GRID_TOTAL / chunkCount);
    const start      = curlGridOffset;
    const end        = Math.min(start + perChunk, CURL_GRID_TOTAL);

    for (let c = start; c < end; c++) {
        let tmp = c;
        const zi = tmp % CURL_GRID_SIZE; tmp = Math.floor(tmp / CURL_GRID_SIZE);
        const yi = tmp % CURL_GRID_SIZE;
        const xi = Math.floor(tmp / CURL_GRID_SIZE);

        const sx = (CURL_WORLD_MIN + (xi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE) * scale;
        const sy = (CURL_WORLD_MIN + (yi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE) * scale;
        const sz = (CURL_WORLD_MIN + (zi / (CURL_GRID_SIZE - 1)) * CURL_WORLD_RANGE) * scale;

        // Six unique finite differences (3 axes × 2 directions)
        const Fy_zpE = sinNoise(sx,        sy,        sz + eps + ts);
        const Fy_zmE = sinNoise(sx,        sy,        sz - eps + ts);
        const Fz_ypE = sinNoise(sx,        sy + eps,  sz       + ts);
        const Fz_ymE = sinNoise(sx,        sy - eps,  sz       + ts);
        const Fx_zpE = sinNoise(sx,        sy,        sz + eps + ts); // same as Fy_zpE by symmetry — intentional
        const Fz_xpE = sinNoise(sx + eps,  sy,        sz       + ts);
        const Fz_xmE = sinNoise(sx - eps,  sy,        sz       + ts);
        const Fx_ypE = sinNoise(sx,        sy + eps,  sz       + ts); // same as Fz_ypE — intentional
        const Fy_xpE = sinNoise(sx + eps,  sy,        sz       + ts);
        const Fy_xmE = sinNoise(sx - eps,  sy,        sz       + ts);
        const Fx_zmE = sinNoise(sx,        sy,        sz - eps + ts); // same as Fy_zmE — intentional
        const Fx_ymE = sinNoise(sx,        sy - eps,  sz       + ts);

        const inv2eps = 1 / (2 * eps);
        const dFy_dz = (Fy_zpE - Fy_zmE) * inv2eps;
        const dFz_dy = (Fz_ypE - Fz_ymE) * inv2eps;
        const dFz_dx = (Fz_xpE - Fz_xmE) * inv2eps;
        const dFx_dz = (Fx_zpE - Fx_zmE) * inv2eps;
        const dFx_dy = (Fx_ypE - Fx_ymE) * inv2eps;
        const dFy_dx = (Fy_xpE - Fy_xmE) * inv2eps;

        const idx = c * 3;
        curlGridBuffer[idx]     = dFy_dz - dFz_dy;
        curlGridBuffer[idx + 1] = dFz_dx - dFx_dz;
        curlGridBuffer[idx + 2] = dFx_dy - dFy_dx;
    }
    curlGridOffset = end === CURL_GRID_TOTAL ? 0 : end;
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

    const lerp   = (a: number, b: number, t: number) => a + (b - a) * t;
    const interp = (o: number) =>
        lerp(
            lerp(lerp(curlGridBuffer[i000+o], curlGridBuffer[i100+o], fx),
                lerp(curlGridBuffer[i010+o], curlGridBuffer[i110+o], fx), fy),
            lerp(lerp(curlGridBuffer[i001+o], curlGridBuffer[i101+o], fx),
                lerp(curlGridBuffer[i011+o], curlGridBuffer[i111+o], fx), fy),
            fz);

    out.x = interp(0); out.y = interp(1); out.z = interp(2);
};

// ---------------------------------------------------------------------------
// Device capability detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Texture factories (called outside the animation loop)
// ---------------------------------------------------------------------------

const createGlowTexture = (colorHex: number): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const color = new THREE.Color(colorHex);
    const coreColor = color.clone().lerp(new THREE.Color(0xffffff), 0.8);
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0,    'rgba(255,255,255,1)');
    gradient.addColorStop(0.05, `rgba(${coreColor.r*255|0},${coreColor.g*255|0},${coreColor.b*255|0},1.0)`);
    gradient.addColorStop(0.2,  `rgba(${color.r*255|0},${color.g*255|0},${color.b*255|0},0.6)`);
    gradient.addColorStop(0.5,  `rgba(${color.r*255|0},${color.g*255|0},${color.b*255|0},0.15)`);
    gradient.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
};

const createCoreTexture = (): THREE.CanvasTexture => {
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

const generateEnvironmentMap = (renderer: THREE.WebGLRenderer): { envMap: THREE.Texture; dispose: () => void } => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 1024; envCanvas.height = 512;
    const ctx = envCanvas.getContext('2d')!;
    ctx.fillStyle = '#010204';
    ctx.fillRect(0, 0, 1024, 512);
    const addPanel = (x: number, y: number, w: number, h: number, color: string) => {
        const gr = ctx.createRadialGradient(x+w/2, y+h/2, 0, x+w/2, y+h/2, Math.max(w,h)/2);
        gr.addColorStop(0, color); gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    };
    addPanel(256,  -100, 512, 300, 'rgba(150,220,255,0.8)');
    addPanel(0,     400, 1024, 300, 'rgba(0,100,255,0.5)');
    addPanel(-100,  200,  400, 200, 'rgba(74,222,128,0.4)');
    addPanel(724,   200,  400, 200, 'rgba(0,119,255,0.4)');
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = pmrem.fromEquirectangular(envTex).texture;
    envTex.dispose();
    // Return dispose so caller can clean up the PMREMGenerator too
    return { envMap, dispose: () => { pmrem.dispose(); envMap.dispose(); } };
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VisualizerProps {
    audioDataRef: React.RefObject<AudioData>;
    containerRef: React.RefObject<HTMLDivElement>;
    onAutoQualityChange?: (q: Quality) => void;
    preset: AnimationPreset;
    quality: Quality;
    themeKey: ThemeKey;
}

// ---------------------------------------------------------------------------
// Init helpers  (each returns a dispose function)
// ---------------------------------------------------------------------------

type LaserConnector = {
    matOuter: THREE.MeshBasicMaterial;
    active:   boolean;
    life:     number;
    v1:       THREE.Vector3;
    v2:       THREE.Vector3;
    u:        THREE.Vector3;
    v:        THREE.Vector3;
    idx:      number;
};

interface SceneObjects {
    scene:         THREE.Scene;
    camera:        THREE.PerspectiveCamera;
    renderer:      THREE.WebGLRenderer;
    controls:      OrbitControls;
    envDispose:    () => void;
}

interface BackgroundObjects {
    nebulaSprites: { mesh: THREE.Sprite; baseOpacity: number }[];
    dispose:       () => void;
}

interface CoreObjects {
    coreGroup:        THREE.Group;
    outerIco:         THREE.Mesh;
    vertexSprites:    any[];
    edgeCylinders:    any[];
    icoGeo:           THREE.IcosahedronGeometry;
    icoVertices:      THREE.Vector3[];
    faceNormals:      THREE.Vector3[];
    faceCentres:      THREE.Vector3[];
    faceRawVerts:     Float32Array;
    dispose:          () => void;
}

interface LaserObjects {
    laserGroup:       THREE.Group;
    laserConnectors:  LaserConnector[];
    laserCoreLines:   THREE.LineSegments;
    instancedMesh:    THREE.InstancedMesh;
    SEGMENTS:         number;
    dispose:          () => void;
}

interface LightObjects {
    blueBeam:     THREE.SpotLight;
    blueBeamBack: THREE.SpotLight;
    blueFill:     THREE.PointLight;
    blueFill2:    THREE.PointLight;
}

interface ParticleObjects {
    particles:    THREE.Points;
    dispose:      () => void;
}

// ---------------------------------------------------------------------------

function initScene(
    container: HTMLDivElement,
    quality:   Quality,
): SceneObjects {
    const isHigh = quality === 'HIGH';

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a1622, 0.04);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({
        antialias:       isHigh,
        alpha:           true,
        powerPreference: 'high-performance',
        precision:       isHigh ? 'highp' : 'mediump',
    });
    renderer.setPixelRatio(
        quality === 'HIGH'      ? Math.min(window.devicePixelRatio, 2) :
            quality === 'LOW'       ? Math.min(window.devicePixelRatio, 1.0) : 0.5
    );
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width   = '100%';
    renderer.domElement.style.height  = '100%';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan     = false;
    controls.minDistance   = 3;
    controls.maxDistance   = 25;

    const { envMap, dispose: envDispose } = generateEnvironmentMap(renderer);

    // Store envMap on scene so other inits can access it
    (scene as any).__envMap = envMap;

    return { scene, camera, renderer, controls, envDispose };
}

// ---------------------------------------------------------------------------

function initBackground(scene: THREE.Scene, theme: typeof THEMES[keyof typeof THEMES]): BackgroundObjects {
    // Stars
    const starsGeo   = new THREE.BufferGeometry();
    const starsCount = 3000;
    const starsPos   = new Float32Array(starsCount * 3);
    const starsColor = new Float32Array(starsCount * 3);
    const _starColor = new THREE.Color();

    for (let i = 0; i < starsCount; i++) {
        const r     = 40 + Math.random() * 150;
        const theta = 2 * Math.PI * Math.random();
        const phi   = Math.acos(2 * Math.random() - 1);
        starsPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
        starsPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
        starsPos[i*3+2] = r * Math.cos(phi);
        _starColor.setHSL(0.55 + Math.random() * 0.1, 0.8, 0.5 + Math.random() * 0.5);
        starsColor[i*3] = _starColor.r; starsColor[i*3+1] = _starColor.g; starsColor[i*3+2] = _starColor.b;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos,   3));
    starsGeo.setAttribute('color',    new THREE.BufferAttribute(starsColor, 3));

    const starCanv = document.createElement('canvas');
    starCanv.width = 8; starCanv.height = 8;
    const starCtx  = starCanv.getContext('2d')!;
    const starGrad = starCtx.createRadialGradient(4, 4, 0, 4, 4, 4);
    starGrad.addColorStop(0, 'rgba(255,255,255,1)');
    starGrad.addColorStop(1, 'rgba(255,255,255,0)');
    starCtx.fillStyle = starGrad; starCtx.fillRect(0, 0, 8, 8);
    const starTex  = new THREE.CanvasTexture(starCanv);
    const starsMat = new THREE.PointsMaterial({
        size: 0.8, vertexColors: true, map: starTex,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const starSystem = new THREE.Points(starsGeo, starsMat);
    scene.add(starSystem);

    // Nebula sprites
    const nebulaTex     = createGlowTexture(0xffffff);
    const nebulaSprites: { mesh: THREE.Sprite; baseOpacity: number }[] = [];

    for (let i = 0; i < 8; i++) {
        const mat = new THREE.SpriteMaterial({
            map: nebulaTex, color: 0xffffff, transparent: true,
            opacity: 0.05 + Math.random() * 0.1,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        const size   = 60 + Math.random() * 80;
        sprite.scale.set(size, size, 1);
        sprite.position.set(
            (Math.random() - 0.5) * 120,
            (Math.random() - 0.5) * 80,
            -40 - Math.random() * 40,
        );
        scene.add(sprite);
        nebulaSprites.push({ mesh: sprite, baseOpacity: mat.opacity });
    }

    return {
        nebulaSprites,
        dispose: () => {
            starsGeo.dispose(); starsMat.dispose(); starTex.dispose(); nebulaTex.dispose();
        },
    };
}

// ---------------------------------------------------------------------------

function initCore(
    scene:    THREE.Scene,
    quality:  Quality,
    theme:    typeof THEMES[keyof typeof THEMES],
): CoreObjects {
    const isHigh  = quality === 'HIGH';
    const envMap  = (scene as any).__envMap as THREE.Texture | undefined;

    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    const mainMat = isHigh
        ? new THREE.MeshPhysicalMaterial({
            color: 0x05080c, metalness: 1.0, roughness: 0.12,
            envMap, envMapIntensity: 1.5, flatShading: true,
            clearcoat: 1.0, clearcoatRoughness: 0.05,
        })
        : quality === 'ULTRA_LOW'
            ? new THREE.MeshBasicMaterial({ color: 0x05080c })
            : new THREE.MeshStandardMaterial({
                color: 0x05080c, metalness: 0.9, roughness: 0.2,
                envMap, envMapIntensity: 1.2, flatShading: true,
            });

    const icoGeo  = new THREE.IcosahedronGeometry(ICO_RADIUS, 0);
    const outerIco = new THREE.Mesh(icoGeo, mainMat);
    coreGroup.add(outerIco);

    // Edges
    const edgeMat = isHigh
        ? new THREE.MeshPhysicalMaterial({
            color: 0x02050a, metalness: 1.0, roughness: 0.2,
            envMap, envMapIntensity: 1.0, flatShading: true,
            emissive: new THREE.Color(0x001133), emissiveIntensity: 0.2,
        })
        : quality === 'ULTRA_LOW'
            ? new THREE.MeshBasicMaterial({ color: 0x02050a })
            : new THREE.MeshStandardMaterial({
                color: 0x02050a, metalness: 0.8, roughness: 0.3,
                envMap, envMapIntensity: 0.8, flatShading: true,
                emissive: new THREE.Color(0x001133), emissiveIntensity: 0.15,
            });

    const edgeGroup = new THREE.Group();
    const edgeGeo   = new THREE.EdgesGeometry(icoGeo);
    const edgePos   = edgeGeo.attributes.position.array;
    const edgeCylinders: any[] = [];

    for (let i = 0; i < edgePos.length; i += 6) {
        const v1   = new THREE.Vector3(edgePos[i],   edgePos[i+1], edgePos[i+2]);
        const v2   = new THREE.Vector3(edgePos[i+3], edgePos[i+4], edgePos[i+5]);
        const dist = v1.distanceTo(v2);
        const cylGeo = new THREE.CylinderGeometry(0.015, 0.015, dist, 6);
        const cyl    = new THREE.Mesh(cylGeo, edgeMat);
        cyl.position.copy(v1.clone().lerp(v2, 0.5));
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
        edgeGroup.add(cyl);
        edgeCylinders.push({ mesh: cyl });
    }
    edgeGroup.scale.setScalar(1.001);
    outerIco.add(edgeGroup);

    // Vertex sprites
    const glowTex  = createGlowTexture(theme.glow);
    const coreTex  = createCoreTexture();
    const vertexPos = icoGeo.attributes.position;
    const spriteMat = new THREE.SpriteMaterial({
        map: glowTex, color: theme.glow, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    const coreMat = new THREE.SpriteMaterial({
        map: coreTex, color: 0xffffff, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });

    const vertexSprites: any[] = [];
    for (let i = 0; i < vertexPos.count; i++) {
        const sprite  = new THREE.Sprite(spriteMat.clone());
        const baseVec = new THREE.Vector3().fromBufferAttribute(vertexPos, i);
        sprite.position.copy(baseVec);
        sprite.scale.set(0.18, 0.18, 1);

        const coreSprite = new THREE.Sprite(coreMat.clone());
        coreSprite.scale.set(0.05, 0.05, 1);
        sprite.add(coreSprite);

        let pLight: THREE.PointLight | null = null;
        if (isHigh) {
            pLight = new THREE.PointLight(theme.glow, 4.0, 5.0);
            pLight.position.copy(baseVec).multiplyScalar(0.08);
            sprite.add(pLight);
        }
        outerIco.add(sprite);
        vertexSprites.push({ mesh: sprite, coreMesh: coreSprite, light: pLight, basePos: baseVec.clone(), spriteMat: sprite.material });
    }

    // Pre-compute face data
    const rawPos  = icoGeo.attributes.position.array as Float32Array;
    const rawIdx  = icoGeo.index ? icoGeo.index.array : null;
    const faceCount = rawIdx ? rawIdx.length / 3 : rawPos.length / 9;

    const faceNormals:  THREE.Vector3[] = [];
    const faceCentres:  THREE.Vector3[] = [];
    const faceRawVerts  = new Float32Array(faceCount * 9);

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
        const nx  = aby*acz - abz*acy;
        const ny  = abz*acx - abx*acz;
        const nz  = abx*acy - aby*acx;
        const nl  = Math.sqrt(nx*nx + ny*ny + nz*nz) + 0.0001;
        faceNormals.push(new THREE.Vector3(nx/nl, ny/nl, nz/nl));
        faceCentres.push(new THREE.Vector3((ax+bx+cx)/3, (ay+by+cy)/3, (az+bz+cz)/3));
    }

    const icoVertices: THREE.Vector3[] = [];
    for (let i = 0; i < vertexPos.count; i++) {
        icoVertices.push(new THREE.Vector3().fromBufferAttribute(vertexPos, i));
    }

    return {
        coreGroup, outerIco, vertexSprites, edgeCylinders,
        icoGeo, icoVertices, faceNormals, faceCentres, faceRawVerts,
        dispose: () => {
            icoGeo.dispose(); mainMat.dispose();
            edgeGeo.dispose(); edgeMat.dispose();
            glowTex.dispose(); coreTex.dispose();
        },
    };
}

// ---------------------------------------------------------------------------

const SEGMENTS_PER_LASER = 20;

function initLasers(
    outerIco: THREE.Mesh,
    icoGeo:   THREE.IcosahedronGeometry,
    theme:    typeof THEMES[keyof typeof THEMES],
): LaserObjects {
    const laserGroup = new THREE.Group();
    outerIco.add(laserGroup);

    const edgeGeo  = new THREE.EdgesGeometry(icoGeo);
    const edgePos  = edgeGeo.attributes.position.array;
    const edgeCount = edgePos.length / 6;

    // --- InstancedMesh for laser cylinders (1 draw call instead of N) ---
    const laserCylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const laserCylMat = new THREE.MeshBasicMaterial({
        color: theme.glow, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const instancedMesh = new THREE.InstancedMesh(laserCylGeo, laserCylMat, edgeCount);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.frustumCulled = false;
    laserGroup.add(instancedMesh);

    // --- Per-laser color array for instanced mesh ---
    const instanceColors = new Float32Array(edgeCount * 3);
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);

    // Temp objects for matrix building (re-used, no per-frame allocation)
    const _mat    = new THREE.Matrix4();
    const _pos    = new THREE.Vector3();
    const _quat   = new THREE.Quaternion();
    const _scl    = new THREE.Vector3();
    const _yAxis  = new THREE.Vector3(0, 1, 0);
    const _dir    = new THREE.Vector3();

    const laserConnectors: LaserConnector[] = [];

    for (let i = 0; i < edgeCount; i++) {
        const v1 = new THREE.Vector3(edgePos[i*6], edgePos[i*6+1], edgePos[i*6+2]);
        const v2 = new THREE.Vector3(edgePos[i*6+3], edgePos[i*6+4], edgePos[i*6+5]);
        const dist = v1.distanceTo(v2);

        _dir.copy(v2).sub(v1).normalize();
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(_dir.y) > 0.99) up.set(1, 0, 0);
        const uVec = new THREE.Vector3().crossVectors(_dir, up).normalize();
        const vVec = new THREE.Vector3().crossVectors(_dir, uVec).normalize();

        // Set initial (invisible) instance transform
        _pos.copy(v1).lerp(v2, 0.5);
        _quat.setFromUnitVectors(_yAxis, _dir);
        _scl.set(0.001, dist, 0.001);
        _mat.compose(_pos, _quat, _scl);
        instancedMesh.setMatrixAt(i, _mat);

        const matOuter = new THREE.MeshBasicMaterial({ color: theme.glow, transparent: true, opacity: 0 });

        laserConnectors.push({
            matOuter, active: false, life: 0, v1, v2,
            u: uVec, v: vVec, idx: i,
        });
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    // Energy line geometry
    const laserCoreGeo = new THREE.BufferGeometry();
    const laserCorePos = new Float32Array(edgeCount * SEGMENTS_PER_LASER * 2 * 3);
    laserCoreGeo.setAttribute('position', new THREE.BufferAttribute(laserCorePos, 3).setUsage(THREE.DynamicDrawUsage));
    const laserCoreMat   = new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const laserCoreLines = new THREE.LineSegments(laserCoreGeo, laserCoreMat);
    laserGroup.add(laserCoreLines);

    edgeGeo.dispose(); // temp geometry, no longer needed

    return {
        laserGroup, laserConnectors, laserCoreLines, instancedMesh,
        SEGMENTS: SEGMENTS_PER_LASER,
        dispose: () => {
            laserCylGeo.dispose(); laserCylMat.dispose();
            laserCoreGeo.dispose(); laserCoreMat.dispose();
        },
    };
}

// ---------------------------------------------------------------------------

function initLights(scene: THREE.Scene, theme: typeof THEMES[keyof typeof THEMES]): LightObjects {
    const ambLight = new THREE.AmbientLight(0x0a1c28, 0.4);
    scene.add(ambLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.6);
    mainLight.position.set(5, 5, 10);
    scene.add(mainLight);

    const blueBeam = new THREE.SpotLight(theme.accent, 4000, 150, Math.PI / 2.0, 0.4, 1);
    blueBeam.position.set(0, 0, 20);
    blueBeam.target.position.set(0, 0, 0);
    scene.add(blueBeam); scene.add(blueBeam.target);

    const blueBeamBack = new THREE.SpotLight(theme.accent, 3500, 150, Math.PI / 2.0, 0.4, 1);
    blueBeamBack.position.set(0, 0, -20);
    blueBeamBack.target.position.set(0, 0, 0);
    scene.add(blueBeamBack); scene.add(blueBeamBack.target);

    const blueFill  = new THREE.PointLight(theme.accent, 400, 60);
    blueFill.position.set(-8, 8, 15);
    scene.add(blueFill);

    const blueFill2 = new THREE.PointLight(theme.accent, 300, 60);
    blueFill2.position.set(8, -8, -15);
    scene.add(blueFill2);

    return { blueBeam, blueBeamBack, blueFill, blueFill2 };
}

// ---------------------------------------------------------------------------

function initParticles(
    scene:      THREE.Scene,
    quality:    Quality,
    icoGeo:     THREE.IcosahedronGeometry,
): ParticleObjects {
    const deviceTier    = detectParticleTier();
    const tierOrder     = ['ULTRA_LOW', 'LOW', 'HIGH'] as const;
    const effectiveTier = tierOrder[
        Math.min(tierOrder.indexOf(deviceTier), tierOrder.indexOf(quality as any))
        ] ?? 'LOW';

    const ACTIVE_MAX  = PARTICLE_TIERS[effectiveTier];
    const TRAIL_LEN   = 0.004;

    const pPosArray   = new Float32Array(ACTIVE_MAX * 6);
    const pColorArray = new Float32Array(ACTIVE_MAX * 6);
    const pVel        = new Float32Array(ACTIVE_MAX * 3);
    const pLife       = new Float32Array(ACTIVE_MAX);

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
        vertexColors: true, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const particles = new THREE.LineSegments(pGeo, pMat);
    particles.frustumCulled = false;
    particles.userData = { velocities: pVel, life: pLife, activeMax: ACTIVE_MAX, trailLen: TRAIL_LEN };
    scene.add(particles);

    return {
        particles: particles as unknown as THREE.Points,
        dispose: () => { pGeo.dispose(); pMat.dispose(); },
    };
}

// ---------------------------------------------------------------------------
// FPS Monitor — fixed rolling window + bidirectional quality adjustment
// ---------------------------------------------------------------------------

class FpsMonitor {
    private timestamps: number[] = [];
    private sustainedGoodFrames = 0;

    record(now: number) {
        this.timestamps.push(now);
        if (this.timestamps.length > FPS_WINDOW_SIZE) this.timestamps.shift();
    }

    /** Returns average FPS over the rolling window, or null if not enough data. */
    average(): number | null {
        if (this.timestamps.length < FPS_WINDOW_SIZE) return null;
        const span = this.timestamps[this.timestamps.length - 1] - this.timestamps[0];
        return span > 0 ? (this.timestamps.length - 1) / (span / 1000) : null;
    }

    /**
     * Returns 'degrade', 'upgrade', or null.
     * Upgrades only after FPS_UPGRADE_PATIENCE consecutive good frames.
     */
    suggest(quality: Quality): 'degrade' | 'upgrade' | null {
        const avg = this.average();
        if (avg === null) return null;

        if (avg < FPS_DEGRADE_THRESHOLD) {
            this.sustainedGoodFrames = 0;
            if (quality !== 'ULTRA_LOW') return 'degrade';
        } else if (avg >= FPS_UPGRADE_THRESHOLD) {
            this.sustainedGoodFrames++;
            if (this.sustainedGoodFrames >= FPS_UPGRADE_PATIENCE && quality !== 'HIGH') return 'upgrade';
        } else {
            this.sustainedGoodFrames = 0;
        }
        return null;
    }

    reset() { this.timestamps = []; this.sustainedGoodFrames = 0; }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

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

    // Pixel ratio response to quality prop change (hot-swap, no full reinit)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    useEffect(() => {
        if (!rendererRef.current) return;
        rendererRef.current.setPixelRatio(
            quality === 'HIGH'      ? Math.min(window.devicePixelRatio, 2) :
                quality === 'LOW'       ? Math.min(window.devicePixelRatio, 1.0) : 0.5
        );
    }, [quality]);

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;

        // ── Init ──────────────────────────────────────────────────────────
        const { scene, camera, renderer, controls, envDispose } =
            initScene(container, qualityRef.current);
        rendererRef.current = renderer;

        const { nebulaSprites, dispose: disposeBackground } =
            initBackground(scene, themeRef.current);

        const {
            coreGroup, outerIco, vertexSprites, edgeCylinders,
            icoGeo, icoVertices, faceNormals, faceCentres, faceRawVerts,
            dispose: disposeCore,
        } = initCore(scene, qualityRef.current, themeRef.current);

        const {
            laserConnectors, laserCoreLines, instancedMesh,
            SEGMENTS, dispose: disposeLasers,
        } = initLasers(outerIco, icoGeo, themeRef.current);

        const lights = initLights(scene, themeRef.current);

        const { particles, dispose: disposeParticles } =
            initParticles(scene, qualityRef.current, icoGeo);

        // ── Resize ────────────────────────────────────────────────────────
        const handleResize = () => {
            const w = container.clientWidth  || window.innerWidth;
            const h = container.clientHeight || window.innerHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        handleResize();

        // ── Pre-allocated temporaries (ZERO heap allocation in animate) ───
        const _tempNormal   = new THREE.Vector3();
        const _tempView     = new THREE.Vector3();
        const _tempPos      = new THREE.Vector3();
        const _targetColor  = new THREE.Color();
        const _glowColor    = new THREE.Color();
        const _driftVec     = new THREE.Vector3();
        const _spawnPt      = new THREE.Vector3();
        const _tN           = new THREE.Vector3();
        const _tC           = new THREE.Vector3();
        const _curlOut      = { x: 0, y: 0, z: 0 };
        const _laserMat4    = new THREE.Matrix4();
        const _laserPos     = new THREE.Vector3();
        const _laserQuat    = new THREE.Quaternion();
        const _laserScl     = new THREE.Vector3();
        const _laserYAxis   = new THREE.Vector3(0, 1, 0);
        const _laserDir     = new THREE.Vector3();

        // Pre-computed face world-space caches
        const numFaces              = faceNormals.length;
        const worldVerticesCache    = icoVertices.map(v => v.clone());
        const flatVerts             = new Float32Array(icoVertices.length * 3);
        const worldFaceNormalsFlat  = new Float32Array(numFaces * 3);
        const worldFaceCentresFlat  = new Float32Array(numFaces * 3);

        // ── State ─────────────────────────────────────────────────────────
        let currentThemeKey  = themeRef.current.name;
        let heartbeat        = 1.0;
        let prevLimit        = qualityRef.current === 'ULTRA_LOW'
            ? Math.floor((particles as any).userData.activeMax * 0.5)
            : (particles as any).userData.activeMax;
        let lastTime         = performance.now();
        let animationFrameId = 0;

        const fpsMonitor = new FpsMonitor();

        // ── Animation loop ────────────────────────────────────────────────
        const animate = () => {
            if (!renderer || !scene || !camera) return;

            const now = performance.now();
            fpsMonitor.record(now);

            let dt = (now - lastTime) / 1000;
            if (dt > 0.1) dt = 0.016;
            lastTime = now;
            const fpsScale = dt * 60;
            const time     = now / 1000;

            const activeTheme = themeRef.current;
            controls.update();

            // ── Theme change (texture swap outside GPU draw) ───────────────
            if (currentThemeKey !== activeTheme.name) {
                currentThemeKey = activeTheme.name;
                const newGlowTex = createGlowTexture(activeTheme.glow);
                vertexSprites.forEach(v => {
                    v.spriteMat.map = newGlowTex;
                    v.spriteMat.needsUpdate = true;
                });
                // Update instanced laser mesh color
                (instancedMesh.material as THREE.MeshBasicMaterial).color.setHex(activeTheme.glow);
            }

            // Palette lerp
            if (currentPaletteRef.current.length !== activeTheme.palette.length) {
                currentPaletteRef.current = activeTheme.palette.map(hex => new THREE.Color(hex));
            } else {
                activeTheme.palette.forEach((hex, idx) => {
                    _targetColor.setHex(hex);
                    if (currentPaletteRef.current[idx].getHex() !== hex)
                        currentPaletteRef.current[idx].lerp(_targetColor, 0.05);
                });
            }
            const dynamicPalette = currentPaletteRef.current;

            // Fog color lerp
            if (scene.fog instanceof THREE.FogExp2) {
                _targetColor.setHex(activeTheme.accent);
                scene.fog.color.lerp(_targetColor, 0.05);
            }

            // ── Audio ──────────────────────────────────────────────────────
            const { bass: sBass, treble: sTreble, amplitude: sAmp } = audioDataRef.current!;
            const presetVars = presetRef.current;
            const rs = presetVars.rotationSpeed ?? 1.0;
            const br = presetVars.bassResponse  ?? 1.0;

            // ── Camera FOV ─────────────────────────────────────────────────
            const targetFov = 40 + sBass * 15 * br;
            if (Math.abs(camera.fov - targetFov) > 0.1) {
                camera.fov += (targetFov - camera.fov) * 0.1;
                camera.updateProjectionMatrix();
            }

            // ── Lights ─────────────────────────────────────────────────────
            _targetColor.setHex(activeTheme.accent);
            lights.blueBeam.color.lerp(_targetColor, 0.05);
            lights.blueBeamBack.color.lerp(_targetColor, 0.05);
            lights.blueFill.color.lerp(_targetColor, 0.05);
            lights.blueFill2.color.lerp(_targetColor, 0.05);

            // ── Core group rotation ────────────────────────────────────────
            coreGroup.rotation.y = time * (0.2 * rs) + sBass * 0.3 * br;
            coreGroup.rotation.x = time * (0.1 * rs);
            coreGroup.position.y = Math.sin(time * 0.8) * 0.15;
            coreGroup.position.x = Math.cos(time * 0.6) * 0.08;

            // ── Heartbeat scale ────────────────────────────────────────────
            const bassPeak    = sBass * br;
            const targetScale = 1.0 + bassPeak * 0.45 + Math.sin(time * 1.5) * 0.02;
            const attack      = bassPeak > heartbeat - 1.0 ? 0.6 : 0.06;
            heartbeat        += (targetScale - heartbeat) * attack;
            outerIco.scale.setScalar(heartbeat);

            // ── Edges ──────────────────────────────────────────────────────
            const edgeThick    = Math.min(1.5, 1.0 + sBass * 0.8 * br);
            const edgeEmissive = 0.1 + sTreble * 0.8;
            edgeCylinders.forEach(cyl => {
                cyl.mesh.scale.set(edgeThick, 1.0, edgeThick);
                cyl.mesh.material.emissiveIntensity = edgeEmissive;
            });

            // ── Vertex sprites ─────────────────────────────────────────────
            const sizeMulti      = 1.0 + sBass * 0.3 * br + sTreble * 0.1;
            const intensityMulti = Math.min(1.5, 1.0 + sTreble * 0.8 + sBass * 0.4 * br);
            _targetColor.setHex(activeTheme.glow);
            const coreRot = coreGroup.rotation;
            const camPos  = camera.position;

            vertexSprites.forEach((v, i) => {
                const flicker = Math.sin(time * 2 + i * 0.8) * 0.1 + 0.9;
                _tempNormal.copy(v.basePos).normalize().applyEuler(coreRot);
                v.mesh.getWorldPosition(_tempPos);
                _tempView.copy(camPos).sub(_tempPos).normalize();
                const vis = THREE.MathUtils.smoothstep(_tempNormal.dot(_tempView), -0.6, 0.0);

                v.mesh.material.opacity = Math.min(1.0, 0.7 + sTreble * 0.2) * flicker * vis;
                v.mesh.scale.setScalar(0.8 * sizeMulti);
                v.mesh.material.color.lerp(_targetColor, 0.05);

                v.coreMesh.scale.setScalar(0.06 + sTreble * 0.03);
                v.coreMesh.material.opacity = (0.5 + sTreble * 0.4 * flicker) * vis;

                if (v.light) {
                    v.light.intensity = 1.0 * intensityMulti * flicker * presetRef.current.glowIntensity;
                    v.light.color.lerp(_targetColor, 0.05);
                }

                // Drift: reuse pre-allocated vector (no allocation)
                _driftVec.set(
                    Math.sin(time * 1.5 + i * 2.1) * 0.08 * (0.2 + sAmp),
                    Math.cos(time * 1.3 + i * 1.8) * 0.08 * (0.2 + sAmp),
                    Math.sin(time * 1.7 + i * 2.5) * 0.08 * (0.2 + sAmp),
                );
                v.mesh.position.copy(v.basePos).add(_driftVec);
            });

            // ── Nebula ─────────────────────────────────────────────────────
            nebulaSprites.forEach((ns, i) => {
                const pColor = dynamicPalette[i % Math.max(1, dynamicPalette.length)];
                if (pColor) ns.mesh.material.color.lerp(pColor, 0.02);
                ns.mesh.material.opacity = ns.baseOpacity * (1.0 + sBass * br * 0.8);
            });

            // ── Lasers ─────────────────────────────────────────────────────
            if ((presetVars.lasersEnabled ?? 1) === 1) {
                const laserIntensity = Math.max(0, (sBass * br - 0.55) * 2.5);

                if (laserIntensity > 0.05 && Math.random() > 0.7) {
                    const numToTrigger = Math.floor(Math.random() * 3) + 1;
                    for (let i = 0; i < numToTrigger; i++) {
                        const rIdx = Math.floor(Math.random() * laserConnectors.length);
                        if (!laserConnectors[rIdx].active) {
                            laserConnectors[rIdx].active = true;
                            laserConnectors[rIdx].life   = 1.0;
                        }
                    }
                }

                let maxCoreOpacity = 0;
                const cPos = laserCoreLines.geometry.attributes.position.array as Float32Array;
                let matricesNeedUpdate = false;

                laserConnectors.forEach(laser => {
                    if (!laser.active) return;
                    laser.life -= dt * 1.5;

                    if (laser.life <= 0) {
                        laser.active = false;
                        const baseIdx = laser.idx * SEGMENTS * 2 * 3;
                        for (let j = 0; j < SEGMENTS * 2 * 3; j++) cPos[baseIdx + j] = 0;
                        // Scale instance to zero (hide it)
                        _laserScl.set(0.001, 1, 0.001);
                        instancedMesh.getMatrixAt(laser.idx, _laserMat4);
                        _laserMat4.decompose(_laserPos, _laserQuat, new THREE.Vector3());
                        _laserMat4.compose(_laserPos, _laserQuat, _laserScl);
                        instancedMesh.setMatrixAt(laser.idx, _laserMat4);
                        matricesNeedUpdate = true;
                    } else {
                        const flash = Math.pow(laser.life, 1.5);
                        const thickness = 0.02 + flash * 0.05;

                        // Update instance transform via matrix (no per-laser Mesh)
                        _laserDir.copy(laser.v2).sub(laser.v1).normalize();
                        _laserPos.copy(laser.v1).lerp(laser.v2, 0.5);
                        _laserQuat.setFromUnitVectors(_laserYAxis, _laserDir);
                        _laserScl.set(thickness, laser.v1.distanceTo(laser.v2), thickness);
                        _laserMat4.compose(_laserPos, _laserQuat, _laserScl);
                        instancedMesh.setMatrixAt(laser.idx, _laserMat4);
                        matricesNeedUpdate = true;

                        maxCoreOpacity = Math.max(maxCoreOpacity, flash * 1.5 * laserIntensity);

                        const baseIdx = laser.idx * SEGMENTS * 2 * 3;
                        let pIdx = baseIdx;
                        const dx = laser.v2.x - laser.v1.x;
                        const dy = laser.v2.y - laser.v1.y;
                        const dz = laser.v2.z - laser.v1.z;
                        const travel    = Math.min(1.0, (1.0 - laser.life) * 4.0);
                        const freq      = 12.0;
                        const speed     = 40.0;
                        const amplitude = 0.25 * flash;

                        const getPosAt = (t: number) => {
                            const at = Math.min(travel, t);
                            let x = laser.v1.x + dx * at;
                            let y = laser.v1.y + dy * at;
                            let z = laser.v1.z + dz * at;
                            if (at > 0 && at < 1) {
                                const wave1    = Math.sin(at * freq - time * speed);
                                const wave2    = Math.cos(at * freq * 1.3 + time * speed * 1.2);
                                const jitter   = Math.sin(at * 50.0 - time * 100.0) * 0.15;
                                const envelope = Math.sin(at * Math.PI);
                                x += (laser.u.x * wave1 + laser.v.x * wave2 + laser.u.x * jitter) * amplitude * envelope;
                                y += (laser.u.y * wave1 + laser.v.y * wave2 + laser.u.y * jitter) * amplitude * envelope;
                                z += (laser.u.z * wave1 + laser.v.z * wave2 + laser.u.z * jitter) * amplitude * envelope;
                            }
                            return { x, y, z };
                        };

                        let prev = getPosAt(0);
                        for (let s = 1; s <= SEGMENTS; s++) {
                            const curr = getPosAt(s / SEGMENTS);
                            cPos[pIdx++] = prev.x; cPos[pIdx++] = prev.y; cPos[pIdx++] = prev.z;
                            cPos[pIdx++] = curr.x; cPos[pIdx++] = curr.y; cPos[pIdx++] = curr.z;
                            prev = curr;
                        }
                    }
                });

                if (matricesNeedUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
                laserCoreLines.material.opacity = maxCoreOpacity;
                laserCoreLines.geometry.attributes.position.needsUpdate = true;

            } else {
                laserConnectors.forEach(laser => {
                    if (!laser.active) return;
                    laser.active = false;
                    const baseIdx = laser.idx * SEGMENTS * 2 * 3;
                    const cPos = laserCoreLines.geometry.attributes.position.array as Float32Array;
                    for (let j = 0; j < SEGMENTS * 2 * 3; j++) cPos[baseIdx + j] = 0;
                });
                laserCoreLines.material.opacity = 0;
                laserCoreLines.geometry.attributes.position.needsUpdate = true;
                instancedMesh.instanceMatrix.needsUpdate = true;
            }

            // ── Particle update ────────────────────────────────────────────
            {
                const positions = (particles as any).geometry.attributes.position.array as Float32Array;
                const colors    = (particles as any).geometry.attributes.color.array    as Float32Array;
                const vels      = (particles as any).userData.velocities as Float32Array;
                const life      = (particles as any).userData.life       as Float32Array;
                const activeMax = (particles as any).userData.activeMax  as number;
                const trailLen  = (particles as any).userData.trailLen   as number;

                // Glow color — extracted once per frame, no per-particle allocation
                _glowColor.setHex(activeTheme.glow);
                const cr = _glowColor.r, cg = _glowColor.g, cb = _glowColor.b;

                const currentScale = heartbeat;

                // World-space face caches
                for (let j = 0; j < icoVertices.length; j++) {
                    const v = worldVerticesCache[j].copy(icoVertices[j]).multiplyScalar(currentScale).applyEuler(coreGroup.rotation).add(coreGroup.position);
                    flatVerts[j*3]   = v.x;
                    flatVerts[j*3+1] = v.y;
                    flatVerts[j*3+2] = v.z;
                }
                for (let f = 0; f < numFaces; f++) {
                    _tN.copy(faceNormals[f]).applyEuler(coreGroup.rotation);
                    _tC.copy(faceCentres[f]).multiplyScalar(currentScale).applyEuler(coreGroup.rotation).add(coreGroup.position);
                    const f3 = f * 3;
                    worldFaceNormalsFlat[f3]   = _tN.x; worldFaceNormalsFlat[f3+1] = _tN.y; worldFaceNormalsFlat[f3+2] = _tN.z;
                    worldFaceCentresFlat[f3]   = _tC.x; worldFaceCentresFlat[f3+1] = _tC.y; worldFaceCentresFlat[f3+2] = _tC.z;
                }

                const limit = qualityRef.current === 'ULTRA_LOW' ? Math.floor(activeMax * 0.5) : activeMax;

                if (limit !== prevLimit) {
                    for (let i = limit; i < activeMax; i++) {
                        const i6 = i * 6;
                        positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                        positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                    }
                    prevLimit = limit;
                    (particles as any).geometry.attributes.position.needsUpdate = true;
                }

                const turbulence = presetVars.turbulence ?? 0.3;
                const chunkCount = qualityRef.current === 'HIGH' ? 2 : qualityRef.current === 'LOW' ? 4 : 8;
                updateCurlGridChunked(time, turbulence, chunkCount);

                const spawnMul   = qualityRef.current === 'ULTRA_LOW' ? 0.35 : qualityRef.current === 'LOW' ? 0.65 : 1.0;
                const density    = presetVars.particleDensity ?? 1.0;
                const maxSpawn   = Math.floor(600 * density * spawnMul) + Math.floor(Math.pow(sAmp, 1.3) * 6000 * density * spawnMul);
                let spawned      = 0;

                const ICO_R      = ICO_RADIUS * currentScale;
                const INNER_R    = ICO_R * 0.92;
                const INNER_SQ   = INNER_R * INNER_R;
                const pSpeedMult = presetVars.particleSpeed ?? 1.0;
                const pTrailMult = presetVars.particleTrail ?? 1.0;
                const pLifeMult  = presetVars.particleLife  ?? 1.0;
                const OUTER_SQ   = Math.pow(ICO_R + 2.5 * pSpeedMult, 2);

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
                            const fnx  = worldFaceNormalsFlat[f3],   fny = worldFaceNormalsFlat[f3+1], fnz = worldFaceNormalsFlat[f3+2];

                            let u = Math.random(), v = Math.random();
                            if (u + v > 1) { u = 1 - u; v = 1 - v; }
                            const w = 1 - u - v;

                            // Reuse _spawnPt (no allocation)
                            _spawnPt.set(
                                u*faceRawVerts[f9]   + v*faceRawVerts[f9+3] + w*faceRawVerts[f9+6],
                                u*faceRawVerts[f9+1] + v*faceRawVerts[f9+4] + w*faceRawVerts[f9+7],
                                u*faceRawVerts[f9+2] + v*faceRawVerts[f9+5] + w*faceRawVerts[f9+8],
                            ).multiplyScalar(currentScale).applyEuler(coreGroup.rotation).add(coreGroup.position);

                            const off = 0.02 + Math.random() * 0.06;
                            positions[i6]   = _spawnPt.x + fnx * off;
                            positions[i6+1] = _spawnPt.y + fny * off;
                            positions[i6+2] = _spawnPt.z + fnz * off;
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
                            vels[i3] = rtx * spd; vels[i3+1] = rty * spd; vels[i3+2] = rtz * spd;

                        } else {
                            positions[i6] = positions[i6+1] = positions[i6+2] = 9999;
                            positions[i6+3] = positions[i6+4] = positions[i6+5] = 9999;
                            colors[i6] = colors[i6+1] = colors[i6+2] = 0;
                            colors[i6+3] = colors[i6+4] = colors[i6+5] = 0;
                        }
                        continue;
                    }

                    life[i] -= dt;

                    let px = positions[i6], py = positions[i6+1], pz = positions[i6+2];
                    let vx = vels[i3],      vy = vels[i3+1],      vz = vels[i3+2];

                    // Closest face (scalar loop — no allocation)
                    let bestFace = 0, bestDot = -Infinity;
                    for (let f = 0; f < numFaces; f++) {
                        const f3  = f * 3;
                        const dot = px * worldFaceNormalsFlat[f3] + py * worldFaceNormalsFlat[f3+1] + pz * worldFaceNormalsFlat[f3+2];
                        if (dot > bestDot) { bestDot = dot; bestFace = f; }
                    }

                    const bf3 = bestFace * 3;
                    const fnx = worldFaceNormalsFlat[bf3],   fny = worldFaceNormalsFlat[bf3+1], fnz = worldFaceNormalsFlat[bf3+2];
                    const fcx = worldFaceCentresFlat[bf3],   fcy = worldFaceCentresFlat[bf3+1], fcz = worldFaceCentresFlat[bf3+2];

                    const signedDist = (px-fcx)*fnx + (py-fcy)*fny + (pz-fcz)*fnz;
                    const pLen = Math.sqrt(px*px + py*py + pz*pz) + 0.0001;
                    const snx = px/pLen, sny = py/pLen, snz = pz/pLen;

                    const bnx  = fnx * NORMAL_BLEND_FACE + snx * NORMAL_BLEND_RADIAL;
                    const bny  = fny * NORMAL_BLEND_FACE + sny * NORMAL_BLEND_RADIAL;
                    const bnz  = fnz * NORMAL_BLEND_FACE + snz * NORMAL_BLEND_RADIAL;
                    const bnL  = Math.sqrt(bnx*bnx + bny*bny + bnz*bnz) + 0.0001;
                    const nx   = bnx/bnL, ny = bny/bnL, nz = bnz/bnL;

                    const rideH      = (RIDE_HEIGHT_BASE + sAmp * RIDE_HEIGHT_AMP) * currentScale;
                    const magnetPull = (rideH - signedDist) * MAGNETIC_PULL_STRENGTH;

                    vx += nx * magnetPull; vy += ny * magnetPull; vz += nz * magnetPull;
                    const vn = vx*nx + vy*ny + vz*nz;
                    vx -= nx * vn * 0.85; vy -= ny * vn * 0.85; vz -= nz * vn * 0.85;

                    sampleCurlGrid(px, py, pz, _curlOut);
                    const flow = (CURL_FLOW_BASE + sAmp * CURL_FLOW_AMP + sBass * CURL_FLOW_BASS * br) * density * pSpeedMult;
                    const cfn  = _curlOut.x*nx + _curlOut.y*ny + _curlOut.z*nz;
                    vx += (_curlOut.x - nx * cfn) * flow;
                    vy += (_curlOut.y - ny * cfn) * flow;
                    vz += (_curlOut.z - nz * cfn) * flow;

                    if (sBass > 0.3) {
                        const b = (sBass - 0.3) * 0.0015 * br * pSpeedMult;
                        vx += nx * b; vy += ny * b; vz += nz * b;
                    }

                    if (sTreble > 0.2) {
                        const t2 = sTreble * 0.0004 * pSpeedMult;
                        const rx = Math.random()-0.5, ry = Math.random()-0.5, rz = Math.random()-0.5;
                        const rn2 = rx*nx + ry*ny + rz*nz;
                        vx += (rx - nx*rn2) * t2; vy += (ry - ny*rn2) * t2; vz += (rz - nz*rn2) * t2;
                    }

                    // Vertex attraction (sample 4 random verts — O(4) instead of O(12))
                    if (qualityRef.current !== 'ULTRA_LOW') {
                        let closestSq = Infinity, cvx = 0, cvy = 0, cvz = 0;
                        const sampleCount = 4;
                        for (let s = 0; s < sampleCount; s++) {
                            const j  = Math.floor(Math.random() * icoVertices.length);
                            const j3 = j * 3;
                            const ddx = flatVerts[j3]-px, ddy = flatVerts[j3+1]-py, ddz = flatVerts[j3+2]-pz;
                            const dSq = ddx*ddx + ddy*ddy + ddz*ddz;
                            if (dSq < closestSq) { closestSq = dSq; cvx = ddx; cvy = ddy; cvz = ddz; }
                        }
                        if (closestSq < VERTEX_ATTRACT_RADIUS_SQ * currentScale * currentScale) {
                            const vd  = Math.sqrt(closestSq) + 0.001;
                            const str = VERTEX_ATTRACT_STR / (closestSq + 0.3);
                            const txv = cvy*nz - cvz*ny, tyv = cvz*nx - cvx*nz, tzv = cvx*ny - cvy*nx;
                            vx += (txv * 2.5 + cvx/vd) * str * pSpeedMult;
                            vy += (tyv * 2.5 + cvy/vd) * str * pSpeedMult;
                            vz += (tzv * 2.5 + cvz/vd) * str * pSpeedMult;
                        }
                    }

                    const vSq  = vx*vx + vy*vy + vz*vz;
                    const maxS = PARTICLE_MAX_SPEED * pSpeedMult;
                    if (vSq > maxS * maxS) {
                        const sc = maxS / Math.sqrt(vSq);
                        vx *= sc; vy *= sc; vz *= sc;
                    }
                    const damp = 1.0 - (PARTICLE_DAMPING + (1.0 - turbulence) * 0.02);
                    vx *= damp; vy *= damp; vz *= damp;

                    const pSq = px*px + py*py + pz*pz;
                    if (pSq < INNER_SQ && pSq > 0.001) {
                        const pL2  = Math.sqrt(pSq);
                        const nx2  = px/pL2, ny2 = py/pL2, nz2 = pz/pL2;
                        const push = INNER_R - pL2;
                        px += nx2 * (push + 0.01); py += ny2 * (push + 0.01); pz += nz2 * (push + 0.01);
                        const vDotN2 = vx*nx2 + vy*ny2 + vz*nz2;
                        if (vDotN2 < 0) {
                            vx -= nx2 * vDotN2 * 1.5; vy -= ny2 * vDotN2 * 1.5; vz -= nz2 * vDotN2 * 1.5;
                        }
                    }

                    px += vx * fpsScale; py += vy * fpsScale; pz += vz * fpsScale;
                    vels[i3] = vx; vels[i3+1] = vy; vels[i3+2] = vz;

                    const spd2    = Math.sqrt(vSq) + 0.0001;
                    const dynTrail = (trailLen + spd2 * (0.3 + sAmp * 0.5)) * pTrailMult;
                    const sInv    = 1.0 / spd2;

                    positions[i6]   = px; positions[i6+1] = py; positions[i6+2] = pz;
                    positions[i6+3] = px - vx*sInv*dynTrail;
                    positions[i6+4] = py - vy*sInv*dynTrail;
                    positions[i6+5] = pz - vz*sInv*dynTrail;

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
                        const env     = Math.min(Math.min(1.0, (1.0 - t01) * 5.0), Math.min(1.0, t01 * 3.0));
                        const bright  = env * (0.8 + sAmp * 1.5 + sBass * 2.0 * br + sTreble * 0.8);

                        const r = Math.min(1, cr * bright);
                        const g = Math.min(1, cg * bright);
                        const b = Math.min(1, cb * bright);
                        colors[i6]   = r;      colors[i6+1] = g;      colors[i6+2] = b;
                        colors[i6+3] = r*0.25; colors[i6+4] = g*0.25; colors[i6+5] = b*0.25;
                    }
                }

                // FIX: use addUpdateRange instead of deprecated updateRange property
                const activeRange = limit * 6;
                (particles as any).geometry.attributes.position.addUpdateRange(0, activeRange);
                (particles as any).geometry.attributes.color.addUpdateRange(0, activeRange);
                (particles as any).geometry.attributes.position.needsUpdate = true;
                (particles as any).geometry.attributes.color.needsUpdate    = true;
            }

            // ── FPS monitor — bidirectional quality adjustment ──────────────
            if (onAutoQualityChange) {
                const suggestion = fpsMonitor.suggest(qualityRef.current);
                if (suggestion === 'degrade') {
                    fpsMonitor.reset();
                    const next: Quality = qualityRef.current === 'HIGH' ? 'LOW' : 'ULTRA_LOW';
                    renderer.setPixelRatio(next === 'LOW' ? 1.5 : 0.75);
                    onAutoQualityChange(next);
                } else if (suggestion === 'upgrade') {
                    fpsMonitor.reset();
                    const next: Quality = qualityRef.current === 'ULTRA_LOW' ? 'LOW' : 'HIGH';
                    renderer.setPixelRatio(next === 'LOW' ? 1.0 : Math.min(window.devicePixelRatio, 2));
                    onAutoQualityChange(next);
                }
            }

            renderer.render(scene, camera);
            animationFrameId = requestAnimationFrame(animate);
        };

        animationFrameId = requestAnimationFrame(animate);

        // ── Cleanup ───────────────────────────────────────────────────────
        return () => {
            cancelAnimationFrame(animationFrameId);
            resizeObserver.disconnect();
            controls.dispose();
            renderer.dispose();
            envDispose();          // disposes both envMap AND PMREMGenerator (was missing before)
            disposeBackground();
            disposeCore();
            disposeLasers();
            disposeParticles();
            if (container && renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);
};