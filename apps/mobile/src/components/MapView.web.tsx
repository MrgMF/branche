import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { mapHtml, type MapIn, type MapOut } from './mapHtml';
import { localeTag, tr, useT } from '../i18n';

export interface MapHandle {
  post: (m: MapIn) => void;
}

export const MapView = forwardRef<MapHandle, { onMessage: (m: MapOut) => void }>(function MapView({ onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const t = useT();
  // Page générée une fois (langue au montage) : la recharger effacerait la carte.
  const [html] = useState(() => mapHtml(localeTag(), tr().map.label, tr().map.offline));
  const cb = useRef(onMessage);
  cb.current = onMessage;

  useImperativeHandle(ref, () => ({
    post: (m) => frame.current?.contentWindow?.postMessage(JSON.stringify(m), '*'),
  }));

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      try {
        cb.current(JSON.parse(e.data) as MapOut);
      } catch {
        /* ignoré */
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return createElement('iframe', {
    ref: frame,
    srcDoc: html,
    title: t.map.label,
    style: { border: 0, width: '100%', height: '100%', flex: 1, display: 'block', background: '#E6ECEA' },
    allow: 'geolocation',
  });
});
