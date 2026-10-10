/**
 * Camera feed with the floor plan of the current level drawn over it.
 *
 * The camera pose is: position from the positioning fix (metres from an anchor, eye height above
 * the floor), rotation from the phone's orientation sensors plus a manual heading correction. Without
 * motion sensors (desktop) dragging looks around instead, so the overlay can be checked anywhere.
 */
import { useEffect, useRef, useState } from 'react';
import { Group, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { toLocal, type LngLat } from '../geo';
import type { FloorPlans } from '../floors/floorPlans';
import { buildLevelScene, disposeGroup } from './scene';
import { XrAlignment } from './xrAlignment';
import { buildRouteMesh } from '../pathfinding/routeMesh';
import type { Route } from '../pathfinding/route';
import { HeadingFusion, orientationQuaternion, requestOrientationPermission, screenAngle, watchOrientation, type OrientationReading } from './orientation';

export interface ArPose extends LngLat {
  levelId: string | null;
  accuracy: number;
  /** Time of the fix; XR alignment uses each fix once. */
  timestamp?: number;
}

interface Props {
  floors: FloorPlans | null;
  pose: ArPose | null;
  route?: Route | null;
  /** Used for a fake camera feed when there is no camera (tests, desktop). */
  fallbackLabel?: string;
}

const EYE_HEIGHT = 1.5;
/** Re-anchor (rebuild the scene around the user) beyond this distance, to keep float precision. */
const REANCHOR_M = 300;
const LABEL_RANGE_M = 25;

export function ArView({ floors, pose, route = null, fallbackLabel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const routeRef = useRef(route);
  routeRef.current = route;
  const [cameraState, setCameraState] = useState<'off' | 'on' | 'error'>('off');
  const [cameraKey, setCameraKey] = useState(0);
  const [sensors, setSensors] = useState<'unknown' | 'absolute' | 'relative' | 'none'>('unknown');
  const [headingOffset, setHeadingOffset] = useState(0);
  const headingRef = useRef(0);
  headingRef.current = headingOffset;
  const [fov, setFov] = useState(60);
  const fovRef = useRef(fov);
  fovRef.current = fov;
  const [status, setStatus] = useState('');
  const orientationRef = useRef<OrientationReading | null>(null);
  const fusionRef = useRef(new HeadingFusion());
  // Lining up walls by hand beats the indoor compass: stop it from pulling the heading away.
  const [compassLocked, setCompassLocked] = useState(false);
  fusionRef.current.locked = compassLocked;
  const lookRef = useRef({ yaw: 0, pitch: -10 });
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [inXr, setInXr] = useState(false);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    xr?.isSessionSupported('immersive-ar').then(setXrSupported, () => setXrSupported(false));
  }, []);

  const startXr = async () => {
    const renderer = rendererRef.current;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!renderer || !xr) return;
    await requestOrientationPermission();
    // ARCore needs the camera itself; the browser shows the passthrough image in XR.
    const video = videoRef.current;
    (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    setCameraState('off');
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: hudRef.current ? { root: hudRef.current } : undefined,
    });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    setInXr(true);
    session.addEventListener('end', () => {
      setInXr(false);
      setCameraKey((k) => k + 1); // restart the camera feed
    });
  };

  // Camera feed.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setCameraState('on');
      } catch (e) {
        console.warn('camera', e);
        setCameraState('error');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraKey]);

  // Orientation sensors.
  useEffect(() => {
    let seen = false;
    const stop = watchOrientation((r) => {
      seen = true;
      orientationRef.current = r;
      setSensors((s) => (s === (r.absolute ? 'absolute' : 'relative') ? s : r.absolute ? 'absolute' : 'relative'));
    }, fusionRef.current);
    const t = setTimeout(() => !seen && setSensors('none'), 1500);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, []);

  // Three.js render loop.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(fovRef.current, 1, 0.1, 200);
    let anchor: LngLat | null = null;
    let levelGroup: Group | null = null;
    let routeGroup: Group | null = null;
    let routeKey = '';
    let routeShown: Route | null = null;
    // The plan lives in `world`: identity normally (the camera moves), XR-aligned in WebXR (the
    // tracked camera moves and the world is placed around it).
    const world = new Group();
    scene.add(world);
    const xrAlign = new XrAlignment();
    const worldQ = new Quaternion();
    const xrPos = new Vector3();
    const fixWorld = new Vector3();
    const labelPos = new Vector3();
    let levelKey = '';
    let loading = '';
    const target = new Vector3(0, EYE_HEIGHT, 0);
    const q = new Quaternion();
    const yawFix = new Quaternion();
    const up = new Vector3(0, 1, 0);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loadLevel = async (levelId: string, origin: LngLat) => {
      const key = `${levelId}@${origin.lng},${origin.lat}`;
      if (!floors || loading === key || levelKey === key) return;
      loading = key;
      try {
        const plan = await floors.plan(levelId, origin);
        if (loading !== key) return;
        if (levelGroup) {
          world.remove(levelGroup);
          disposeGroup(levelGroup);
        }
        levelGroup = buildLevelScene(plan);
        world.add(levelGroup);
        levelKey = key;
        const summary = floors.level(levelId);
        setStatus(summary ? `${summary.facilityId.replace('ETH.', '')} ${summary.label} · ${plan.rooms.length} rooms` : levelId);
      } catch (e) {
        setStatus(`No floor plan for ${levelId}`);
        console.warn(e);
      } finally {
        if (loading === key) loading = '';
      }
    };

    const tick = () => {
      const p = poseRef.current;
      const inXr = renderer.xr.isPresenting;
      if (p) {
        if (!anchor || Math.hypot(toLocal(p, anchor).x, toLocal(p, anchor).y) > REANCHOR_M) {
          anchor = { lng: p.lng, lat: p.lat };
          levelKey = '';
          camera.position.set(0, EYE_HEIGHT, 0);
          xrAlign.reset();
        }
        if (p.levelId) void loadLevel(p.levelId, anchor);
        const local = toLocal(p, anchor);
        target.set(local.x, EYE_HEIGHT, -local.y);
        // Glide towards new fixes instead of jumping (fixes come ~1 Hz).
        if (!inXr) camera.position.lerp(target, 0.08);
      }
      const o = orientationRef.current;
      if (inXr) {
        const xrCam = renderer.xr.getCamera();
        xrCam.getWorldPosition(xrPos);
        let compass: Quaternion | null = null;
        if (o) compass = orientationQuaternion(worldQ, o.alpha, o.beta, o.gamma, screenAngle());
        xrAlign.updateHeading(xrCam.getWorldQuaternion(q), compass, (headingRef.current * Math.PI) / 180);
        if (p) xrAlign.updatePosition(xrPos, fixWorld.set(target.x, 0, target.z), p.timestamp ?? 0);
        world.rotation.set(0, xrAlign.yaw ?? 0, 0);
        world.position.copy(xrAlign.t);
        world.visible = xrAlign.ready;
      } else if (o) {
        world.position.set(0, 0, 0);
        world.rotation.set(0, 0, 0);
        world.visible = true;
        orientationQuaternion(q, o.alpha, o.beta, o.gamma, screenAngle());
        yawFix.setFromAxisAngle(up, (headingRef.current * Math.PI) / 180);
        camera.quaternion.copy(yawFix).multiply(q);
      } else {
        world.position.set(0, 0, 0);
        world.rotation.set(0, 0, 0);
        world.visible = true;
        const { yaw, pitch } = lookRef.current;
        camera.rotation.set((pitch * Math.PI) / 180, ((yaw + headingRef.current) * Math.PI) / 180, 0, 'YXZ');
      }
      // Route ribbon of the current floor (rebuilt when the route, floor or anchor changes).
      const r = routeRef.current;
      const key = r && anchor && p?.levelId ? `${p.levelId}|${anchor.lng},${anchor.lat}` : '';
      if (key !== routeKey || r !== routeShown) {
        if (routeGroup) {
          world.remove(routeGroup);
          disposeGroup(routeGroup);
          routeGroup = null;
        }
        if (r && anchor && p?.levelId) {
          routeGroup = buildRouteMesh(r, p.levelId, anchor);
          world.add(routeGroup);
        }
        routeKey = key;
        routeShown = r ?? null;
      }
      // Labels only for nearby rooms; far ones pile up on the horizon.
      if (levelGroup) {
        const eye = inXr ? xrPos : camera.position;
        for (const child of levelGroup.children) {
          if (!child.userData.label) continue;
          child.getWorldPosition(labelPos);
          child.visible = labelPos.distanceTo(eye) < LABEL_RANGE_M;
        }
      }
      if (camera.fov !== fovRef.current) {
        camera.fov = fovRef.current;
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(tick);
    rendererRef.current = renderer;
    return () => {
      renderer.setAnimationLoop(null);
      void renderer.xr.getSession()?.end();
      rendererRef.current = null;
      observer.disconnect();
      if (levelGroup) disposeGroup(levelGroup);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [floors]);

  // Dragging: look around without sensors, otherwise fine-tune the heading.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    const degPerPx = fovRef.current / (hostRef.current?.clientHeight || 600);
    if (orientationRef.current) {
      setHeadingOffset((h) => h + dx * degPerPx);
      setCompassLocked(true);
    } else {
      lookRef.current.yaw += dx * degPerPx;
      lookRef.current.pitch = Math.max(-89, Math.min(89, lookRef.current.pitch + dy * degPerPx));
    }
  };
  const onPointerUp = () => (drag.current = null);

  return (
    <div className="ar-view">
      <video ref={videoRef} className="ar-video" playsInline muted />
      {cameraState !== 'on' && !inXr && <div className="ar-fallback">{cameraState === 'error' ? 'No camera' : 'Starting camera…'}{fallbackLabel ? ` · ${fallbackLabel}` : ''}</div>}
      <div ref={hostRef} className="ar-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
      <div className="ar-hud" ref={hudRef}>
        <div>{pose ? `${status || 'Loading floor plan…'} · ±${pose.accuracy.toFixed(1)} m` : 'Waiting for a position…'}</div>
        <div className="ar-hud-row">
          {sensors === 'unknown' || sensors === 'none' ? (
            <button
              onClick={async () => {
                const ok = await requestOrientationPermission();
                if (!ok) setSensors('none');
              }}
            >
              Enable motion sensors
            </button>
          ) : (
            <span>{sensors === 'absolute' ? 'Gyro + compass' : 'Gyro (no north reference)'}</span>
          )}
          {sensors === 'absolute' && (
            <button onClick={() => setCompassLocked((l) => !l)} title="Locked: heading follows the gyro only, as you aligned it">
              {compassLocked ? 'Heading locked' : 'Heading follows compass'}
            </button>
          )}
          <label>
            Heading {headingOffset >= 0 ? '+' : ''}
            {headingOffset.toFixed(0)}°
            <input type="range" min={-180} max={180} value={headingOffset} onChange={(e) => {
                setHeadingOffset(Number(e.target.value));
                setCompassLocked(true);
              }} />
          </label>
          {xrSupported && !inXr && <button onClick={() => startXr().catch((e: Error) => setStatus(`WebXR: ${e.message}`))}>Start WebXR AR</button>}
          {inXr && <button onClick={() => rendererRef.current?.xr.getSession()?.end()}>Exit WebXR</button>}
          {!inXr && <label>
            FOV {fov}°
            <input type="range" min={35} max={90} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
          </label>}
        </div>
        <div className="ar-hint">
          {inXr
            ? 'WebXR: tracking by ARCore, plan anchored by the position fix and compass. Use the heading slider to line up walls.'
            : sensors === 'none'
              ? 'Drag to look around.'
              : 'Drag sideways to line up walls with the camera image.'}
        </div>
      </div>
    </div>
  );
}
