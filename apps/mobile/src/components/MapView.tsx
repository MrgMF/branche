import { forwardRef, useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { MAP_HTML, type MapIn, type MapOut } from './mapHtml';

export interface MapHandle {
  post: (m: MapIn) => void;
}

type WebViewHandle = { injectJavaScript: (js: string) => void };
// Les typings de react-native-webview n'exposent pas la ref sur la version générique.
const WV = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

export const MapView = forwardRef<MapHandle, { onMessage: (m: MapOut) => void }>(function MapView({ onMessage }, ref) {
  const web = useRef<WebViewHandle>(null);
  useImperativeHandle(ref, () => ({
    post: (m) => web.current?.injectJavaScript(`window.__recv(${JSON.stringify(JSON.stringify(m))});true;`),
  }));
  return (
    <WV
      ref={web}
      style={styles.map}
      originWhitelist={['*']}
      source={{ html: MAP_HTML, baseUrl: 'https://branche.app/' }}
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
      accessibilityLabel="Carte des bornes de recharge"
    />
  );
});

const styles = StyleSheet.create({ map: { flex: 1, backgroundColor: '#E6ECEA' } });
