import probematch, {compareBearing} from '../probematch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import point from 'turf-point';
import {readFileSync} from 'fs';

function load() {
  return JSON.parse(readFileSync(path.join('./test/fixtures/in/roads.json')));
}

// reduce precision so tests aren't as finnicky
function reducePrecision(matches) {
  function toPrecision(number, precision) {
    const power = Math.pow(10, precision);
    return Math.round(number * power) / power;
  }

  for (let i = 0; i < matches.length; i++) {
    matches[i].distance = toPrecision(matches[i].distance, 5);
    matches[i].bearing = toPrecision(matches[i].bearing, 5);
  }
  return matches;
}


test('probematch -- returns scored roads', () => {
  const match = probematch(load(), {compareBearing: false});
  const probe = point([-77.03038215637207, 38.909639917926036]);

  const matched = match(probe);

  assert.equal(matched.length, 2);
  assert.deepEqual(reducePrecision(matched), JSON.parse(readFileSync(path.join('./test/fixtures/out/scored.json')), 'matches expected output'));
  assert.ok(matched[0].distance < matched[1].distance, 'is sorted by distance');
});

test('probematch -- empty roads', () => {
  const match = probematch({type: 'FeatureCollection', features: []}, {compareBearing: false});
  const probe = point([-77.03038215637207, 38.909639917926036]);

  const matched = match(probe);

  assert.equal(matched.length, 0);
});

test('probematch -- including bearing limits matches', () => {
  const match = probematch(load());
  const probe = point([-77.03038215637207, 38.909639917926036]);

  assert.deepEqual(reducePrecision(match(probe, 87)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearing.json')), 'matches expected output'));
  assert.deepEqual(reducePrecision(match(probe, -270)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearing.json')), 'bearing is correction to 0-360'));

  assert.deepEqual(match(probe), [], 'undefined bearing results in no matches');
  assert.deepEqual(match(probe, null), [], 'null bearing results in no matches');
});

test('probematch -- match distance is configurable', () => {
  const probe = point([-77.03162670135498, 38.91076278357181]);

  const matchNormal = probematch(load());
  const matchFar = probematch(load(), {maxProbeDistance: 0.13});

  assert.deepEqual(matchNormal(probe, 89), [], 'no matches for a far away probe');
  assert.deepEqual(reducePrecision(matchFar(probe, 89)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearingConfigured.json')), 'matches expected output'));
});

test('probematch -- bearing range is configurable', () => {
  const matchNormal = probematch(load());
  const matchExpanded = probematch(load(), {maxBearingRange: 20});
  const probe = point([-77.03038215637207, 38.909639917926036]);

  assert.deepEqual(matchNormal(probe, 70), [], 'bearing outside range finds no matches');
  assert.deepEqual(reducePrecision(matchExpanded(probe, 70)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearing.json')), 'expanded bearing range finds matches'));
});

test('probematch -- bidirectional bearing allows opposite bearing matches', () => {
  const matchNormal = probematch(load());
  const matchBi = probematch(load(), {bidirectionalBearing: true});
  const probe = point([-77.03038215637207, 38.909639917926036]);

  assert.deepEqual(matchNormal(probe, 270), [], 'no matches for reverse bearing');
  assert.deepEqual(reducePrecision(matchBi(probe, 270)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearing.json')), 'bidirectional bearing finds matches'));
  assert.deepEqual(reducePrecision(matchBi(probe, 90)), JSON.parse(readFileSync(path.join('./test/fixtures/out/bearing.json')), 'bidirectional bearing finds original matches too'));
});

test('probematch -- can match a trace to roads', () => {
  const match = probematch(load(), {bidirectionalBearing: true, maxProbeDistance: 0.1, maxBearingRange: 60});

  const line = JSON.parse(readFileSync('./test/fixtures/in/trace.json'));
  const matches = match.matchTrace(line);
  const bestMatches = matches.map((m) => {
    if (m[0]) return {roadId: m[0].road.properties.roadId};
    return null;
  });

  assert.deepEqual(bestMatches, JSON.parse(readFileSync('./test/fixtures/out/trace.json'), 'all points in trace matched expected segments'));
});


test('compareBearing', () => {

  assert.equal(true, compareBearing(45, 45, 10));
  assert.equal(true, compareBearing(45, 35, 10));
  assert.equal(true, compareBearing(45, 55, 10));
  assert.equal(false, compareBearing(45, 34.9, 10));
  assert.equal(false, compareBearing(45, 55.1, 10));

  // When angle+limit goes > 360
  assert.equal(true, compareBearing(355, 359, 10));
  assert.equal(true, compareBearing(351.2, 59.6, 89));
  assert.equal(false, compareBearing(351.2, 181, 89));
  assert.equal(true, compareBearing(350.6, 23.4, 89));

  // When angle-limit goes < 0
  assert.equal(true, compareBearing(5, 359, 10));
  assert.equal(false, compareBearing(5, 354, 10));
  assert.equal(false, compareBearing(5, 16, 10));
  assert.equal(true, compareBearing(59.6, 351.2, 89));

  // Checking other cases of wraparound
  assert.equal(true, compareBearing(-5, 359, 10));
  assert.equal(false, compareBearing(-5, 344, 10));
  assert.equal(false, compareBearing(-5, 6, 10));

  assert.equal(true, compareBearing(5, -1, 10));
  assert.equal(false, compareBearing(5, -6, 10));

  assert.equal(true, compareBearing(5, -721, 10));
  assert.equal(true, compareBearing(5, 719, 10));

  assert.equal(false, compareBearing(1, 1, -1));
  assert.equal(true, compareBearing(1, 1, 0));

  assert.equal(true, compareBearing(3, 11, 8)); // base, bearing, range
  assert.equal(true, compareBearing(3, -5, 8));
  assert.equal(true, compareBearing(3, 355, 8));
  assert.equal(true, compareBearing(3, 0, 8));
  assert.equal(false, compareBearing(3, 12, 8));
  assert.equal(false, compareBearing(3, -6, 8));

  assert.equal(true, compareBearing(3, 175, 8, true)); // base, bearing, range
  assert.equal(true, compareBearing(3, 191, 8, true));
  assert.equal(false, compareBearing(3, 174, 8, true));
  assert.equal(false, compareBearing(3, 192, 8, true));
  assert.equal(true, compareBearing(3, 185, 8, true));

  assert.equal(true, compareBearing(183, 11, 8, true)); // base, bearing, range
  assert.equal(true, compareBearing(183, -5, 8, true));
  assert.equal(true, compareBearing(183, 355, 8, true));
  assert.equal(true, compareBearing(183, 0, 8, true));
  assert.equal(false, compareBearing(183, 12, 8, true));
  assert.equal(false, compareBearing(183, -6, 8, true));
});
