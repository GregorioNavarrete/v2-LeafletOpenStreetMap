/**
 * Demo E - Explorador de funciones de mapas (Leaflet + OpenStreetMap) y
 *          Mapa de Pedido en Vivo (pedido + mensajero actualizándose).
 * ------------------------------------------------------------------------
 * npm start  ->  http://localhost:3105
 *
 * No necesita proxy a APIs externas: Leaflet y OpenStreetMap son gratuitos y
 * CORS-friendly. Las búsquedas de direcciones usan Nominatim (geocodificador
 * oficial de OSM, uso gratuito con límite de 1 consulta/segundo).
 * Notes:
 *  - Tiles por CDN (unpkg). Sin Internet, el mapa no pinta tiles pero la
 *    geometría (marcadores, distancias, simulación) sigue funcionando.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3105;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log('');
  console.log('Demo E: Explorador de Mapas + Pedido en Vivo');
  console.log('Abri:  http://localhost:' + PORT);
  console.log('');
});
