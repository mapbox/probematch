var rbush = require('rbush');
var xtend = require('xtend');
var flatten = require('geojson-flatten');
var normalize = require('geojson-normalize');
var linestring = require('turf-linestring');
var cheapRuler = require('cheap-ruler');

/**
 * Index `roadNetwork` and return the matcher function
 *
 * @param      {FeatureCollection}  roadNetwork  FeatureCollection of linestrings representing roads
 * @param      {object}  opts         Configuration object
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
  var network = normalize(flatten(roadNetwork));

  prepSegments(segments, load, network.features, options);
  tree.load(load);

  var matcher = function (probe, bearing) {
    return match(probe, bearing, options, network, segments, tree);
  };
  matcher.matchTrace = function (trace) {
    return matchTrace(trace, options, network, segments, tree);
  };
  return matcher;
};

function match(probe, bearing, options, network, segments, tree, ruler) {
  var probeCoords = probe.geometry ? probe.geometry.coordinates : probe;

  if (!ruler) ruler = cheapRuler(probeCoords[1], 'kilometers');

  var ext = [probeCoords[0], probeCoords[1], probeCoords[0], probeCoords[1]];
  var hits = tree.search(ext);
  var matches = [];

  if (options.compareBearing &&
    (bearing === null || typeof bearing === 'undefined')) return [];

  if (bearing && bearing < 0) bearing = bearing + 360;

  for (var i = 0; i < hits.length; i++) {
    filterMatchHits(hits[i], matches, probeCoords, bearing, segments, network.features, options, ruler);
  }

  matches.sort(function (a, b) {
    return a.distance - b.distance;
  });
  return matches;
}

function filterMatchHits(hit, matches, probeCoords, bearing, segments, networkFeatures, options, ruler) {
  var segment = segments[hit.id];
  var parent = networkFeatures[segment.properties.roadId];

  if (options.compareBearing && !compareBearing(
    segment.properties.bearing,
    bearing,
    options.maxBearingRange,
    options.bidirectionalBearing
  )) return;

  var p = ruler.pointOnLine(segment.geometry.coordinates, probeCoords);
  var dist = ruler.distance(probeCoords, p);

  if (dist <= options.maxProbeDistance) {
    matches.push({segment: segment, road: parent, distance: dist});
  }
}

function matchTrace(trace, options, network, segments, tree) {
  var coords = trace.coordinates || trace.geometry.coordinates;
  var lastbearing;
  var results = [];

  var ruler = cheapRuler(coords[0][1], 'kilometers');

  for (var i = 0; i < coords.length - 1; i++) {
    lastbearing = ruler.bearing(coords[i], coords[i + 1]);
    results.push(match(coords[i], lastbearing, options, network, segments, tree, ruler));
  }
  // handle last point
  if (coords.length > 0) results.push(match(coords[coords.length - 1], lastbearing, options, network, segments, tree, ruler));
  return results;
}

function prepSegments(segments, load, networkFeatures, options) {
  for (var i = 0; i < networkFeatures.length; i++) {
    var coords = networkFeatures[i].geometry.coordinates;
    var ruler = cheapRuler(coords[0][1], 'kilometers');

    for (var j = 0; j < coords.length - 1; j++) {
      prepLine(load, segments, i, j, coords[j], coords[j + 1], ruler, options.maxProbeDistance);
    }
  }
}

function prepLine(load, segments, i, j, a, b, ruler, maxProbeDistance) {
  var seg = linestring([a, b], {roadId: i, segmentId: j});
  var ext = ruler.bufferBBox([
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1])
  ], maxProbeDistance);

  seg.properties.bearing = ruler.bearing(a, b);
  if (seg.properties.bearing < 0) seg.properties.bearing += 360;

  ext.id = segments.length;
  segments.push(seg);
  load.push(ext);
}

/**
 * Compare bearing `base` to `bearing`, to determine if they are
 * close enough to eachother to be considered matching. `range` is
 * number of degrees difference that is allowed between the bearings.
 * `allowReverse` allows bearings that are 180 degrees +/- `range` to be
 * considered matching.
 *
 * TODO: proper bearing wrapping (deal with negative bearings)
 *
 * @param      {number}   base           Base bearing
 * @param      {number}   range          The range
 * @param      {number}   bearing        Bearing to compare to base
 * @param      {boolean}  allowReverse   Should opposite bearings be allowed to match?
 * @return     {boolean}  Whether or not base and bearing match
 */
function compareBearing(base, bearing, range, allowReverse) {
  var min = base - range,
    max = base + range;

  if (bearing > min && bearing < max) return true;

  if (allowReverse) {
    min = min - 180;
    max = max - 180;

    if (min < 0) min = min + 360;
    if (max < 0) max = max + 360;

    if (bearing > min && bearing < max) return true;
  }

  return false;
}
