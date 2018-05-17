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
  }
  return matches;
}


test('probematch -- returns scored roads', function (t) {
  var match = probematch(load(), {compareBearing: false});
  var probe = point([-77.03038215637207, 38.909639917926036]);

  var matched = match(probe);

  t.equal(matched.length, 2);
  t.deepEqual(reducePrecision(matched), require(path.join(__dirname, 'fixtures/out/scored.json')), 'matches expected output');
  t.ok(matched[0].distance < matched[1].distance, 'is sorted by distance');
  t.end();
});

test('probematch -- empty roads', function (t) {
  var match = probematch({type: 'FeatureCollection', features: []}, {compareBearing: false});
  var probe = point([-77.03038215637207, 38.909639917926036]);

  var matched = match(probe);

  t.equal(matched.length, 0);
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

test('probematch -- can match a trace to roads', function (t) {
  var match = probematch(load(), {bidirectionalBearing: true, maxProbeDistance: 0.1, maxBearingRange: 60});

  var line = require('./fixtures/in/trace.json');
  var matches = match.matchTrace(line);
  var bestMatches = matches.map(function (m) {
    if (m[0]) return {roadId: m[0].road.properties.roadId};
    return null;
  });

  t.deepEqual(bestMatches, require('./fixtures/out/trace.json'), 'all points in trace matched expected segments');
  t.end();
});


test('compareBearing', function (t) {

  t.equal(true, probematch.compareBearing(45, 45, 10));
  t.equal(true, probematch.compareBearing(45, 35, 10));
  t.equal(true, probematch.compareBearing(45, 55, 10));
  t.equal(false, probematch.compareBearing(45, 34.9, 10));
  t.equal(false, probematch.compareBearing(45, 55.1, 10));

  // When angle+limit goes > 360
  t.equal(true, probematch.compareBearing(355, 359, 10));
  t.equal(true, probematch.compareBearing(351.2, 59.6, 89));
  t.equal(false, probematch.compareBearing(351.2, 181, 89));
  t.equal(true, probematch.compareBearing(350.6, 23.4, 89));

  // When angle-limit goes < 0
  t.equal(true, probematch.compareBearing(5, 359, 10));
  t.equal(false, probematch.compareBearing(5, 354, 10));
  t.equal(false, probematch.compareBearing(5, 16, 10));
  t.equal(true, probematch.compareBearing(59.6, 351.2, 89));

  // Checking other cases of wraparound
  t.equal(true, probematch.compareBearing(-5, 359, 10));
  t.equal(false, probematch.compareBearing(-5, 344, 10));
  t.equal(false, probematch.compareBearing(-5, 6, 10));

  t.equal(true, probematch.compareBearing(5, -1, 10));
  t.equal(false, probematch.compareBearing(5, -6, 10));

  t.equal(true, probematch.compareBearing(5, -721, 10));
  t.equal(true, probematch.compareBearing(5, 719, 10));

  t.equal(false, probematch.compareBearing(1, 1, -1));
  t.equal(true, probematch.compareBearing(1, 1, 0));

  t.equal(true, probematch.compareBearing(3, 11, 8)); // base, bearing, range
  t.equal(true, probematch.compareBearing(3, -5, 8));
  t.equal(true, probematch.compareBearing(3, 355, 8));
  t.equal(true, probematch.compareBearing(3, 0, 8));
  t.equal(false, probematch.compareBearing(3, 12, 8));
  t.equal(false, probematch.compareBearing(3, -6, 8));

  t.equal(true, probematch.compareBearing(3, 175, 8, true)); // base, bearing, range
  t.equal(true, probematch.compareBearing(3, 191, 8, true));
  t.equal(false, probematch.compareBearing(3, 174, 8, true));
  t.equal(false, probematch.compareBearing(3, 192, 8, true));
  t.equal(true, probematch.compareBearing(3, 185, 8, true));

  t.equal(true, probematch.compareBearing(183, 11, 8, true)); // base, bearing, range
  t.equal(true, probematch.compareBearing(183, -5, 8, true));
  t.equal(true, probematch.compareBearing(183, 355, 8, true));
  t.equal(true, probematch.compareBearing(183, 0, 8, true));
  t.equal(false, probematch.compareBearing(183, 12, 8, true));
  t.equal(false, probematch.compareBearing(183, -6, 8, true));



  t.end();
});
