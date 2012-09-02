var assert = require('assert'),
    dht = require('..'),
    Buffer = require('buffer').Buffer;

describe('DHT.js/Bencode', function() {
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

    nodes[0].addNode(nodes[1]);
    nodes[1].addNode(nodes[2]);
    nodes[2].addNode(nodes[3]);

    nodes[0].addPeer(infohash, '127.0.0.1', 13589);
    nodes[2].on('peer:new', function(ih, peer) {
      if (infohash.toString('hex') !== ih.toString('hex')) return;
      assert.equal(peer.address, '127.0.0.1');
      assert.equal(peer.port, nodes[0].port);
      callback();
    });

    nodes[0].announce();
  });
});
