export function extractPlaceCoordinates(value = '') {
  const raw = String(value || '').replace(/%21/gi, '!');
  const latitude = raw.match(/!3d(-?\d+(?:\.\d+)?)/i);
  const longitude = raw.match(/!4d(-?\d+(?:\.\d+)?)/i);
  if (!latitude || !longitude) return null;
  const lat = Number(latitude[1]);
  const lng = Number(longitude[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng, coordinatesSource: 'google_maps_place_url' };
}

export function hasCoordinates(lead = {}) {
  const lat = Number(lead.latitude);
  const lng = Number(lead.longitude);
  return lead.latitude !== null && lead.latitude !== undefined &&
    lead.longitude !== null && lead.longitude !== undefined &&
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function getGeolocatedLeads(leads = []) {
  return (Array.isArray(leads) ? leads : []).filter(hasCoordinates);
}

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

export function buildGeoJSON(leads = []) {
  return {
    type: 'FeatureCollection',
    name: 'Prospectra',
    features: getGeolocatedLeads(leads).map((lead) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lead.longitude), Number(lead.latitude)] },
      properties: {
        name: lead.name || '',
        category: lead.category || '',
        address: lead.address || '',
        city: lead.city || '',
        phone: lead.phone || '',
        website: lead.website || '',
        stage: lead.stage || '',
        qualityScore: Number(lead.qualityScore) || 0,
        mapsUrl: lead.mapsUrl || '',
        coordinatesSource: lead.coordinatesSource || 'google_maps_place_url'
      }
    }))
  };
}

export function buildKML(leads = []) {
  const placemarks = getGeolocatedLeads(leads).map((lead) => {
    const description = [
      lead.category ? 'Categoria: ' + lead.category : '',
      lead.address ? 'Endereço: ' + lead.address : '',
      lead.phone ? 'Telefone: ' + lead.phone : '',
      lead.website ? 'Site: ' + lead.website : '',
      lead.mapsUrl ? 'Google Maps: ' + lead.mapsUrl : ''
    ].filter(Boolean).join(' | ');
    return '<Placemark><name>' + xmlEscape(lead.name || 'Empresa') + '</name><description>' +
      xmlEscape(description) + '</description><Point><coordinates>' +
      Number(lead.longitude) + ',' + Number(lead.latitude) + ',0</coordinates></Point></Placemark>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Prospectra</name>' +
    placemarks + '</Document></kml>';
}

const svgEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);

export function buildCoverageSvg(leads = []) {
  const points = getGeolocatedLeads(leads);
  if (!points.length) return '';
  const width = 1000;
  const height = 440;
  const padding = 48;
  const projected = points.map((lead) => {
    const lat = Math.max(-85.0511, Math.min(85.0511, Number(lead.latitude)));
    const lon = Number(lead.longitude);
    const mercatorY = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    return { lead, xValue: lon, yValue: mercatorY };
  });
  const minX = Math.min(...projected.map((point) => point.xValue));
  const maxX = Math.max(...projected.map((point) => point.xValue));
  const minY = Math.min(...projected.map((point) => point.yValue));
  const maxY = Math.max(...projected.map((point) => point.yValue));
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const sample = projected.length > 1500
    ? projected.filter((_, index) => index % Math.ceil(projected.length / 1500) === 0).slice(0,1500)
    : projected;
  const dots = sample.map(({lead,xValue,yValue}) => {
    const x = padding + ((xValue - minX) / spanX) * innerW;
    const y = height - padding - ((yValue - minY) / spanY) * innerH;
    const title = [lead.name,lead.city,lead.address].filter(Boolean).join(' · ');
    return '<circle class="coverage-dot" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="7"><title>' + svgEscape(title) + '</title></circle>';
  }).join('');
  const grid = [0.2,0.4,0.6,0.8].map((ratio) => {
    const x = padding + innerW * ratio;
    const y = padding + innerH * ratio;
    return '<line class="coverage-gridline" x1="' + x + '" y1="' + padding + '" x2="' + x + '" y2="' + (height-padding) + '"/>' +
      '<line class="coverage-gridline" x1="' + padding + '" y1="' + y + '" x2="' + (width-padding) + '" y2="' + y + '"/>';
  }).join('');
  const minLatitude = Math.min(...points.map((point) => Number(point.latitude)));
  const maxLatitude = Math.max(...points.map((point) => Number(point.latitude)));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Distribuição relativa de ' + points.length + ' leads geolocalizados">' +
    '<title>Distribuição geográfica dos leads</title><desc>Gráfico de pontos em latitude e longitude. Não é um mapa-base cartográfico.</desc>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="12" fill="#FFFDF7"/>' +
    grid + '<g>' + dots + '</g>' +
    '<text x="' + padding + '" y="25" font-size="16" fill="#365B40">Longitude: ' + minX.toFixed(3) + '° a ' + maxX.toFixed(3) + '°</text>' +
    '<text x="' + (width-padding) + '" y="25" text-anchor="end" font-size="16" fill="#365B40">Latitude: ' +
    minLatitude.toFixed(3) + '° a ' + maxLatitude.toFixed(3) + '°</text></svg>';
}
