import QrScanner from 'qr-scanner';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ScannerStatus = 'starting' | 'scanning' | 'unavailable';

/** Reads QR codes from the camera into a <video>. `onCode` fires for every
    frame that holds a code, so the caller must ignore repeats. */
export function useQrScanner(onCode: (code: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onCodeRef = useRef(onCode);
  const [status, setStatus] = useState<ScannerStatus>('starting');
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const scanner = new QrScanner(
      video,
      (result) => onCodeRef.current(result.data),
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 5,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        returnDetailedScanResult: true,
      },
    );
    scannerRef.current = scanner;
    scanner
      .start()
      .then(async () => {
        if (cancelled) return;
        setStatus('scanning');
        setHasFlash(await scanner.hasFlash());
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });
    return () => {
      cancelled = true;
      scanner.destroy();
      scannerRef.current = null;
    };
  }, []);

  const toggleFlash = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    await scanner.toggleFlash();
    setFlashOn(scanner.isFlashOn());
  }, []);

  return { videoRef, status, hasFlash, flashOn, toggleFlash };
}
