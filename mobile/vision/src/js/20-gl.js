/* Hand-written WebGL2 renderer: ray-traced planet + single-scatter atmosphere, sprites, trails,
   lines, meshes (city/terrain/water) and a mobile post chain (half-res dual-Kawase bloom, FXAA-lite,
   ACES, grade, vignette, grain) with lens modes (cinematic / clear / night / thermal / NVG). */
const GL = (GE.GL = {});

const GLSL_COMMON = `
const float PI = 3.14159265;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5;} return s; }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.-2.*f);
  float a=hash13(i), b=hash13(i+vec3(1,0,0)), c=hash13(i+vec3(0,1,0)), d=hash13(i+vec3(1,1,0));
  float e=hash13(i+vec3(0,0,1)), g=hash13(i+vec3(1,0,1)), h=hash13(i+vec3(0,1,1)), k=hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y), mix(mix(e,g,u.x),mix(h,k,u.x),u.y), u.z); }
float fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p=p*2.02+vec3(3.1,1.7,5.3); a*=.5;} return s; }
`;

const GLSL_ATMO = `
const float HR = 0.0021, HM = 0.0006, RA = 1.0165;
const vec3 BR = vec3(22.1, 51.5, 126.3);
const vec3 BM = vec3(16.0);
uniform vec3 uSun;
uniform float uSunI;
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b=dot(ro,rd); float c=dot(ro,ro)-r*r; float d=b*b-c; if(d<0.) return vec2(1e9,-1e9); d=sqrt(d); return vec2(-b-d,-b+d); }
// optical depth (length units) of exp(-(r-1)/H) from radius r along zenith-cosine mu to infinity
float odH(float r, float mu, float H){
  float c = sqrt(PI*0.5*r/H); float h=(r-1.)/H;
  if (mu >= 0.) return H*exp(-h)*c/(c*mu+1.);
  float r0 = r*sqrt(max(0.,1.-mu*mu));
  if (r0 < 1.0) return 1e4;
  float h0 = (r0-1.)/H; float c0 = sqrt(PI*0.5*r0/H);
  return H*(2.*exp(-h0)*c0 - exp(-h)*c/(-c*mu+1.));
}
vec3 sunTrans(vec3 x){ float r=length(x); float mu=dot(x,uSun)/r; return exp(-(BR*odH(r,mu,HR)+BM*1.11*odH(r,mu,HM))); }
vec3 atmo(vec3 ro, vec3 rd, float tEnd, float inside, int steps, out vec3 T){
  vec2 ta = raySphere(ro, rd, RA);
  float t0 = max(ta.x, 0.), t1 = min(ta.y, tEnd);
  T = vec3(1.);
  if (t1 <= t0) return vec3(0.);
  float mu = dot(rd, uSun);
  float pR = 3./(16.*PI)*(1.+mu*mu);
  const float g = 0.76;
  float pM = 3./(8.*PI)*((1.-g*g)*(1.+mu*mu))/((2.+g*g)*pow(max(1.+g*g-2.*g*mu,1e-4),1.5));
  vec3 sR=vec3(0.), sM=vec3(0.); float oR=0., oM=0.; float L=t1-t0;
  float N = float(steps);
  for (int i=0;i<24;i++){
    if (i>=steps) break;
    float fa = float(i)/N, fb = float(i+1)/N;
    float ta0 = mix(fa, fa*fa, inside), tb0 = mix(fb, fb*fb, inside);
    float ds = (tb0-ta0)*L; float t = t0 + (ta0+tb0)*0.5*L;
    vec3 x = ro + rd*t; float r = length(x); float h=r-1.;
    float dR = exp(-h/HR), dM = exp(-h/HM);
    oR += dR*ds; oM += dM*ds;
    float muS = dot(x,uSun)/r;
    vec3 tau = BR*(oR+odH(r,muS,HR)) + BM*1.11*(oM+odH(r,muS,HM));
    vec3 att = exp(-tau);
    sR += dR*att*ds; sM += dM*att*ds;
  }
  T = exp(-(BR*oR + BM*1.11*oM));
  return uSunI*(sR*BR*pR + sM*BM*pM);
}
`;

const SRC = {};
SRC.fsq_vs = `#version 300 es
out vec2 vUv; out vec2 vNdc;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv=p; vNdc=p*2.-1.; gl_Position=vec4(p*2.-1.,0.,1.); }`;

