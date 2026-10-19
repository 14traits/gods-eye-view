/* Synthetic, plausible world data. Real places & public phenomena; all people, handles, posts,
   callsigns and reconstruction claims are illustrative (Concept · illustrative data). */
const NOW = Date.now();
GE.NOW = NOW;
const lastUTC = (h, m) => { const d = new Date(NOW); let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m); if (t > NOW - 3600000) t -= 86400000; return t; };
GE.T_CONCERT = lastUTC(21, 44); GE.T_CLIMB = lastUTC(10, 52);
GE.dayWord = (t, part) => (new Date(t).getUTCDate() === new Date(NOW).getUTCDate() ? 'this ' + part : (part === 'night' ? 'last night' : 'yesterday ' + part)).replace('this night', 'tonight');
const R = rng(20261018);

/* ---------- airports [iata, city, lat, lon, weight] ---------- */
const AIRPORTS = [
  ['ATL','Atlanta',33.6407,-84.4277,104],['DXB','Dubai',25.2532,55.3657,87],['DFW','Dallas–Fort Worth',32.8998,-97.0403,82],['LHR','London Heathrow',51.47,-0.4543,80],
  ['HND','Tokyo Haneda',35.5494,139.7798,79],['DEN','Denver',39.8561,-104.6737,78],['IST','Istanbul',41.2753,28.7519,76],['LAX','Los Angeles',33.9416,-118.4085,75],
  ['ORD','Chicago O’Hare',41.9742,-87.9073,74],['DEL','Delhi',28.5562,77.1,73],['CDG','Paris CDG',49.0097,2.5479,70],['JFK','New York JFK',40.6413,-73.7781,62],
  ['CAN','Guangzhou',23.3924,113.2988,64],['PEK','Beijing',40.0799,116.6031,60],['PVG','Shanghai Pudong',31.1443,121.8083,62],['SIN','Singapore',1.3644,103.9915,59],
  ['AMS','Amsterdam',52.3105,4.7683,62],['FRA','Frankfurt',50.0379,8.5622,60],['MAD','Madrid',40.4983,-3.5676,60],['BKK','Bangkok',13.69,100.7501,58],
  ['ICN','Seoul Incheon',37.4602,126.4407,56],['BOM','Mumbai',19.0896,72.8656,52],['CGK','Jakarta',-6.1256,106.6559,50],['SFO','San Francisco',37.6213,-122.379,50],
  ['LAS','Las Vegas',36.084,-115.1537,55],['MCO','Orlando',28.4312,-81.3081,57],['MIA','Miami',25.7959,-80.287,52],['CLT','Charlotte',35.214,-80.9431,53],
  ['SEA','Seattle',47.4502,-122.3088,50],['PHX','Phoenix',33.4342,-112.0116,48],['EWR','Newark',40.6895,-74.1745,49],['IAH','Houston',29.9902,-95.3368,46],
  ['BOS','Boston',42.3656,-71.0096,40],['MSP','Minneapolis',44.8848,-93.2223,36],['DTW','Detroit',42.2162,-83.3554,32],['YYZ','Toronto',43.6777,-79.6248,45],
  ['YVR','Vancouver',49.1967,-123.1815,25],['MEX','Mexico City',19.4361,-99.0719,48],['CUN','Cancún',21.0365,-86.877,30],['GRU','São Paulo',-23.4356,-46.4731,42],
  ['BOG','Bogotá',4.7016,-74.1469,38],['LIM','Lima',-12.0219,-77.1143,24],['SCL','Santiago',-33.393,-70.7858,24],['EZE','Buenos Aires',-34.8222,-58.5358,12],
  ['GIG','Rio de Janeiro',-22.809,-43.2506,15],['PTY','Panama City',9.0714,-79.3835,17],['MUC','Munich',48.3537,11.775,41],['FCO','Rome',41.8003,12.2389,40],
  ['BCN','Barcelona',41.2974,2.0833,52],['LGW','London Gatwick',51.1537,-0.1821,41],['ZRH','Zurich',47.4582,8.5555,31],['VIE','Vienna',48.1103,16.5697,29],
  ['CPH','Copenhagen',55.618,12.6508,30],['OSL','Oslo',60.1976,11.1004,27],['ARN','Stockholm',59.6498,17.9238,25],['HEL','Helsinki',60.3172,24.9633,18],
  ['DUB','Dublin',53.4264,-6.2499,33],['LIS','Lisbon',38.7742,-9.1342,33],['ATH','Athens',37.9364,23.9445,28],['WAW','Warsaw',52.1657,20.9671,21],
  ['PRG','Prague',50.1008,14.26,17],['BRU','Brussels',50.9014,4.4844,24],['MAN','Manchester',53.3537,-2.275,29],['PMI','Palma',39.5517,2.7388,33],
  ['DOH','Doha',25.2731,51.6081,45],['AUH','Abu Dhabi',24.433,54.6511,28],['RUH','Riyadh',24.9576,46.6988,36],['JED','Jeddah',21.6702,39.1525,42],
  ['CAI','Cairo',30.1219,31.4056,30],['TLV','Tel Aviv',32.0055,34.8854,24],['ADD','Addis Ababa',8.9779,38.7993,13],['NBO','Nairobi',-1.3192,36.9278,9],
  ['JNB','Johannesburg',-26.1392,28.246,21],['CPT','Cape Town',-33.9715,18.6021,11],['LOS','Lagos',6.5774,3.3212,8],['CMN','Casablanca',33.3675,-7.5898,10],
  ['HKG','Hong Kong',22.308,113.9185,53],['TPE','Taipei',25.0797,121.2342,45],['NRT','Tokyo Narita',35.772,140.3929,33],['KIX','Osaka Kansai',34.4347,135.244,28],
  ['MNL','Manila',14.5086,121.0198,45],['KUL','Kuala Lumpur',2.7456,101.7072,57],['SGN','Ho Chi Minh City',10.8188,106.6519,40],['HAN','Hanoi',21.2187,105.8042,29],
  ['CTU','Chengdu',30.5785,103.9471,50],['SZX','Shenzhen',22.6393,113.8107,52],['KMG','Kunming',25.1019,102.9292,45],['XIY','Xi’an',34.4471,108.7516,43],
  ['CKG','Chongqing',29.7192,106.6417,44],['HGH','Hangzhou',30.2295,120.4344,40],['BLR','Bengaluru',13.1986,77.7066,37],['MAA','Chennai',12.9941,80.1709,22],
  ['CCU','Kolkata',22.6547,88.4467,22],['HYD','Hyderabad',17.2403,78.4294,21],['KTM','Kathmandu',27.6966,85.3591,8],['DAC','Dhaka',23.8433,90.3978,9],
  ['KHI','Karachi',24.9065,67.1608,8],['SYD','Sydney',-33.9399,151.1753,44],['MEL','Melbourne',-37.669,144.841,37],['BNE','Brisbane',-27.3842,153.1175,24],
  ['PER','Perth',-31.9385,115.9672,15],['AKL','Auckland',-37.0082,174.785,21],['HNL','Honolulu',21.3187,-157.9225,21],['ANC','Anchorage',61.1743,-149.9963,6],
  ['SVO','Moscow',55.9726,37.4146,40],['LED','St Petersburg',59.8003,30.2625,19],['ALA','Almaty',43.3521,77.0405,9],['TAS','Tashkent',41.2579,69.2812,7],
  ['RKV','Reykjavík',63.985,-22.6056,8],['SLC','Salt Lake City',40.7899,-111.9791,26],['SAN','San Diego',32.7338,-117.1933,25],['PDX','Portland',45.5898,-122.5951,19],
  ['AUS','Austin',30.1975,-97.6664,21],['BNA','Nashville',36.1263,-86.6774,22],['MSY','New Orleans',29.9934,-90.258,13],['YUL','Montréal',45.4706,-73.7408,21],
  ['YYC','Calgary',51.1215,-114.0076,18],['GUA','Guatemala City',14.5833,-90.5275,3],['SJO','San José CR',9.9939,-84.2088,5],['UIO','Quito',-0.1292,-78.3575,5],
];
const AP = AIRPORTS.map(([iata, city, lat, lon, w]) => ({ iata, city, lat, lon, w, v: geo.vec(lat, lon) }));
const apByIata = Object.fromEntries(AP.map((a) => [a.iata, a]));

