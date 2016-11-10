var georandom = require('geojson-random');
var probematch = require('../probematch.js');
var ways = require('./roads.json');

var points = 1000000;
var loops = process.argv[2] || 10;

console.time('matcher');
var matcher = probematch(ways, {
  compareBearing: false
});
console.timeEnd('matcher');

var bbox = [
  -77.0557451248169, 38.914294059378925,
  -77.04630374908447, 38.919110670041974
];

var overall = 0;

for (var i = 0; i < loops; i++) {
  var random = georandom.point(points, bbox);
  var matches = 0;

  var start = +new Date();
  random.features.forEach(function (point) {
    var results = matcher(point);
    if (results.length) matches++;
  });
  var end = +new Date();
  var diff = end - start;
  overall += diff;
  console.log('generated ' + points + ' random points and matched ' + ((matches / points) * 100).toPrecision(4) + '% in ' + diff + 'ms');
}

console.log(loops + ' loops avg: ' + overall / loops + 'ms');
