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
import { VpsClient, focalFromFov, fovFromFocal, type VpsResult } from '../vps/client';
import { VisualOffset, headingCorrection } from '../vps/fusion';
import { debugInitiallyOn, featureStats, imageStats, newDebugId, rememberDebug, uploadDebug } from '../vps/debug';
import { VpsDebugPanel, type VpsDebugAttempt } from '../vps/VpsDebugPanel';

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
/** Auto mode: next visual fix this long after the previous one finished. */
const VPS_INTERVAL_MS = 3000;
/** A visual fix's floor is trusted over the beacons' this long. */
const VPS_LEVEL_HOLD_MS = 20_000;
/** Debug mode keeps this many attempts to browse. */
const DEBUG_HISTORY = 12;

interface VpsState {
  busy: boolean;
  last: VpsResult | null;
  error: string | null;
}

/** Heading (degrees clockwise from north) and pitch of a three.js camera in the AR world (x east, y up, z south). */
function viewAngles(q: Quaternion): { heading: number; pitch: number } {
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  return {
    heading: ((((Math.atan2(f.x, -f.z) * 180) / Math.PI) % 360) + 360) % 360,
    pitch: (Math.asin(Math.max(-1, Math.min(1, f.y))) * 180) / Math.PI,
  };
}

/** ?camera=<image url>: a still photo instead of the camera (testing the visual fix on a desktop). */
const TEST_IMAGE = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('camera') : null;

