import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Clock,
    Mesh,
    NormalBlending,
    OrthographicCamera,
    PlaneGeometry,
    Points,
    ReinhardToneMapping,
    Scene,
    ShaderMaterial,
    Vector2,
    WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type CarmineFireScene = {
    setDark: (dark: boolean) => void;
    dispose: () => void;
};

const SPARK_COUNT = 84;
const EMBER_COUNT = 40;
const BLOOM_STRENGTH_LIGHT = 0.48;
const BLOOM_STRENGTH_DARK = 0.82;

const planeVertex = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const noise2Chunk = /* glsl */ `
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.7, 1.2, -1.2, 1.7);
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return v;
}
`;

const fireFragment = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uDark;
uniform vec2 uResolution;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise3(p);
        p = p * 2.03 + vec3(0.07, 0.31, 0.17);
        a *= 0.5;
    }
    return v;
}

float tongueField(float x, float y, float time) {
    float span = 2.14;
    float count = 11.0;
    float u = ((x + span * 0.5) / span) * count;
    float id = floor(u);
    float f = fract(u);

    float base = (1.0 - smoothstep(0.0, 0.72, y)) * (0.82 + 0.18 * hash13(vec3(x * 6.0, y, time * 0.2)));
    float field = base;

    for (int k = -1; k <= 1; k++) {
        float kid = id + float(k);
        float ff = f - float(k);
        float h1 = hash13(vec3(kid, 0.17, 2.4));
        float h2 = hash13(vec3(kid, 1.9, 0.6));
        float h3 = hash13(vec3(kid, 4.2, 1.1));
        float cx = 0.5 + (h1 - 0.5) * 0.22 + 0.08 * sin(time * mix(0.6, 1.3, h2) + kid);
        float w = mix(0.22, 0.38, h2);
        w *= mix(1.15, 0.55, smoothstep(0.15, 2.4, y));
        float amp = mix(0.7, 1.25, h3);
        amp *= 0.82 + 0.18 * sin(time * mix(0.9, 1.8, h1) + kid * 1.3);
        float hgt = mix(2.35, 3.45, hash13(vec3(kid, 8.1, 0.3)));
        float rise = pow(1.0 - smoothstep(0.0, hgt, y), 0.72);
        field += amp * exp(-pow((ff - cx) / max(w, 0.04), 2.0)) * rise;
    }

    return field;
}

float flameDensity(vec3 p, float time) {
    if (p.y < -0.18 || p.y > 3.55) {
        return 0.0;
    }
    float envelope = tongueField(p.x, p.y, time);
    envelope *= exp(-p.z * p.z * 4.6);

    vec3 q = p;
    q.y -= time * 0.72;
    q.x += 0.08 * sin(time * 0.51 + p.y * 1.6);
    q.z += 0.12 * cos(time * 0.37 + p.x * 1.2);
    vec3 qs = q * vec3(2.15, 1.35, 1.7);
    float n = fbm3(qs);
    n = fbm3(qs + vec3(n * 1.55, n * 0.8, 0.0));
    float dens = n * envelope * 1.85 - 0.04;
    dens += (1.0 - smoothstep(0.0, 0.45, p.y)) * 0.35;
    return max(0.0, dens);
}

