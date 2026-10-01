import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { equatorialToHorizontal, getSunAltitude, getVisibility } from '../lib/astronomy';
import { skyRotation, updateSkyClock } from '../lib/skyMotion';
import type { MeteorRadiant, ObserverLocation, SkyObject, SkySceneProps } from '../types';
import './SkyScene.css';

const RAD = Math.PI / 180;
const SKY_RADIUS = 800;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const normalized = (n: number) => ((n % 360) + 360) % 360;
const angularDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const minimumFov = (mode: SkySceneProps['mode']) => ({ eye: 10, binocular: 1, telescope: 0.15 })[mode];

function direction(azimuth: number, altitude: number, radius = 1) {
  const az = azimuth * RAD;
  const alt = altitude * RAD;
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)).multiplyScalar(radius);
}

type ConstellationData = { features: { geometry: { type: string; coordinates: number[][][] } }[] };
type Label = { element: HTMLElement; object?: SkyObject; position: THREE.Vector3; compass?: boolean };
type SceneRuntime = { refresh: (props: SkySceneProps) => void; destroy: () => void };
type SatelliteMotion = { position: THREE.Vector3; velocity: THREE.Vector3 };
type RadiantView = { element: HTMLElement; caption: HTMLElement; position: THREE.Vector3; guides: { element: HTMLElement; line: HTMLElement; position: THREE.Vector3 }[]; guideKey: string };
// Angular radius of the radiant glow. Meteors appear all over the sky; this marks where their trails point back to.
const RADIANT_RADIUS = 11;
const METEOR_STREAKS = [[-24,.30,.0],[38,.42,2.6],[97,.26,5.1],[151,.36,1.3],[203,.30,3.9],[258,.40,6.2],[312,.28,.7],[352,.34,4.6]];

const skyVertex = `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = `
  precision highp float;
  varying vec3 vDirection;
  uniform float uDay;
  uniform float uNight;
  uniform vec3 uSun;
  uniform vec3 uGalacticPole;
  uniform vec3 uGalacticCore;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  void main() {
    vec3 d = normalize(vDirection);
    float h = pow(clamp(1.0 - d.y, 0.0, 1.0), 4.0);
    vec3 night = mix(vec3(0.0018,0.0037,0.009),vec3(0.014,0.026,0.043),h);
    vec3 day = mix(vec3(0.115,0.205,0.305),vec3(0.315,0.367,0.393),h);
    vec3 color = mix(night,day,uDay);
    float sunward = pow(max(0.0, dot(d, normalize(vec3(uSun.x,0.03,uSun.z)))),5.0);
    float twilight = sin(uDay * 3.14159) * h * sunward;
    color += twilight * vec3(0.13,0.053,0.027);
    float latitude = abs(dot(d, uGalacticPole));
    float band = exp(-latitude * latitude * 110.0);
    float detail = noise(d*19.0)*0.56 + noise(d*43.0)*0.29 + noise(d*94.0)*0.15;
    float core = pow(max(0.0,dot(d,uGalacticCore)),5.0);
    float dust = smoothstep(0.28,0.65,detail);
    float galaxy = band * (0.14 + dust*0.70) * (0.42 + core*0.65);
    color += vec3(0.046,0.051,0.067) * galaxy * uNight * smoothstep(-0.01,0.2,d.y);
    color += vec3(0.02,0.013,0.012) * galaxy * core * uNight;
    float grain = (hash(d*1600.0)-0.5)/255.0;
    gl_FragColor = vec4(color+grain,1.0);
    #include <colorspace_fragment>
  }
`;

const pointVertex = `
  attribute float aSize;
  attribute float aKind;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;
  uniform float uPixelRatio;
  uniform float uDiscScale;
  uniform float uZoomScale;
  attribute float aFixedSky;
  uniform mat4 uSkyRotation;
  void main() {
    vColor=color; vKind=aKind; vPhase=aPhase;
    vec4 skyPosition=mix(vec4(position,1.0),uSkyRotation*vec4(position,1.0),aFixedSky);
    vec4 mvPosition=modelViewMatrix*skyPosition;
    gl_Position=projectionMatrix*mvPosition;
    gl_PointSize = (aKind > 1.5 ? max(5.0,uDiscScale) : aSize*uZoomScale) * uPixelRatio;
  }
`;

const pointFragment = `
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;
  void main() {
    vec2 p=gl_PointCoord.xy*2.0-1.0;
    float r=length(p);
    if(r>1.0) discard;
    if(vKind>1.5) {
      float edge=1.0-smoothstep(0.90,1.0,r);
      if(vKind>2.5) { gl_FragColor=vec4(vec3(1.0,0.9,0.67),edge); return; }
      float z=sqrt(max(0.0,1.0-dot(p,p)));
      float lightZ=clamp(vPhase*2.0-1.0,-1.0,1.0);
      vec3 light=vec3(sqrt(max(0.0,1.0-lightZ*lightZ)),0.0,lightZ);
      float illumination=max(0.0,dot(vec3(p.x,-p.y,z),light));
      float maria=0.86+0.09*sin(p.x*18.0+p.y*13.0)*sin(p.y*21.0-p.x*8.0);
      gl_FragColor=vec4(vColor*(0.045+0.955*sqrt(illumination))*maria,edge);
    } else {
      float alpha=exp(-r*r*7.0)*0.28+exp(-r*r*19.0)*0.90;
      if(vKind>0.5) alpha=exp(-r*r*6.0)*0.23+exp(-r*r*23.0)*1.12;
      gl_FragColor=vec4(vColor,alpha);
    }
    #include <colorspace_fragment>
  }