/* ---------- fictional operators ---------- */
const OPS = ['AXR','NVA','SKL','ORX','VLT','KTO','LMA','TRV','QNX','PLR','HZN','CRS','SOL','MRD','EQX','BLU','CYG','ALD','JTR','FRN'];
const OPNAME = { AXR:'Axiom Air', NVA:'Nova Atlantic', SKL:'Skylark', ORX:'Orix Cargo', VLT:'Volta', KTO:'Kito Air', LMA:'Lumea', TRV:'Traverse', QNX:'Quanta', PLR:'Polaris', HZN:'Horizonte', CRS:'Cirrus Lines', SOL:'Solstice', MRD:'Meridian', EQX:'Equinox', BLU:'Bluewing', CYG:'Cygnet', ALD:'Aldea', JTR:'Jetrail', FRN:'Fernway' };
const TYPES_SHORT = ['A320','A21N','B738','B38M','E190','A20N','AT76','CRJ9'];
const TYPES_LONG = ['B77W','A359','B789','A388','B78X','A35K','B744F','A333'];

/* ---------- flights (GPU-animated great circles) ----------
   Each flight cycles: fly a→b for dur, turn around, fly b→a… so any scrub time is consistent. */
const FLIGHTS = [];
(function genFlights() {
  const N = 3600;
  const wsum = AP.reduce((s, a) => s + a.w, 0);
  const pickAp = () => { let r = R() * wsum; for (const a of AP) { r -= a.w; if (r <= 0) return a; } return AP[0]; };
  let guard = 0;
  while (FLIGHTS.length < N && guard++ < N * 8) {
    const a = pickAp(); let b = pickAp();
    if (a === b) continue;
    const d = geo.dist(a.lat, a.lon, b.lat, b.lon) * EARTH_KM;
    if (d < 250 || d > 15500) continue;
    // short-haul bias
    if (d > 6000 && R() < 0.55) continue;
    const long = d > 4500;
    const speed = long ? 905 : 780; // km/h
    const dur = (d / speed + 0.45) * 3600; // seconds
    const turn = (long ? R.range(1.5, 3.5) : R.range(0.6, 2.2)) * 3600;
    const period = 2 * (dur + turn);
    const op = R.pick(OPS);
    FLIGHTS.push({
      kind: 0, a, b, dKm: d, dur, turn, period, t0: R() * period, alt: long ? R.range(10.6, 12.5) : R.range(8.5, 11.6),
      cs: op + (R.int(8900) + 100), op, type: long ? R.pick(TYPES_LONG) : R.pick(TYPES_SHORT), speed,
    });
  }
  // private / GA — short hops near busy regions
  for (let i = 0; i < 380; i++) {
    const a = R.pick(AP); const brg = R() * TAU, km = R.range(80, 520);
    const [lat, lon] = geo.dest(a.lat, a.lon, brg, km);
    const b = { iata: 'GA', city: '', lat, lon, w: 1, v: geo.vec(lat, lon) };
    const dur = (km / 330 + 0.2) * 3600, turn = R.range(0.5, 4) * 3600;
    FLIGHTS.push({ kind: 3, a, b, dKm: km, dur, turn, period: 2 * (dur + turn), t0: R() * 2 * (dur + turn), alt: R.range(1.5, 4.5), cs: 'N' + (R.int(899) + 100) + String.fromCharCode(65 + R.int(26), 65 + R.int(26)), op: 'GA', type: R.pick(['C172','PC12','SR22','C25A','BE20']), speed: 330 });
  }
  // military transits (fictional callsigns)
  const MIL = [[55.0,10.0],[50.0,20.0],[44.0,30.0],[37.0,24.0],[36.5,-76.0],[32.0,-110.0],[26.0,51.0],[35.0,128.0],[21.0,-158.0],[13.5,144.8],[51.0,-1.5],[64.0,25.0],[57.0,22.0],[54.5,18.0]];
  const MCS = ['VIPER','TITAN','HAWK','RAVEN','SABRE','ATLAS','GHOST','DUKE','NOMAD','LANCE'];
  for (let i = 0; i < 160; i++) {
    const c = R.pick(MIL); const [la1, lo1] = geo.dest(c[0], c[1], R() * TAU, R.range(50, 600)); const [la2, lo2] = geo.dest(c[0], c[1], R() * TAU, R.range(300, 1600));
    const a = { iata: 'MIL', lat: la1, lon: lo1, v: geo.vec(la1, lo1) }, b = { iata: 'MIL', lat: la2, lon: lo2, v: geo.vec(la2, lo2) };
    const km = geo.dist(la1, lo1, la2, lo2) * EARTH_KM; const dur = (km / 760 + 0.2) * 3600, turn = R.range(0.3, 3) * 3600;
    FLIGHTS.push({ kind: 1, a, b, dKm: km, dur, turn, period: 2 * (dur + turn), t0: R() * 2 * (dur + turn), alt: R.range(6, 11), cs: R.pick(MCS) + ' ' + (R.int(89) + 10), op: 'MIL', type: R.pick(['KC-135','C-17','P-8','E-3','RC-135','A400','F-35','MQ-9']), speed: 760 });
  }
})();
// position of a flight at sim seconds t → {v:[x,y,z] (unit, alt applied), lat, lon, altKm, hdg, prog, onLeg}
function flightAt(f, t) {
  let ph = (t - f.t0) % f.period; if (ph < 0) ph += f.period;
  const leg = ph < f.period / 2 ? 0 : 1; const lp = ph - leg * (f.period / 2);
  if (lp > f.dur) return null;
  const p = lp / f.dur; const A = leg ? f.b : f.a, B = leg ? f.a : f.b;
  const s = geo.slerp(A.v, B.v, p);
  const climb = Math.min(1, Math.min(p, 1 - p) * f.dKm / 160);
  const altKm = f.alt * Math.sqrt(Math.max(0, climb));
  const [lat, lon] = geo.ll(s);
  const s2 = geo.slerp(A.v, B.v, Math.min(1, p + 0.001)); const [lat2, lon2] = geo.ll(s2);
  return { v: s, lat, lon, altKm, hdg: geo.bearing(lat, lon, lat2, lon2), prog: p, from: A, to: B };
}