SRC.globe_fs = `#version 300 es
precision highp float;
in vec2 vNdc; out vec4 frag;
${GLSL_COMMON}
${GLSL_ATMO}
uniform vec3 uCamR, uCamU, uCamB; uniform vec4 uTanS; uniform vec3 uEye; uniform float uEyeC; uniform float uT; uniform float uGmst;
uniform sampler2D uDay, uNight, uClouds, uWater, uTopo;
uniform vec4 uLens;     // x mode, y night force, z cloud amount, w graticule
uniform vec4 uCyc;      // xyz center, w radius (rad)
uniform vec4 uCycP;     // x intensity, y spin, z eye radius
uniform float uAurora;
uniform mat3 uEnu; uniform vec3 uEyeLocal; uniform vec4 uCity; // x detail, y block m, z rot, w urban boost
uniform float uRange; uniform int uSteps; uniform float uInside;
uniform vec4 uFocus;    // xyz focus dir, w strength (dim surroundings)
uniform vec4 uLocalWater; // xy normal, z offset (m), w enabled
uniform float uTraffic;
vec2 uvOf(vec3 n){ return vec2(atan(n.y,n.x)/(2.*PI)+0.5, 0.5-asin(clamp(n.z,-1.,1.))/PI); }
vec4 tex2(sampler2D s, vec2 uv){
  vec2 u2 = vec2(fract(uv.x+0.5)-0.5, uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(u2), dy2 = dFdy(u2);
  if (abs(dx2.x)+abs(dy2.x) < abs(dx.x)+abs(dy.x)) { dx = dx2; dy = dy2; }
  return textureGrad(s, uv, dx, dy);
}
vec3 stars(vec3 d){
  float c = cos(uGmst), s = sin(uGmst);
  d = vec3(c*d.x - s*d.y, s*d.x + c*d.y, d.z);
  vec3 col = vec3(0.);
  for (int L=0; L<3; L++){
    float sc = 60. + float(L)*70.;
    vec3 a = abs(d); vec2 uv; float face;
    if (a.x>a.y && a.x>a.z){ uv=d.yz/a.x; face=sign(d.x); }
    else if (a.y>a.z){ uv=d.xz/a.y; face=2.+sign(d.y); }
    else { uv=d.xy/a.z; face=4.+sign(d.z); }
    vec2 g = uv*sc; vec2 id = floor(g); vec2 f = fract(g)-0.5;
    vec2 rnd = hash22(id+face*17.+float(L)*31.);
    float b = pow(rnd.x, 70.) * (L==0 ? 1.4 : 0.8);
    vec2 off = (hash22(id*1.7+face)-0.5)*0.7;
    float dd = length(f-off);
    float w = fwidth(g.x)*0.9+0.02;
    col += b * smoothstep(w*1.25, 0., dd) * mix(vec3(1.,.84,.7), vec3(.75,.85,1.), rnd.y) * 4.;
  }
  // milky way band (galactic north pole RA 192.86°, Dec 27.13°)
  vec3 gnp = vec3(-0.8676, -0.1981, 0.4560);
  float gb = dot(d, gnp);
  float band = exp(-gb*gb*14.);
  float n = fbm3(d*6.)*0.7 + fbm3(d*17.)*0.3;
  col += band * smoothstep(0.35, 0.85, n) * vec3(0.10, 0.11, 0.15) * 0.9;
  col += band * vec3(0.012,0.013,0.02);
  return col;
}
float cycloneDensity(vec3 n){
  if (uCycP.x <= 0.) return 0.;
  float cd = dot(n, uCyc.xyz); if (cd < 0.985) return 0.;
  float d = acos(clamp(cd,-1.,1.));
  vec3 e1 = normalize(cross(vec3(0,0,1), uCyc.xyz)); vec3 e2 = cross(uCyc.xyz, e1);
  vec3 v = n - uCyc.xyz*cd; float th = atan(dot(v,e2), dot(v,e1));
  float x = d/uCyc.w;
  float sw = 2.*th + 5.2*log(max(x,0.03)) - uCycP.y;
  float arms = pow(0.5 + 0.5*sin(sw), 2.4);
  float tex = fbm(vec2(cos(th), sin(th))*x*9. + vec2(3.*log(x+0.05) - uCycP.y*0.2, uCycP.y*0.05));
  float dens = smoothstep(1.25, 0.28, x) * (0.12 + 0.88*arms) * (0.35 + 0.9*tex);
  float cdo = smoothstep(0.26, 0.08, x) * (0.75 + 0.25*tex);
  dens = max(dens, cdo);
  float eye = smoothstep(uCycP.z*0.8, uCycP.z*1.6, d) * (1. + 0.25*smoothstep(uCycP.z*2.6, uCycP.z*1.6, d));
  return clamp(dens*1.15, 0., 1.) * eye * uCycP.x;
}
vec3 aurora(vec3 n, float nightF){
  if (uAurora <= 0.) return vec3(0.);
  vec3 mp = vec3(0.0484, -0.1559, 0.9866);
  float s = dot(n, mp); float hemi = sign(s);
  float ml = asin(abs(s)) * 57.2958;
  float band = 66.5 - uAurora*5.5;
  float lonm = atan(dot(n, normalize(cross(mp, vec3(0,0,1)))), dot(n, normalize(cross(mp, cross(mp, vec3(0,0,1))))));
  float curt = 0.25 + 0.75*fbm(vec2(lonm*14. + uT*0.0006, uT*0.00025 + ml*0.15));
  float g = exp(-pow((ml-band)/(0.7+uAurora*0.25), 2.)) * curt * curt * 0.6;
  float r = exp(-pow((ml-band-2.5)/2.0, 2.)) * 0.08 * curt;
  return (vec3(0.12, 1.0, 0.5)*g + vec3(0.75, 0.15, 0.45)*r*0.45) * nightF * uAurora * 0.75;
}
vec3 cityDetail(vec3 base, vec2 q, float urban, float night, float fw, out vec3 emis){
  emis = vec3(0.);
  float rot = uCity.z; mat2 m = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
  vec2 p = m*q; float B = uCity.y;
  vec2 g = p/B; vec2 id = floor(g); vec2 f = fract(g);
  float big = step(0.8, hash12(floor(id/5.)+3.));
  float rw = 0.085 + 0.05*step(4.5, mod(id.x,5.)) ;
  vec2 e = min(f, 1.-f);
  float road = 1. - smoothstep(rw*0.75, rw, min(e.x, e.y));
  float aa = clamp(fw/B*4., 0., 1.);
  road = mix(road, 0.18, aa);
  float h = hash12(id);
  vec3 roof = mix(vec3(0.20,0.20,0.21), vec3(0.42,0.38,0.33), h);
  roof = mix(roof, vec3(0.30,0.36,0.26), step(0.86, h)); // parks
  float lot = vnoise(p*0.11)*0.12;
  vec3 urb = mix(roof*(0.9+lot), vec3(0.075,0.078,0.085), road);
  // rural: patchwork fields & forest
  vec2 fid = floor(p/(B*2.6)); float fh = mix(hash12(fid+7.), 0.5, clamp(fw/(B*2.6)*1.6, 0., 1.));
  vec3 field = base * mix(vec3(0.94,1.02,0.9), vec3(1.12,1.06,0.86), fh) * (0.92+0.16*vnoise(p*0.02));
  float forest = smoothstep(0.5,0.66, fbm(p*0.0011+3.));
  field = mix(field, base*vec3(0.78,0.88,0.74), forest*0.6);
  vec3 col = mix(field, urb, urban);
  // street lights at night along roads
  float emin = min(e.x, e.y);
  float curb = smoothstep(rw*0.55, rw*0.8, emin) * (1. - smoothstep(rw*0.8, rw*0.98, emin));
  float along2 = (e.x < e.y) ? g.y : g.x;
  float dotsL = smoothstep(0.75, 0.95, fract(along2*B/28.));
  float lamps = mix(curb*(0.25 + dotsL*1.6), 0.07, aa) * urban;
  emis = vec3(1.0,0.56,0.22)*lamps*night*1.0;
  if (uTraffic > 0.5) {
    vec2 rp = p/B; float along = abs(f.x-0.5) < abs(f.y-0.5) ? rp.y : rp.x;
    float cars = smoothstep(0.75, 1., sin(along*38. - uT*2.5 + h*20.)) * road * urban * (1.-aa);
    emis += mix(vec3(1.,0.15,0.1), vec3(1.,0.95,0.8), step(0.5, fract(along*3.)))*cars*(0.03 + night*1.2);
  }
  float lit = step(0.72, hash12(id*3.1)) * (1.-road) * urban * night;
  emis += vec3(0.9,0.8,0.6)*lit*0.035;
  return col;
}
void main(){
  vec3 rd = normalize(uCamR*(vNdc.x - uTanS.z)*uTanS.x + uCamU*(vNdc.y - uTanS.w)*uTanS.y - uCamB);
  vec3 ro = uEye;
  float b = dot(ro, rd);
  float disc = b*b - uEyeC;
  int mode = int(uLens.x+0.5);
  float clear = mode==1 ? 1. : 0.;
  vec3 col; float heat = 0.;
  vec3 T; vec3 ins;
  float nightForce = uLens.y;
  if (disc > 0. && b < 0.) {
    float t = uEyeC / (-b + sqrt(disc));
    vec3 p = ro + rd*t; vec3 n = normalize(p);
    vec2 uv = uvOf(n);
    vec3 day = pow(tex2(uDay, uv).rgb, vec3(2.2));
    vec3 nightTex = tex2(uNight, uv).rgb;
    float water = tex2(uWater, uv).r;
    float muS = dot(n, uSun);
    // relief from topography
    vec2 tx = vec2(1./2048., 1./1024.);
    float h0 = texture(uTopo, uv).r;
    float hx = texture(uTopo, uv+vec2(tx.x,0.)).r - texture(uTopo, uv-vec2(tx.x,0.)).r;
    float hy = texture(uTopo, uv-vec2(0.,tx.y)).r - texture(uTopo, uv+vec2(0.,tx.y)).r;
    vec3 east = normalize(vec3(-n.y, n.x, 0.)+1e-6); vec3 north = cross(n, east);
    float bumpK = 2.2 * (1.-water);
    vec3 nb = normalize(n - (east*hx + north*hy)*bumpK/ max(cos(asin(n.z)),0.2) * 0.6);
    float lights = max(0., (nightTex.g*1.1 - nightTex.b*0.55));
    lights = pow(lights, 1.7) * 2.6;
    float urban = smoothstep(0.03, 0.25, lights) + uCity.w;
    // low-altitude synthetic ground detail
    vec3 emisD = vec3(0.);
    float nightF = 1. - smoothstep(-0.16, 0.06, muS);
    nightF = max(nightF, nightForce);
    if (uCity.x > 0.001) {
      vec3 rdl = transpose(uEnu) * rd; vec2 q = (uEyeLocal + rdl * (t*6371000.)).xy;
      if (uLocalWater.w > 0.) { float lw = smoothstep(uLocalWater.z-25., uLocalWater.z+25., dot(q, uLocalWater.xy)); water = max(water, lw*uCity.x); day = mix(day, vec3(0.012,0.03,0.045), lw*uCity.x); }
      float fw = length(fwidth(q));
      vec3 dcol = cityDetail(day, q, clamp(urban,0.,1.)*(1.-water), nightF, fw, emisD);
      float fade = uCity.x * (1.-smoothstep(150., 900., fw)) * (1.-water*0.9);
      day = mix(day, dcol, fade); emisD *= fade;
    }
    // clouds (+ cyclone)
    vec2 cuv = uv + vec2(uT*1.2e-7, 0.);
    vec3 wp = n*5. + vec3(uT*2e-6);
    cuv += (vec2(fbm3(wp), fbm3(wp+7.3))-0.5)*0.012;
    float cl = tex2(uClouds, cuv).r;
    float dK = smoothstep(1.2, 0.08, uRange);
    float base0 = smoothstep(0.1, 0.9, cl);
    if (dK > 0.) {
      vec3 q3 = n*420. + vec3(uT*1.5e-5, 0., uT*1e-5);
      float n1 = fbm3(q3), n2 = fbm3(q3*4.1 + 7.);
      float cells = smoothstep(0.62 - cl*0.55, 0.92 - cl*0.35, n1*0.62 + n2*0.38 + cl*0.18);
      cl = mix(base0, cells * smoothstep(0.03, 0.3, cl), dK);
    } else cl = base0;
    cl *= 0.94;
    cl = max(cl, cycloneDensity(n));
    float cloudFade = smoothstep(0.0012, 0.006, uRange);
    cl *= uLens.z * cloudFade * (1.-clear);
    vec3 st = sunTrans(p*1.0005);
    float shade = mix(1.0, 1.0-0.55*tex2(uClouds, cuv - vec2(uSun.y, -uSun.z)*0.0015).r*uLens.z*cloudFade, step(0.,muS));
    float diff = max(dot(nb, uSun), 0.);
    vec3 skyAmb = vec3(0.022,0.036,0.07)*smoothstep(-0.25,0.5,muS);
    vec3 irr = uSunI*(st*diff*shade + skyAmb);
    if (clear > 0.5) irr = vec3(uSunI*0.32);
    irr *= (1.-nightForce*0.97);
    irr += vec3(0.05,0.07,0.13)*nightF*(1.-clear);
    vec3 alb = day;
    vec3 surf = alb * irr / PI;
    // ocean specular
    if (water > 0.01) {
      vec3 v = -rd;
      vec3 nw = n;
      if (uRange < 0.05) { vec2 wq = uv*vec2(4000.,2000.)+uT*0.02; nw = normalize(n + (east*(vnoise(wq)-.5) + north*(vnoise(wq.yx+3.)-.5))*0.04); }
      vec3 hv = normalize(v + uSun);
      float nh = max(dot(nw, hv), 0.);
      float rough = 0.18;
      float a2 = rough*rough; float dd = nh*nh*(a2-1.)+1.; float D = a2/(PI*dd*dd);
      float F = 0.02 + 0.98*pow(1.-max(dot(v,hv),0.), 5.);
      vec3 spec = uSunI * st * D * F * max(dot(nw,uSun),0.) * 0.25;
      float fres = 0.02 + 0.98*pow(1.-max(dot(nw,v),0.), 5.);
      vec3 skyR = vec3(0.12,0.22,0.45)*uSunI*0.05*smoothstep(-0.2,0.4,muS);
      surf += (spec*(1.-clear) + skyR*fres) * water * (1.-cl);
    }
    // night lights + moonlit black-marble land
    vec3 lightCol = mix(vec3(1.0,0.66,0.32), vec3(1.0,0.86,0.64), smoothstep(0.4,1.4,lights));
    vec3 emis = lightCol * lights * 3.2 * nightF * (1. - uCity.x*0.995);
    emis += pow(nightTex, vec3(2.2)) * vec3(0.5,0.6,1.0) * 0.12 * nightF;
    emis += emisD;
    emis *= (1.-cl*0.82);
    // clouds lit
    vec3 cirr = uSunI*(st*(0.25+0.75*max(dot(n,uSun)*0.9+0.1,0.)) + skyAmb*2.);
    if (clear > 0.5) cirr = vec3(uSunI*0.3);
    vec3 ccol = vec3(0.78) * cirr/PI + vec3(0.008,0.01,0.018)*nightF + lightCol*lights*0.25*nightF;
    surf = mix(surf, ccol, cl);
    surf += emis;
    surf += aurora(n, nightF);
    // graticule (clear lens)
    if (uLens.w > 0.) {
      vec2 ll = vec2(atan(n.y,n.x), asin(n.z))*57.2958/15.;
      vec2 gg = abs(fract(ll+0.5)-0.5)/fwidth(ll);
      float lineG = 1.-min(min(gg.x,gg.y),1.);
      surf += vec3(0.35,0.5,0.7)*lineG*0.35*uLens.w;
    }
    // focus: gently dim surroundings of a situation
    if (uFocus.w > 0.) { float fd = acos(clamp(dot(n, uFocus.xyz),-1.,1.)); surf *= mix(1., 0.55, uFocus.w*smoothstep(0.08, 0.5, fd)); }
    ins = atmo(ro, rd, t, uInside, uSteps, T);
    if (clear > 0.5) { ins *= 0.35; T = mix(T, vec3(1.), 0.6); }
    col = surf*T + ins;
    // heat: land warm by day, cities warm, ocean cool, clouds cold
    heat = mix(0.32 + 0.38*diff*(1.-nightForce), 0.2 - 0.12*abs(n.z), water) + 0.25*clamp(lights,0.,1.);
    heat = mix(heat, 0.06, cl);
  } else {
    // sky / space
    ins = atmo(ro, rd, 1e9, uInside, uSteps, T);
    vec3 sp = stars(rd) * (1.-clear*0.6);
    float sd = dot(rd, uSun);
    vec3 sun = vec3(1.,0.96,0.9) * (smoothstep(0.99996, 0.99999, sd)*400. + pow(max(sd,0.),900.)*3. + pow(max(sd,0.),40.)*0.08) * (1.-clear);
    col = (sp + sun)*T + ins;
    // aurora curtains at the limb
    float tc = -b; vec3 cp = ro + rd*max(tc,0.); float hr = length(cp);
    if (uAurora > 0. && hr > 1.004 && hr < 1.05) {
      vec3 cn = normalize(cp); float nf = 1.-smoothstep(-0.2,0.0,dot(cn,uSun));
      col += aurora(cn, nf) * smoothstep(1.05,1.012,hr) * smoothstep(1.004,1.012,hr) * 0.12 * smoothstep(1.5, 0.4, uRange);
    }
    heat = 0.;
  }
  frag = vec4(col, heat);
}`;