`;

const discVertex = `
  varying vec2 vUv;
  void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const discFragment = `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uPhase;
  uniform float uKind;
  void main() {
    vec2 p=vUv*2.0-1.0;
    float r=length(p);
    if(r>1.0) discard;
    float edge=1.0-smoothstep(0.99,1.0,r);
    if(uKind>2.5) { gl_FragColor=vec4(vec3(1.0,0.90,0.67),edge); return; }
    float z=sqrt(max(0.0,1.0-dot(p,p)));
    float lightZ=clamp(uPhase*2.0-1.0,-1.0,1.0);
    vec3 light=vec3(sqrt(max(0.0,1.0-lightZ*lightZ)),0.0,lightZ);
    float illumination=max(0.0,dot(vec3(p,z),light));
    float surface=uKind>1.5 ? 0.86+0.07*sin(p.x*18.0+p.y*13.0)*sin(p.y*21.0-p.x*8.0) : 1.0;
    gl_FragColor=vec4(uColor*(0.025+0.975*sqrt(illumination))*surface,edge);
    #include <colorspace_fragment>
  }
`;

// Approximate physical diameters; positions and distances come from the ephemeris.
const BODY_DIAMETERS: Record<string, number> = { sun:1391400, moon:3474.8, mercury:4879.4, venus:12104, mars:6779, jupiter:142984, saturn:120536, uranus:51118, neptune:49528, pluto:2376.6, io:3643.2, europa:3121.6, ganymede:5268.2, callisto:4820.6 };
function angularDiameter(object: SkyObject) {
  const diameter=BODY_DIAMETERS[object.id];
  if(!diameter || !object.distance) return 0;
  const numeric=Number.parseFloat(object.distance.replaceAll(',',''));
  const kilometers=object.distance.includes('AU')?numeric*149597870.7:numeric;
  return kilometers>0 ? 2*Math.atan(diameter/(2*kilometers)) : 0;
}

