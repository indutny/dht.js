var assert = require('assert'),
    dht = require('..'),
    Buffer = require('buffer').Buffer;

describe('DHT.js/Networking', function() {
  var nodes;

  beforeEach(function(callback) {
    var waiting = 20;

    nodes = [];
    for (var i = 0; i < waiting; i++) {
      nodes[i] = dht.node.create();
      nodes[i].once('listening', finish);
    }

    function finish() {
      if (--waiting !== 0) return;

      callback();
    }
  });

  afterEach(function() {
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].close();
    }
  });

  it('should successfully send/receive pings', function(callback) {
    nodes[0].sendPing(nodes[1], function(err) {
      assert(err === null);
      callback();
    });
  });

  it('should successfully discover peers', function(callback) {
    var infohash = new Buffer([0,5,4,3,2,1,6,7,8,9,
                               0,1,3,5,8,9,6,7,8,9]);

    nodes[0].connect(nodes[1]);
    nodes[1].connect({ address: nodes[2].address, port: nodes[2].port });

    nodes[0].advertise(infohash, 13589);
    nodes[2].on('peer:new', function(ih, peer) {
      if (infohash.toString('hex') !== ih.toString('hex')) return;
      assert.equal(peer.port, 13589);
      callback();
    });

    nodes[0].announce();
  });

  it('should save/load configuration', function() {
    var infohash = new Buffer([0,5,4,3,2,1,6,7,8,9,
                               0,1,3,5,8,9,6,7,8,9]);

    // Create star-like network
    for (var i = 1; i < nodes.length; i++) {
      nodes[0].connect(nodes[i]);
    }

    nodes[0].advertise(infohash, 13589);
    nodes[0].announce();

    var config = nodes[0].save();

    nodes[0].close();
    var test = dht.node.create(config);

    test.once('listening', function() {
      assert.equal(nodes[0].port, test.port);
      test.close();
    });
  });
});