/* ---------- sprites ---------- */
const SPRITE_VS_HEAD = `#version 300 es
precision highp float;
uniform mat4 uVP; uniform vec3 uEyeH, uEyeL; uniform float uEyeC; uniform float uOccR;
uniform float uPx; uniform float uT; uniform float uAltX; uniform float uSizeK; uniform float uGmst; uniform vec2 uView;
uniform float uMinSize; uniform float uAlphaK; uniform vec3 uSun;
out vec4 vCol; out float vGlyph; out float vAng; out float vSize; out float vSeed; out float vHeat;
float occluded(vec3 p){
  vec3 E = uEyeH + uEyeL; vec3 d = p - E; float L = length(d); vec3 u = d/L;
  float b = dot(E,u); float c = uEyeC + 1. - uOccR*uOccR; float disc = b*b - c;
  if (disc <= 0.) return 0.;
  float tn = -b - sqrt(disc);
  return (tn > 0. && tn < L) ? 1. : 0.;
}
vec4 project(vec3 p){ vec3 rel = (p - uEyeH) - uEyeL; vec4 c = uVP*vec4(rel,1.); if (c.z > c.w) c.z = c.w*0.99999; return c; }
float screenAngle(vec3 p, vec3 dir, vec4 c0){
  vec3 rel = (p - uEyeH) - uEyeL; float s = length(rel)*0.01 + 1e-7;
  vec4 c1 = uVP*vec4(rel + dir*s, 1.);
  vec2 a = c0.xy/c0.w, bb = c1.xy/c1.w;
  return atan((bb.y-a.y)*uView.y, (bb.x-a.x)*uView.x);
}
vec3 headingDir(vec3 p, float hdg){ vec3 up = normalize(p); vec3 e = normalize(vec3(-up.y, up.x, 0.)+1e-7); vec3 nn = cross(up, e); return nn*cos(hdg) + e*sin(hdg); }
`;
SRC.sprite_vs = SPRITE_VS_HEAD + `
in vec3 aPos; in vec4 aCol; in vec4 aPar; // size, glyph, heading, t0 (seconds; visible after)
in vec4 aExt; // x: tEnd, y: grow, z: seed, w: heat
void main(){
  vec3 p = aPos;
  float vis = step(aPar.w, uT) * step(uT, aExt.x);
  vec4 c = project(p);
  float occ = occluded(p);
  gl_Position = c;
  float age = uT - aPar.w;
  float grow = 1. + aExt.y * clamp(age/86400., 0., 2.);
  float sz = max(aPar.x * uSizeK * grow, uMinSize);
  gl_PointSize = vis * (1.-occ) * sz * uPx;
  vCol = aCol; vCol.a *= uAlphaK; vGlyph = aPar.y; vSize = sz*uPx; vSeed = aExt.z + age*0.0;
  vAng = aPar.z > -9. ? screenAngle(p, headingDir(p, aPar.z), c) : 0.;
  vHeat = aExt.w;
  if (aPar.y > 1.5 && aPar.y < 2.5) vSeed = age; // quake ring: pass age
}`;
SRC.flight_vs = SPRITE_VS_HEAD + `
in vec3 aA; in vec3 aB; in vec4 aTime; in vec4 aMeta; // t0,dur,period,_ ; altKm, kind, seed, dKm
uniform float uTrail; uniform float uTrailLen; in float aK;
uniform vec4 uKindMask; uniform float uSelId; uniform vec4 uKindSize;
out float vK;
vec3 flightPos(float t, out float vis, out vec3 dir){
  float ph = mod(t - aTime.x, aTime.z);
  float hf = aTime.z*0.5; float leg = step(hf, ph); float lp = ph - leg*hf;
  vis = step(lp, aTime.y) * step(0., lp);
  float pr = clamp(lp/aTime.y, 0., 1.);
  vec3 A = mix(aA, aB, leg), B = mix(aB, aA, leg);
  float om = acos(clamp(dot(A,B), -1., 1.)); float so = max(sin(om), 1e-5);
  vec3 s = (sin((1.-pr)*om)*A + sin(pr*om)*B)/so;
  vec3 s2 = (sin((1.-pr-0.002)*om)*A + sin((pr+0.002)*om)*B)/so;
  dir = normalize(s2 - s);
  float climb = clamp(min(pr,1.-pr)*aMeta.w/160., 0., 1.);
  float alt = aMeta.x*sqrt(climb);
  return s*(1. + alt*uAltX/6371.);
}
void main(){
  int kind = int(aMeta.y+0.5);
  float km = kind==0?uKindMask.x: kind==1?uKindMask.y: kind==2?uKindMask.z: uKindMask.w;
  float vis; vec3 dir;
  float t = uT - aK*uTrailLen;
  vec3 p = flightPos(t, vis, dir);
  vec4 c = project(p);
  float occ = occluded(p);
  gl_Position = c;
  float sel = float(abs(float(gl_InstanceID) - uSelId) < 0.5);
  float ks = kind==0?uKindSize.x: kind==1?uKindSize.y: kind==2?uKindSize.z: uKindSize.w;
  float sz = max(ks*uSizeK*(1.+sel*0.8), uMinSize);
  gl_PointSize = vis*(1.-occ)*km*sz*uPx;
  vec3 colK = kind==0 ? vec3(0.42,0.74,1.0) : kind==1 ? vec3(1.0,0.56,0.3) : kind==2 ? vec3(0.55,1.0,0.5) : vec3(0.78,0.85,1.0);
  colK = mix(colK, vec3(1.0,0.86,0.45), sel);
  vCol = vec4(colK, vis*(1.-occ)*km*uAlphaK*(uTrail>0.5 ? pow(1.-aK,1.6)*(0.55+sel*0.45) : 1.));
  vK = aK;
  vGlyph = 1.; vSize = sz*uPx; vSeed = aMeta.z; vHeat = 0.55;
  vAng = screenAngle(p, dir, c);
}`;
SRC.sat_vs = SPRITE_VS_HEAD + `
in vec4 aEl; in vec4 aSM; // inc, raan, u0, n ; altKm, kind, geo, seed
uniform vec4 uSatMask0; uniform vec4 uSatMask1; uniform float uSelId;
void main(){
  float u = aEl.z + aEl.w*uT; float r = 1. + aSM.x/6371.;
  float cu=cos(u), su=sin(u), cO=cos(aEl.y), sO=sin(aEl.y), ci=cos(aEl.x), si=sin(aEl.x);
  vec3 x = vec3(cu*cO - su*ci*sO, cu*sO + su*ci*cO, su*si);
  vec3 p;
  if (aSM.z > 0.5) p = vec3(cos(aEl.z), sin(aEl.z), 0.)*r;
  else { float cg=cos(-uGmst), sg=sin(-uGmst); p = r*vec3(x.x*cg - x.y*sg, x.x*sg + x.y*cg, x.z); }
  int k = int(aSM.y+0.5);
  float m = k==0?uSatMask0.x: k==1?uSatMask0.y: k==2?uSatMask0.z: k==3?uSatMask0.w: k==4?uSatMask1.x: k==5?uSatMask1.y: uSatMask1.z;
  vec4 c = project(p); float occ = occluded(p);
  gl_Position = c;
  float sel = float(abs(float(gl_VertexID) - uSelId) < 0.5);
  float base = k==6 ? 15. : k==5 ? 4.0 : k==3 ? 2.6 : k==4 ? 1.4 : 1.6;
  // sunlit satellites glint; in earth shadow they dim
  vec3 sd = uSun; float bb = dot(p, sd); float rho2 = dot(p,p) - bb*bb; float lit = (bb < 0. && rho2 < 1.) ? 0.25 : 1.;
  float sz = max(base*uSizeK*(1.+sel), uMinSize);
  gl_PointSize = (1.-occ)*m*sz*uPx;
  vec3 col = k==6 ? vec3(1.0,0.9,0.7) : k==5 ? vec3(0.95,0.9,1.0) : k==4 ? vec3(0.7,0.62,0.7) : k==3 ? vec3(0.85,0.7,1.0) : k==2 ? vec3(0.7,0.85,1.0) : vec3(0.79,0.66,1.0);
  vCol = vec4(col*lit, m*(1.-occ)*uAlphaK*(k==6||k==5 ? 1. : k==3 ? 0.7 : 0.42));
  vGlyph = k==6 ? 7. : 0.; vSize = sz*uPx; vSeed = aSM.w; vHeat = 0.2; vAng = 0.;
}`;
SRC.sun_uniform = `uniform vec3 uSun;`;