function makeLandscape() {
  const group = new THREE.Group();
  const materials: { material: THREE.MeshBasicMaterial; night: THREE.Color; day: THREE.Color }[] = [];
  const makeMaterial = (night: string, day: string) => {
    const material = new THREE.MeshBasicMaterial({ color: night, side: THREE.DoubleSide });
    materials.push({ material, night: new THREE.Color(night), day: new THREE.Color(day) });
    return material;
  };
  const layers = [
    { radius: 470, base: -17, height: 32, phase: 0.3, night: '#253749', day: '#54646c' },
    { radius: 340, base: -17, height: 22, phase: 1.7, night: '#1a2b3b', day: '#3b4b55' },
    { radius: 240, base: -15, height: 14, phase: 4.1, night: '#102030', day: '#283c46' },
  ];
  for (const layer of layers) {
    const positions: number[] = [];
    const count = 720;
    const heightAt = (angle: number) => {
      const hills = Math.sin(angle*3+layer.phase)*0.25 + Math.sin(angle*7.0+layer.phase)*0.15
        + Math.sin(angle*13+layer.phase*3)*0.10 + Math.sin(angle*29.0+2)*0.035;
      return layer.base + layer.height*(0.52+hills);
    };
    for (let i=0; i<count; i++) {
      const a=i/count*Math.PI*2;
      const b=(i+1)/count*Math.PI*2;
      const p=[Math.sin(a)*layer.radius,heightAt(a),-Math.cos(a)*layer.radius];
      const q=[Math.sin(b)*layer.radius,heightAt(b),-Math.cos(b)*layer.radius];
      positions.push(...p,...q,q[0],-150,q[2],...p,q[0],-150,q[2],p[0],-150,p[2]);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    group.add(new THREE.Mesh(geometry,makeMaterial(layer.night,layer.day)));
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(700,128),makeMaterial('#0a141f','#20343c'));
  ground.rotation.x=-Math.PI/2;
  ground.position.y=-4.3;
  group.add(ground);

  // The landscape is an illustrative horizon, rather than local terrain data.
  const treePositions: number[]=[];
  for(let i=0;i<160;i++) {
    const angle=i*2.399963;
    const radius=140+20*Math.sin(i*9.3);
    const height=2.1+(Math.sin(i*6.71)*0.5+0.5)*2.7;
    const width=height*0.31;
    const center=new THREE.Vector3(Math.sin(angle)*radius,-4.0,-Math.cos(angle)*radius);
    const side=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
    const triangle=(y:number,w:number,h:number) => {
      const a=center.clone().addScaledVector(side,-w); a.y+=y;
      const b=center.clone().addScaledVector(side,w); b.y+=y;
      const c=center.clone(); c.y+=y+h;
      treePositions.push(...a.toArray(),...b.toArray(),...c.toArray());
    };
    triangle(height*0.12,width,height*0.56);
    triangle(height*0.38,width*0.80,height*0.43);
    triangle(height*0.60,width*0.53,height*0.4);
    triangle(0,width*0.07,height*0.7);
  }
  const trees=new THREE.BufferGeometry();
  trees.setAttribute('position',new THREE.Float32BufferAttribute(treePositions,3));
  group.add(new THREE.Mesh(trees,makeMaterial('#080f18','#182b31')));

  const observatory=new THREE.Group();
  const buildingMaterial=makeMaterial('#0b141e','#293a42');
  const building=new THREE.Mesh(new THREE.CylinderGeometry(3.0,3.0,3.1,24),buildingMaterial);
  building.position.y=1.55;
  observatory.add(building);
  const dome=new THREE.Mesh(new THREE.SphereGeometry(3.18,24,12,0,Math.PI*2,0,Math.PI/2),buildingMaterial);
  dome.position.y=3.15;
  observatory.add(dome);
  const slit=new THREE.Mesh(new THREE.BoxGeometry(0.21,2.6,0.12),makeMaterial('#1c2932','#59676e'));
  slit.position.set(0.5,4.0,-2.77);
  slit.rotation.x=-0.23;
  observatory.add(slit);
  const door=new THREE.Mesh(new THREE.PlaneGeometry(0.65,1.3),new THREE.MeshBasicMaterial({color:'#514633',side:THREE.DoubleSide}));
  door.position.set(-0.4,0.7,-3.01);
  observatory.add(door);
  observatory.position.copy(direction(221,0,155));
  observatory.position.y=-4.3;
  observatory.rotation.y=41*RAD;
  group.add(observatory);
  return { group, materials };
}

function makeGrid() {
  const vertices: number[]=[];
  for(const altitude of [0,15,30,45,60,75]) {
    for(let az=0;az<360;az+=2) {
      vertices.push(...direction(az,altitude,790).toArray(),...direction(az+2,altitude,790).toArray());
    }
  }
  for(let az=0;az<360;az+=30) {
    for(let alt=0;alt<90;alt+=2) vertices.push(...direction(az,alt,790).toArray(),...direction(az,alt+2,790).toArray());
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#8fa8c2',transparent:true,opacity:0.11,depthWrite:false}));
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse(object => {
    if(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials=Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material=>material.dispose());
    }
  });
}

function buildScene(host: HTMLDivElement, labelHost: HTMLDivElement, initial: SkySceneProps): SceneRuntime {
  let props=initial;
  let destroyed=false;
  let width=host.clientWidth || window.innerWidth;
  let height=host.clientHeight || window.innerHeight;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(width,height);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(initial.zoom || 70,width/height,0.1,1300);
  camera.position.set(0,0,0);
  let yaw=180, pitch=23, targetYaw=180, targetPitch=23, targetFov=initial.zoom || 70;
  let lastPropFov=targetFov;
  let labels: Label[]=[];
  let drawnObjects: SkyObject[]=[];
  const discs: THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>[]=[];
  let constellationData: ConstellationData | null=null;
  let lastObjects: SkyObject[] | null=null;
  let lastMode: string | null=null;
  let lastSelected: string | null | undefined=undefined;
  let lastTime=0;
  let lastObserver='';
  let focusNonce=-1;
  let activeFocus: SkySceneProps['focus']=null;
  let hasDragged=false;
  let lastReported=0;
  let lastReportedView: {azimuth:number;altitude:number;fov:number} | null=null;
  let selectedObject: SkyObject | undefined;
  let needsFrame=true;
  let lastFrame=performance.now();
  let animation=0;
  let clockUpdatedAt=performance.now();
  let clockDate=initial.date.getTime();
  let clockRate=initial.timeRate;
  let satelliteMotions=new Map<string,SatelliteMotion>();
  let satelliteIndices: {index:number;object:SkyObject}[]=[];
  let renderAheadMs=0;
  let overlayNight=1;
  const radiants=new Map<string,RadiantView>();
  let guideNames=new Set<string>();
  const skyQuaternion=new THREE.Quaternion();
  const rotationMatrix=new THREE.Matrix4();
  const sunDirection=new THREE.Vector3();
  const galacticPole=new THREE.Vector3();
  const galacticCore=new THREE.Vector3();
  const lookTarget=new THREE.Vector3();
  const projected=new THREE.Vector3();
  const cameraForward=new THREE.Vector3();
  const framingAltitude=(altitude:number,fov:number) => {
    if(width<=760) {
      // Reserve the lower mobile sky for the detail card. This changes the camera,
      // not celestial coordinates, and uses the exact perspective projection.
      const screenY=height>=740?0.39:0.40;
      const offset=Math.atan((1-2*screenY)*Math.tan(fov*RAD/2))/RAD;
      return clamp(altitude-offset,-20,89.9999);
    }
    const centered=clamp(altitude,-4,89.9999);
    return altitude<=40 ? THREE.MathUtils.lerp(centered,Math.min(centered,24),THREE.MathUtils.smoothstep(fov,20,50)) : centered;
  };
  const galacticDirection=(ra:number,dec:number,date:Date,observer:ObserverLocation) => {
    const point=equatorialToHorizontal(ra,dec,date,observer);
    return direction(point.azimuth,point.altitude);
  };
  const skyMaterial=new THREE.ShaderMaterial({
    vertexShader:skyVertex,fragmentShader:skyFragment,side:THREE.BackSide,depthWrite:false,
    uniforms:{uDay:{value:0},uNight:{value:1},uSun:{value:direction(220,-20)},uGalacticPole:{value:new THREE.Vector3(0,1,0)},uGalacticCore:{value:new THREE.Vector3(1,0,0)}},
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1000,48,32),skyMaterial));
  const pointMaterial=new THREE.ShaderMaterial({
    vertexShader:pointVertex,fragmentShader:pointFragment,vertexColors:true,
    transparent:true,depthWrite:false,blending:THREE.NormalBlending,
    uniforms:{uPixelRatio:{value:renderer.getPixelRatio()},uDiscScale:{value:6},uZoomScale:{value:1},uSkyRotation:{value:rotationMatrix}},
  });
  const celestial=new THREE.Points(new THREE.BufferGeometry(),pointMaterial);
  celestial.frustumCulled=false;
  scene.add(celestial);
  const discGroup=new THREE.Group();
  scene.add(discGroup);
  const constellations=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#829aae',transparent:true,opacity:0.16,depthWrite:false}));
  scene.add(constellations);
  const grid=makeGrid();
  scene.add(grid);
  const landscape=makeLandscape();
  scene.add(landscape.group);

  const selectedMarker=document.createElement('div');
  selectedMarker.className='sky-selection-marker';
  selectedMarker.setAttribute('aria-hidden','true');
  selectedMarker.innerHTML='<span class="sky-selection-ring"></span><span class="sky-selection-name"></span>';
  labelHost.appendChild(selectedMarker);
  const selectedName=selectedMarker.querySelector<HTMLElement>('.sky-selection-name')!;
  const edgeMarker=document.createElement('div');
  edgeMarker.className='sky-edge-marker';
  edgeMarker.setAttribute('aria-hidden','true');
  edgeMarker.innerHTML='<span class="sky-edge-arrow">↑</span><span class="sky-edge-name"></span>';
  labelHost.appendChild(edgeMarker);
  const edgeArrow=edgeMarker.querySelector<HTMLElement>('.sky-edge-arrow')!;
  const edgeName=edgeMarker.querySelector<HTMLElement>('.sky-edge-name')!;

  const rebuildLabels=() => {
    labels.forEach(label=>label.element.remove());
    labels=[];
    const planetLabels=drawnObjects.filter(object=>object.category!=='star');
    const starLabels=drawnObjects.filter(object=>object.category==='star' && (object.magnitude ?? 10)<1.5 && !/^(HIP|HD|HR|TYC|HYG|Star|\d)/.test(object.name)).sort((a,b)=>(a.magnitude ?? 10)-(b.magnitude ?? 10)).slice(0,18);
    for(const object of [...planetLabels,...starLabels]) {
      const element=document.createElement('button');
      element.className=`sky-object-label ${object.category==='star'?'sky-star-label':''}`;
      element.type='button';
      element.textContent=object.name;
      element.setAttribute('aria-label',`Locate ${object.name}`);
      element.addEventListener('click',()=>props.onSelect(object.id));
      labelHost.appendChild(element);
      labels.push({element,object,position:direction(object.azimuth,object.altitude,SKY_RADIUS)});
    }
    for(const [name,azimuth] of [['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315]] as const) {
      const element=document.createElement('span');
      element.className=`sky-compass-label ${name.length===1?'sky-compass-major':''}`;
      element.textContent=name;
      element.setAttribute('aria-hidden','true');
      labelHost.appendChild(element);
      labels.push({element,position:direction(azimuth,0.4,SKY_RADIUS),compass:true});
    }
  };

  const syncRadiants=(next:MeteorRadiant[]) => {
    const ids=new Set(next.map(radiant=>radiant.id));
    guideNames=new Set(next.flatMap(radiant=>radiant.guides.map(guide=>guide.name)));
    for(const [id,view] of radiants) if(!ids.has(id)) {
      view.element.remove();
      view.guides.forEach(guide=>{guide.element.remove();guide.line.remove();});
      radiants.delete(id);
    }
    for(const radiant of next) {
      let view=radiants.get(radiant.id);
      if(!view) {
        const element=document.createElement('div');
        element.className='sky-meteor';
        element.innerHTML=`<span class="sky-meteor-glow"></span><span class="sky-meteor-core"></span><span class="sky-meteor-streaks">${METEOR_STREAKS.map(([angle,offset,delay])=>`<i style="--a:${angle}deg;--o:${offset};--d:${delay}s"></i>`).join('')}</span>`;
        const label=document.createElement('button');
        label.type='button';
        label.className='sky-meteor-label';
        label.setAttribute('aria-label',`${radiant.name} meteor shower radiant`);
        label.innerHTML='<span></span><small></small>';
        label.firstElementChild!.textContent=radiant.name;
        label.addEventListener('click',()=>props.onSelectShower(radiant.id));
        element.appendChild(label);
        labelHost.appendChild(element);
        view={element,caption:label.querySelector('small')!,position:new THREE.Vector3(),guides:[],guideKey:''};
        radiants.set(radiant.id,view);
      }
      view.caption.textContent=radiant.caption;
      view.element.style.setProperty('--strength',radiant.strength.toFixed(2));
      view.element.classList.toggle('is-selected',props.selectedShowerId===radiant.id);
      view.position.copy(direction(radiant.azimuth,radiant.altitude,SKY_RADIUS));
      const guideKey=radiant.guides.map(guide=>guide.name).join('|');
      if(guideKey!==view.guideKey) {
        view.guides.forEach(guide=>{guide.element.remove();guide.line.remove();});
        view.guides=radiant.guides.map(guide=>{
          const line=document.createElement('span');
          line.className='sky-meteor-guide-line';
          const element=document.createElement('span');
          element.className='sky-meteor-guide';
          element.innerHTML='<i></i><span></span>';
          element.lastElementChild!.textContent=guide.name;
          labelHost.append(line,element);
          return {element,line,position:new THREE.Vector3()};
        });
        view.guideKey=guideKey;
      }
      radiant.guides.forEach((guide,index)=>{
        view.guides[index].position.copy(direction(guide.azimuth,guide.altitude,SKY_RADIUS));
        view.guides[index].element.classList.toggle('is-selected',props.selectedShowerId===radiant.id);
        view.guides[index].line.classList.toggle('is-selected',props.selectedShowerId===radiant.id);
      });
    }
  };

  const rebuildConstellations=() => {
    if(!constellationData) return;
    const positions: number[]=[];
    for(const feature of constellationData.features) {
      if(feature.geometry.type!=='MultiLineString') continue;
      for(const line of feature.geometry.coordinates) {
        for(let i=0;i<line.length-1;i++) {
          const a=galacticDirection(line[i][0]/15,line[i][1],props.objectsDate,props.observer);
          const b=galacticDirection(line[i+1][0]/15,line[i+1][1],props.objectsDate,props.observer);
          // Clip long lines to the mathematical horizon, avoiding underground constellations.
          if(a.y<=0 && b.y<=0) continue;
          if(a.y<0) a.lerp(b,-a.y/(b.y-a.y)).normalize();
          if(b.y<0) b.lerp(a,-b.y/(a.y-b.y)).normalize();
          positions.push(...a.multiplyScalar(805).toArray(),...b.multiplyScalar(805).toArray());
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    constellations.geometry.dispose();
    constellations.geometry=geometry;
    needsFrame=true;
  };

  const refresh=(next:SkySceneProps) => {
    const now=performance.now();
    const observerKey=`${next.observer.latitude},${next.observer.longitude},${next.observer.elevation}`;
    const dateChanged=next.date.getTime()!==clockDate;
    const rateChanged=next.timeRate!==clockRate;
    const observerChanged=observerKey!==lastObserver;
    const {sample:nextClock,continuous}=updateSkyClock({simulatedMs:clockDate,monotonicMs:clockUpdatedAt,rate:clockRate},next.date.getTime(),next.timeRate,now,observerChanged);
    if(dateChanged || rateChanged || observerChanged || next.objects!==lastObjects) {
      const interval=next.date.getTime()-clockDate;
      const motions=new Map<string,SatelliteMotion>();
      for(const object of next.objects) {
        if(object.category!=='satellite' || object.available===false) continue;
        const position=direction(object.azimuth,object.altitude,SKY_RADIUS);
        const previous=satelliteMotions.get(object.id);
        const velocity=continuous && previous ? position.clone().sub(previous.position).divideScalar(interval) : new THREE.Vector3();
        // An unrelated UI refresh does not discard the current velocity.
        if(!dateChanged && !rateChanged && !observerChanged && previous) velocity.copy(previous.velocity);
        motions.set(object.id,{position,velocity});
      }
      satelliteMotions=motions;
    }
    if(dateChanged || rateChanged || observerChanged) {
      clockUpdatedAt=nextClock.monotonicMs;
      clockDate=nextClock.simulatedMs;
      clockRate=nextClock.rate;
    }
    props=next;
    const time=props.objectsDate.getTime();
    const skyChanged=time!==lastTime || observerKey!==lastObserver;
    needsFrame=true;
    const sunAltitude=getSunAltitude(props.date,props.observer);
    const daylight=THREE.MathUtils.smoothstep(sunAltitude,-14,8);
    const night=1-THREE.MathUtils.smoothstep(sunAltitude,-18,-8);
    skyMaterial.uniforms.uDay.value=daylight;
    skyMaterial.uniforms.uNight.value=night;
    overlayNight=0.35+0.65*night;
    syncRadiants(props.meteorRadiants);
    if(skyChanged) {
      galacticPole.copy(galacticDirection(192.85948/15,27.12825,props.objectsDate,props.observer));
      galacticCore.copy(galacticDirection(266.4051/15,-28.936175,props.objectsDate,props.observer));
      const sun=props.objects.find(object=>object.id==='sun');
      if(sun) sunDirection.copy(direction(sun.azimuth,sun.altitude));
      landscape.materials.forEach(({material,night:nightColor,day})=>material.color.copy(nightColor).lerp(day,daylight));
      rebuildConstellations();
    }
    constellations.visible=props.constellations && night>0.02;
    constellations.material.opacity=0.115*night;
    grid.visible=props.grid;
    landscape.group.visible=props.landscape;
    const nextFov=clamp(props.zoom,minimumFov(props.mode),100);
    if(nextFov!==lastPropFov && activeFocus) targetPitch=framingAltitude(activeFocus.altitude,nextFov);
    targetFov=nextFov;
    lastPropFov=nextFov;
    if(props.objects!==lastObjects || props.mode!==lastMode || skyChanged) {
      const nextDrawn=props.objects.filter(object=>object.available!==false && Number.isFinite(object.altitude) && object.altitude>=0 && getVisibility(object,props.mode,sunAltitude).visible);
      const rebuild=skyChanged || props.mode!==lastMode || nextDrawn.length!==drawnObjects.length || nextDrawn.some((object,index)=>object.id!==drawnObjects[index].id || (object.category!=='satellite' && object!==drawnObjects[index]));
      drawnObjects=nextDrawn;
      satelliteIndices=drawnObjects.flatMap((object,index)=>object.category==='satellite'?[{object,index}]:[]);
      if(rebuild) {
      const positions=new Float32Array(drawnObjects.length*3);
      const colors=new Float32Array(drawnObjects.length*3);
      const sizes=new Float32Array(drawnObjects.length);
      const kinds=new Float32Array(drawnObjects.length);
      const phases=new Float32Array(drawnObjects.length);
      const fixedSky=new Float32Array(drawnObjects.length);
      const color=new THREE.Color();
      const starWhite=new THREE.Color('#ffffff');
      const planetWhite=new THREE.Color('#fff9eb');
      disposeGroup(discGroup);
      discGroup.clear();
      discs.length=0;
      drawnObjects.forEach((object,index)=>{
        direction(object.azimuth,object.altitude,SKY_RADIUS).toArray(positions,index*3);
        fixedSky[index]=object.category==='satellite'?0:1;
        color.set(object.color || '#e5eafa');
        const mag=object.magnitude ?? 7;
        if(object.category==='star') {
          const brightness=clamp(1.16-mag*0.067,0.28,1.1);
          color.lerp(starWhite,0.22).multiplyScalar(brightness);
          sizes[index]=clamp(7.0-mag*0.62,1.4,8.4);
          kinds[index]=0;
        } else {
          color.lerp(planetWhite,0.22);
          sizes[index]=clamp(10.5-mag*0.7,3,12);
          kinds[index]=1;
        }
        color.toArray(colors,index*3);
        phases[index]=object.phase ?? 1;
        const diameter=angularDiameter(object);
        if(diameter>0) {
          const material=new THREE.ShaderMaterial({vertexShader:discVertex,fragmentShader:discFragment,transparent:true,depthWrite:false,
            uniforms:{uColor:{value:new THREE.Color(object.color)},uPhase:{value:object.phase ?? 1},uKind:{value:object.id==='sun'?3:object.id==='moon'?2:1}}});
          const disc=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
          disc.position.copy(direction(object.azimuth,object.altitude,SKY_RADIUS-1));
          disc.scale.setScalar(2*Math.tan(diameter/2)*(SKY_RADIUS-1));
          discGroup.add(disc);
          discs.push(disc);
          if(object.id==='moon' || object.id==='sun') sizes[index]=0;
        }
      });
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
      geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
      geometry.setAttribute('aKind',new THREE.BufferAttribute(kinds,1));
      geometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
      geometry.setAttribute('aFixedSky',new THREE.BufferAttribute(fixedSky,1));
      celestial.geometry.dispose();
      celestial.geometry=geometry;
      rebuildLabels();
      }
    }
    if(lastSelected!==props.selectedId) {
      const selected=props.objects.find(object=>object.id===props.selectedId);
      selectedName.textContent=selected?.name ?? '';
      edgeName.textContent=selected?.name ?? '';
    }
    const selected=props.objects.find(object=>object.id===props.selectedId);
    selectedObject=selected;
    const isVisible=selected && getVisibility(selected,props.mode,sunAltitude).visible;
    selectedMarker.classList.toggle('sky-marker-predicted',Boolean(selected && !isVisible));
    selectedName.textContent=selected?`${selected.name}${isVisible?'':' · position'}`:'';
    if(props.focus && props.focus.nonce!==focusNonce) {
      focusNonce=props.focus.nonce;
      activeFocus=props.focus;
      targetYaw=yaw+angularDelta(yaw,props.focus.azimuth);
      targetPitch=framingAltitude(props.focus.altitude,targetFov);
    }
    lastObjects=props.objects;
    lastMode=props.mode;
    lastSelected=props.selectedId;
    lastTime=time;
    lastObserver=observerKey;
  };

  const apparentPosition=(object:SkyObject,target:THREE.Vector3) => {
    const motion=object.category==='satellite' ? satelliteMotions.get(object.id) : undefined;
    if(motion) return target.copy(motion.position).addScaledVector(motion.velocity,Math.min(renderAheadMs,30000)).normalize().multiplyScalar(SKY_RADIUS);
    return target.copy(direction(object.azimuth,object.altitude,SKY_RADIUS)).applyQuaternion(skyQuaternion);
  };

  const controller=new AbortController();
  fetch('/data/constellations.json',{signal:controller.signal})
    .then(response=>response.ok?response.json():null)
    .then((data:ConstellationData|null)=>{
      if(!destroyed && data?.features) { constellationData=data; rebuildConstellations(); }
    }).catch(()=>{ /* Star positions remain usable when the optional line catalog is unavailable. */ });

  const pointers=new Map<number,{x:number;y:number}>();
  let dragStart={x:0,y:0};
  let lastPointer={x:0,y:0};
  let pinchDistance=0;
  const pointerDown=(event:PointerEvent) => {
    if(event.button!==0) return;
    host.focus({preventScroll:true});
    host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    dragStart={x:event.clientX,y:event.clientY};
    lastPointer=dragStart;
    hasDragged=false;
    host.classList.add('is-dragging');
    if(pointers.size===2) {
      const [a,b]=[...pointers.values()];
      pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);
    }
  };
  const pointerMove=(event:PointerEvent) => {
    if(!pointers.has(event.pointerId)) return;
    const current={x:event.clientX,y:event.clientY};
    pointers.set(event.pointerId,current);
    if(pointers.size===2) {
      const [a,b]=[...pointers.values()];
      const distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinchDistance>0) {
        targetFov=clamp(targetFov*pinchDistance/distance,minimumFov(props.mode),100);
        props.onZoomChange(targetFov);
      }
      pinchDistance=distance;
      hasDragged=true;
    } else {
      const sensitivity=camera.fov/height;
      activeFocus=null;
      targetYaw-=(current.x-lastPointer.x)*sensitivity;
      targetPitch=clamp(targetPitch+(current.y-lastPointer.y)*sensitivity,-8,88);
      if(Math.hypot(current.x-dragStart.x,current.y-dragStart.y)>4) hasDragged=true;
    }
    lastPointer=current;
  };
  const pointerUp=(event:PointerEvent) => {
    const wasDragging=hasDragged;
    pointers.delete(event.pointerId);
    if(host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if(pointers.size===0) host.classList.remove('is-dragging');
    if(pointers.size===1) lastPointer=[...pointers.values()][0];
    if(wasDragging || event.type==='pointercancel') return;
    const rect=host.getBoundingClientRect();
    let nearest: SkyObject | undefined;
    let distance=22;
    camera.getWorldDirection(cameraForward);
    for(const object of drawnObjects) {
      apparentPosition(object,projected);
      if(projected.dot(cameraForward)<0) continue;
      projected.project(camera);
      const x=(projected.x+1)*width/2;
      const y=(1-projected.y)*height/2;
      const separation=Math.hypot(x-(event.clientX-rect.left),y-(event.clientY-rect.top));
      if(separation<distance) {distance=separation;nearest=object;}
    }
    if(nearest) props.onSelect(nearest.id);
  };
  const wheel=(event:WheelEvent) => {
    event.preventDefault();
    targetFov=clamp(targetFov*Math.exp(event.deltaY*0.002),minimumFov(props.mode),100);
    props.onZoomChange(targetFov);
  };
  const keyDown=(event:KeyboardEvent) => {
    const step=camera.fov*(event.shiftKey?0.15:0.045);
    if(event.key.startsWith('Arrow') || event.key==='Home') activeFocus=null;
    if(event.key==='ArrowLeft') targetYaw-=step;
    else if(event.key==='ArrowRight') targetYaw+=step;
    else if(event.key==='ArrowUp') targetPitch=clamp(targetPitch+step,-8,88);
    else if(event.key==='ArrowDown') targetPitch=clamp(targetPitch-step,-8,88);
    else if(event.key==='+' || event.key==='=') {targetFov=clamp(targetFov*0.72,minimumFov(props.mode),100);props.onZoomChange(targetFov);}
    else if(event.key==='-' || event.key==='_') {targetFov=clamp(targetFov/0.72,minimumFov(props.mode),100);props.onZoomChange(targetFov);}
    else if(event.key==='Home') {targetYaw=yaw+angularDelta(yaw,180);targetPitch=23;targetFov=70;props.onZoomChange(70);}
    else return;
    event.preventDefault();
  };
  host.addEventListener('pointerdown',pointerDown);
  host.addEventListener('pointermove',pointerMove);
  host.addEventListener('pointerup',pointerUp);
  host.addEventListener('pointercancel',pointerUp);
  host.addEventListener('wheel',wheel,{passive:false});
  host.addEventListener('keydown',keyDown);

  const resize=new ResizeObserver(()=>{
    width=host.clientWidth;
    height=host.clientHeight;
    if(!width || !height) return;
    renderer.setSize(width,height);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    if(activeFocus) targetPitch=framingAltitude(activeFocus.altitude,targetFov);
    needsFrame=true;
  });
  resize.observe(host);

  const animate=(now:number) => {
    if(destroyed) return;
    animation=requestAnimationFrame(animate);
    const elapsed=Math.min((now-lastFrame)/1000,0.1);
    lastFrame=now;
    const moving=Math.abs(targetYaw-yaw)>0.00001 || Math.abs(targetPitch-pitch)>0.00001 || Math.abs(camera.fov-targetFov)>0.0001;
    if(!moving && !needsFrame && props.timeRate===0) return;
    needsFrame=false;
    // Advance the sampled sky at frame rate without recalculating the star catalog.
    // Satellite velocity uses recent samples and remains separate from Earth rotation.
    renderAheadMs=props.timeRate>0 ? Math.min(Math.max(now-clockUpdatedAt,0),500)*props.timeRate : 0;
    skyRotation(props.observer.latitude,clockDate+renderAheadMs-props.objectsDate.getTime(),skyQuaternion);
    rotationMatrix.makeRotationFromQuaternion(skyQuaternion);
    discGroup.quaternion.copy(skyQuaternion);
    constellations.quaternion.copy(skyQuaternion);
    skyMaterial.uniforms.uGalacticPole.value.copy(galacticPole).applyQuaternion(skyQuaternion);
    skyMaterial.uniforms.uGalacticCore.value.copy(galacticCore).applyQuaternion(skyQuaternion);
    skyMaterial.uniforms.uSun.value.copy(sunDirection).applyQuaternion(skyQuaternion);
    const positions=celestial.geometry.getAttribute('position') as THREE.BufferAttribute;
    for(const {object,index} of satelliteIndices) {
      apparentPosition(object,projected);
      positions.setXYZ(index,projected.x,projected.y,projected.z);
    }
    if(satelliteIndices.length) {
      const first=satelliteIndices[0].index;
      const last=satelliteIndices[satelliteIndices.length-1].index;
      positions.clearUpdateRanges();
      positions.addUpdateRange(first*3,(last-first+1)*3);
      positions.needsUpdate=true;
    }
    const ease=1-Math.exp(-8*elapsed);
    yaw+=(targetYaw-yaw)*ease;
    pitch+=(targetPitch-pitch)*ease;
    if(Math.abs(camera.fov-targetFov)>0.0001) {
      camera.fov+=(targetFov-camera.fov)*ease;
      camera.updateProjectionMatrix();
    }
    lookTarget.copy(direction(yaw,pitch));
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld();
    pointMaterial.uniforms.uDiscScale.value=height*Math.tan(0.52*RAD/2)/Math.tan(camera.fov*RAD/2);
    pointMaterial.uniforms.uZoomScale.value=Math.min(1.5,Math.pow(70/camera.fov,0.18));
    const inverseSky=skyQuaternion.clone().invert();
    discs.forEach(disc=>disc.quaternion.copy(inverseSky).multiply(camera.quaternion));
    renderer.render(scene,camera);
    camera.getWorldDirection(cameraForward);
    const occupied: {x:number;y:number}[]=[];
    for(const label of labels) {
      if(label.object) apparentPosition(label.object,projected);
      else projected.copy(label.position);
      const inFront=projected.dot(cameraForward)>0 && (!label.object || projected.y>=0);
      projected.project(camera);
      const x=(projected.x+1)*width/2;
      const y=(1-projected.y)*height/2;
      let shown=inFront && projected.z<=1 && x>18 && x<width-18 && y>20 && y<height-28;
      if(label.object?.id===props.selectedId || (label.object && guideNames.has(label.object.name))) shown=false;
      if(shown && !label.compass) {
        if(occupied.some(point=>Math.abs(point.x-x)<95 && Math.abs(point.y-y)<28)) shown=false;
        else occupied.push({x,y});
      }
      label.element.style.display=shown?'':'none';
      if(shown) label.element.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    }
    const pixelsPerRadian=(height/2)/Math.tan(camera.fov*RAD/2);
    const radius=clamp(pixelsPerRadian*Math.tan(RADIANT_RADIUS*RAD),34,Math.max(width,height)*0.6);
    const screenPoint=(position:THREE.Vector3) => {
      projected.copy(position).applyQuaternion(skyQuaternion);
      const altitude=Math.asin(clamp(projected.y/SKY_RADIUS,-1,1))/RAD;
      const inFront=projected.dot(cameraForward)>0;
      projected.project(camera);
      return {x:(projected.x+1)*width/2,y:(1-projected.y)*height/2,altitude,inFront};
    };
    for(const view of radiants.values()) {
      const center=screenPoint(view.position);
      const shown=center.inFront && center.altitude>-2 && center.x>-radius && center.x<width+radius && center.y>-radius && center.y<height+radius;
      view.element.style.display=shown?'':'none';
      if(shown) {
        view.element.style.transform=`translate3d(${center.x.toFixed(1)}px,${center.y.toFixed(1)}px,0)`;
        view.element.style.setProperty('--r',`${radius.toFixed(1)}px`);
        view.element.style.setProperty('--night',(overlayNight*clamp((center.altitude+2)/10,0,1)).toFixed(2));
      }
      for(const guide of view.guides) {
        const point=screenPoint(guide.position);
        const guideShown=shown && point.inFront && point.altitude>0 && point.x>18 && point.x<width-18 && point.y>20 && point.y<height-28;
        guide.element.style.display=guideShown?'':'none';
        guide.line.style.display=guideShown?'':'none';
        if(!guideShown) continue;
        guide.element.style.transform=`translate3d(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px,0)`;
        const dx=center.x-point.x, dy=center.y-point.y, length=Math.hypot(dx,dy);
        // Keep a nearby guide's name clear of the radiant label, which sits to the radiant's right.
        guide.element.classList.toggle('is-left',dx>0 && length<170);
        const visibleLength=Math.max(0,length-24);
        guide.line.style.width=`${visibleLength.toFixed(1)}px`;
        guide.line.style.transform=`translate3d(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px,0) rotate(${Math.atan2(dy,dx).toFixed(4)}rad) translateX(10px)`;
      }
    }
    const selected=selectedObject;
    if(selected && selected.available!==false && Number.isFinite(selected.altitude) && selected.altitude>=0) {
      const position=apparentPosition(selected,new THREE.Vector3());
      const inFront=position.dot(cameraForward)>0;
      projected.copy(position).project(camera);
      const x=(projected.x+1)*width/2;
      const y=(1-projected.y)*height/2;
      const onScreen=inFront && x>30 && x<width-30 && y>30 && y<height-30;
      selectedMarker.style.display=onScreen?'':'none';
      edgeMarker.style.display=onScreen?'none':'';
      if(onScreen) selectedMarker.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      else {
        const apparentAzimuth=normalized(Math.atan2(position.x,-position.z)/RAD);
        const apparentAltitude=Math.asin(clamp(position.y/SKY_RADIUS,-1,1))/RAD;
        const deltaYaw=angularDelta(yaw,apparentAzimuth);
        let dx=deltaYaw/Math.max(camera.fov*camera.aspect,1);
        let dy=(pitch-apparentAltitude)/Math.max(camera.fov,1);
        if(Math.abs(dx)+Math.abs(dy)<0.001) dx=1;
        const scale=0.42/Math.max(Math.abs(dx),Math.abs(dy));
        dx*=scale;dy*=scale;
        edgeMarker.style.transform=`translate3d(${(width*(0.5+dx)).toFixed(1)}px,${(height*(0.5+dy)).toFixed(1)}px,0)`;
        edgeArrow.style.transform=`rotate(${Math.atan2(dx,-dy)/RAD}deg)`;
      }
    } else {
      selectedMarker.style.display='none';
      edgeMarker.style.display='none';
    }
    if(now-lastReported>220) {
      const view={azimuth:normalized(yaw),altitude:pitch,fov:camera.fov};
      if(!lastReportedView || Math.abs(angularDelta(lastReportedView.azimuth,view.azimuth))>0.05 || Math.abs(lastReportedView.altitude-view.altitude)>0.05 || Math.abs(lastReportedView.fov-view.fov)>Math.min(0.05,view.fov*0.01)) {
        props.onViewChange?.(view);
        lastReportedView=view;
      }
      lastReported=now;
    }
  };
  refresh(initial);
  animation=requestAnimationFrame(animate);

  return {
    refresh,
    destroy:()=>{
      destroyed=true;
      controller.abort();
      cancelAnimationFrame(animation);
      resize.disconnect();
      host.removeEventListener('pointerdown',pointerDown);
      host.removeEventListener('pointermove',pointerMove);
      host.removeEventListener('pointerup',pointerUp);
      host.removeEventListener('pointercancel',pointerUp);
      host.removeEventListener('wheel',wheel);
      host.removeEventListener('keydown',keyDown);
      disposeGroup(scene);
      renderer.dispose();
      renderer.domElement.remove();
      labelHost.replaceChildren();
    },
  };
}

export default function SkyScene(props: SkySceneProps) {
  const host=useRef<HTMLDivElement>(null);
  const labels=useRef<HTMLDivElement>(null);
  const runtime=useRef<SceneRuntime|null>(null);
  const latest=useRef(props);
  latest.current=props;
  const [failed,setFailed]=useState(false);

  useEffect(()=>{
    if(!host.current || !labels.current) return;
    try { runtime.current=buildScene(host.current,labels.current,latest.current); }
    catch(error) { console.error('The sky renderer could not start.',error);setFailed(true); }
    return ()=>{runtime.current?.destroy();runtime.current=null;};
  },[]);

  useEffect(()=>{ runtime.current?.refresh(props); });

  return <div className="sky-scene" aria-label="Interactive sky map">
    <div ref={host} className="sky-canvas-host" tabIndex={0} role="application" aria-label="3D sky. Drag to look around, scroll to zoom. Arrow keys move; plus and minus zoom; Home faces south." />
    <div ref={labels} className="sky-label-layer" />
    <div className="sky-optical-vignette" />
    {failed && <div className="sky-webgl-fallback" role="status"><span className="sky-fallback-star">✧</span><h2>Your sky is still here.</h2><p>The 3D view needs WebGL. Enable hardware acceleration in your browser to explore it.</p><p>Object positions and rise times remain available in the explorer.</p></div>}
  </div>;
}
