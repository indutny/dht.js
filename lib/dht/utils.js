var utils = exports;

utils.encodePeer = function encodePeer(peer) {
  var data = new Buffer(6),
      ip = peer.address.split(/\./g, 4);

  for (var i = 0; i < 4; i++) {
    data[i] = +ip[i];
  }
  data.writeUInt16BE(peer.port, 4);

  return data;
};

utils.encodeNode = function encodeNode(node) {
  var data = new Buffer(26),
      ip = node.address.split(/\./g, 4);

  node.id.copy(data);
  for (var i = 0; i < 4; i++) {
    data[i + 20] = +ip[i];
  }
  data.writeUInt16BE(node.port, 24);

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