/* ---------- shipping lanes (lat,lon chains on water) ---------- */
const LANES = [
  // Asia–Europe via Suez
  [[31.0,122.6],[28.0,122.6],[24.6,119.9],[22.0,116.0],[18.0,113.5],[12.0,110.4],[7.0,106.0],[2.6,104.9],[1.25,104.0],[1.9,102.4],[3.4,100.6],[5.9,97.2],[6.1,94.0],[6.0,88.0],[5.7,81.0],[7.0,76.5],[11.0,64.0],[12.2,52.0],[12.0,46.5],[12.6,43.4],[14.5,42.4],[18.0,40.3],[22.0,37.9],[25.5,35.3],[27.8,33.7],[29.6,32.6],[30.6,32.33],[31.4,32.33],[32.6,30.0],[34.0,24.5],[36.1,16.0],[37.3,11.6],[37.6,8.0],[36.6,2.0],[35.95,-5.6],[36.6,-9.6],[40.0,-10.2],[43.6,-9.9],[48.4,-5.8],[49.9,-2.3],[50.9,1.3],[51.6,2.8],[52.0,3.95]],
  // Transpacific (Shanghai → LA)
  [[31.0,122.6],[30.3,128.5],[33.0,135.5],[34.6,139.9],[36.5,152.0],[38.0,165.0],[38.5,180.0],[37.5,-165.0],[35.5,-145.0],[34.0,-128.0],[33.7,-118.4]],
  // Busan → Seattle (great circle north)
  [[35.0,129.1],[36.5,135.0],[41.4,141.6],[45.0,155.0],[50.0,175.0],[51.5,-170.0],[51.0,-150.0],[49.0,-132.0],[48.4,-124.8]],
  // Transatlantic
  [[49.9,-2.3],[49.4,-6.4],[47.5,-20.0],[44.5,-40.0],[41.5,-60.0],[40.45,-73.8]],
  // US East coast → Panama → west coast S America
  [[40.45,-73.8],[35.2,-74.6],[28.0,-77.5],[24.0,-74.5],[20.2,-73.8],[15.0,-77.0],[9.4,-79.9],[8.9,-79.5],[7.2,-80.2],[1.0,-81.3],[-6.0,-81.5],[-12.0,-77.3]],
  // Panama → LA
  [[8.9,-79.5],[10.5,-87.5],[15.0,-96.5],[20.0,-106.0],[23.0,-110.6],[29.0,-116.0],[33.7,-118.4]],
  // Gulf of Mexico → Florida → NY
  [[29.3,-94.7],[26.5,-90.0],[24.3,-84.0],[24.2,-81.0],[26.5,-79.7],[31.0,-79.5],[35.2,-74.6]],
  // Persian Gulf → Hormuz → Arabian Sea → Gulf of Aden
  [[29.4,48.6],[27.3,50.8],[26.5,54.0],[26.5,56.4],[25.2,57.5],[22.6,60.3],[17.0,57.0],[12.2,52.0]],
  // Persian Gulf → Malacca
  [[25.2,57.5],[22.6,60.3],[17.0,66.0],[10.0,73.0],[6.6,79.3],[5.7,81.0]],
  // Cape route
  [[22.6,60.3],[10.0,58.0],[-5.0,52.0],[-12.0,45.5],[-20.0,39.5],[-28.0,34.5],[-34.5,26.0],[-35.3,19.5],[-33.0,15.5],[-24.0,11.0],[-10.0,4.0],[2.0,-3.0],[10.0,-18.5],[20.0,-19.5],[28.5,-15.0],[35.5,-10.0],[36.6,-9.6]],
  // Singapore → Australia (Lombok)
  [[1.25,104.0],[-2.0,107.4],[-6.0,113.0],[-8.7,115.75],[-14.0,117.0],[-20.3,118.6]],
  // SE Asia → Hong Kong → Busan
  [[22.0,116.0],[25.0,121.8],[29.0,124.0],[33.0,127.8],[35.0,129.1]],
  // North Sea → Baltic
  [[52.0,3.95],[53.8,6.8],[56.2,7.6],[57.9,10.7],[56.4,12.0],[55.6,12.75],[55.1,14.8],[56.5,18.6],[58.3,20.6],[59.6,23.5],[59.95,27.5],[59.9,29.8]],
  // Med: Port Said → Piraeus → Bosphorus → Novorossiysk
  [[31.4,32.33],[33.5,28.5],[36.0,25.3],[37.9,23.55],[39.2,24.6],[40.2,26.2],[40.95,28.9],[41.25,29.1],[42.8,31.5],[44.3,36.5],[44.65,37.8]],
  // W Med: Gibraltar → Marseille → Genoa
  [[35.95,-5.6],[37.0,-1.0],[39.5,2.6],[42.6,4.6],[43.2,5.3],[43.6,7.5],[44.3,8.9]],
  // China coast → Japan
  [[31.0,122.6],[33.0,126.0],[34.0,130.8],[33.6,135.0],[34.6,139.9]],
  // Australia east coast
  [[-33.85,151.4],[-30.0,153.8],[-27.3,153.6],[-24.0,152.8],[-19.0,147.8],[-12.0,143.8],[-10.4,142.1],[-9.8,137.0],[-8.6,125.0],[-8.7,115.75]],
  // Brazil → West Africa
  [[-23.9,-46.3],[-22.9,-41.0],[-15.0,-37.5],[-5.0,-34.4],[2.0,-25.0],[6.0,-8.0],[6.3,3.4]],
];
const LANE_V = LANES.map((l) => { const pts = l.map(([la, lo]) => geo.vec(la, lo)); const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.acos(clamp(v3.dot(pts[i - 1], pts[i]), -1, 1))); return { pts, cum, len: cum[cum.length - 1], raw: l }; });
const SHIPS = [];
(function genShips() {
  const NAMES1 = ['Northern','Aurora','Pacific','Silver','Atlas','Coral','Ocean','Polar','Cape','Golden','Blue','Iron','Jade','Amber','Crimson','Morning','Evening','Sea','Star','Harbor'];
  const NAMES2 = ['Lark','Spirit','Voyager','Pioneer','Horizon','Dawn','Tide','Meridian','Wave','Crest','Falcon','Unity','Glory','Venture','Breeze','Pearl','Fortune','Harmony','Trader','Express'];
  const kinds = ['container','tanker','bulk','LNG','ro-ro','general'];
  const tot = LANE_V.reduce((s, l) => s + l.len, 0);
  for (let i = 0; i < 2200; i++) {
    let r = R() * tot, li = 0; for (; li < LANE_V.length - 1; li++) { if (r < LANE_V[li].len) break; r -= LANE_V[li].len; }
    const kn = kinds[R.int(kinds.length)];
    const kts = kn === 'container' ? R.range(14, 21) : R.range(10, 15);
    SHIPS.push({ lane: li, off: R(), dir: R() < 0.5 ? 1 : -1, speed: (kts * 1.852) / EARTH_KM / 3600, lat0: R.gauss() * 0.12, name: 'MV ' + R.pick(NAMES1) + ' ' + R.pick(NAMES2), kind: kn, mmsi: 200000000 + R.int(500000000), dark: R() < 0.012 });
  }
  // anchorage queues: Suez south & north, Singapore, Rotterdam, LA/LB
  const Q = [[29.72,32.56,48,0.09,'suez'],[31.45,32.2,30,0.1,'suez'],[1.22,103.9,90,0.12,'sin'],[52.0,3.6,26,0.12,'rtm'],[33.55,-118.2,22,0.08,'lalb'],[29.1,48.6,18,0.15,''],[22.2,113.9,40,0.12,'']];
  for (const [la, lo, n, s, q] of Q) for (let i = 0; i < n; i++) SHIPS.push({ anchor: [la + R.gauss() * s * 0.6, lo + R.gauss() * s], name: 'MV ' + R.pick(NAMES1) + ' ' + R.pick(NAMES2), kind: R.pick(kinds), mmsi: 200000000 + R.int(500000000), queue: q, speed: 0 });
})();
function shipAt(s, t) {
  if (s.anchor) { const [la, lo] = s.anchor; return { lat: la, lon: lo, v: geo.vec(la, lo), hdg: hash01(s.mmsi) * TAU, sog: 0 }; }
  const L = LANE_V[s.lane];
  let d = (s.off * L.len + s.dir * s.speed * t) % L.len; if (d < 0) d += L.len;
  let i = 1; while (i < L.cum.length - 1 && L.cum[i] < d) i++;
  const seg = L.cum[i] - L.cum[i - 1] || 1; const p = (d - L.cum[i - 1]) / seg;
  let v = geo.slerp(L.pts[i - 1], L.pts[i], p);
  const [la0, lo0] = geo.ll(v);
  const brg = geo.bearing(...L.raw[i - 1], ...L.raw[i]) + (s.dir < 0 ? Math.PI : 0);
  const [la, lo] = geo.dest(la0, lo0, brg + Math.PI / 2, s.lat0 * 18);
  return { lat: la, lon: lo, v: geo.vec(la, lo), hdg: brg, sog: s.speed * EARTH_KM * 3600 / 1.852 };
}

