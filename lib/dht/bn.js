var bn = exports,
    assert = require('assert'),
    crypto = require('crypto'),
    Buffer = require('buffer').Buffer;

bn.add = function add(a, b) {
  // a should be the bigger one buffer
  if (a.length < b.length) {
    var t = a;
    a = b;
    b = t;
  }

  var result = new Buffer(a.length + 2),
      over = 0;

  for (var i = a.length - 2, j = b.length - 2; i >= 0; i -= 2, j -= 2) {
    var aword = a.readUInt16BE(i),
        bword = j >= 0 ? b.readUInt16BE(j) : 0,
        rword = aword + bword + over;

    over = rword >> 16;
    result.writeUInt16BE(rword & 0xffff, i);
  }

  // Write last overflowed word
  if (i >= 0) {
    result.writeUInt16BE(over, i);
  }

  // Do not return last byte if overflow hasn't happened
  return over ? result : result.slice(0, result.length - 2);
};

bn.sub = function sub(a, b) {
  var result = new Buffer(Math.max(a.length, b.length)),
      under = 0;

  for (var i = a.length - 2, j = b.length - 2;
       i >= 0 || j >= 0;
       i -= 2, j -= 2) {

    var aword = i >= 0 ? a.readUInt16BE(i) : 0,
        bword = j >= 0 ? b.readUInt16BE(j) : 0,
        rword = aword - bword - under;

    if (rword < 0) {
      rword += 0x10000;
      under = 1;
    } else {
      under = 0;
    }
    result.writeUInt16BE(rword, i);
  }

  // Do not return last byte if overflow hasn't happened
  return result;
};

bn.shr = function shr(a) {
  var result = new Buffer(a.length),
      under = 0;

  for (var i = 0; i < result.length; i += 2) {
    var word = a.readUInt16BE(i);

    result.writeUInt16BE((word >> 1) | under, i);

    under = (word & 1) << 15;
  }

  return result;
};

bn.compare = function compare(a, b) {
  var common = Math.min(a.length, b.length);

  if (a.length > common) {
    for (var i = 0; i < a.length - common; i += 2) {
      if (a.readUInt16BE(i) !== 0) return 1;
    }
  } else if (b.length > common) {
    for (var i = 0; i < b.length - common; i += 2) {
      if (b.readUInt16BE(i) !== 0) return -1;
    }
  }

  for (var i = a.length - common, j = b.length - common;
       i < a.length && j < b.length;
       i += 2, j += 2) {

    var aword = i >= 0 ? a.readUInt16BE(i) : 0,
        bword = j >= 0 ? b.readUInt16BE(j) : 0;

    if (aword === bword) continue;

    return aword > bword ? 1 : -1;
  }

  return 0;
};

bn.random = function random(a, b) {
  assert.equal(a.length, b.length);
  var result = new Buffer(a.length);

  for (var i = 0; i < a.length; i += 2) {
    var aword = a.readUInt16BE(i),
        bword = b.readUInt16BE(i);

    if (aword === bword) {
      result.writeUInt16BE(aword, i);
      continue;
    }

    var word = (aword + Math.random() * (bword - aword)) | 0;
    result.writeUInt16BE(word, i);

    if (word < bword) {
      i += 2;
      break;
    }
  }

  // Fill rest with random bytes
  if (i !== a.length) {
    crypto.randomBytes(a.length - i).copy(result, i);
  }

  return result;
};
