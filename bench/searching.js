import georandom from 'geojson-random';
import probematch from '../probematch.js';
import {readFileSync} from 'fs';

const ways = JSON.parse(readFileSync('./bench/roads.json'));

const points = 1000000;
const loops = process.argv[2] || 10;

console.time('matcher');
const matcher = probematch(ways, {
  compareBearing: false
});
console.timeEnd('matcher');

const bbox = [
  -77.0557451248169, 38.914294059378925,
  -77.04630374908447, 38.919110670041974
];

let overall = 0;

for (let i = 0; i < loops; i++) {
  const random = georandom.point(points, bbox);
  let matches = 0;

  const start = +new Date();
  for (let j = 0; j < random.features.length; j++) {
    const results = matcher(random.features[j]);
    if (results.length) matches++;
  }
  const end = +new Date();
  const diff = end - start;
  overall += diff;
  console.log(`generated ${points} random points and matched ${((matches / points) * 100).toPrecision(4)}% in ${diff}ms`);
}

console.log(`${loops} loops avg: ${  overall / loops  }ms`);
