var assert = require('assert'),
    dht = require('..'),
    Buffer = require('buffer').Buffer;

describe('DHT.js/Bucket', function() {
  var node;

  beforeEach(function() {
    node = dht.node.create();
  });

  afterEach(function() {
    node.close();
  });

  it('should split correctly', function() {
    var bucket = node.getBucket(node.id);

    while (true) {
      var split = bucket.split();
      if (!split) break;
      bucket = bucket.split()[~~(Math.random() * 2)];
    }
  });
});
