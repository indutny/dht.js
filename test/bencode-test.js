var assert = require('assert'),
    dht = require('..'),
    bencode = dht.bencode,
    Buffer = require('buffer').Buffer;

describe('DHT.js/Bencode', function() {
  it('should encode number', function() {
    assert.equal(bencode.encode(123).toString(), 'i123e');
  });

  it('should encode string', function() {
    assert.equal(bencode.encode('123').toString(), '3:123');
  });

  it('should encode buffer', function() {
    assert.equal(bencode.encode(new Buffer('456')).toString(), '3:456');
  });

  it('should encode array', function() {
    assert.equal(bencode.encode([1,2,3]).toString(), 'li1ei2ei3ee');
  });

  it('should encode hashmap', function() {
    assert.equal(bencode.encode({ c: 1, b: 2, a: 3 }).toString(),
                 'd1:ai3e1:bi2e1:ci1ee');
  });

  it('should encode nested data', function() {
    assert.equal(
      bencode.encode({ c: [1, {x: 3}], b: [2,'123', {y: 1}], a: 3 }).toString(),
      'd' +
        '1:a' + 'i3e' +
        '1:b' + 'l' +
          'i2e' +
          '3:123' +
          'd' +
            '1:y' + 'i1e' +
          'e' +
        'e' +
        '1:c' + 'l' +
          'i1e' +
          'd' + '1:x' + 'i3e' + 'e' +
        'e' +
      'e');
  });

  it('should decode number', function() {
    assert.equal(bencode.decode('i13589e'), 13589);
  });

  it('should decode string', function() {
    assert.equal(bencode.decode('5:abcde').toString(), 'abcde');
  });

  it('should decode list', function() {
    assert.equal(JSON.stringify(bencode.decode('li1ei2ei3ee')), '[1,2,3]');
  });

  it('should decode dictionary', function() {
    var obj = bencode.decode('d1:a1:b1:b1:c1:c1:de');

    assert(!Array.isArray(obj));
    assert(!Buffer.isBuffer(obj));
    assert.equal(typeof obj, 'object');

    assert.equal(Object.keys(obj).length, 3);
    assert.equal(obj.a, 'b');
    assert.equal(obj.b, 'c');
    assert.equal(obj.c, 'd');
  });

  it('should decode nested', function() {
    var str = 'd1:ai3e1:bli2e3:123d1:yi1eee1:cli1ed1:xi3eeee',
        obj = bencode.decode(str);

    assert.equal(bencode.encode(obj).toString(), str);
  });
});
