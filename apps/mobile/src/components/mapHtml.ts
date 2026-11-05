// Carte MapLibre GL JS (tuiles OpenFreeMap, données OSM), partagée par la WebView native et l'iframe web.
// La bibliothèque est servie par notre propre site (/vendor), avec repli sur unpkg.
import { SITE_URL } from '../lib/config';

const V = '5.24.0';
const LOCAL = `${SITE_URL}/vendor`;
const CDN = `https://unpkg.com/maplibre-gl@${V}/dist`;

export const MAP_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LOCAL}/maplibre-gl.css" onerror="this.href='${CDN}/maplibre-gl.css'">
<style>html,body,#m{margin:0;height:100%;background:#E6ECEA;overflow:hidden;overscroll-behavior:none}#m{touch-action:none}
.maplibregl-ctrl-attrib{font:11px system-ui,sans-serif}
#err{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:12px;background:#fff;color:#0F1A17;font:14px system-ui;display:none}</style>
</head><body><div id="m" role="application" aria-label="Carte des bornes de recharge"></div><div id="err">Carte indisponible hors connexion. La liste des bornes reste utilisable.</div>
<script src="${LOCAL}/maplibre-gl.js"></script>
<script>if(!window.maplibregl){document.write('<script src="${CDN}/maplibre-gl.js"><\\/script>')}</script>
<script>
(function(){
  function send(m){var s=JSON.stringify(m);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else{parent.postMessage(s,'*')}}
  if(!window.maplibregl){document.getElementById('err').style.display='block';send({type:'error'});return}
  var map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',center:[2.3522,48.8566],zoom:12,attributionControl:{compact:true},pitchWithRotate:false,dragRotate:true,touchPitch:false,cooperativeGestures:false,scrollZoom:true,doubleClickZoom:true,keyboard:true});
  var lastB=0;map.on('rotate',function(){var b=Math.round(map.getBearing());if(b!==lastB){lastB=b;send({type:'camera',bearing:b})}});
  var empty={type:'FeatureCollection',features:[]};var pending=[];var ready=false;var selected=null;
  map.on('load',function(){
    map.addSource('st',{type:'geojson',data:empty,cluster:true,clusterRadius:42,clusterMaxZoom:13});
    map.addSource('me',{type:'geojson',data:empty});
    map.addSource('zones',{type:'geojson',data:empty});
    map.addSource('route',{type:'geojson',data:empty});
    map.addSource('inc',{type:'geojson',data:empty});
    map.addLayer({id:'zones-f',type:'fill',source:'zones',paint:{'fill-color':'#B45309','fill-opacity':0.12}});
    map.addLayer({id:'zones-l',type:'line',source:'zones',paint:{'line-color':'#B45309','line-width':1.5,'line-dasharray':[2,2]}});
    map.addSource('alts',{type:'geojson',data:empty});
    map.addSource('traffic',{type:'geojson',data:empty});
    map.addSource('dest',{type:'geojson',data:empty});
    map.addSource('pins',{type:'geojson',data:empty});
    var lr={'line-cap':'round','line-join':'round'};
    map.addLayer({id:'alts-casing',type:'line',source:'alts',layout:lr,paint:{'line-color':'#FFFFFF','line-width':9}});
    map.addLayer({id:'alts',type:'line',source:'alts',layout:lr,paint:{'line-color':'#8A9792','line-width':5}});
    map.addLayer({id:'alts-hit',type:'line',source:'alts',layout:lr,paint:{'line-color':'#000','line-opacity':0,'line-width':28}});
    map.addLayer({id:'alts-l',type:'symbol',source:'alts',layout:{'symbol-placement':'line-center','text-field':['get','label'],'text-size':13,'text-font':['Noto Sans Bold']},paint:{'text-color':'#0F1A17','text-halo-color':'#fff','text-halo-width':2.5}});
    map.addLayer({id:'route-casing',type:'line',source:'route',layout:lr,paint:{'line-color':'#FFFFFF','line-width':11}});
    map.addLayer({id:'route',type:'line',source:'route',layout:lr,paint:{'line-color':'#1D4ED8','line-width':7}});
    map.addLayer({id:'traffic',type:'line',source:'traffic',layout:lr,paint:{'line-width':7,'line-color':['match',['get','level'],'closed','#7A1410','jam','#B42318','#E07B00']}});
    map.on('click','alts-hit',function(e){var f=e.features&&e.features[0];if(f)send({type:'tapRoute',id:f.properties.id})});
    map.addLayer({id:'inc',type:'circle',source:'inc',paint:{'circle-radius':9,'circle-color':['match',['get','t'],'accident','#B42318','fermeture','#B42318','travaux','#B45309','bouchon','#C2410C','#5B6662'],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'inc-l',type:'symbol',source:'inc',minzoom:12,layout:{'text-field':['get','title'],'text-size':11,'text-offset':[0,1.4],'text-anchor':'top','text-font':['Noto Sans Bold'],'text-max-width':10},paint:{'text-color':'#0F1A17','text-halo-color':'#fff','text-halo-width':2}});
    map.on('click','inc',function(e){var f=e.features&&e.features[0];if(f)send({type:'tapIncident',id:f.properties.id})});
    map.addLayer({id:'cl-halo',type:'circle',source:'st',filter:['has','point_count'],paint:{'circle-color':'#0B7A55','circle-opacity':0.14,'circle-radius':['step',['get','point_count'],23,20,28,100,34]}});
    map.addLayer({id:'cl',type:'circle',source:'st',filter:['has','point_count'],paint:{'circle-color':'#E3F2EC','circle-radius':['step',['get','point_count'],16,20,20,100,25],'circle-stroke-width':2.5,'circle-stroke-color':'#0B7A55'}});
    map.addLayer({id:'cl-n',type:'symbol',source:'st',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':13,'text-font':['Noto Sans Bold'],'text-allow-overlap':true},paint:{'text-color':'#075C40'}});
    map.addLayer({id:'pt',type:'circle',source:'st',filter:['!',['has','point_count']],paint:{
      'circle-color':['case',['==',['get','r'],1],'#A9B8B3',['>=',['get','kw'],150],'#075C40',['>=',['get','kw'],50],'#0B7A55','#3DDC97'],
      'circle-radius':['interpolate',['linear'],['zoom'],10,6,14,9,17,11],'circle-stroke-width':2.5,'circle-stroke-color':['case',['==',['get','r'],1],'#5B6662','#FFFFFF']}});
    map.addLayer({id:'pt-l',type:'symbol',source:'st',filter:['!',['has','point_count']],minzoom:13.5,layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.5],'text-anchor':'top','text-font':['Noto Sans Bold'],'text-allow-overlap':false},paint:{'text-color':'#0F1A17','text-halo-color':'#fff','text-halo-width':2}});
    map.addLayer({id:'sel-halo',type:'circle',source:'st',filter:['==',['get','id'],'__none__'],paint:{'circle-color':'#0B7A55','circle-opacity':0.22,'circle-radius':28}});
    map.addLayer({id:'sel',type:'circle',source:'st',filter:['==',['get','id'],'__none__'],paint:{'circle-color':['case',['>=',['get','kw'],150],'#075C40',['>=',['get','kw'],50],'#0B7A55','#3DDC97'],'circle-radius':15,'circle-stroke-width':4,'circle-stroke-color':'#0F1A17'}});
    map.addLayer({id:'pins',type:'circle',source:'pins',paint:{'circle-color':'#075C40','circle-radius':13,'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'pins-l',type:'symbol',source:'pins',layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.6],'text-anchor':'top','text-font':['Noto Sans Bold'],'text-max-width':9},paint:{'text-color':'#075C40','text-halo-color':'#fff','text-halo-width':2}});
    map.on('click','pins',function(e){var f=e.features&&e.features[0];if(f)send({type:'tapPin',id:f.properties.id})});
    map.addLayer({id:'dest-halo',type:'circle',source:'dest',paint:{'circle-color':'#0F1A17','circle-opacity':0.15,'circle-radius':20}});
    map.addLayer({id:'dest',type:'circle',source:'dest',paint:{'circle-color':'#0F1A17','circle-radius':9,'circle-stroke-width':4,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'me-halo',type:'circle',source:'me',paint:{'circle-color':'#1D4ED8','circle-opacity':0.12,'circle-stroke-color':'#1D4ED8','circle-stroke-opacity':0.35,'circle-stroke-width':1,'circle-radius':14,'circle-pitch-alignment':'map'}});
    try{var cc=document.createElement('canvas');cc.width=cc.height=120;var cg=cc.getContext('2d');var gr=cg.createRadialGradient(60,60,6,60,60,58);gr.addColorStop(0,'rgba(29,78,216,0.55)');gr.addColorStop(1,'rgba(29,78,216,0)');
      cg.fillStyle=gr;cg.beginPath();cg.moveTo(60,60);cg.arc(60,60,58,-Math.PI/2-0.55,-Math.PI/2+0.55);cg.closePath();cg.fill();
      map.addImage('cone',cg.getImageData(0,0,120,120),{pixelRatio:2});
      map.addLayer({id:'me-cone',type:'symbol',source:'me',filter:['all',['!=',['get','nav'],1],['>=',['get','h'],0]],layout:{'icon-image':'cone','icon-rotate':['get','h'],'icon-rotation-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}});
    }catch(e){}
    map.addLayer({id:'me',type:'circle',source:'me',filter:['!=',['get','nav'],1],paint:{'circle-color':'#1D4ED8','circle-radius':8,'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    try{var c=document.createElement('canvas');c.width=c.height=72;var g=c.getContext('2d');
      g.beginPath();g.moveTo(36,6);g.lineTo(62,64);g.lineTo(36,52);g.lineTo(10,64);g.closePath();g.lineJoin='round';
      g.lineWidth=7;g.strokeStyle='#FFFFFF';g.stroke();g.fillStyle='#1D4ED8';g.fill();
      map.addImage('nav-arrow',g.getImageData(0,0,72,72),{pixelRatio:2});
      map.addLayer({id:'me-arrow',type:'symbol',source:'me',filter:['==',['get','nav'],1],layout:{'icon-image':'nav-arrow','icon-rotate':['get','b'],'icon-rotation-alignment':'map','icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}});
    }catch(e){}
    map.on('click','pt',function(e){var f=e.features&&e.features[0];if(f)send({type:'tap',id:f.properties.id})});
    map.on('click','cl',function(e){var f=e.features[0];map.getSource('st').getClusterExpansionZoom(f.properties.cluster_id).then(function(z){map.easeTo({center:f.geometry.coordinates,zoom:z})})});
    ['pt','cl'].forEach(function(l){map.on('mouseenter',l,function(){map.getCanvas().style.cursor='pointer'});map.on('mouseleave',l,function(){map.getCanvas().style.cursor=''})});
    map.on('moveend',function(e){var c=map.getCenter();send({type:'moveend',lat:c.lat,lon:c.lng,zoom:map.getZoom(),user:!!e.originalEvent})});
    ready=true;pending.forEach(handle);pending=[];send({type:'ready'});
  });
  function line(c){return c&&c.length?{type:'Feature',geometry:{type:'LineString',coordinates:c},properties:{}}:empty}
  function handle(m){
    if(!ready){pending.push(m);return}
    if(m.type==='stations'){map.getSource('st').setData({type:'FeatureCollection',features:m.stations.map(function(s){return{type:'Feature',geometry:{type:'Point',coordinates:[s.lon,s.lat]},properties:{id:s.id,kw:s.kw,r:s.r?1:0,label:s.label}}})})}
    else if(m.type==='user'){map.getSource('me').setData({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[m.lon,m.lat]},properties:{nav:m.nav?1:0,b:m.bearing||0,h:(m.heading==null||m.nav)?-1:m.heading}}]});
      if(m.accuracy){var px0=m.accuracy/(156543.03*Math.cos(m.lat*Math.PI/180));map.setPaintProperty('me-halo','circle-radius',['max',14,['interpolate',['exponential',2],['zoom'],0,px0,22,px0*4194304]]);map.setPaintProperty('me-halo','circle-opacity',m.nav?0:0.12)}}
    else if(m.type==='zoom'){map.easeTo({zoom:map.getZoom()+m.by,duration:250})}
    else if(m.type==='north'){map.easeTo({bearing:0,pitch:0,duration:400})}
    else if(m.type==='fly'){map.flyTo({center:[m.lon,m.lat],zoom:m.zoom||map.getZoom(),offset:[0,m.offsetY||0],duration:m.instant?0:900})}
    else if(m.type==='route'){map.getSource('route').setData(line(m.coords));if(!m.coords||!m.coords.length){map.getSource('alts').setData(empty);map.getSource('traffic').setData(empty)}}
    else if(m.type==='routes'){map.getSource('route').setData(line(m.main));
      map.getSource('traffic').setData({type:'FeatureCollection',features:(m.segments||[]).map(function(s){return{type:'Feature',geometry:{type:'LineString',coordinates:s.coords},properties:{level:s.level}}})});
      map.getSource('alts').setData({type:'FeatureCollection',features:(m.alts||[]).map(function(a){return{type:'Feature',geometry:{type:'LineString',coordinates:a.coords},properties:{id:a.id,label:a.label||''}}})})}
    else if(m.type==='dest'){map.getSource('dest').setData(m.lat==null?empty:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[m.lon,m.lat]},properties:{}}]})}
    else if(m.type==='pins'){map.getSource('pins').setData({type:'FeatureCollection',features:m.items.map(function(i){return{type:'Feature',geometry:{type:'Point',coordinates:[i.lon,i.lat]},properties:{id:i.id,label:i.label}}})})}
    else if(m.type==='incidents'){map.getSource('inc').setData({type:'FeatureCollection',features:m.items.map(function(i){return{type:'Feature',geometry:{type:'Point',coordinates:[i.lon,i.lat]},properties:{id:i.id,t:i.type,title:i.title}}})})}
    else if(m.type==='zones'){map.getSource('zones').setData({type:'FeatureCollection',features:m.polys.map(function(r){return{type:'Feature',geometry:{type:'Polygon',coordinates:[r]},properties:{}}})})}
    else if(m.type==='fit'){map.fitBounds([[m.bounds[0],m.bounds[1]],[m.bounds[2],m.bounds[3]]],{padding:{top:m.top||80,bottom:m.bottom||80,left:40,right:40},duration:800,maxZoom:16})}
    else if(m.type==='follow'){map.easeTo({center:[m.lon,m.lat],zoom:m.zoom||map.getZoom(),bearing:m.bearing==null?map.getBearing():m.bearing,pitch:m.pitch==null?50:m.pitch,offset:[0,m.offsetY||0],duration:m.duration||900,easing:function(t){return t}})}
    else if(m.type==='unfollow'){map.easeTo({pitch:0,bearing:0,duration:600})}
    else if(m.type==='select'){selected=m.id;var f=['==',['get','id'],m.id||'__none__'];map.setFilter('sel',f);map.setFilter('sel-halo',f)}
  }
  window.__recv=function(m){try{handle(typeof m==='string'?JSON.parse(m):m)}catch(e){}};
  window.addEventListener('message',function(e){if(typeof e.data==='string'&&e.data.charAt(0)==='{'){window.__recv(e.data)}});
})();
</script></body></html>`;

export type MapIn =
  | { type: 'stations'; stations: { id: string; lat: number; lon: number; kw: number; r: boolean; label: string }[] }
  | { type: 'user'; lat: number; lon: number; bearing?: number; nav?: boolean; accuracy?: number | null; heading?: number | null }
  | { type: 'zoom'; by: number }
  | { type: 'north' }
  | { type: 'fly'; lat: number; lon: number; zoom?: number; offsetY?: number; instant?: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'route'; coords: [number, number][] }
  | {
      type: 'routes';
      main: [number, number][];
      segments: { coords: [number, number][]; level: 'slow' | 'jam' | 'closed' }[];
      alts: { id: string; coords: [number, number][]; label?: string }[];
    }
  | { type: 'dest'; lat?: number; lon?: number }
  | { type: 'pins'; items: { id: string; lat: number; lon: number; label: string }[] }
  | { type: 'incidents'; items: { id: string; lon: number; lat: number; type: string; title: string }[] }
  | { type: 'zones'; polys: [number, number][][] }
  | { type: 'fit'; bounds: [number, number, number, number]; top?: number; bottom?: number }
  | { type: 'follow'; lat: number; lon: number; bearing?: number; offsetY?: number; zoom?: number; pitch?: number; duration?: number }
  | { type: 'unfollow' };

export type MapOut =
  | { type: 'ready' }
  | { type: 'error' }
  | { type: 'tap'; id: string }
  | { type: 'tapIncident'; id: string }
  | { type: 'tapRoute'; id: string }
  | { type: 'camera'; bearing: number }
  | { type: 'tapPin'; id: string }
  | { type: 'moveend'; lat: number; lon: number; zoom: number; user: boolean };
