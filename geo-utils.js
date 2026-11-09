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