/* ---------- satellites (circular orbits; GPU-propagated) ---------- */
const MU = 398600.4418;
const SATS = [];
function addSat(o) { const a = EARTH_KM + o.alt; o.n = Math.sqrt(MU / (a * a * a)); SATS.push(o); return o; }
(function genSats() {
  // Starlink-like shells (53°, 550 km), (70°, 570 km), (97.6°, 560 km)
  const shells = [[53, 550, 22, 36], [70, 570, 12, 20], [97.6, 560, 10, 18], [43, 540, 14, 22]];
  for (const [inc, alt, planes, per] of shells) for (let p = 0; p < planes; p++) for (let k = 0; k < per; k++)
    addSat({ name: 'STARLINK-' + (1000 + SATS.length), inc: inc * D2R, raan: (p / planes) * TAU, u0: (k / per) * TAU + p * 0.13, alt: alt + R.range(-4, 4), kind: 0 });
  // other LEO (EO, weather, cubesats)
  for (let i = 0; i < 420; i++) addSat({ name: 'LEO-' + (40000 + i), inc: (R() < 0.5 ? R.range(96.5, 99) : R.range(30, 82)) * D2R, raan: R() * TAU, u0: R() * TAU, alt: R.range(380, 1200), kind: 1 });
  // GNSS MEO
  for (let i = 0; i < 31; i++) addSat({ name: 'GPS ' + (i + 1), inc: 55 * D2R, raan: (Math.floor(i / 5.2) / 6) * TAU, u0: (i % 6) / 6 * TAU + i, alt: 20180, kind: 2 });
  for (let i = 0; i < 24; i++) addSat({ name: 'GNSS-E ' + (i + 1), inc: 56 * D2R, raan: (i % 3) / 3 * TAU, u0: i / 8 * TAU, alt: 23222, kind: 2 });
  // GEO belt
  for (let i = 0; i < 90; i++) addSat({ name: 'GEO-' + (i + 1), inc: R.range(0, 0.08) * D2R, raan: 0, u0: R() * TAU, alt: 35786, kind: 3, geo: true });
  // debris
  for (let i = 0; i < 600; i++) addSat({ name: 'DEB ' + (20000 + i), inc: R.range(60, 100) * D2R, raan: R() * TAU, u0: R() * TAU, alt: R.range(650, 1500), kind: 4 });
  // Starlink train (fresh launch, low and tight)
  for (let i = 0; i < 24; i++) addSat({ name: 'STARLINK-T' + (i + 1), inc: 43 * D2R, raan: 1.9, u0: 2.4 + i * 0.006, alt: 312, kind: 5 });
})();
const ISS = addSat({ name: 'ISS (ZARYA)', inc: 51.64 * D2R, raan: 4.1, u0: 0.7, alt: 418, kind: 6 });
const CSS = addSat({ name: 'CSS (TIANHE)', inc: 41.47 * D2R, raan: 2.2, u0: 3.1, alt: 385, kind: 6 });
function satAt(s, t, gmst) { // ECEF unit vector with altitude
  const u = s.u0 + s.n * t, r = 1 + s.alt / EARTH_KM;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(s.raan), sO = Math.sin(s.raan), ci = Math.cos(s.inc), si = Math.sin(s.inc);
  let x = cu * cO - su * ci * sO, y = cu * sO + su * ci * cO, z = su * si;
  if (s.geo) { const g = gmst; const c = Math.cos(s.u0), sn = Math.sin(s.u0); return [r * c, r * sn, z * r]; }
  const cg = Math.cos(-gmst), sg = Math.sin(-gmst);
  return [r * (x * cg - y * sg), r * (x * sg + y * cg), r * z];
}