SRC.sprite_fs = `#version 300 es
precision highp float;
in vec4 vCol; in float vGlyph; in float vAng; in float vSize; in float vSeed; in float vHeat;
uniform float uT; uniform float uPass; uniform float uWall; uniform float uGlyphPx;
out vec4 frag;
${GLSL_COMMON}
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
void main(){
  vec2 q = gl_PointCoord*2.-1.; q.y = -q.y;
  float r = length(q);
  int g = int(vGlyph+0.5);
  float px = 2.5/max(vSize,1.);
  float a = 0.; vec3 col = vCol.rgb; float glow = 0.;
  if (vSize < uGlyphPx && g != 2 && g != 11 && g != 10 && g != 9 && g != 6 && g != 14 && g != 12) g = 0;
  float ca = cos(vAng - 1.5708), sa = sin(vAng - 1.5708);
  vec2 rq = vec2(ca*q.x + sa*q.y, -sa*q.x + ca*q.y);
  if (g == 0) { a = exp(-r*r*7.)*1.0 + exp(-r*r*2.2)*0.18; }
  else if (g == 1) { // aircraft
    vec2 p = rq*1.15;
    float fus = sdSeg(p, vec2(0.,-0.72), vec2(0.,0.78)) - 0.085;
    float wing = max(abs(p.y + 0.02 + abs(p.x)*0.42) - 0.075, abs(p.x) - 0.86);
    float tail = max(abs(p.y + 0.66 + abs(p.x)*0.3) - 0.05, abs(p.x) - 0.34);
    float d = min(fus, min(wing, tail));
    a = (smoothstep(px, -px, d) + exp(-r*r*3.)*0.22)*0.85;
  }
  else if (g == 2) { // quake ring: vSeed = age (s)
    float age = vSeed; float ph = fract(uT/2.4);
    float rr = 0.25 + 0.7*ph;
    float pulse = exp(-pow((r-rr)/0.05,2.)) * (1.-ph) * step(age, 86400.*1.5);
    float base = exp(-pow((r-0.55)/0.035,2.))*0.55 + exp(-r*r*40.)*1.2;
    a = (pulse + base) * smoothstep(1.,0.9,r);
  }
  else if (g == 3) { // fire
    float fl = 0.7 + 0.3*sin(uT*7. + vSeed*30.) * sin(uT*3.1 + vSeed*11.);
    a = (exp(-r*r*9.)*1.3 + exp(-r*r*2.5)*0.35) * fl;
    col = mix(vec3(1.0,0.35,0.08), vec3(1.0,0.85,0.45), exp(-r*r*14.));
  }
  else if (g == 4) { // ship hull
    vec2 p = rq*1.2;
    float d = max(abs(p.x) - 0.26 + max(p.y-0.35,0.)*0.55, abs(p.y) - 0.8);
    a = smoothstep(px, -px, d) + exp(-r*r*4.)*0.15;
  }
  else if (g == 5) { // camera eye
    float ring = abs(r - 0.62) - 0.1;
    float lid = abs(length(q*vec2(1.,1.9)) - 0.86) - 0.07;
    float d = min(ring, r - 0.26);
    a = smoothstep(px, -px, min(d, lid)) * 0.95 + exp(-r*r*3.)*0.18;
  }
  else if (g == 6) { // signed capture / hologram seal
    float dia = abs(q.x)+abs(q.y);
    float d = min(abs(dia - 0.62) - 0.09, dia - 0.22);
    float beam = exp(-q.x*q.x*80.) * smoothstep(-1., 0., -q.y) * 0.0;
    a = smoothstep(px, -px, d) + exp(-r*r*3.)*0.35 + beam;
  }
  else if (g == 7) { // satellite / station
    vec2 p = q*1.25;
    float body = max(abs(p.x)-0.16, abs(p.y)-0.16);
    float panel = max(abs(abs(p.x)-0.58)-0.3, abs(p.y)-0.13);
    float truss = max(abs(p.x)-0.9, abs(p.y)-0.03);
    a = smoothstep(px, -px, min(min(body,panel),truss)) + exp(-r*r*3.)*0.35;
  }
  else if (g == 8) { // helicopter
    vec2 p = rq*1.2;
    float rotor = abs(r*1.2 - 0.82) - 0.03;
    float spin = abs(sin(atan(q.y,q.x)*2. + uT*40.));
    float blades = (r < 0.95) ? smoothstep(0.9, 1., spin) * 0.55 : 0.;
    float body = length(p*vec2(1.7,1.)) - 0.32;
    float boom = sdSeg(p, vec2(0.,-0.1), vec2(0.,-0.82)) - 0.05;
    a = max(smoothstep(px, -px, min(body, boom)), blades) + smoothstep(px,-px,rotor)*0.35 + exp(-r*r*3.)*0.18;
  }
  else if (g == 9) { // situation pin
    float ph = fract(uT*0.5 + vSeed);
    a = smoothstep(px,-px, abs(r-0.42)-0.07) + exp(-r*r*30.)*1.4 + exp(-pow((r-0.4-ph*0.55)/0.06,2.))*(1.-ph)*0.8;
  }
  else if (g == 10) { // hex
    vec2 p = abs(q); float d = max(p.x*0.866 + p.y*0.5, p.y) - 0.86;
    a = smoothstep(px*2., -px*2., d) * 0.5 + smoothstep(px,-px, abs(d+0.02)-0.03)*0.6;
  }
  else if (g == 11) { // soft blob (smoke / air quality / radar)
    float n = vnoise(q*2.5 + vSeed*13. + uT*0.02);
    a = exp(-r*r*2.6) * (0.55+0.45*n);
  }
  else if (g == 12) { // lightning
    float fl = step(0.93, fract(sin(floor(uT*3.+vSeed*40.)*91.7)*437.1));
    a = (exp(-r*r*18.)*2. + exp(-min(abs(q.x),abs(q.y))*30.)*exp(-r*2.)*0.8) * fl;
  }
  else if (g == 13) { // infra square
    vec2 p = abs(q); float d = max(p.x,p.y) - 0.55;
    a = smoothstep(px,-px, abs(d)-0.09) + smoothstep(px,-px,max(p.x,p.y)-0.18) + exp(-r*r*3.)*0.15;
  }
  else if (g == 14) { // volcano triangle
    vec2 p = q; p.y += 0.2;
    float d = max(abs(p.x)*0.866 + p.y*0.5, -p.y) - 0.45;
    a = smoothstep(px,-px, abs(d)-0.08) + exp(-r*r*3.)*0.2;
  }
  else if (g == 15) { // wind streak (oriented)
    a = exp(-(rq.x*rq.x*60. + rq.y*rq.y*1.6)) * smoothstep(1.,0.4,abs(rq.y));
  }
  else if (g == 16) { // runner / small dot with ring
    a = smoothstep(px,-px, r-0.42) + smoothstep(px,-px, abs(r-0.7)-0.06)*0.5;
  }
  else if (g == 17) { // drone (quad)
    vec2 p = abs(rq);
    float arms = sdSeg(p, vec2(0.), vec2(0.5,0.5)) - 0.06;
    float rot = abs(length(p - vec2(0.55)) - 0.22) - 0.05;
    a = smoothstep(px,-px, min(arms, rot)) + exp(-r*r*4.)*0.2;
  }
  if (r > 1.) a = 0.;
  a *= vCol.a;
  if (a < 0.003) discard;
  if (uPass > 0.5) frag = vec4(col, a*0.85);          // alpha-blended pass
  else frag = vec4(col*a, vHeat*a);                     // additive pass
}`;

