import Flatbush from 'flatbush';
import xtend from 'xtend';
import bbox from '@turf/bbox';
import CheapRuler from 'cheap-ruler';

/**
 * Index `roadNetwork` and return the matcher function
 *
 * @param      {FeatureCollection}    roadNetwork  FeatureCollection of linestrings representing roads
 * @param      {object}               options      probematch configuration object
 */
export default function probematch(roadNetwork, opts) {
  const options = xtend({
    maxProbeDistance: 0.01, // max kilometers away a probe can be to be considered a match
    compareBearing: true, // should bearing be used to filter matches?
    maxBearingRange: 5, // max bearing degrees allowed between a probe and a potentially matching road
    bidirectionalBearing: false
  }, opts);

  const network = roadNetwork.features;

  const index = indexNetwork(options, network);

  const matcher = function (probe, bearing) {
    return match(options, network, index, probe, bearing);
  };
  matcher.matchTrace = function (trace) {
    return matchTrace(options, network, index, trace);
  };
  return matcher;
}

/**
 * Iterates over each road network feature, explodes it into it's segments
 * and loads them into index arrays (`segments` && `load`)
 *
 * @param      {object}  options          probematch configuration object
 * @param      {array}   network          Array of the road network's linestring features
 * @returns    {object}  a {segments, bush} object that contains the flatbush index
 * and the parallel array of associated segments
 */
function indexNetwork(options, network) {
  // flatbush will throw an error for an empty index.
  if (network.length === 0) return {segments: [], bush: null};

  const bush = new Flatbush(network.length);

  for (let i = 0; i < network.length; i++) {
    const bounds = getFeatureBounds(network[i], options);
    bush.add(bounds[0], bounds[1], bounds[2], bounds[3]);
  }

  bush.finish();

  return {network, bush};
}

/**
 * Takes the coordinates of a road segment, configuring it for
 * flatbush indexing and lookups.
 *
 * @param      {object}  feature           the linestring to index
 * @param      {object}  options           probematch configuration object
 */
function getFeatureBounds(feature, options) {
  if (feature.geometry.type !== 'LineString' || feature.geometry.coordinates.length < 2) {
    throw new Error('Feature must be a LineString');
  }

  const ruler = new CheapRuler(feature.geometry.coordinates[0][1], 'kilometers');
  const featureBbox = bbox(feature);
  const ext = ruler.bufferBBox(featureBbox, options.maxProbeDistance);
  return ext;
}

/**
 * Match a probe to the road network
 *
 * @param  {object}                     options   probematch configuration object
 * @param  {array}                      network   Array of the road network's linestring features
 * @param  {object}                     index     flatbush index of features bounding boxes
 * @param  {Point|Feature<Point>|array} probe     Probe to match to the road network
 * @param  {number}                     bearing   Bearing of the probe
 * @param  {object}                     ruler     A cheap ruler instance
 * @return {array}  matches for the probe
 */
function match(options, network, index, probe, bearing, ruler) {
  const probeCoords = probe.geometry ? probe.geometry.coordinates : probe;

  if (!ruler) ruler = new CheapRuler(probeCoords[1], 'kilometers');
  if (options.compareBearing && (bearing === null || typeof bearing === 'undefined')) {
    return [];
  }
  bearing = normalizeAngle(bearing);

  let hits;
  if (!index.bush) {
    hits = [];
  } else {
    hits = index.bush.search(probeCoords[0], probeCoords[1], probeCoords[0], probeCoords[1]);
  }

  const matches = filterMatchHits(options, network, hits, probeCoords, bearing, ruler);

  matches.sort(sortByDistance);
  return matches;
}

/**
 * Filter down matches by checking real distance and bearing - initial matches are found just
 * by checking bbox hits against the road network
 *
 * @param      {object}  options          probematch configuration object
 * @param      {array}   network          Array of the road network's linestring features
 * @param      {array}   hits             Array of possible matches from `tree.search`
 * @param      {array}   probeCoords      Probe's [x, y] coordinates
 * @param      {number}  bearing          Probe's bearing
 * @param      {object}  ruler            A cheap-ruler instance
 */
function filterMatchHits(options, network, hits, probeCoords, bearing, ruler) {
  const matches = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const road = network[hit];

    const p = ruler.pointOnLine(road.geometry.coordinates, probeCoords);
    const distance = ruler.distance(probeCoords, p.point);

    if (distance > options.maxProbeDistance) continue;

    const index = p.index;
    const segmentBearing = ruler.bearing(
      road.geometry.coordinates[index],
      road.geometry.coordinates[index + 1]
    );

    if (options.compareBearing && !compareBearing(
      segmentBearing,
      bearing,
      options.maxBearingRange,
      options.bidirectionalBearing
    )) continue;

    matches.push({road, distance, index, bearing: segmentBearing});
  }
  return matches;
}

/**
 * Match a trace to the road network
 *
 * @param      {object}                         options   probematch configuration object
 * @param      {array}                          network   Array of the road network's linestring features
 * @param      {object}                         index     flatbush index of segment bounding boxes
 * @param      {LineString|Feature<LineString>} trace     Trace to match to the network
 * @return     {array}   matches for each point of `trace`
 */
function matchTrace(options, network, index, trace) {
  const coords = trace.coordinates || trace.geometry.coordinates;
  let lastbearing;
  const results = [];

  const ruler = new CheapRuler(coords[0][1], 'kilometers');

  for (let i = 0; i < coords.length; i++) {
    if (i < coords.length - 1) lastbearing = ruler.bearing(coords[i], coords[i + 1]);

    results.push(match(options, network, index, coords[i], lastbearing, ruler));
  }

  return results;
}

/**
 * Compare bearing `base` to `bearing`, to determine if they are
 * close enough to each other to be considered matching. `range` is
 * number of degrees difference that is allowed between the bearings.
 * `allowReverse` allows bearings that are 180 degrees +/- `range` to be
 * considered matching.
 *
 * @param      {number}   base           Base bearing
 * @param      {number}   bearing        Bearing to compare to base
 * @param      {number}   range          The range
 * @param      {boolean}  allowReverse   Should opposite bearings be allowed to match?
 * @return     {boolean}  Whether or not base and bearing match
 */
export function compareBearing(base, bearing, range, allowReverse) {

  // map base and bearing into positive modulo 360 space
  const normalizedBase = normalizeAngle(base);
  const normalizedBearing = normalizeAngle(bearing);

  const min = normalizeAngle(normalizedBase - range);
  const max = normalizeAngle(normalizedBase + range);

  if (min < max) {
    if (min <= normalizedBearing && normalizedBearing <= max) return true;
  } else if (min <= normalizedBearing || normalizedBearing <= max) return true;

  if (allowReverse)
    return compareBearing(normalizedBase + 180, bearing, range);

  return false;
}

/**
 * Map angle to positive modulo 360 space.
 * @param  {number} angle an angle in degrees
 * @return {number}       equivalent angle in [0-360] space.
 */
function normalizeAngle(angle) {
  return (angle < 0) ? (angle % 360) + 360 : (angle % 360);
}

function sortByDistance(a, b) {
  return a.distance - b.distance;
}