/* ---------- quakes (illustrative, along plate boundaries) ---------- */
const QUAKE_ZONES = [[35.5,141.9],[38.3,142.4],[-6,130],[-20,-70],[-33,-72],[13,-90],[61,-148],[52,-170],[-41,174],[36,71],[28,84],[38,26],[-17,168],[-5,152],[18,-68],[40,30],[37,-121],[-1,-77],[14,121],[24,123]];
const QUAKES = [];
for (let i = 0; i < 46; i++) {
  const z = R.pick(QUAKE_ZONES);
  QUAKES.push({ lat: z[0] + R.gauss() * 1.6, lon: z[1] + R.gauss() * 1.6, mag: +(2.6 + Math.pow(R(), 2.6) * 3.2).toFixed(1), t: R.range(-72, 0) * 3600, depth: Math.round(R.range(8, 120)) });
}
const BIGQ = { lat: 35.62, lon: 141.95, mag: 6.4, t: -5.4 * 3600, depth: 32, place: 'off the coast of Honshu' };
QUAKES.push(BIGQ);
for (let i = 0; i < 9; i++) QUAKES.push({ lat: BIGQ.lat + R.gauss() * 0.35, lon: BIGQ.lon + R.gauss() * 0.4, mag: +(3.4 + R() * 1.6).toFixed(1), t: BIGQ.t + R.range(0.2, 5) * 3600, depth: Math.round(R.range(10, 50)) });