/* ---------- lines (world space, polyline strips) ---------- */
SRC.line_vs = `#version 300 es
precision highp float;
in vec3 aPos; in vec4 aCol; in vec2 aD; // dist along (units), dashed flag
uniform mat4 uVP; uniform vec3 uEyeH, uEyeL; uniform float uEyeC; uniform float uOccR; uniform float uAlphaK;
out vec4 vCol; out vec2 vD;
void main(){
  vec3 E = uEyeH + uEyeL; vec3 d = aPos - E; float L = length(d); vec3 u = d/L;
  float b = dot(E,u); float c = uEyeC + 1. - uOccR*uOccR; float disc = b*b - c; float occ = 0.;
  if (disc > 0.) { float tn = -b - sqrt(disc); occ = (tn > 0. && tn < L) ? 1. : 0.; }
  vec4 cp = uVP*vec4((aPos-uEyeH)-uEyeL, 1.);
  if (cp.z > cp.w) cp.z = cp.w*0.99999;
  gl_Position = cp;
  vCol = aCol; vCol.a *= (1.-occ*0.92)*uAlphaK; vD = aD;
}`;
SRC.line_fs = `#version 300 es
precision highp float;
in vec4 vCol; in vec2 vD; uniform float uDashK; uniform float uT; out vec4 frag;
void main(){
  float a = vCol.a;
  if (vD.y > 0.5 && fract(vD.x*uDashK - uT*0.0) > 0.55) discard;
  if (vD.y > 1.5) a *= 0.5 + 0.5*sin(vD.x*uDashK*6.2832 - uT*3.);
  frag = vec4(vCol.rgb*a, a*0.3);
}`;

