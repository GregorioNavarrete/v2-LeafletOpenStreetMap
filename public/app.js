/* Demo E — Explorador de funciones Leaflet/OSM + Pedido en Vivo (simulación)
 * Todas las funciones corren en el navegador:
 *   - Leaflet (BSD-2) + tiles OSM / Esri Imagery / CARTO Dark (gratuitos)
 *   - Nominatim para buscar direcciones (1 consulta/s, sin clave)
 *   - Haversine (distancia esférica) y área esférica de polígono
 *   - Simulación del cadete: interpolación a velocidad constante sobre una
 *     polilínea de waypoints; ETA = distancia restante / velocidad; geocerca
 *     (círculo) dispara la notificación "está a menos de N metros".
 */
'use strict';

const $ = id => document.getElementById(id);
const kms = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(d < 10 ? 2 : 1) + ' km';

/* distancia esférica entre dos {lat,lng}, en km */
function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* área del polígono en m² (suma triangulada desde el primer punto, proyección local) */
function areaPoligono(pts) {
  const R = 6371e3, rad = Math.PI / 180;
  const lat0 = pts[0].lat;
  const v = pts.map(p => ({
    x: (p.lng - pts[0].lng) * rad * Math.cos(lat0 * rad) * R,
    y: (p.lat - lat0) * rad * R
  }));
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    s += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return Math.abs(s) / 2;
}

function fError(msg) { const e = $('error'); e.textContent = '⚠ ' + msg; e.classList.remove('oculto'); }

/* ---------------- pestañas ---------------- */
document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.remove('activo'));
  document.querySelectorAll('.pestana').forEach(x => x.classList.remove('visible'));
  b.classList.add('activo');
  $('pestaña-' + b.dataset.tab).classList.add('visible');
  if (window._mapas) Object.values(window._mapas).forEach(m => m.invalidateSize());
}));

/* La init puede llamarse más de una vez (load listener en HTML) */
let yaInit = false;
window.initMapas = function () {
  if (yaInit || !window.L) return;
  yaInit = true;
  try {
    window._mapas = { explorador: iniciarExplorador(), pedido: iniciarPedido() };
  } catch (e) {
    fError('Fallo al inicializar los mapas: ' + e.message);
  }
};

/* ==========================================================
   PESTAÑA 1 — EXPLORADOR DE FUNCIONES
   ========================================================== */
