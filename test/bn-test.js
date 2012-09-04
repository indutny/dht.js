var assert = require('assert'),
    dht = require('..'),
    bn = dht.bn,
    Buffer = require('buffer').Buffer;

describe('DHT.js/BigNumbers', function() {
  it('should add #1', function() {
    var a = new Buffer('0001ffffffff', 'hex'),
        b = new Buffer('0001', 'hex');

    assert.equal(bn.add(a, b).toString('hex'), '000200000000');
  });

  it('should add #2', function() {
    var a = new Buffer('000123456789', 'hex'),
        b = new Buffer('000123456789', 'hex');

    assert.equal(bn.add(a, b).toString('hex'), '0002468acf12');
  });

  it('should sub #1', function() {
    var a = new Buffer('000123456789', 'hex'),
        b = new Buffer('000123456789', 'hex');

    assert.equal(bn.sub(a, b).toString('hex'), '000000000000');
  });

  it('should sub #2', function() {
    var a = new Buffer('0005124ab125', 'hex'),
        b = new Buffer('000123456789', 'hex');

    assert.equal(bn.sub(a, b).toString('hex'), '0003ef05499c');
  });

  it('should shr #1', function() {
    var a = new Buffer('000100000000', 'hex');

    assert.equal(bn.shr(a).toString('hex'), '000080000000');
  });

  it('should shr #2', function() {
    var a = new Buffer('12345678', 'hex');

    assert.equal(bn.shr(a).toString('hex'), '091a2b3c');
  });

  it('should compare #1', function() {
    var a = new Buffer('12345678', 'hex'),
        b = new Buffer('12345678', 'hex');

    assert.equal(bn.compare(a, b), 0);
  });

  it('should compare #2', function() {
    var a = new Buffer('12345678', 'hex'),
        b = new Buffer('12355678', 'hex');

    assert.equal(bn.compare(a, b), -1);
  });

  it('should compare #3', function() {
    var a = new Buffer('13345678', 'hex'),
        b = new Buffer('12359999', 'hex');

    assert.equal(bn.compare(a, b), 1);
  });

  it('should compare #4', function() {
    var a = new Buffer('00000000000000000000000000000000000000000000', 'hex'),
        b = new Buffer('3444b337cc50b002736f0ba1e1af1c0e430474e2', 'hex'),
        c = new Buffer('00000000000000000000000000000000800000000000', 'hex');

    assert.equal(bn.compare(a, b), -1);
    assert.equal(bn.compare(b, c), 1);
  });

  it('should random', function() {
    var a = new Buffer('13345678', 'hex'),
        b = new Buffer('15359999', 'hex'),
        r = bn.random(a, b);

    assert(bn.compare(a, r) <= 0);
    assert(bn.compare(r, b) <= 0);
  });
});
