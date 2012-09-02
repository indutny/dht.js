var bencode = exports,
    Buffer = require('buffer').Buffer;

var internal = {},
    end = new Buffer('e');

end._internal = internal;

bencode.decode = function decode(buff) {
  var data = Buffer.isBuffer(buff) ? buff : new Buffer(buff),
      stack = [],
      state = 'plain',
      key = null,
      result;

  function value(v) {
    if (state === 'plain') {
      result = v;
    } else {
      if (stack.length === 0) throw new TypeError('Internal parser error');
      var obj = stack[stack.length - 1].value;

      if (state === 'list') {
        obj.push(v);
      } else if (state === 'dict:key') {
        key = v.toString();
        state = 'dict:value';
      } else if (state === 'dict:value') {
        obj[key] = v;
        state = 'dict:key';
      } else {
        throw new TypeError('Unexpected state: ' + state);
      }
    }
  }

  for (var i = 0; i < data.length; ) {
    var ident = data[i];

    if (ident === 0x69 /* i */) {
      i++;

      // Number
      for (var j = i; j < data.length && data[j] !== 0x65 /* e */; j++) {
        if (data[j] < 0x30 /* 0 */ || data[j] > 0x39 /* 9 */) {
          throw new TypeError('Incorrect number symbol: ' + data[j]);
        }
      }

      if (j >= data.length) throw new TypeError('Number out of bounds');
      value(+data.slice(i, j));
      i = j + 1;
    } else if (ident === 0x6c /* l */) {
      // List
      stack.push({ state: state, key: key, value: [] });
      state = 'list';
      i++;
    } else if (ident === 0x64 /* d */) {
      // Dictionary
      stack.push({ state: state, key: key, value: {} });
      state = 'dict:key';
      i++;
    } else if (ident === 0x65 /* e */) {
      // End of dictionary or list
      if (stack.length === 0) throw new TypeError('End of nothing');
      if (state === 'dict:value') {
        throw new TypeError('Unfinished dictionary');
      }

      var entry = stack.pop();
      state = entry.state;
      key = entry.key;
      value(entry.value);
      i++;
    } else {
      // String
      for (var j = i + 1; j < data.length && data[j] !== 0x3a /* : */; j++) {
        if (data[j] < 0x30 /* 0 */ || data[j] > 0x39 /* 9 */) {
          throw new TypeError('Incorrect string length');
        }
      }

      if (j >= data.length) throw new TypeError('String without `:`');
      var len = +data.slice(i, j);
      i = j + 1;

      if (i + len > data.length) throw new TypeError('String out of bounds');
      value(data.slice(i, i + len));
      i += len;
    }
  }

  return result;
};

bencode.encode = function encode(data) {
  var buffers = [],
      total = 0,
      buffer = new Buffer(1024),
      offset = 0,
      queue = [];

  function flush() {
    if (offset !== 0) {
      buffers.push(buffer.slice(0, offset));
      total += offset;
    }

    // Just to be sure that buffer won't be reused
    buffer = null;
    offset = 0;
  }

  function ensureHas(bytes) {
    if (buffer.length - offset >= bytes) return;

    flush();
    buffer = new Buffer(Math.max(bytes, 1024));
  }

  function write(chunk) {
    if (Buffer.isBuffer(chunk)) {
      ensureHas(chunk.length);
      chunk.copy(buffer, offset);
      offset += chunk.length;
    } else {
      ensureHas(Buffer.byteLength(chunk));
      offset += buffer.write(chunk, offset);
    }
  };

  queue.push(data);
  while (queue.length !== 0) {
    var item = queue.pop();

    if (typeof item === 'string') {
      write(Buffer.byteLength(item) + ':' + item);
    } else if (typeof item === 'number') {
      write('i' + item + 'e');
    } else if (Array.isArray(item)) {
      queue.push(end);
      for (var i = item.length - 1; i >= 0; i--) {
        queue.push(item[i]);
      }
      write('l');
    } else if (Buffer.isBuffer(item)) {
      if (item._internal === internal) {
        write(item);
      } else {
        write(item.length + ':');
        write(item);
      }
    } else if (typeof item === 'object') {
      queue.push(end);
      Object.keys(item).sort().reverse().forEach(function(key) {
        queue.push(item[key]);
        queue.push(key);
      });
      write('d');
    }
  }

  flush();

  return Buffer.concat(buffers, total);
};
