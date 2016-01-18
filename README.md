Match probe data to roads by distance and bearing

#### install

`npm install probematch`

### usage

*probematch* creates an [rbush index](https://github.com/mourner/rbush) of a road network and allows you to match individual probe points to the roads by a combo of distance and bearing. Both distance and bearing filters are configurable.

```js
var probematch = require('probematch');

var roads = {
  'type': 'FeatureCollection'
  'features': [
    // Linestring features representing the road network
  ]
};

var match = probematch(roads, {
  compareBearing: true, // should bearing be used to filter matches?
  maxProbeDistance: 0.01, // distance filter in kilometers for probe matching
  maxBearingRange: 5 // maximum bearing difference, in degrees, allowed for match filtering,
  bidirectionalBearing: false // allows matching probes to roads oriented in the opposite direction. 
  							  // good if you know your data contains many 2-way roads
});

var probe = /* a point feature representing a probe */;
var probeBearing  = /* a bearing in degrees */

var results = match(probe, probeBearing);
```

### output

*probematch* outputs an array of potential matches, sorted by distance from the probe.

```js
[
  {
    "line": /* the road geometry that matched */,
    "segment": /* the segment of road that matched */,
    "distance":0.004666787054452857
  },
  {
    "segment": /* ... */,
    "line": /* ... */,
    "distance":0.005917207788475857
  }
]
```


### performance

*probematch* performs best with the smallest road network possible loaded into it's index. Ideally, it is used on a tile-per-tile basis (for example, as part of a [tile-reduce](https://github.com/mapbox/tile-reduce) job)