/* ---------- fires (FIRMS-like hotspots; start times so the ribbon shows spread) ---------- */
const FIRE_CLUSTERS = [
  [40.2,-8.1,'Central Portugal',90,1.0],[42.4,-7.4,'Galicia',60,0.9],[38.1,23.4,'Attica',50,0.7],[39.8,21.0,'Epirus',30,0.5],[36.8,30.6,'Antalya',40,0.6],
  [34.4,-118.5,'Los Angeles County',45,0.8],[39.7,-121.6,'Butte County',40,0.6],[-14.0,-60.0,'Rondônia',180,1.6],[-9.5,24.0,'Katanga savanna',260,2.6],
  [8.5,19.0,'Central African savanna',220,2.6],[-17.0,131.0,'Northern Territory',140,2.0],[61.5,128.0,'Yakutia',60,1.3],[-2.5,113.5,'Kalimantan',70,1.0],
  [21.0,98.0,'Shan State',60,1.2],[-22.0,-55.0,'Mato Grosso do Sul',70,1.2],
];
const FIRES = [];
for (const [la, lo, name, n, s] of FIRE_CLUSTERS) {
  const tStart = R.range(-70, -6) * 3600;
  for (let i = 0; i < n; i++) {
    const rad = Math.sqrt(R()) * s, ang = R() * TAU;
    // fronts move with prevailing wind: later ignitions sit downwind
    const tt = tStart + (rad / s) * R.range(20, 110) * 3600;
    FIRES.push({ lat: la + Math.sin(ang) * rad * 0.8, lon: lo + Math.cos(ang) * rad, t: tt, frp: R.range(5, 120), cluster: name });
  }
}

