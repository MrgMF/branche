import { forwardRef, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { mapHtml, type MapIn, type MapOut } from './mapHtml';
import { localeTag, tr, useT } from '../i18n';

export interface MapHandle {
  post: (m: MapIn) => void;
}

type WebViewHandle = { injectJavaScript: (js: string) => void };
// Les typings de react-native-webview n'exposent pas la ref sur la version générique.
const WV = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

export const MapView = forwardRef<MapHandle, { onMessage: (m: MapOut) => void }>(function MapView({ onMessage }, ref) {
  const t = useT();
  const [html] = useState(() => mapHtml(localeTag(), tr().map.label, tr().map.offline));
  const web = useRef<WebViewHandle>(null);
  useImperativeHandle(ref, () => ({
    post: (m) => web.current?.injectJavaScript(`window.__recv(${JSON.stringify(JSON.stringify(m))});true;`),
  }));
  return (
    <WV
      ref={web}
      style={styles.map}
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://branche.app/' }}
      onMessage={(e: WebViewMessageEvent) => {
        try {
          onMessage(JSON.parse(e.nativeEvent.data) as MapOut);
        } catch {
          /* message ignoré */
        }
      }}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
      accessibilityLabel={t.map.label}
    />
  );
});

const styles = StyleSheet.create({ map: { flex: 1, backgroundColor: '#E6ECEA' } });
