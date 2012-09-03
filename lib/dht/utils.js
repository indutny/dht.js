var utils = exports;

utils.encodePeers = function encodePeers(peers) {
  var data = new Buffer(peers.length * 6),
      offset = 0;

  peers.forEach(function(peer) {
    var ip = peer.address.split(/\./g, 4);

    for (var i = 0; i < 4; i++) {
      data[i + offset] = +ip[i];
    }
    data.writeUInt16BE(peer.port, 4 + offset);

    offset += 6;
  });

  return data;
};

utils.encodeNodes = function encodeNodes(nodes) {
  var data = new Buffer(26 * nodes.length),
      offset = 0;

  nodes.forEach(function(node) {
    var ip = node.address.split(/\./g, 4);

    node.id.copy(data, offset);
    for (var i = 0; i < 4; i++) {
      data[i + 20 + offset] = +ip[i];
    }
    data.writeUInt16BE(node.port, 24 + offset);
    offset += 26;
  });

  return data;
};

utils.decodePeers = function decodePeers(data) {
  var peers = [];

  for (var i = 0; i + 6 <= data.length; i += 6) {
    peers.push({
      address: data[i] + '.' + data[i + 1] + '.' +
               data[i + 2] + '.' + data[i + 3],
      port: data.readUInt16BE(i + 4)
    });
  }

  return peers;
};

utils.decodeNodes = function decodeNodes(data) {
  var nodes = [];

  for (var i = 0; i + 26 <= data.length; i += 26) {
    nodes.push({
      id: data.slice(i, i + 20),
      address: data[i + 20] + '.' + data[i + 21] + '.' +
               data[i + 22] + '.' + data[i + 23],
      port: data.readUInt16BE(i + 24)
    });
  }

  return nodes;
};

utils.wrapSocket = function wrapSocket(socket, onmessage, onlistening) {
  var handlers = socket.listeners('message').slice();
  socket.removeAllListeners('message');
  socket.on('message', function(msg, rinfo) {
    if (onmessage(msg, rinfo) !== false) return;

    handlers.forEach(function(handler) {
      handler.call(socket, msg, rinfo);
    });
  });

  try {
    // Only bound sockets allow calling this
    socket.address();
  } catch (e) {
    // Invoke callback when socket will be bound
    socket.once('listening', onlistening);
    return socket;
  }

  process.nextTick(function() {
    // Invoke listening callback immediately
    onlistening.call(socket);
  });

  return socket;
};
