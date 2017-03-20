var rbush = require('rbush');
var xtend = require('xtend');
var linestring = require('turf-linestring');
var cheapRuler = require('cheap-ruler');

/**
 * Index `roadNetwork` and return the matcher function
 *
 * @param      {FeatureCollection}    roadNetwork  FeatureCollection of linestrings representing roads
 * @param      {object}               options      probematch configuration object
 */
module.exports = function (roadNetwork, opts) {
  var options = xtend({
    maxProbeDistance: 0.01, // max kilometers away a probe can be to be considered a match
    rbushMaxEntries: 9,
    compareBearing: true, // should bearing be used to filter matches?
    maxBearingRange: 5, // max bearing degrees allowed between a probe and a potentially matching road
    bidirectionalBearing: false
  }, opts);

  var segments = [], load = [];
  var tree = rbush(options.rbushMaxEntries);
  var network = roadNetwork.features;

  prepSegments(options, segments, load, network);
  tree.load(load);

  var matcher = function (probe, bearing) {
    return match(options, network, segments, tree, probe, bearing);
  };
  matcher.matchTrace = function (trace) {
    return matchTrace(options, network, segments, tree, trace);
  };
  return matcher;
};

/**
 * Iterates over each road network feature, explodes it into it's segments
 * and loads them into index arrays (`segments` && `load`)
 *
 * @param      {object}  options          probematch configuration object
 * @param      {array}   segments         Array that will hold segment linestrings
 * @param      {array}   load             Array that will hold bboxes to index in rbush
 * @param      {array}   network          Array of the road network's linestring features
 */
function prepSegments(options, segments, load, network) {
  for (var i = 0; i < network.length; i++) {
    var coords = network[i].geometry.coordinates;
    var ruler = cheapRuler(coords[0][1], 'kilometers');

    for (var j = 0; j < coords.length - 1; j++) {
      prepSegment(options, segments, load, i, j, coords[j], coords[j + 1], ruler);
    }
  }
}

/**
 * Takes the coordinates of a road segment, configuring it for
 * rbush indexing and lookups.
 *
 * @param      {object}  options           probematch configuration object
 * @param      {array}   segments          Array that will hold segment linestrings
 * @param      {array}   load              Array that will hold bboxes to index in rbush
 * @param      {int}     roadId            Numeric index of which road in the network this segment belongs to
 * @param      {int}     segmentId         Numeric index of which segment in the road `a` and `b` represent
 * @param      {array}   a                 First coordinate of the current segment
 * @param      {array}   b                 Second coordinate of the current segment
 * @param      {object}  ruler             A cheap-ruler instance
 */
function prepSegment(options, segments, load, roadId, segmentId, a, b, ruler) {
  var seg = linestring([a, b], {roadId: roadId, segmentId: segmentId});
  var ext = ruler.bufferBBox([
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1])
  ], options.maxProbeDistance);

  seg.properties.bearing = ruler.bearing(a, b);
  if (seg.properties.bearing < 0) seg.properties.bearing += 360;

  var id = segments.length;
  segments.push(seg);

  load.push({
    minX: ext[0],
    minY: ext[1],
    maxX: ext[2],
    maxY: ext[3],
    id: id
  });
}

/**
 * Match a probe to the road network
 *
 * @param  {object}                     options   probematch configuration object
 * @param  {array}                      network   Array of the road network's linestring features
 * @param  {array}                      segments  Array holding linestrings of each segment in the road network
 * @param  {object}                     tree      Rbush tree of segment bounding boxes
 * @param  {Point|Feature<Point>|array} probe     Probe to match to the road network
 * @param  {number}                     bearing   Bearing of the probe
 * @param  {object}                     ruler     A cheap ruler instance
 * @return {array}  matches for the probe
 */