export function ArView({ floors, pose, route = null, fallbackLabel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
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
  // Visual positioning: the camera orientation as rendered each frame (to compare a visual fix
  // with), the plan's anchor, the beacon position before the visual offset.
  const vpsClient = useRef(new VpsClient());
  const [vps, setVps] = useState<VpsState>({ busy: false, last: null, error: null });
  const vpsBusy = useRef(false);
  const [vpsAuto, setVpsAuto] = useState(false);
  const [vpsDebug, setVpsDebug] = useState(debugInitiallyOn);
  const vpsDebugRef = useRef(vpsDebug);
  vpsDebugRef.current = vpsDebug;
  const [debugAttempts, setDebugAttempts] = useState<VpsDebugAttempt[]>([]);
  const visualOffset = useRef(new VisualOffset());
  const visualLevel = useRef<{ levelId: string; t: number } | null>(null);
  const renderedQ = useRef(new Quaternion());
  const anchorRef = useRef<LngLat | null>(null);

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

  /**
   * One visual fix: features of the current camera frame go to the VPS server; the answer corrects
   * the heading (and the position, see VisualOffset). The rendered orientation and the beacon
   * position are taken at the same instant as the frame.
   */
  const localizeVisually = async () => {
    const host = hostRef.current;
    const p = poseRef.current;
    const img = imageRef.current;
    const video = TEST_IMAGE ? img : videoRef.current;
    const vw = img && TEST_IMAGE ? img.naturalWidth : (videoRef.current?.videoWidth ?? 0);
    const vh = img && TEST_IMAGE ? img.naturalHeight : (videoRef.current?.videoHeight ?? 0);
    if (vpsBusy.current || !video || !host || !vw) return;
    if (!p) {
      setVps((v) => ({ ...v, error: 'Needs a beacon position first (the map is searched around it)' }));
      return;
    }
    vpsBusy.current = true;
    setVps((v) => ({ ...v, busy: true }));
    const viewW = host.clientWidth, viewH = host.clientHeight;
    const qAtCapture = renderedQ.current.clone();
    const anchor = anchorRef.current;
    const beaconAtCapture = anchor ? toLocal(p, anchor) : null;
    const debugId = vpsDebugRef.current ? newDebugId() : undefined;
    // Debug mode: what the server can't know about the capture (see vps/debug_replay.py).
    const captured = debugId ? captureContext(p, qAtCapture, vw, vh, viewW, viewH) : null;
    let applied: number | null = null;
    try {
      const res = await vpsClient.current.localize(video, vw, vh, focalFromFov(fovRef.current, vw, vh, viewW, viewH), {
        lng: p.lng, lat: p.lat, levelId: p.levelId, accuracy: p.accuracy,
      }, debugId);
      if (res.ok && res.quaternion && res.lng != null && res.lat != null) {
        const visual = new Quaternion(...res.quaternion);
        const d = headingCorrection(qAtCapture, visual);
        applied = d;
        setHeadingOffset((h) => ((((h + d + 180) % 360) + 360) % 360) - 180);
        setCompassLocked(true);
        // Without motion sensors (desktop, ?camera=) the pitch is the dragged one: take the visual one.
        if (!orientationRef.current && res.pitch != null) lookRef.current.pitch = res.pitch;
        if (anchor && beaconAtCapture && anchorRef.current === anchor) {
          visualOffset.current.set(toLocal({ lng: res.lng, lat: res.lat }, anchor), beaconAtCapture, performance.now());
        }
        if (res.levelId) visualLevel.current = { levelId: res.levelId, t: performance.now() };
        // The refined focal length is the camera's true field of view: match the overlay to it.
        if (res.focalVideo && (res.inliers ?? 0) >= 80) setFov(Math.round(fovFromFocal(res.focalVideo, vw, vh, viewW, viewH)));
      }
      setVps({ busy: false, last: res, error: null });
      if (debugId && captured) recordDebug(debugId, captured, res, null, applied);
    } catch (e) {
      setVps((v) => ({ ...v, busy: false, error: (e as Error).message }));
      setVpsAuto(false);
      if (debugId && captured) recordDebug(debugId, captured, null, (e as Error).message, null);
    } finally {
      vpsBusy.current = false;
    }
  };

  /** The phone's side of a capture, for the debug panel and the server's client.json. */
  const captureContext = (p: ArPose, q: Quaternion, vw: number, vh: number, viewW: number, viewH: number) => {
    const o = orientationRef.current;
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    const angles = viewAngles(q);
    return {
      time: Date.now(),
      rendered: { ...angles, angularSpeed: o ? Math.round(fusionRef.current.speed) : null },
      context: {
        app: { userAgent: navigator.userAgent, android: typeof window.PolymapsAndroid !== 'undefined', testImage: TEST_IMAGE, page: location.pathname + location.search },
        prior: { ...p, ageMs: p.timestamp != null ? Date.now() - p.timestamp : null },
        orientation: {
          sensors, reading: o, ...angles, quaternion: q.toArray(), angularSpeed: o ? fusionRef.current.speed : null,
          headingOffset: headingRef.current, compassLocked: fusionRef.current.locked, screenAngle: screenAngle(),
        },
        camera: {
          videoWidth: vw, videoHeight: vh, viewWidth: viewW, viewHeight: viewH, devicePixelRatio: window.devicePixelRatio,
          fovSetting: fovRef.current, track: track?.getSettings?.() ?? null,
        },
        visualOffset: { x: visualOffset.current.x, y: visualOffset.current.y },
      } as Record<string, unknown>,
    };
  };

  const recordDebug = (id: string, captured: ReturnType<typeof captureContext>, res: VpsResult | null, error: string | null, applied: number | null) => {
    const frame = res?.frame;
    const attempt: VpsDebugAttempt = {
      id, time: captured.time, frame, result: res, error, rendered: captured.rendered,
      image: frame ? imageStats(frame.gray, frame.width, frame.height) : undefined,
      features: frame ? featureStats(frame.features) : undefined,
      upload: res?.debugStored ? 'uploading…' : res ? 'not stored by the server' : 'no answer',
    };
    setDebugAttempts((list) => [attempt, ...list].slice(0, DEBUG_HISTORY));
    if (!frame || !res?.debugStored) return;
    const context = {
      ...captured.context, id, capturedAt: new Date(captured.time).toISOString(),
      backend: res.backend, timing: { extractMs: Math.round(res.extractMs), totalMs: Math.round(res.totalMs), serverMs: res.ms },
      frame: { width: frame.width, height: frame.height, scaleX: frame.scaleX, scaleY: frame.scaleY, focal: frame.focal },
      image: attempt.image, features: attempt.features, requestBytes: res.bytes,
      result: { ok: res.ok, reason: res.reason, inliers: res.inliers, heading: res.heading }, headingCorrectionApplied: applied,
    };
    const setUpload = (upload: string) => setDebugAttempts((list) => list.map((a) => (a.id === id ? { ...a, upload } : a)));
    uploadDebug(id, frame, context).then(setUpload, (e: Error) => setUpload(`upload failed: ${e.message}`));
  };
  const localizeRef = useRef(localizeVisually);
  localizeRef.current = localizeVisually;

  // Auto mode: a visual fix every few seconds (the next starts after the previous one finished).
  useEffect(() => {
    if (!vpsAuto || inXr) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await localizeRef.current();
      if (!stop) timer = setTimeout(loop, VPS_INTERVAL_MS);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [vpsAuto, inXr]);

  // Camera feed.
  useEffect(() => {
    if (TEST_IMAGE) return;
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
          anchorRef.current = anchor;
          levelKey = '';
          camera.position.set(0, EYE_HEIGHT, 0);
          xrAlign.reset();
          visualOffset.current.reset();
        }
        const vl = visualLevel.current;
        const levelId = vl && performance.now() - vl.t < VPS_LEVEL_HOLD_MS ? vl.levelId : p.levelId;
        if (levelId) void loadLevel(levelId, anchor);
        const local = visualOffset.current.apply(toLocal(p, anchor), performance.now());
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
        renderedQ.current.copy(camera.quaternion);
      } else {
        world.position.set(0, 0, 0);
        world.rotation.set(0, 0, 0);
        world.visible = true;
        const { yaw, pitch } = lookRef.current;
        camera.rotation.set((pitch * Math.PI) / 180, ((yaw + headingRef.current) * Math.PI) / 180, 0, 'YXZ');
        renderedQ.current.copy(camera.quaternion);
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
      {TEST_IMAGE ? (
        <img ref={imageRef} className="ar-video" src={TEST_IMAGE} alt="" crossOrigin="anonymous" onLoad={() => setCameraState('on')} onError={() => setCameraState('error')} />
      ) : (
        <video ref={videoRef} className="ar-video" playsInline muted />
      )}
      {vpsDebug && !inXr && <VpsDebugPanel attempts={debugAttempts} />}
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
          {!inXr && cameraState === 'on' && (
            <>
              <button disabled={vps.busy} onClick={() => void localizeVisually()} title="Match the camera image against the ETH 3D map (only image features are sent)">
                {vps.busy ? 'Localizing…' : 'Localize visually'}
              </button>
              <label title="A visual fix every few seconds">
                <input type="checkbox" checked={vpsAuto} onChange={(e) => setVpsAuto(e.target.checked)} /> auto
              </label>
              <label title="Show what the visual fix saw and found. Uploads each frame (grey, 640 px) with its context to the VPS server for debugging">
                <input type="checkbox" checked={vpsDebug} onChange={(e) => {
                    setVpsDebug(e.target.checked);
                    rememberDebug(e.target.checked);
                  }} /> debug
              </label>
            </>
          )}
          {!inXr && <label>
            FOV {fov}°
            <input type="range" min={35} max={90} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
          </label>}
        </div>
        {(vps.last || vps.error) && <div className="ar-vps">{vpsStatus(vps)}</div>}
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

function vpsStatus({ last, error }: VpsState): string {
  if (error) return `Visual fix failed: ${error}`;
  if (!last) return '';
  const t = `${(last.totalMs / 1000).toFixed(1)} s (features ${(last.extractMs / 1000).toFixed(1)} s, ${last.backend}), ${Math.round(last.bytes / 1024)} KiB sent`;
  if (!last.ok) return `No visual fix (${last.reason ?? 'unknown'}) · ${t}`;
  return `Visual fix · ${last.inliers} inliers · heading ${last.heading?.toFixed(0)}° · ${last.levelId?.replace('ETH.', '')} · ${t}`;
}
