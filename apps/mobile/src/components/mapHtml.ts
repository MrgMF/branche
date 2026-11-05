// Carte MapLibre GL JS (tuiles OpenFreeMap, données OSM), partagée par la WebView native et l'iframe web.
// La bibliothèque est servie par notre propre site (/vendor), avec repli sur unpkg.
import { SITE_URL } from '../lib/config';

const V = '5.24.0';
const LOCAL = `${SITE_URL}/vendor`;
const CDN = `https://unpkg.com/maplibre-gl@${V}/dist`;

export const MAP_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LOCAL}/maplibre-gl.css" onerror="this.href='${CDN}/maplibre-gl.css'">
<style>html,body,#m{margin:0;height:100%;background:#E6ECEA}
.maplibregl-ctrl-attrib{font:11px system-ui,sans-serif}
#err{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:12px;background:#fff;color:#0F1A17;font:14px system-ui;display:none}</style>
</head><body><div id="m" role="application" aria-label="Carte des bornes de recharge"></div><div id="err">Carte indisponible hors connexion. La liste des bornes reste utilisable.</div>
<script src="${LOCAL}/maplibre-gl.js"></script>
<script>if(!window.maplibregl){document.write('<script src="${CDN}/maplibre-gl.js"><\\/script>')}</script>
<script>
(function(){
  function send(m){var s=JSON.stringify(m);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else{parent.postMessage(s,'*')}}
  if(!window.maplibregl){document.getElementById('err').style.display='block';send({type:'error'});return}
  var map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',center:[2.3522,48.8566],zoom:12,attributionControl:{compact:true},pitchWithRotate:false,dragRotate:false});
  map.touchZoomRotate.disableRotation();
  var empty={type:'FeatureCollection',features:[]};var pending=[];var ready=false;var selected=null;
  map.on('load',function(){
    map.addSource('st',{type:'geojson',data:empty,cluster:true,clusterRadius:42,clusterMaxZoom:13});
    map.addSource('me',{type:'geojson',data:empty});
    map.addSource('zones',{type:'geojson',data:empty});
    map.addSource('route',{type:'geojson',data:empty});
    map.addSource('inc',{type:'geojson',data:empty});
    map.addLayer({id:'zones-f',type:'fill',source:'zones',paint:{'fill-color':'#B45309','fill-opacity':0.12}});
    map.addLayer({id:'zones-l',type:'line',source:'zones',paint:{'line-color':'#B45309','line-width':1.5,'line-dasharray':[2,2]}});
    map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#FFFFFF','line-width':10}});
    map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#1D4ED8','line-width':6}});
    map.addLayer({id:'inc',type:'circle',source:'inc',paint:{'circle-radius':9,'circle-color':['match',['get','t'],'accident','#B42318','fermeture','#B42318','travaux','#B45309','bouchon','#C2410C','#5B6662'],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'inc-l',type:'symbol',source:'inc',minzoom:12,layout:{'text-field':['get','title'],'text-size':11,'text-offset':[0,1.4],'text-anchor':'top','text-font':['Noto Sans Bold'],'text-max-width':10},paint:{'text-color':'#0F1A17','text-halo-color':'#fff','text-halo-width':2}});
    map.on('click','inc',function(e){var f=e.features&&e.features[0];if(f)send({type:'tapIncident',id:f.properties.id})});
    map.addLayer({id:'cl',type:'circle',source:'st',filter:['has','point_count'],paint:{'circle-color':'#0F1A17','circle-radius':['step',['get','point_count'],16,20,20,100,26],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'cl-n',type:'symbol',source:'st',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':13,'text-font':['Noto Sans Bold']},paint:{'text-color':'#fff'}});
    map.addLayer({id:'pt',type:'circle',source:'st',filter:['!',['has','point_count']],paint:{
      'circle-color':['case',['==',['get','r'],1],'#5B6662',['>=',['get','kw'],50],'#075C40','#0B7A55'],
      'circle-radius':['case',['==',['get','id'],''],10,10],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'pt-l',type:'symbol',source:'st',filter:['!',['has','point_count']],minzoom:13.5,layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.5],'text-anchor':'top','text-font':['Noto Sans Bold'],'text-allow-overlap':false},paint:{'text-color':'#0F1A17','text-halo-color':'#fff','text-halo-width':2}});
    map.addLayer({id:'sel',type:'circle',source:'st',filter:['==',['get','id'],'__none__'],paint:{'circle-color':'#0B7A55','circle-radius':14,'circle-stroke-width':4,'circle-stroke-color':'#0F1A17'}});
    map.addLayer({id:'me-halo',type:'circle',source:'me',paint:{'circle-color':'#1D4ED8','circle-opacity':0.18,'circle-radius':22}});
    map.addLayer({id:'me',type:'circle',source:'me',paint:{'circle-color':'#1D4ED8','circle-radius':8,'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.on('click','pt',function(e){var f=e.features&&e.features[0];if(f)send({type:'tap',id:f.properties.id})});
    map.on('click','cl',function(e){var f=e.features[0];map.getSource('st').getClusterExpansionZoom(f.properties.cluster_id).then(function(z){map.easeTo({center:f.geometry.coordinates,zoom:z})})});
    ['pt','cl'].forEach(function(l){map.on('mouseenter',l,function(){map.getCanvas().style.cursor='pointer'});map.on('mouseleave',l,function(){map.getCanvas().style.cursor=''})});
    map.on('moveend',function(e){var c=map.getCenter();send({type:'moveend',lat:c.lat,lon:c.lng,zoom:map.getZoom(),user:!!e.originalEvent})});
    ready=true;pending.forEach(handle);pending=[];send({type:'ready'});
  });
  function handle(m){
    if(!ready){pending.push(m);return}
    if(m.type==='stations'){map.getSource('st').setData({type:'FeatureCollection',features:m.stations.map(function(s){return{type:'Feature',geometry:{type:'Point',coordinates:[s.lon,s.lat]},properties:{id:s.id,kw:s.kw,r:s.r?1:0,label:s.label}}})})}
    else if(m.type==='user'){map.getSource('me').setData({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[m.lon,m.lat]},properties:{}}]})}
    else if(m.type==='fly'){map.flyTo({center:[m.lon,m.lat],zoom:m.zoom||map.getZoom(),offset:[0,m.offsetY||0],duration:m.instant?0:900})}
    else if(m.type==='route'){map.getSource('route').setData(m.coords&&m.coords.length?{type:'Feature',geometry:{type:'LineString',coordinates:m.coords},properties:{}}:empty)}
    else if(m.type==='incidents'){map.getSource('inc').setData({type:'FeatureCollection',features:m.items.map(function(i){return{type:'Feature',geometry:{type:'Point',coordinates:[i.lon,i.lat]},properties:{id:i.id,t:i.type,title:i.title}}})})}
    else if(m.type==='zones'){map.getSource('zones').setData({type:'FeatureCollection',features:m.polys.map(function(r){return{type:'Feature',geometry:{type:'Polygon',coordinates:[r]},properties:{}}})})}
    else if(m.type==='fit'){map.fitBounds([[m.bounds[0],m.bounds[1]],[m.bounds[2],m.bounds[3]]],{padding:{top:m.top||80,bottom:m.bottom||80,left:40,right:40},duration:800,maxZoom:16})}
    else if(m.type==='follow'){map.easeTo({center:[m.lon,m.lat],zoom:16.5,bearing:m.bearing||0,pitch:45,offset:[0,m.offsetY||0],duration:900})}
    else if(m.type==='unfollow'){map.easeTo({pitch:0,bearing:0,duration:600})}
    else if(m.type==='select'){selected=m.id;map.setFilter('sel',['==',['get','id'],m.id||'__none__'])}
  }
  window.__recv=function(m){try{handle(typeof m==='string'?JSON.parse(m):m)}catch(e){}};
  window.addEventListener('message',function(e){if(typeof e.data==='string'&&e.data.charAt(0)==='{'){window.__recv(e.data)}});
})();
</script></body></html>`;

export type MapIn =
  | { type: 'stations'; stations: { id: string; lat: number; lon: number; kw: number; r: boolean; label: string }[] }
  | { type: 'user'; lat: number; lon: number }
  | { type: 'fly'; lat: number; lon: number; zoom?: number; offsetY?: number; instant?: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'route'; coords: [number, number][] }
  | { type: 'incidents'; items: { id: string; lon: number; lat: number; type: string; title: string }[] }
  | { type: 'zones'; polys: [number, number][][] }
  | { type: 'fit'; bounds: [number, number, number, number]; top?: number; bottom?: number }
  | { type: 'follow'; lat: number; lon: number; bearing?: number; offsetY?: number }
  | { type: 'unfollow' };

export type MapOut =
  | { type: 'ready' }
  | { type: 'error' }
  | { type: 'tap'; id: string }
  | { type: 'tapIncident'; id: string }
  | { type: 'moveend'; lat: number; lon: number; zoom: number; user: boolean };