function match(options, network, segments, tree, probe, bearing, ruler) {
  var probeCoords = probe.geometry ? probe.geometry.coordinates : probe;

  if (!ruler) ruler = cheapRuler(probeCoords[1], 'kilometers');
  if (options.compareBearing &&
    (bearing === null || typeof bearing === 'undefined')) return [];
  if (bearing && bearing < 0) bearing = bearing + 360;

  var hits = tree.search({
    minX: probeCoords[0],
    minY: probeCoords[1],
    maxX: probeCoords[0],
    maxY: probeCoords[1]
  });

  var matches = filterMatchHits(options, network, segments, hits, probeCoords, bearing, ruler);

  matches.sort(function (a, b) {
    return a.distance - b.distance;
  });
  return matches;
}

/**
 * Filter down matches by checking real distance and bearing - initial matches are found just
 * by checking bbox hits against the road network
 *
 * @param      {object}  options          probematch configuration object
 * @param      {array}   network          Array of the road network's linestring features
 * @param      {array}   segments         Array holding linestrings of each segment in the road network
 * @param      {array}   hits             Array of possible matches from `tree.search`
 * @param      {array}   probeCoords      Probe's [x, y] coordinates
 * @param      {number}  bearing          Probe's bearing
 * @param      {object}  ruler            A cheap-ruler instance
 */
function filterMatchHits(options, network, segments, hits, probeCoords, bearing, ruler) {
  var matches = [];
  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    var segment = segments[hit.id];
    var parent = network[segment.properties.roadId];

    if (options.compareBearing && !module.exports.compareBearing(
      segment.properties.bearing,
      bearing,
      options.maxBearingRange,
      options.bidirectionalBearing
    )) continue;

    var p = ruler.pointOnLine(segment.geometry.coordinates, probeCoords);
    var dist = ruler.distance(probeCoords, p.point);

    if (dist <= options.maxProbeDistance) matches.push({segment: segment, road: parent, distance: dist});
  }
  return matches;
}

/**
 * Match a trace to the road network
 *
 * @param      {object}                         options   probematch configuration object
 * @param      {array}                          network   Array of the road network's linestring features
 * @param      {array}                          segments  Array holding linestrings of each segment in the road network
 * @param      {object}                         tree      Rbush tree of segment bounding boxes
 * @param      {LineString|Feature<LineString>} trace     Trace to match to the network
 * @return     {array}   matches for each point of `trace`
 */
function matchTrace(options, network, segments, tree, trace) {
  var coords = trace.coordinates || trace.geometry.coordinates;
  var lastbearing;
  var results = [];

  var ruler = cheapRuler(coords[0][1], 'kilometers');

  for (var i = 0; i < coords.length; i++) {
    if (i < coords.length - 1) lastbearing = ruler.bearing(coords[i], coords[i + 1]);

    results.push(match(options, network, segments, tree, coords[i], lastbearing, ruler));
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
 * @param      {number}   range          The range
 * @param      {number}   bearing        Bearing to compare to base
 * @param      {boolean}  allowReverse   Should opposite bearings be allowed to match?
 * @return     {boolean}  Whether or not base and bearing match
 */
module.exports.compareBearing = function (base, bearing, range, allowReverse) {

  // map base and bearing into positive modulo 360 space
  var normalizedBase = normalizeAngle(base);
  var normalizedBearing = normalizeAngle(bearing);

  var min = normalizeAngle(normalizedBase - range);
  var max = normalizeAngle(normalizedBase + range);

  if (min < max) {
    if (min <= normalizedBearing && normalizedBearing <= max) return true;
  } else if (min <= normalizedBearing || normalizedBearing <= max) return true;

  if (allowReverse)
    return module.exports.compareBearing(normalizedBase + 180, bearing, range);

  return false;
};

/**
 * Map angle to positive modulo 360 space.
 * @param  {[type]} angle an angle in degrees
 * @return {[type]}       equivalent angle in [0-360] space.
 */
function normalizeAngle(angle) {
  return (angle < 0) ? (angle % 360) + 360 : (angle % 360);
}
