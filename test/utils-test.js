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
    var buff = utils.encodePeer({ address: '127.0.0.1', port: 0x1234 });
    eqbuffs(buff, new Buffer([127, 0, 0, 1, 0x12, 0x34]));
  });

  it('should encode node', function() {
    var id = new Buffer(20),
        buff = utils.encodeNode({
          id: id,
          address: '127.0.0.1',
          port: 0x1234
        }),
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

  it('should decode peer', function() {
    var buff = utils.encodePeer({
          address: '127.0.0.1',
          port: 0x1234
        }),
        peers = utils.decodePeers(buff);

    assert.equal(peers.length, 1);
    assert.equal(peers[0].address, '127.0.0.1');
    assert.equal(peers[0].port, 0x1234);
  });

  it('should decode peers', function() {
    var buff = utils.encodePeer({
          address: '127.0.0.1',
          port: 0x1234
        }),
        cnt = 20,
        bigbuff = new Buffer(cnt * buff.length);

    for (var i = 0; i < cnt; i++) {
      buff.copy(bigbuff, buff.length * i);
    }

    var peers = utils.decodePeers(bigbuff);

    assert.equal(peers.length, cnt);
    for (var i = 0; i < cnt; i++) {
      assert.equal(peers[i].address, '127.0.0.1');
      assert.equal(peers[i].port, 0x1234);
    }
  });

  it('should decode node', function() {
    var buff = utils.encodeNode({
          id: new Buffer(20),
          address: '127.0.0.1',
          port: 0x1234
        }),
        nodes = utils.decodeNodes(buff);

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].id.length, 20);
    assert.equal(nodes[0].address, '127.0.0.1');
    assert.equal(nodes[0].port, 0x1234);
  });

  it('should decode nodes', function() {
    var buff = utils.encodeNode({
          id: new Buffer(20),
          address: '127.0.0.1',
          port: 0x1234
        }),
        cnt = 20,
        bigbuff = new Buffer(cnt * buff.length);

    for (var i = 0; i < cnt; i++) {
      buff.copy(bigbuff, buff.length * i);
    }

    var nodes = utils.decodeNodes(bigbuff);

    assert.equal(nodes.length, cnt);
    for (var i = 0; i < cnt; i++) {
      assert.equal(nodes[i].id.length, 20);
      assert.equal(nodes[i].address, '127.0.0.1');
      assert.equal(nodes[i].port, 0x1234);
    }
  });
});
