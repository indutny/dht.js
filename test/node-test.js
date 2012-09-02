var assert = require('assert'),
    dht = require('..'),
    Buffer = require('buffer').Buffer;

describe('DHT.js/Bencode', function() {
  var a, b;

  beforeEach(function(callback) {
    var waiting = 2;

    a = dht.node.create();
    b = dht.node.create();

    a.once('listening', finish);
    b.once('listening', finish);

    function finish() {
      if (--waiting !== 0) return;

      callback();
    }
  });

  afterEach(function() {
    a.close();
    b.close();
  });

  it('should successfully send/receive pings', function(callback) {
    a.sendPing(b, function(err) {
      assert(err === null);
      callback();
    });
  });
});