/* ---------- tropical cyclone (illustrative name) ---------- */
const CYCLONE = {
  name: 'Typhoon Halcyon', designation: '26W (illustrative)',
  // [hoursFromNow, lat, lon, windKmh, pressure hPa]
  track: [[-72,11.2,141.8,95,992],[-60,11.9,139.6,110,985],[-48,12.6,137.4,130,975],[-36,13.4,135.3,150,965],[-24,14.3,133.1,170,955],[-12,15.2,130.9,180,948],[0,16.2,128.8,185,944],
          [12,17.3,126.9,195,938],[24,18.6,125.1,200,935],[36,20.1,123.6,190,940],[48,21.8,122.5,175,950],[72,25.0,121.9,140,968],[96,28.6,124.4,110,980],[120,32.4,129.0,85,990]],
  at(hours) {
    const tr = this.track; if (hours <= tr[0][0]) return { lat: tr[0][1], lon: tr[0][2], wind: tr[0][3], p: tr[0][4] };
    for (let i = 1; i < tr.length; i++) if (hours <= tr[i][0]) {
      const a = tr[i - 1], b = tr[i], f = (hours - a[0]) / (b[0] - a[0]);
      return { lat: lerp(a[1], b[1], f), lon: lerp(a[2], b[2], f), wind: lerp(a[3], b[3], f), p: lerp(a[4], b[4], f) };
    }
    const z = tr[tr.length - 1]; return { lat: z[1], lon: z[2], wind: z[3], p: z[4] };
  },
  cone(hours) { return hours <= 0 ? 0 : 35 + hours * 3.1; }, // km radius of uncertainty
};

/* ---------- cities (search + scatter) ---------- */
const CITIES = [
  ['New York',40.7128,-74.006],['London',51.5072,-0.1276],['Tokyo',35.6762,139.6503],['Paris',48.8566,2.3522],['Shanghai',31.2304,121.4737],['Mumbai',19.076,72.8777],
  ['São Paulo',-23.5505,-46.6333],['Mexico City',19.4326,-99.1332],['Cairo',30.0444,31.2357],['Lagos',6.5244,3.3792],['Istanbul',41.0082,28.9784],['Moscow',55.7558,37.6173],
  ['Seoul',37.5665,126.978],['Jakarta',-6.2088,106.8456],['Delhi',28.6139,77.209],['Los Angeles',34.0522,-118.2437],['Chicago',41.8781,-87.6298],['Singapore',1.3521,103.8198],
  ['Sydney',-33.8688,151.2093],['Dubai',25.2048,55.2708],['Hong Kong',22.3193,114.1694],['Berlin',52.52,13.405],['Madrid',40.4168,-3.7038],['Rome',41.9028,12.4964],
  ['Bangkok',13.7563,100.5018],['Toronto',43.6532,-79.3832],['San Francisco',37.7749,-122.4194],['Buenos Aires',-34.6037,-58.3816],['Johannesburg',-26.2041,28.0473],['Nairobi',-1.2921,36.8219],
  ['Kathmandu',27.7172,85.324],['Lisbon',38.7223,-9.1393],['Athens',37.9838,23.7275],['Reykjavík',64.1466,-21.9426],['Tromsø',69.6492,18.9553],['Honolulu',21.3069,-157.8583],
  ['Manila',14.5995,120.9842],['Taipei',25.033,121.5654],['Rotterdam',51.9244,4.4777],['Suez',29.9668,32.5498],['Cape Canaveral',28.3922,-80.6077],['Dothan',31.2232,-85.3905],
];
const CITY_V = CITIES.map(([n, la, lo]) => ({ name: n, lat: la, lon: lo }));