void main() {
    float screenX = vUv.x * 2.0 - 1.0;

    vec3 ro = vec3(screenX * 1.04, 0.12, 2.25);
    vec3 rd = normalize(vec3(0.0, vUv.y * 1.72 + 0.08, -1.32));

    vec3 col = vec3(0.0);
    float transm = 1.0;
    float tRay = 0.85;
    const int STEPS = 26;
    float dt = 0.062;

    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * tRay;
        float dens = flameDensity(p, uTime);
        dens = dens * dens * 0.35 + dens * 0.75;

        float heat = clamp(dens * 2.15, 0.0, 1.0);
        vec3 emit = mix(vec3(0.4, 0.0, 0.055), vec3(0.72, 0.07, 0.11), heat);
        emit = mix(emit, vec3(0.94, 0.3, 0.13), heat * heat);
        emit = mix(emit, vec3(1.0, 0.68, 0.3), pow(heat, 3.0) * (1.0 - clamp(p.y * 0.7, 0.0, 1.0)));

        col += emit * dens * dt * transm * mix(1.55, 2.15, uDark);
        transm *= exp(-dens * 2.7 * dt);
        tRay += dt;
    }

    float alpha = pow(clamp(1.0 - transm, 0.0, 1.0), 0.82);
    gl_FragColor = vec4(col, alpha);
}
`;

const smokeFragment = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uDark;

${noise2Chunk}

void main() {
    vec2 uv = vUv;
    float t = uTime * 0.22;

    vec2 st = vec2(uv.x * 1.35 + sin(t * 0.7) * 0.12, uv.y * 1.15 - t * 0.85);
    float n = fbm(st);
    float n2 = fbm(st * 1.7 + vec2(n * 0.9, -t * 0.4));

    float column = 1.0 - abs(uv.x - 0.5) * 0.22;
    column = pow(max(column, 0.0), 0.55);

    float plume = smoothstep(0.1, 0.55, uv.y) * (1.0 - smoothstep(0.58, 1.0, uv.y));
    float wisps = smoothstep(0.22, 0.78, n2 * column * plume);

    vec3 smoke = mix(vec3(0.22, 0.1, 0.11), vec3(0.46, 0.34, 0.35), n2);
    float alpha = wisps * mix(0.07, 0.15, uDark) * (0.55 + 0.45 * (1.0 - uv.y));
    gl_FragColor = vec4(smoke, alpha);
}
`;

const particleVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uRise;
attribute float aSeed;
attribute float aSpeed;
attribute float aDrift;
attribute float aSize;
varying float vAlpha;
varying float vHeat;

void main() {
    float t = fract(aSeed + uTime * aSpeed);
    vec3 p = position;
    float lift = pow(t, 0.72);
    p.y = mix(-1.05, uRise, lift);
    p.x += sin((aSeed * 6.28318) + t * 5.2) * aDrift * (0.35 + lift);
    vHeat = 1.0 - t;
    vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.42, 1.0, t));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio * (0.45 + vHeat * 1.05);
}
`;

const sparkFragment = /* glsl */ `
varying float vAlpha;
varying float vHeat;

void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) {
        discard;
    }
    float core = smoothstep(0.5, 0.08, d);
    float halo = smoothstep(0.5, 0.18, d) * 0.55;
    vec3 col = mix(vec3(0.72, 0.05, 0.1), vec3(1.0, 0.86, 0.62), vHeat * vHeat);
    gl_FragColor = vec4(col, (core + halo) * vAlpha);
}
`;

const emberFragment = /* glsl */ `
varying float vAlpha;
varying float vHeat;

void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) {
        discard;
    }
    float glow = smoothstep(0.5, 0.12, d);
    vec3 col = mix(vec3(0.45, 0.02, 0.05), vec3(0.95, 0.42, 0.18), vHeat);
    gl_FragColor = vec4(col, glow * vAlpha * 0.85);
}
`;

const gradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uDark: { value: 0 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uDark;
        varying vec2 vUv;

        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            vec3 rgb = c.rgb * vec3(1.05, 0.92, 0.94);
            float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
            float alpha = max(c.a, smoothstep(0.018, 0.16, luma));
            rgb *= mix(0.92, 1.0, uDark);
            gl_FragColor = vec4(rgb, alpha);
        }
    `,
};

function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createParticleGeometry(
    count: number,
    spread: number,
    speed: [number, number],
    drift: [number, number],
    size: [number, number],
): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const speeds = new Float32Array(count);
    const drifts = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (Math.random() * 2 - 1) * spread;
        positions[i * 3 + 1] = -1;
        positions[i * 3 + 2] = 0;
        seeds[i] = Math.random();
        speeds[i] = speed[0] + Math.random() * (speed[1] - speed[0]);
        drifts[i] = drift[0] + Math.random() * (drift[1] - drift[0]);
        sizes[i] = size[0] + Math.random() * (size[1] - size[0]);
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    geometry.setAttribute('aSpeed', new BufferAttribute(speeds, 1));
    geometry.setAttribute('aDrift', new BufferAttribute(drifts, 1));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    return geometry;
}

