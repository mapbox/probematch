var probematch = require('../');
var test = require('tap').test;
var path = require('path');
var point = require('turf-point');

function load() {
  return require(path.join(__dirname, 'fixtures/in/roads.json'));
}

// reduce precision so tests aren't as finnicky
function reducePrecision(matches) {
  function toPrecision(number, precision) {
    var power = Math.pow(10, precision);
    return Math.round(number * power) / power;
  }

  for (var i = 0; i < matches.length; i++) {
    matches[i].distance = toPrecision(matches[i].distance, 5);
    matches[i].segment.properties.bearing = toPrecision(matches[i].segment.properties.bearing, 1);
  }
  return matches;
}


test('probematch -- returns scored roads', function (t) {
  var match = probematch(load(), {compareBearing: false});
  var probe = point([-77.03038215637207, 38.909639917926036]);

  var matched = match(probe);

  t.deepEqual(reducePrecision(matched), require(path.join(__dirname, 'fixtures/out/scored.json')), 'matches expected output');
  t.ok(matched[0].distance < matched[1].distance, 'is sorted by distance');
  t.end();
});

test('probematch -- including bearing limits matches', function (t) {
  var match = probematch(load());
  var probe = point([-77.03038215637207, 38.909639917926036]);

  t.deepEqual(reducePrecision(match(probe, 87)), require(path.join(__dirname, 'fixtures/out/bearing.json')), 'matches expected output');
  t.deepEqual(reducePrecision(match(probe, -270)), require(path.join(__dirname, 'fixtures/out/bearing.json')), 'bearing is correction to 0-360');

  t.deepEqual(match(probe), [], 'undefined bearing results in no matches');
  t.deepEqual(match(probe, null), [], 'null bearing results in no matches');
  t.end();
});

test('probematch -- match distance is configurable', function (t) {
  var probe = point([-77.03162670135498, 38.91076278357181]);

  var matchNormal = probematch(load());
  var matchFar = probematch(load(), {maxProbeDistance: 0.13});

  t.deepEqual(matchNormal(probe, 89), [], 'no matches for a far away probe');
  t.deepEqual(reducePrecision(matchFar(probe, 89)), require(path.join(__dirname, 'fixtures/out/bearingConfigured.json')), 'matches expected output');

  t.end();
});

test('probematch -- bearing range is configurable', function (t) {
  var matchNormal = probematch(load());
  var matchExpanded = probematch(load(), {maxBearingRange: 20});
  var probe = point([-77.03038215637207, 38.909639917926036]);

  t.deepEqual(matchNormal(probe, 70), [], 'bearing outside range finds no matches');
  t.deepEqual(reducePrecision(matchExpanded(probe, 70)), require(path.join(__dirname, 'fixtures/out/bearing.json')), 'expanded bearing range finds matches');

  t.end();
});

test('probematch -- bidirectional bearing allows opposite bearing matches', function (t) {
  var matchNormal = probematch(load());
  var matchBi = probematch(load(), {bidirectionalBearing: true});
  var probe = point([-77.03038215637207, 38.909639917926036]);

  t.deepEqual(matchNormal(probe, 270), [], 'no matches for reverse bearing');
  t.deepEqual(reducePrecision(matchBi(probe, 270)), require(path.join(__dirname, 'fixtures/out/bearing.json')), 'bidirectional bearing finds matches');
  t.deepEqual(reducePrecision(matchBi(probe, 90)), require(path.join(__dirname, 'fixtures/out/bearing.json')), 'bidirectional bearing finds original matches too');

  t.end();
});

test('probematch -- can match lines to roads', function (t) {
  var match = probematch(load(), {bidirectionalBearing: true, maxProbeDistance: 0.1, maxBearingRange: 60});
  var line = require('./fixtures/in/line.json');
  var matches = match.matchLine(line);
  var bestMatches = matches.map(function (m) {
    if (m[0]) return {lineId: m[0].segment.properties.lineId, segmentId: m[0].segment.properties.segmentId};
    return null;
  });

  t.deepEqual(bestMatches, require('./fixtures/out/line.json'), 'all points in line matched expected segments');
  t.end();
});