function iniciarExplorador() {
  const map = L.map('mapaE', { center: [-27.7842, -64.2644], zoom: 14 });

  const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 });
  const baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles Esri World Imagery (demo)', maxZoom: 19 });
  const baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO © OpenStreetMap', maxZoom: 20 });
  baseOSM.addTo(map);
  L.control.layers({ 'OpenStreetMap': baseOSM, 'Satélite (Esri)': baseSat, 'Dark (CARTO)': baseDark }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ metric: true }).addTo(map);

  const capPersonas = L.layerGroup().addTo(map);
  const capDibujo = L.layerGroup().addTo(map);
  const capMedicion = L.layerGroup().addTo(map);

  const personas = [];          // { id, lat, lng, marker }
  const zonas = [];             // { tipo:'radio', lat,lng,radio } | { tipo:'zona', m2, nPuntos }
  let zonasDibujadas = [];      // layers para limpiar
  let numPersona = 0;
  let puntosZona = [], poligonoActivo = null;
  let medicionOn = false, puntosMedidos = [], rutaMedida = null;

  const icono = emoji => L.divIcon({ html: `<div class="etiquetaPersona">${emoji}</div>`, className: '', iconSize: [0, 0] });

  /* --- herramientas (toggle) --- */
  let activo = null;
  function setHerramienta(nombre, boton) {
    activo = (activo === nombre) ? null : nombre;
    document.querySelectorAll('.htool').forEach(b => b.classList.remove('activo'));
    if (activo) boton.classList.add('activo');
    if (activo !== 'medir') { medicionOn = false; $('medRuta').textContent = 'Modo medir apagado'; }
    if (activo !== 'zona') { puntosZona = []; poligonoActivo = null; }
  }
  document.querySelector('#hPersona').onclick = e => setHerramienta('persona', e.target);
  document.querySelector('#hMedir').onclick = e => setHerramienta('medir', e.target);
  document.querySelector('#hRadio').onclick = e => setHerramienta('radio', e.target);
  document.querySelector('#hZona').onclick = e => setHerramienta('zona', e.target);
  document.querySelector('#hYo').onclick = () => {
    if (!navigator.geolocation) { fError('Este navegador no soporta geolocalización.'); return; }
    navigator.geolocation.getCurrentPosition(p => {
      const mk = L.marker([p.coords.latitude, p.coords.longitude], { icon: icono('🧭') }).addTo(capPersonas);
      mk.bindPopup(`<b>Estás acá</b><br>${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}<br><small>±${p.coords.accuracy.toFixed(0)} m (GPS del navegador)</small>`);
      mk.on('click', () => map.flyTo([p.coords.latitude, p.coords.longitude], 15));
      map.flyTo([p.coords.latitude, p.coords.longitude], 15);
    }, err => fError('No se pudo obtener tu ubicación: ' + err.message));
  };
  document.querySelector('#hLimpiar').onclick = () => {
    capPersonas.clearLayers(); capDibujo.clearLayers(); capMedicion.clearLayers();
    personas.length = 0; zonas.length = 0; zonasDibujadas = []; puntosZona = []; poligonoActivo = null;
    medicionOn = false; puntosMedidos = [];
    $('medRuta').textContent = 'Modo medir apagado';
    pintarTablas(); pintarZonas();
  };

  /* --- clic del mapa según herramienta activa --- */
  map.on('click', e => {
    const { lat, lng } = e.latlng;

    if (activo === 'persona') {
      numPersona++;
      const mk = L.marker([lat, lng], { icon: icono('👤'), draggable: true }).addTo(capPersonas);
      const persona = { id: numPersona, lat, lng, marker: mk };
      mk.bindPopup(`<b>Persona #${numPersona}</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}<br><small>Arrastrála y las distancias se recalculan solo.</small>`);
      mk.on('dragend', ev => {
        const p = ev.target.getLatLng();
        persona.lat = p.lat; persona.lng = p.lng;
        pintarTablas();
      });
      personas.push(persona);
      pintarTablas();
    }

    else if (activo === 'radio') {
      const r = Math.max(50, Number($('inRadio').value) || 500);
      const c = L.circle([lat, lng], { radius: r, color: '#6b4fbb', fillOpacity: .12 }).addTo(capDibujo);
      c.bindPopup(`⭕ Radio de <b>${kms(r / 1000)}</b><br>centro en ${lat.toFixed(4)}, ${lng.toFixed(4)}<br><small>Útil para zona de cobertura o "radio gratis" de un local.</small>`);
      zonas.push({ tipo: 'radio', lat, lng, radio: r });
      zonasDibujadas.push(c);
      pintarZonas();
    }

    else if (activo === 'zona') {
      puntosZona.push([lat, lng]);
      if (poligonoActivo) capDibujo.removeLayer(poligonoActivo);
      poligonoActivo = L.polygon(puntosZona, { color: '#1a7f37', fillOpacity: .14 }).addTo(capDibujo);
      poligonoActivo.bindPopup(`🟦 Zona en armado<br>Área parcial: <b>${(areaPoligono(puntosZona.map(p => ({ lat: p[0], lng: p[1] }))) / 1e4).toFixed(2)} ha</b><br>Doble clic para fijarla`);
      poligonoActivo.on('dblclick', () => fijarZona());
    }

    else if (activo === 'medir') {
      if (!medicionOn) {
        medicionOn = true;
        rutaMedida = L.polyline([], { color: '#0b57d0', dashArray: '6 5' }).addTo(capMedicion);
        puntosMedidos = [];
      }
      puntosMedidos.push([lat, lng]);
      rutaMedida.setLatLngs(puntosMedidos);
      L.circleMarker([lat, lng], { radius: 4, color: '#0b57d0', fillOpacity: .8 }).addTo(capMedicion);
      const total = puntosMedidos.slice(1).reduce((s, p, i) =>
        s + haversine({ lat: puntosMedidos[i][0], lng: puntosMedidos[i][1] }, { lat: p[0], lng: p[1] }), 0);
      $('medRuta').innerHTML = `Medición: <b>${kms(total)}</b> en ${puntosMedidos.length} puntos`;
    }
  });

  function fijarZona() {
    const pts = puntosZona.map(p => ({ lat: p[0], lng: p[1] }));
    zonas.push({ tipo: 'zona', m2: areaPoligono(pts), nPuntos: pts.length });
    puntosZona = []; poligonoActivo = null;
    pintarZonas();
  }

  /* --- distancia entre dos personas elegidas + matriz completa --- */
  function distanciaPar() {
    const i1 = $('selPersona1').selectedIndex, i2 = $('selPersona2').selectedIndex;
    if (personas.length < 2 || i1 < 0 || i2 < 0 || i1 === i2) {
      $('distPar').textContent = '—';
      $('db').textContent = personas.length < 2 ? 'Marcá al menos 2 personas en el mapa.' : 'Elegí dos personas distintas.';
      return;
    }
    const a = personas[i1], b = personas[i2];
    $('distPar').textContent = kms(haversine(a, b));
    $('db').textContent = `Persona #${a.id} ↔ Persona #${b.id} · línea recta (Haversine, esfera de 6 371 km).`;
  }
  $('selPersona1').onchange = distanciaPar;
  $('selPersona2').onchange = distanciaPar;

  function pintarTablas() {
    const opts = personas.map(p => `<option value="${p.id}">Persona #${p.id}</option>`).join('');
    $('selPersona1').innerHTML = opts || '<option>—</option>';
    $('selPersona2').innerHTML = opts || '<option>—</option>';
    if (personas.length >= 2) { $('selPersona1').selectedIndex = 0; $('selPersona2').selectedIndex = 1; }
    distanciaPar();

    const tb = $('tablaDist');
    if (!personas.length) { tb.innerHTML = '<tr><td class="ot">Sin personas marcadas todavía</td></tr>'; return; }
    let html = '<tr><th></th>' + personas.map(p => `<th>#${p.id}</th>`).join('') + '</tr>';
    personas.forEach(a => {
      html += `<tr><th>#${a.id}</th>` + personas.map(b => {
        if (a.id === b.id) return '<td>—</td>';
        return `<td>${kms(haversine(a, b))}</td>`;
      }).join('') + '</tr>';
    });
    tb.innerHTML = html;
  }

  function pintarZonas() {
    $('zonasInfo').innerHTML = zonas.length
      ? zonas.map((z, i) => z.tipo === 'radio'
        ? `<li>⭕ Radio #${i + 1}: <b>${kms(z.radio / 1000)}</b> desde ${z.lat.toFixed(3)}, ${z.lng.toFixed(3)}</li>`
        : `<li>🟦 Zona #${i + 1}: <b>${(z.m2 / 1e4).toFixed(2)} ha</b> (${z.nPuntos} vértices)</li>`).join('')
      : 'Sin radios ni zonas fijadas. Marcá puntos en el mapa con la herramienta activa.';
  }

  /* --- búsqueda de direcciones con Nominatim (política: 1 req/s) --- */
  $('btnBuscar').onclick = async () => {
    const q = $('inBuscar').value.trim();
    if (!q) return;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=3&accept-language=es&q=' + encodeURIComponent(q);
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const res = await r.json();
      if (!res.length) { fError('Nominatim no encontró esa dirección.'); return; }
      if ($('error').textContent) $('error').classList.add('oculto');
      res.forEach(o => L.marker([+o.lat, +o.lon]).addTo(capDibujo).bindPopup(`<b>${o.display_name}</b>`));
      map.flyToBounds(L.latLngBounds(res.map(o => [+o.lat, +o.lon])), { maxZoom: 16 });
    } catch (e) {
      fError('Falla la búsqueda (¿sin Internet?): ' + e.message);
    }
  };
  $('inBuscar').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnBuscar').click(); });

  pintarTablas(); pintarZonas();
  return map;
}

