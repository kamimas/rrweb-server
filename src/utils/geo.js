// src/utils/geo.js
// Server-side IP geolocation utility
// Uses MaxMind's GeoLite2 database via geoip-lite (no external API calls)

const geoip = require('geoip-lite');
const requestIp = require('request-ip');

/**
 * Extracts location data from an Express request
 * Handles proxies (AWS LB, Nginx) via request-ip library
 *
 * @param {import('express').Request} req - Express request object
 * @returns {{ ip: string, country: string|null, city: string|null, region: string|null }}
 */
function getLocationFromRequest(req) {
  // 1. Get the client IP (handles X-Forwarded-For, CF-Connecting-IP, etc.)
  const clientIp = requestIp.getClientIp(req);

  // 2. Handle localhost/development environment
  if (!clientIp || clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1') {
    return {
      ip: '127.0.0.1',
      country: 'LO', // Local
      city: 'Localhost',
      region: ''
    };
  }

  // 3. Lookup Geo Data from MaxMind database
  const geo = geoip.lookup(clientIp);

  if (!geo) {
    // IP not found in database (rare, usually private/internal IPs)
    return { ip: clientIp, country: null, city: null, region: null };
  }

  return {
    ip: clientIp,
    country: geo.country, // ISO 2-letter code: 'US', 'CA', 'FR'
    city: geo.city,       // 'San Francisco', 'Toronto'
    region: geo.region    // State/Province code: 'CA', 'ON'
  };
}

module.exports = { getLocationFromRequest };