export function createCarmineFireScene(
    canvas: HTMLCanvasElement,
    options: { dark: boolean },
): CarmineFireScene | null {
    let renderer: WebGLRenderer;
    try {
        renderer = new WebGLRenderer({
            canvas,
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            premultipliedAlpha: false,
        });
    } catch {
        return null;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = ReinhardToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    camera.position.z = 1;

    const darkValue = options.dark ? 1 : 0;
    const resolution = new Vector2(1, 1);
    const planeGeo = new PlaneGeometry(2, 2);

    const smokeMaterial = new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uDark: { value: darkValue },
        },
        vertexShader: planeVertex,
        fragmentShader: smokeFragment,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
    });
    const smoke = new Mesh(planeGeo, smokeMaterial);
    smoke.renderOrder = 0;
    scene.add(smoke);

    const fireMaterial = new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uDark: { value: darkValue },
            uResolution: { value: resolution },
        },
        vertexShader: planeVertex,
        fragmentShader: fireFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const fire = new Mesh(planeGeo.clone(), fireMaterial);
    fire.renderOrder = 1;
    scene.add(fire);

    const emberGeometry = createParticleGeometry(EMBER_COUNT, 1, [0.08, 0.16], [0.03, 0.09], [5, 10]);
    const emberMaterial = new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: renderer.getPixelRatio() },
            uRise: { value: 0.18 },
        },
        vertexShader: particleVertex,
        fragmentShader: emberFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const embers = new Points(emberGeometry, emberMaterial);
    embers.renderOrder = 2;
    scene.add(embers);

    const sparkGeometry = createParticleGeometry(SPARK_COUNT, 1, [0.22, 0.48], [0.06, 0.18], [1.6, 3.8]);
    const sparkMaterial = new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: renderer.getPixelRatio() },
            uRise: { value: 1.65 },
        },
        vertexShader: particleVertex,
        fragmentShader: sparkFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const sparks = new Points(sparkGeometry, sparkMaterial);
    sparks.renderOrder = 3;
    scene.add(sparks);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera, null, 0x000000, 0));
    const bloomPass = new UnrealBloomPass(new Vector2(1, 1), options.dark ? BLOOM_STRENGTH_DARK : BLOOM_STRENGTH_LIGHT, 0.58, 0.14);
    composer.addPass(bloomPass);
    const gradePass = new ShaderPass(gradeShader);
    gradePass.uniforms.uDark.value = darkValue;
    composer.addPass(gradePass);

    const clock = new Clock();
    let frame = 0;
    let disposed = false;
    const reduced = prefersReducedMotion();

    const resize = () => {
        if (disposed) {
            return;
        }
        const parent = canvas.parentElement;
        const width = Math.max(parent?.clientWidth || canvas.clientWidth || 1, 1);
        const height = Math.max(parent?.clientHeight || canvas.clientHeight || 1, 1);
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        resolution.set(width, height);
        const ratio = renderer.getPixelRatio();
        emberMaterial.uniforms.uPixelRatio.value = ratio;
        sparkMaterial.uniforms.uPixelRatio.value = ratio;
    };

    const render = () => {
        const elapsed = clock.getElapsedTime();
        smokeMaterial.uniforms.uTime.value = elapsed;
        fireMaterial.uniforms.uTime.value = elapsed;
        emberMaterial.uniforms.uTime.value = elapsed;
        sparkMaterial.uniforms.uTime.value = elapsed;
        composer.render();
    };

    const tick = () => {
        if (disposed) {
            return;
        }
        if (!document.hidden && !reduced) {
            render();
        }
        frame = window.requestAnimationFrame(tick);
    };

    resize();
    render();
    if (!reduced) {
        frame = window.requestAnimationFrame(tick);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);

    const onVisibility = () => {
        if (!document.hidden && !disposed) {
            render();
        }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return {
        setDark(dark: boolean) {
            const value = dark ? 1 : 0;
            smokeMaterial.uniforms.uDark.value = value;
            fireMaterial.uniforms.uDark.value = value;
            gradePass.uniforms.uDark.value = value;
            bloomPass.strength = dark ? BLOOM_STRENGTH_DARK : BLOOM_STRENGTH_LIGHT;
            if (reduced) {
                render();
            }
        },
        dispose() {
            disposed = true;
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            planeGeo.dispose();
            fire.geometry.dispose();
            emberGeometry.dispose();
            sparkGeometry.dispose();
            smokeMaterial.dispose();
            fireMaterial.dispose();
            emberMaterial.dispose();
            sparkMaterial.dispose();
            composer.dispose();
            renderer.dispose();
        },
    };
}