/* ---------- people (fictional handles) ---------- */
const PEOPLE = {
  you: { h: 'you', name: 'You', hue: 205 },
  kora: { h: 'kora_maps', name: 'Kora M.', hue: 160 },
  tamang: { h: 'tamang_lens', name: 'Pemba T.', hue: 30 },
  rotor: { h: 'rotorwash_ret', name: 'J. Alder', hue: 95 },
  hydro: { h: 'hydro_nerd', name: 'Sita R.', hue: 200 },
  ais: { h: 'ais_owl', name: 'Marek', hue: 270 },
  sky: { h: 'skywatch_ana', name: 'Ana P.', hue: 330 },
  geo: { h: 'geodesy_dan', name: 'Dan K.', hue: 50 },
  crowd: { h: 'row_m_seat14', name: 'Lena', hue: 300 },
  news: { h: 'chopper_cam9', name: 'Desk 9', hue: 10 },
  ai: { h: 'claude', name: 'AI (proposal)', hue: 260, ai: true },
  // round two: people across the bands (all fictional)
  nadia: { h: 'nadia_basco', name: 'Nadia R.', hue: 18, home: [20.45, 121.97], where: 'Basco, Batanes' },
  rafa: { h: 'rafa_aparri', name: 'Rafael D.', hue: 140, home: [18.36, 121.64], where: 'Aparri' },
  mei: { h: 'mei_taitung', name: 'Mei-Ling C.', hue: 345, home: [22.76, 121.14], where: 'Taitung' },
  joon: { h: 'joon_pilotboat', name: 'Joon-ho P.', hue: 190, domain: 'Mariner', home: [22.61, 120.28], where: 'Kaohsiung' },
  lin: { h: 'lin_forecasts', name: 'Lin W.', hue: 225, domain: 'Met', where: 'Taipei' },
  repost: { h: 'breaking_now_24', name: 'breaking_now_24', hue: 0 },
  aiko: { h: 'aiko_sendai', name: 'Aiko S.', hue: 300, home: [38.27, 140.87], where: 'Sendai' },
  tetsu: { h: 'tetsu_rail', name: 'Tetsuya O.', hue: 60, domain: 'Rail ops', where: 'Fukushima' },
  tomas: { h: 'tomas_atc', name: 'Tomás V.', hue: 205, domain: 'Pilot', where: 'Reykjavík' },
  seat: { h: 'seat_23F', name: 'Passenger, 23F', hue: 40 },
  ines: { h: 'ines_coimbra', name: 'Inês M.', hue: 330, home: [40.2, -8.42], where: 'Coimbra' },
  bomb: { h: 'bombeiro_ruiz', name: 'Cpt. Ruiz', hue: 8, domain: 'First responder', home: [40.1, -8.0], where: 'Pampilhosa' },
  carla: { h: 'carla_avellaneda', name: 'Carla G.', hue: 280, home: [-34.66, -58.37], where: 'Avellaneda' },
  dev: { h: 'dev_storms', name: 'Devansh K.', hue: 110, domain: 'Storm spotter', where: 'Arlington, TX' },
  yuki: { h: 'yuki_kagoshima', name: 'Yuki T.', hue: 170, home: [31.6, 130.56], where: 'Kagoshima' },
  ola: { h: 'ola_tromso', name: 'Ola B.', hue: 150, home: [69.65, 18.96], where: 'Tromsø' },
  amara: { h: 'amara_lakefront', name: 'Amara J.', hue: 25, home: [41.88, -87.62], where: 'Chicago' },
};

Object.assign(GE, { AP, apByIata, FLIGHTS, flightAt, OPNAME, LANES, LANE_V, SHIPS, shipAt, SATS, ISS, CSS, satAt, QUAKES, BIGQ, FIRES, FIRE_CLUSTERS, CYCLONE, CITY_V, PEOPLE });