/* ==========================================================
   PESTAÑA 2 — PEDIDO EN VIVO (simulación de delivery)
   ========================================================== */
const RUTA_CADETE = [  // waypoints mock por el centro de Sgo. del Estero; el último es tu casa
  [-27.7870, -64.2620],  // 🍕 pizzería
  [-27.7860, -64.2590],
  [-27.7843, -64.2570],
  [-27.7822, -64.2568],
  [-27.7808, -64.2575],
  [-27.7796, -64.2590],
  [-27.7802, -64.2612],
  [-27.7816, -64.2633]   // 🏠 tu casa
];
const RESTO = [-27.7870, -64.2620];
const CASA = [-27.7816, -64.2633];

function iniciarPedido() {
  const map = L.map('mapaP', { center: [-27.784, -64.2595], zoom: 15 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  L.control.scale().addTo(map);

  const icResto = L.divIcon({ html: '<div class="etiquetaPersona">🍕</div>', className: '', iconSize: [0, 0] });
  const icCasa = L.divIcon({ html: '<div class="etiquetaPersona">🏠</div>', className: '', iconSize: [0, 0] });
  L.marker(RESTO, { icon: icResto }).addTo(map).bindPopup('<b>Pizzería “La Centro”</b><br>El pedido sale de acá');
  L.marker(CASA, { icon: icCasa }).addTo(map).bindPopup('<b>Tu casa</b><br>Entrega estimada acá');

  L.polyline(RUTA_CADETE, { color: '#c0c8d2', weight: 5 }).addTo(map);          // "calle" simulada
  const crumb = L.polyline([], { color: '#6b4fbb', weight: 4 }).addTo(map);     // camino ya recorrido
  const mkCade = L.marker(RESTO, { icon: L.divIcon({ html: '<div class="etiquetaPersona">🛵</div>', className: '', iconSize: [0, 0] }) })
    .addTo(map).bindPopup('<b>Cadete 🛵</b><br>Esperando simular el pedido');

  // total de la ruta esférica RESTO..CASA (km)
  const totalKm = RUTA_CADETE.slice(1).reduce((s, p, i) =>
    s + haversine({ lat: RUTA_CADETE[i][0], lng: RUTA_CADETE[i][1] }, { lat: p[0], lng: p[1] }), 0);

  const cercos = [];
  cercos.push(L.circle(CASA, { radius: Number($('inCerco').value), color: '#c2870b', dashArray: '4 4', fillOpacity: .08 }).addTo(map)
    .bindPopup(`Geocerca de aviso: <b>${$('inCerco').value} m</b> alrededor de tu casa`));

  const ETAPAS = ['⏳ Sin pedido simulado', '👨‍🍳 Preparando…', '🛵 Cadete en camino', '🏁 ¡Entregado!'];
  function setEstado(step) {
    $('estadoChip').textContent = ETAPAS[step];
    document.querySelectorAll('#pasos li').forEach((li, i) => {
      li.classList.toggle('hecho', i <= step);
      li.classList.toggle('actual', i === step);
    });
  }

  let iTramo = 0, frac = 0, timer = null, cercaYa = false;

  const iconoCade = emoji => L.divIcon({ html: `<div class="etiquetaPersona">${emoji}</div>`, className: '', iconSize: [0, 0] });

  function tick() {
    const A = RUTA_CADETE[iTramo], B = RUTA_CADETE[iTramo + 1];
    if (!B) { entregar(); return; }
    const dt = 0.25 * Number($('inAccel').value || 1);   // tick cada 250 ms, acelerable
    const kmTick = (Number($('inVel').value) * dt) / 3600;
    const dTramo = haversine({ lat: A[0], lng: A[1] }, { lat: B[0], lng: B[1] }) || 1e-9;

    frac += kmTick / dTramo;
    if (frac >= 1) {
      frac = 0; iTramo++;
      if (iTramo >= RUTA_CADETE.length - 1) { entregar(); return; }
    }
    const A2 = RUTA_CADETE[iTramo], B2 = RUTA_CADETE[iTramo + 1];
    const lat = A2[0] + (B2[0] - A2[0]) * frac;
    const lng = A2[1] + (B2[1] - A2[1]) * frac;
    mkCade.setLatLng([lat, lng]);
    crumb.addLatLng([lat, lng]);

    // distancia restante por la ruta (tramo actual + próximos tramos completos)
    let rest = haversine({ lat, lng }, { lat: B2[0], lng: B2[1] });
    for (let j = iTramo + 1; j < RUTA_CADETE.length - 1; j++) {
      rest += haversine({ lat: RUTA_CADETE[j][0], lng: RUTA_CADETE[j][1] }, { lat: RUTA_CADETE[j + 1][0], lng: RUTA_CADETE[j + 1][1] });
    }
    const vel = Math.max(1, Number($('inVel').value));
    $('pDist').textContent = kms(rest);
    $('pEta').textContent = Math.round((rest / vel) * 60) + ' min';
    $('pBarra').style.width = ((1 - rest / totalKm) * 100).toFixed(0) + '%';
    mkCade.setPopupContent(`<b>Cadete 🛵</b><br>${lat.toFixed(4)}, ${lng.toFixed(4)}<br>faltan <b>${kms(rest)}</b> por la ruta`);

    // geocerca
    if (!cercaYa && haversine({ lat, lng }, { lat: CASA[0], lng: CASA[1] }) * 1000 <= Number($('inCerco').value)) {
      cercaYa = true;
      toast('🔔 El cadete está a menos de ' + $('inCerco').value + ' m de tu casa — salí a esperar 🔥');
      mkCade.setIcon(iconoCade('🔥'));
    }
  }

  function entregar() {
    pausar();
    setEstado(3);
    $('estadoChip').textContent = '🏁 ¡Entregado! ¡Buen provecho!';
    $('pDist').textContent = '0 m';
    $('pEta').textContent = '0 min';
    $('pBarra').style.width = '100%';
    toast('✅ Pedido entregado — calificá al cadete ⭐⭐⭐⭐⭐');
    $('btnSimular').disabled = false;
    $('btnPausa').textContent = '▶️ Reanudar';
  }

  function pausar() {
    if (timer) { clearInterval(timer); timer = null; }
    $('btnPausa').disabled = false;
    $('btnPausa').textContent = '▶️ Reanudar';
  }
  function resume() {
    if (timer) return;
    timer = setInterval(tick, 250);
    $('btnPausa').disabled = false;
    $('btnPausa').textContent = '⏸ Pausar';
    $('btnSimular').disabled = true;
  }

  function inicioSim() {
    if (timer) { clearInterval(timer); timer = null; }
    iTramo = 0; frac = 0; cercaYa = false;
    crumb.setLatLngs([]);
    mkCade.setLatLng(RESTO).setIcon(iconoCade('🛵')).setPopupContent('<b>Cadete 🛵</b><br>Retira tu pedido…');
    mkCade.bindPopup('<b>Cadete 🛵</b><br>Retira tu pedido…');
    $('pBarra').style.width = '0%';
    $('pDist').textContent = '—'; $('pEta').textContent = '—';
    setEstado(1);
    $('btnSimular').disabled = true;
    setTimeout(() => {
      setEstado(2);
      resume();
      toast('🛵 Cadete salió con tu pedido. Mirá el mapa…');
    }, 2500);
  }

  $('btnSimular').onclick = inicioSim;
  $('btnReset').onclick = () => { if (timer) { clearInterval(timer); timer = null; } $('btnSimular').disabled = false; $('btnPausa').disabled = true; $('btnPausa').textContent = '⏸ Pausar'; inicioSim(); };
  $('btnPausa').onclick = () => { if (timer) { pausar(); } else { resume(); } };
  $('inVel').oninput = () => $('velTxt').textContent = $('inVel').value + ' km/h';
  $('inAccel').oninput = () => $('acelTxt').textContent = '×' + $('inAccel').value;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  setEstado(0);
  return map;
}
