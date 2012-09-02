var assert = require('assert'),
    dht = require('..'),
    utils = dht.utils,
    Buffer = require('buffer').Buffer;

describe('DHT.js/Utils', function() {
  function eqbuffs(a, b) {
    assert(a.length === b.length);
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) assert(false, "Buffers should be equal");
    }
  }

  it('should encode peer', function() {
    var buff = utils.encodePeers([{ address: '127.0.0.1', port: 0x1234 }]);
    eqbuffs(buff, new Buffer([127, 0, 0, 1, 0x12, 0x34]));
  });

  it('should encode node', function() {
    var id = new Buffer(20),
        buff = utils.encodeNodes([{
          id: id,
          address: '127.0.0.1',
          port: 0x1234
        }]),
        expected = new Buffer(26);

    id.copy(expected);
    expected[20] = 127;
    expected[21] = 0;
    expected[22] = 0;
    expected[23] = 1;
    expected[24] = 0x12;
    expected[25] = 0x34;

    eqbuffs(buff, expected);
  });

  it('should decode peers', function() {
    var peers = [],
        cnt = 20;

    for (var i = 0; i < cnt; i++) {
      peers.push({
        address: '127.0.0.1',
        port: 0x1234
      });
    }

    var buff = utils.encodePeers(peers);
    peers = utils.decodePeers(buff);

    assert.equal(peers.length, cnt);
    for (var i = 0; i < cnt; i++) {
      assert.equal(peers[i].address, '127.0.0.1');
      assert.equal(peers[i].port, 0x1234);
    }
  });

  it('should decode nodes', function() {
    var nodes = [],
        cnt = 20;

    for (var i = 0; i < cnt; i++) {
      nodes.push({
        id: new Buffer(20),
        address: '127.0.0.1',
        port: 0x1234
      });
    }

    var buff = utils.encodeNodes(nodes);
    nodes = utils.decodeNodes(buff);

    assert.equal(nodes.length, 20);
    assert.equal(nodes[0].id.length, 20);
    assert.equal(nodes[0].address, '127.0.0.1');
    assert.equal(nodes[0].port, 0x1234);
  });
});