/* ---------- meshes (local ENU meters, camera-relative matrix) ---------- */
SRC.mesh_vs = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aNor; in vec2 aUV; in vec4 aAttr; // type, hash, height, misc
uniform mat4 uMVP; uniform float uT; uniform vec4 uFlood; // x: tHours, y: start h, z: speed m/h, w: crest m
out vec3 vPos; out vec3 vNor; out vec2 vUV; out vec4 vAttr;
void main(){
  vec3 p = aPos;
  if (aAttr.x > 1.5 && aAttr.x < 2.5) { // flood water: rise with crest arrival
    float s = aUV.x; float arr = uFlood.y + s/uFlood.z;
    float dt = uFlood.x - arr;
    float crest = uFlood.w * (dt > 0. ? exp(-dt/5.) * smoothstep(0., 0.4, dt) : exp(-dt*dt*6.)) ;
    p.z += crest * 0.5;
  }
  vPos = p; vNor = aNor; vUV = aUV; vAttr = aAttr;
  gl_Position = uMVP*vec4(p, 1.);
}`;
SRC.mesh_fs = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec2 vUV; in vec4 vAttr;
uniform vec3 uSunL; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uFogCol; uniform vec3 uEyeL;
uniform float uNight; uniform float uT; uniform float uVis; uniform vec4 uFlood; uniform float uClear;
out vec4 frag;
${GLSL_COMMON}
void main(){
  int type = int(vAttr.x+0.5);
  vec3 n = normalize(vNor);
  vec3 v = normalize(uEyeL - vPos);
  float diff = max(dot(n, uSunL), 0.);
  vec3 base; vec3 emis = vec3(0.); float heat = 0.35; float spec = 0.;
  if (type == 0) { // building
    float h = vAttr.y;
    base = mix(vec3(0.15,0.155,0.165), vec3(0.32,0.29,0.25), fract(h*7.13));
    base = mix(base, vec3(0.07,0.09,0.11), step(0.68, h)); // glass towers
    if (abs(n.z) < 0.5) {
      vec2 f = vec2(vUV.x/3.2, vUV.y/3.6);
      vec2 id = floor(f); vec2 fr = fract(f);
      float win = step(0.18, fr.x)*step(fr.x,0.82)*step(0.22,fr.y)*step(fr.y,0.78);
      float r = hash12(id + h*91.);
      float frac = 0.12 + 0.5*uNight;
      float lit = step(1. - frac, r) * win * step(vUV.y, vAttr.z - 1.);
      vec3 wc = mix(vec3(1.0,0.72,0.42), vec3(0.75,0.85,1.0), step(0.6, hash12(id*1.3+h)));
      float fwv = length(fwidth(vUV));
      float pat = mix(lit * (0.9 + 0.6*r), frac * 0.36 * 0.75 * (0.15 + 1.6*fract(h*13.7)*fract(h*13.7)), smoothstep(0.9, 2.6, fwv));
      emis += wc * pat * uNight * 2.2;
      base = mix(base, base*0.45 + uSkyCol*0.08, win*0.8);
      spec = win*(1.-uNight)*0.9 + step(0.68, h)*0.5;
    } else base *= 0.82;
    float ao = smoothstep(0., 14., vUV.y + (1.-abs(n.z))*0.) * 0.35 + 0.65;
    if (abs(n.z) < 0.5) base *= ao;
    heat = 0.4 + 0.3*uNight;
  } else if (type == 1) { // terrain
    float hgt = vAttr.z; float slope = 1.-n.z;
    vec3 forest = vec3(0.035,0.075,0.025), meadow = vec3(0.15,0.17,0.07), rock = vec3(0.22,0.2,0.18), snow = vec3(0.85,0.88,0.93);
    float nz = vnoise(vPos.xy*0.004)*0.5 + vnoise(vPos.xy*0.02)*0.25 + vnoise(vPos.xy*0.09)*0.12;
    base = mix(forest, meadow, smoothstep(3000., 3700., hgt + nz*500.));
    base = mix(base, forest*0.8, smoothstep(0.2, 0.45, slope) * (1. - smoothstep(3200., 3800., hgt)));
    base = mix(base, rock, clamp(smoothstep(0.55, 0.85, slope + nz*0.25) + smoothstep(3900., 4500., hgt + nz*400.), 0., 1.));
    base = mix(base, snow, smoothstep(4700., 5100., hgt + nz*700. - slope*500.));
    // flood scar (mud) along the channel once the crest has passed
    float scar = vAttr.w; // 0..1 near channel
    float s = vUV.x; float arr = uFlood.y + s/uFlood.z;
    float passed = smoothstep(0., 0.6, uFlood.x - arr);
    base = mix(base, vec3(0.16,0.14,0.11), scar*passed*0.8);
    heat = 0.3 + 0.2*diff;
  } else if (type == 2) { // water (river / flood)
    float s = vUV.x; float across = abs(vUV.y);
    float arr = uFlood.y + s/uFlood.z; float dt = uFlood.x - arr;
    float w = 0.18 + 0.82*(dt > 0. ? exp(-dt/6.)*smoothstep(0., 0.3, dt) : exp(-dt*dt*5.));
    if (across > w) discard;
    float flow = vnoise(vec2(s*0.02 - uT*0.9, vUV.y*6.));
    base = mix(vec3(0.25,0.22,0.17), vec3(0.45,0.38,0.28), flow) * mix(1., 1.25, step(0.08, w-0.18));
    spec = 0.8; heat = 0.12;
    emis += vec3(0.9,0.8,0.6)*smoothstep(0.85,1.,flow)*0.06*(1.-uNight);
  } else if (type == 3) { // stadium seats + crowd
    base = vec3(0.16,0.17,0.2);
    float crowd = step(0.45, hash12(floor(vUV*vec2(1.6,1.2))));
    float flash = step(0.985, hash12(floor(vUV*vec2(1.6,1.2)) + floor(uT*2.)));
    emis += mix(vec3(0.5,0.6,1.0), vec3(1.0,0.95,0.9), flash) * crowd * (0.05 + flash*4.) * uNight;
    heat = 0.7;
  } else if (type == 4) { // flat pads, runways, pitch
    float h = vAttr.y;
    base = h > 0.5 ? vec3(0.06,0.2,0.05)*(0.85+0.15*step(0.5,fract(vUV.x/10.))) : vec3(0.12,0.12,0.13);
    if (h < 0.5) base += vec3(0.7)*step(0.97, fract(vUV.x/30.))*step(abs(vUV.y - vAttr.w*0.5), 0.6);
    float edge = step(vUV.y, 1.6) + step(vAttr.w - 1.6, vUV.y);
    float dots = step(0.93, fract(vUV.x/40.));
    emis += (h > 0.5 ? vec3(0.05,0.2,0.04)*0.8 : vec3(1.0,0.85,0.55)*dots*edge*2.5 + vec3(0.25,0.45,1.0)*step(0.96, fract((vUV.x+vUV.y)/23.))*0.6) * uNight;
    heat = 0.45;
  } else if (type == 5) { // stage / light rig / beacon
    base = vec3(0.05);
    emis = mix(vec3(0.9,0.3,1.0), vec3(0.3,0.8,1.0), 0.5+0.5*sin(uT*1.7+vPos.x*0.05)) * 3.0;
    heat = 0.9;
  } else if (type == 7) { // floodlit launch structure
    base = vec3(0.75, 0.76, 0.78) * (0.6 + 0.4*vAttr.y);
    emis = vec3(1.0, 0.93, 0.82) * uNight * (0.35 + 0.25*smoothstep(0., 60., vUV.y));
    heat = 0.6;
  } else { // houses
    base = mix(vec3(0.55,0.45,0.38), vec3(0.75,0.72,0.66), vAttr.y);
    if (n.z > 0.5) base = mix(vec3(0.45,0.2,0.15), vec3(0.3,0.35,0.42), step(0.5, vAttr.y));
    emis += vec3(1.0,0.7,0.4)*step(0.6, vAttr.y)*uNight*0.5*step(n.z,0.5);
  }
  vec3 amb = uSkyCol * (0.55 + 0.45*n.z);
  vec3 col = base * (uSunCol*diff + amb);
  if (spec > 0.) { vec3 hv = normalize(v + uSunL); col += uSunCol * pow(max(dot(n,hv),0.), 60.) * spec * 0.6; col += uSkyCol*spec*0.25*pow(1.-max(dot(n,v),0.),3.); }
  col += emis;
  float dist = length(uEyeL - vPos);
  float fog = 1. - exp(-dist / uVis);
  col = mix(col, uFogCol, clamp(fog, 0., 0.8));
  frag = vec4(col, heat);
}`;

/* ---------- post ---------- */
SRC.bright_fs = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThr; out vec4 frag;
void main(){
  vec3 c = vec3(0.);
  c += texture(uSrc, vUv + uTexel*vec2(-1.,-1.)).rgb; c += texture(uSrc, vUv + uTexel*vec2(1.,-1.)).rgb;
  c += texture(uSrc, vUv + uTexel*vec2(-1.,1.)).rgb;  c += texture(uSrc, vUv + uTexel*vec2(1.,1.)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp(l - uThr*0.6, 0., uThr*0.8); k = k*k/(4.*uThr*0.8+1e-4);
  float w = max(k, l - uThr) / max(l, 1e-4);
  frag = vec4(min(c*w, vec3(60.)), 1.);
}`;
SRC.down_fs = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 frag;
void main(){
  vec3 s = texture(uSrc, vUv).rgb*4.;
  s += texture(uSrc, vUv + uTexel*vec2(-1.,-1.)).rgb; s += texture(uSrc, vUv + uTexel*vec2(1.,-1.)).rgb;
  s += texture(uSrc, vUv + uTexel*vec2(-1.,1.)).rgb;  s += texture(uSrc, vUv + uTexel*vec2(1.,1.)).rgb;
  frag = vec4(s/8., 1.);
}`;
SRC.up_fs = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform sampler2D uBase; uniform vec2 uTexel; uniform float uMix; out vec4 frag;
void main(){
  vec3 s = vec3(0.); vec2 o = uTexel;
  s += texture(uSrc, vUv + vec2(-o.x*2.,0.)).rgb; s += texture(uSrc, vUv + vec2(-o.x,o.y)).rgb*2.;
  s += texture(uSrc, vUv + vec2(0.,o.y*2.)).rgb;  s += texture(uSrc, vUv + vec2(o.x,o.y)).rgb*2.;
  s += texture(uSrc, vUv + vec2(o.x*2.,0.)).rgb;  s += texture(uSrc, vUv + vec2(o.x,-o.y)).rgb*2.;
  s += texture(uSrc, vUv + vec2(0.,-o.y*2.)).rgb; s += texture(uSrc, vUv + vec2(-o.x,-o.y)).rgb*2.;
  frag = vec4(s/12. + texture(uBase, vUv).rgb*uMix, 1.);
}`;
SRC.comp_fs = `#version 300 es
precision highp float; in vec2 vUv; out vec4 frag;
uniform sampler2D uScene, uBloom; uniform vec2 uTexel; uniform float uExposure, uBloomK, uVig, uGrain, uT, uFade, uFxaa, uSat;
uniform int uMode; uniform vec3 uLift; uniform vec3 uGain;
${GLSL_COMMON}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec3 ironbow(float t){
  t = clamp(t,0.,1.);
  vec3 a = vec3(0.0,0.0,0.05), b = vec3(0.32,0.0,0.55), c = vec3(0.86,0.12,0.25), d = vec3(1.0,0.6,0.0), e = vec3(1.0,1.0,0.85);
  if (t < 0.25) return mix(a,b,t/0.25); if (t < 0.5) return mix(b,c,(t-0.25)/0.25); if (t < 0.78) return mix(c,d,(t-0.5)/0.28); return mix(d,e,(t-0.78)/0.22);
}
vec4 sampleScene(vec2 uv){
  vec4 c = texture(uScene, uv);
  if (uFxaa > 0.5) {
    float lN = luma(texture(uScene, uv + vec2(0., uTexel.y)).rgb), lS = luma(texture(uScene, uv - vec2(0., uTexel.y)).rgb);
    float lE = luma(texture(uScene, uv + vec2(uTexel.x, 0.)).rgb), lW = luma(texture(uScene, uv - vec2(uTexel.x, 0.)).rgb);
    float lM = luma(c.rgb);
    float mn = min(lM, min(min(lN,lS), min(lE,lW))), mx = max(lM, max(max(lN,lS), max(lE,lW)));
    if (mx - mn > max(0.06, mx*0.15)) {
      vec2 dir = vec2(-((lN)-(lS)), (lE)-(lW));
      float rcp = 1./(min(abs(dir.x),abs(dir.y)) + 1e-3*(lN+lS+lE+lW) + 1e-4);
      dir = clamp(dir*rcp, -4., 4.) * uTexel;
      vec4 a = 0.5*(texture(uScene, uv + dir*(1./3.-0.5)) + texture(uScene, uv + dir*(2./3.-0.5)));
      c = vec4(a.rgb, c.a);
    }
  }
  return c;
}
void main(){
  vec4 s = sampleScene(vUv);
  vec3 b = texture(uBloom, vUv).rgb;
  vec3 c = (s.rgb + b*uBloomK) * uExposure;
  float heat = s.a;
  vec2 cc = vUv - 0.5;
  float vig = 1. - dot(cc, cc) * uVig;
  if (uMode == 3) { // thermal
    float hv = heat*0.85 + luma(c)*0.12 + luma(b)*0.05;
    c = ironbow(hv) * 0.95;
  } else if (uMode == 4) { // NVG
    float l = luma(aces(c*2.2));
    l = pow(l, 0.8) + (hash12(vUv*vec2(1311.,977.) + fract(uT)*91.)-0.5)*0.12;
    l *= 0.92 + 0.08*sin(vUv.y*900.);
    c = vec3(0.25, 1.0, 0.35) * l * 1.1 + vec3(0.0,0.02,0.0);
    float circ = smoothstep(0.62, 0.48, length(cc*vec2(1.,1.)));
    c *= mix(0.15, 1., circ);
  } else {
    c = aces(c);
    float l = luma(c);
    c = mix(vec3(l), c, uSat);
    c = c*uGain + uLift*(1.-c);
    if (uMode == 2) c = mix(c, c*vec3(0.75,0.85,1.15), 0.5);
  }
  c *= vig;
  c = pow(max(c, 0.), vec3(1./2.2));
  c += (hash12(vUv*vec2(1717.,1313.) + fract(uT*0.37)*77.) - 0.5) * uGrain;
  c += (hash12(vUv*vec2(911.,733.)) - 0.5)/255.;
  frag = vec4(c * uFade, 1.);
}`;
SRC.trail_fs = `#version 300 es
precision highp float; in vec4 vCol; in float vK; out vec4 frag;
void main(){ float a = vCol.a; if (a < 0.002) discard; frag = vec4(vCol.rgb*a, a*0.3); }`;
SRC.copy_fs = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; out vec4 frag; void main(){ frag = texture(uSrc, vUv); }`;

/* ---------- GL helpers ---------- */
GL.init = function (canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', desynchronized: false });
  if (!gl) return null;
  GL.gl = gl;
  GL.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  GL.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.getExtension('OES_texture_float_linear');
  GL.vao0 = gl.createVertexArray();
  GL.progs = {};
  const P = (name, vs, fs) => (GL.progs[name] = GL.program(vs, fs, name));
  P('globe', SRC.fsq_vs, SRC.globe_fs);
  P('sprite', SRC.sprite_vs, SRC.sprite_fs);
  P('flight', SRC.flight_vs, SRC.sprite_fs);
  P('sat', SRC.sat_vs, SRC.sprite_fs);
  P('trail', SRC.flight_vs, SRC.trail_fs);
  P('line', SRC.line_vs, SRC.line_fs);
  P('mesh', SRC.mesh_vs, SRC.mesh_fs);
  P('bright', SRC.fsq_vs, SRC.bright_fs);
  P('down', SRC.fsq_vs, SRC.down_fs);
  P('up', SRC.fsq_vs, SRC.up_fs);
  P('comp', SRC.fsq_vs, SRC.comp_fs);
  P('copy', SRC.fsq_vs, SRC.copy_fs);
  return gl;
};
GL.program = function (vsSrc, fsSrc, name) {
  const gl = GL.gl;
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => i + 1 + ': ' + l);
      const m = /0:(\d+)/.exec(log || ''); const ln = m ? +m[1] : 0;
      console.error(`[${name}] shader error`, log, '\n', lines.slice(Math.max(0, ln - 4), ln + 2).join('\n'));
      throw new Error('shader compile failed: ' + name);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(`[${name}] link`, gl.getProgramInfoLog(p)); throw new Error('link failed ' + name); }
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, inf.name); }
  const a = {}, na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const inf = gl.getActiveAttrib(p, i); a[inf.name] = gl.getAttribLocation(p, inf.name); }
  return { p, u, a, name };
};
GL.texture = function (img, { mips = true, wrap = 'repeat', aniso = 8 } = {}) {
  const gl = GL.gl, t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  if (GL.aniso && aniso) gl.texParameterf(gl.TEXTURE_2D, GL.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, gl.getParameter(GL.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
};
GL.target = function (w, h, { hdr = true, depth = false, linear = true } = {}) {
  const gl = GL.gl;
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const useHdr = hdr && GL.hdr;
  gl.texImage2D(gl.TEXTURE_2D, 0, useHdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, useHdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (depth) {
    rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok && useHdr) { GL.hdr = false; return GL.target(w, h, { hdr: false, depth, linear }); }
  return { tex, fb, rb, w, h, dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); if (rb) gl.deleteRenderbuffer(rb); } };
};
// chain of render targets for a given output size
GL.chain = function (w, h) {
  const s = GL.target(w, h, { depth: true });
  const lv = [];
  let cw = Math.max(1, (w / 2) | 0), ch = Math.max(1, (h / 2) | 0);
  for (let i = 0; i < 4; i++) { lv.push({ a: GL.target(cw, ch), b: null }); cw = Math.max(1, (cw / 2) | 0); ch = Math.max(1, (ch / 2) | 0); }
  for (let i = 0; i < 3; i++) lv[i].b = GL.target(lv[i].a.w, lv[i].a.h);
  return { w, h, scene: s, lv, dispose() { s.dispose(); lv.forEach((l) => { l.a.dispose(); l.b && l.b.dispose(); }); } };
};
GL.fsq = function (prog) { const gl = GL.gl; gl.useProgram(prog.p); gl.bindVertexArray(GL.vao0); gl.drawArrays(gl.TRIANGLES, 0, 3); };
GL.bindTex = function (prog, name, tex, unit) { const gl = GL.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u[name], unit); };
GL.buffer = function (data, usage) { const gl = GL.gl, b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
// build a VAO from {name: [buffer, size, stride, offset, divisor]}
GL.vao = function (prog, spec, index) {
  const gl = GL.gl, vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const k in spec) {
    const loc = prog.a[k]; if (loc == null || loc < 0) continue;
    const [buf, size, stride, off, div] = spec[k];
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4);
    gl.vertexAttribDivisor(loc, div || 0);
  }
  if (index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bindVertexArray(null);
  return vao;
};
