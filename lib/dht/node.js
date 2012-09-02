var dgram = require('dgram'),
    crypto = require('crypto'),
    util = require('util'),
    async = require('async'),
    Buffer = require('buffer').Buffer,
    EventEmitter = require('events').EventEmitter;

var dht = require('../dht'),
    bencode = dht.bencode,
    utils = dht.utils;

function Node(port) {
  var self = this;
  EventEmitter.call(this);

  this.address = null;
  this.port = port;

  this.id = new Buffer(
    crypto.createHash('sha1').update(crypto.randomBytes(20)).digest('hex'),
    'hex'
  );

  this.queries = {};
  this.timeouts = {
    response: 5000, // 5 seconds
    peer: 60 * 60 * 1000, // 1 hour
    announce: 10000, // 10 seconds
  };

  // DHT configuration
  this.K = 8;
  this.buckets = [ new Bucket(this) ];

  // Information about peers
  this.peers = {};

  this.announceInterval = setInterval(this.announce.bind(this),
                                      this.timeouts.announce);

  // Create socket
  this.socket = dgram.createSocket('udp4');
  this.socket.on('message', this.onmessage.bind(this));
  this.socket.once('listening', function() {
    self.port = self.socket.address().port;
    self.address = self.socket.address().address;

    self.announce();

    process.nextTick(function() {
      self.emit('listening');
    });
  });
  this.socket.bind(port);
};
util.inherits(Node, EventEmitter);

exports.create = function create(port) {
  return new Node(port || 0);
};

Node.prototype.close = function close() {
  this.socket.close();
  clearTimeout(this.announceInterval);
  this.announceInterval = null;
};

Node.prototype.request = function request(target, type, args, callback) {
  var self = this,
      id = new Buffer([~~(Math.random() * 256), ~~(Math.random() * 256)]),
      msg = {
        t: id,
        y: 'q',
        q: type,
        a: args
      },
      packet = bencode.encode(msg);

  this.socket.send(packet, 0, packet.length, target.port, target.address);

  var key = id.toString('hex'),
      query = {
        callback: callback,
        timeout: setTimeout(function() {
          callback(new Error('Timed out'));
          if (self.queries[key] !== query) return;

          delete self.queries[key];
        }, this.timeouts.response)
      };

  this.queries[key] = query;
};

Node.prototype.respond = function respond(target, msg, args) {
  args.id = this.id;

  var response = {
        t: msg.t,
        y: 'r',
        r: args
      },
      packet = bencode.encode(response);

  this.socket.send(packet, 0, packet.length, target.port, target.address);
};

Node.prototype.onmessage = function onmessage(packet, rinfo) {
  try {
    var msg = bencode.decode(packet),
        id;

    if (msg.a && msg.a.id) {
      id = msg.a.id;
    } else if (msg.r && msg.r.id) {
      id = msg.r.id;
    }

    // Ignore malformed data
    if (!id || !Buffer.isBuffer(id) || id.length !== 20) return;

    this.addNode({
      id: id,
      address: rinfo.address,
      port: rinfo.port
    });

    // Process response
    if (msg.y && msg.y.length === 1 && msg.y[0] === 0x72 /* r */) {
      var id = msg.t.toString('hex');

      // Invoke callback if we have sent request with the same id
      if (this.queries.hasOwnProperty(id)) {
        var query = this.queries[id];
        clearTimeout(query.timeout);
        query.callback(null, msg.r, rinfo);
        delete this.queries[id];
      }
      return;
    }

    if (!msg.a) return;

    // Process requests
    this.processRequest(msg.q.toString(), msg, rinfo);

  } catch (e) {
    this.emit('error', e);
  }
};

Node.prototype.processRequest = function processRequest(type, msg, rinfo) {
  if (type === 'ping') {
    this.processPing(msg, rinfo);
  } else if (type === 'find_node') {
    this.processFindNode(msg, rinfo);
  } else if (type === 'get_peers') {
    this.processGetPeers(msg, rinfo);
  } else if (type === 'announce_peer') {
    this.processAnnouncePeer(msg, rinfo);
  } else {
    // Ignore
  }
};

Node.prototype.sendPing = function sendPing(target, callback) {
  this.request(target, 'ping', { id: this.id }, callback);
};

Node.prototype.sendFindNode = function sendFindNode(target, id, callback) {
  this.request(target, 'find_node', { id: this.id, target: id }, callback);
};

Node.prototype.sendGetPeers = function sendGetPeers(target, id, callback) {
  this.request(target, 'get_peers', { id: this.id, info_hash: id }, callback);
};

Node.prototype.sendAnnouncePeer = function sendAnnouncePeer(target,
                                                            token,
                                                            infohash,
                                                            callback)  {
  var self = this;

  // UDP Port is required. Wait for socket to bound if it isn't.
  if (this.port === 0) {
    this.once('listening', function() {
      send();
    });
  } else {
    send();
  }

  function send() {
    self.request(target, 'announce_peer', {
      id: self.id,
      info_hash: infohash,
      token: token,
      port: self.port
    }, callback);
  }
};

Node.prototype.processPing = function processPing(msg, rinfo) {
  this.respond(rinfo, msg, { });
};

Node.prototype.processFindNode = function processFindNode(msg, rinfo) {
  this.respond(rinfo, msg, {
    nodes: utils.encodeNodes(this.getKClosest(msg.a.id))
  });
};

Node.prototype.processGetPeers = function processGetPeers(msg, rinfo) {
  if (!msg.a.info_hash ||
      !Buffer.isBuffer(msg.a.info_hash) ||
      msg.a.info_hash.length !== 20) {
    return;
  }

  var infohash = msg.a.info_hash.toString('hex'),
      token = this.issueToken();

  if (!this.peers.hasOwnProperty(infohash)) {
    this.respond(rinfo, msg, {
      token: token,
      nodes: utils.encodeNodes(this.getKClosest(msg.a.info_hash))
    });
    return;
  }

  this.respond(rinfo, msg, {
    token: token,
    values: utils.encodePeers(this.peers[infohash])
  });
};

Node.prototype.processAnnouncePeer = function processAnnouncePeer(msg, rinfo) {
  if (!msg.a.token ||
      !Buffer.isBuffer(msg.a.token) ||
      !this.verifyToken(msg.a.token) ||
      !msg.a.info_hash ||
      !Buffer.isBuffer(msg.a.info_hash) ||
      msg.a.info_hash.length !== 20) {
    return;
  }

  this.addPeer(msg.a.info_hash,
               rinfo.address,
               typeof msg.a.port === 'number' ? msg.a.port : rinfo.port);
  this.respond(rinfo, msg, {});
};

Node.prototype.findNodes = function findNodes(id, callback) {
  var self = this,
      results = [],
      known = this.getKClosest(id);

  async.whilst(function() {
    return results.length < 2 * self.K && known.length !== 0;
  }, function(callback) {
    var nodes = known;

    results = results.concat(known);
    known = [];

    async.forEach(nodes, function(node, callback) {
      node.findNode(id, function(err, msg) {
        // Ignore errors because we just need to collect as much as possible
        if (err) return callback(null);
        if (!msg || !Buffer.isBuffer(msg.nodes)) return callback(null);

        // Add nodes to known
        var nodes = utils.decodeNodes(msg.nodes);
        nodes.forEach(function(node) {
          var remote = self.addNode(node);
          if (remote) known.push(remote);
        });

        callback(null);
      });
    }, callback);
  }, function() {
    callback(null, results);
  });
};

Node.prototype.announce = function announce() {
  var self = this;

  Object.keys(this.peers).forEach(function(infohash) {
    infohash = new Buffer(infohash, 'hex');

    this.getKClosest(infohash).forEach(function(node) {
      node.getPeers(infohash, function(err, msg) {
        if (err) return;

        if (msg.nodes && Buffer.isBuffer(msg.nodes)) {
          // Add nodes that are close to the infohash
          var nodes = utils.decodeNodes(msg.nodes);
          nodes.forEach(function(node) {
            self.addNode(node);
          });

          if (msg.token && !msg.values) {
            // Add our info to node
            node.announcePeer(msg.token, infohash, function(err) {
              if (err) return;
              // Ignore?!
            });
          }
        }

        if (msg.values) {
          if (Buffer.isBuffer(msg.values)) {
            msg.values = [msg.values];
          }

          if (Array.isArray(msg.values)) {
            msg.values.forEach(function(value) {
              var peers = utils.decodePeers(value);
              peers.forEach(function(peer) {
                self.addPeer(infohash, peer.address, peer.port);
              });
            });
          }
        }
      });
    }, this);
  }, this);
};

Node.prototype.getKClosest = function getKClosest(id) {
  var bucket = this.buckets.filter(function(bucket) {
    return bucket.contains(id);
  })[0];

  var nodes = bucket.getNodes();

  // If not enough results
  if (nodes.length < this.K) {
    var index = this.buckets.indexOf(bucket);

    // Include neighbors
    if (index - 1 >= 0) {
      nodes = nodes.concat(this.buckets[index - 1].getNodes());
    }
    if (index + 1 < this.buckets.length) {
      nodes = nodes.concat(this.buckets[index + 1].getNodes());
    }
  }

  // Limit number of nodes
  nodes = nodes.slice(0, this.K);

  return nodes;
};

Node.prototype.addNode = function addNode(info) {
  var node;

  // Ignore requests to add myself
  if (info.id === this.id) return;

  while (true) {
    var bucket = this.buckets.filter(function(bucket) {
      return bucket.contains(info.id);
    })[0];

    // Add node to bucket
    if (node = bucket.add(info)) break;

    // Non-main bucket can't be split
    if (!bucket.contains(this.id)) break;

    // Bucket is full - split it and try again
    this.buckets.splice.apply(this.buckets, [
      this.buckets.indexOf(bucket),
      1
    ].concat(bucket.split()));
  }

  return node;
};

Node.prototype.addPeer = function addPeer(infohash, address, port) {
  var self = this,
      peers = this.peers[infohash.toString('hex')],
      existing;

  if (!peers) {
    peers = this.peers[infohash.toString('hex')] = [];
  }

  peers.some(function(peer) {
    if (peer.address !== address || peer.port !== peer.port) return false;
    existing = peer;
    return true;
  });

  if (existing) {
    existing.renew();
  } else {
    var peer = new Peer(this, infohash, address, port);

    peer.once('timeout', function() {
      self.emit('peer:delete', infohash, peer);
    });

    this.peers[infohash.toString('hex')].push(peer);
    this.emit('peer:new', infohash, peer);

    existing = peer;
  }

  // Try reaching out peer
  this.sendPing(existing, function() {});
};

Node.prototype.issueToken = function issueToken() {
  // XXX: Issue real token
  return new Buffer(4);
};

Node.prototype.verifyToken = function verifyToken(token) {
  // XXX: Verify token
  return true;
};

function Bucket(node, start, end) {
  this.node = node;

  if (start && end) {
    this.start = start;
    this.end = end;
    this.first = false;
  } else {
    this.start = new Buffer(20);
    this.end = new Buffer(20);
    this.first = true;

    for (var i = 0; i < this.start.length; i += 2) {
      this.start.writeUInt16BE(0, i);
      this.end.writeUInt16BE(0xffff, i);
    }
  }

  this.timeouts = {
    renew: 15 * 60 * 1000 // 15 minutes
  };
  this.timeout = null;
  this.nodes = {};
  this.slots = node.K;

  this.renew(true);
};

Bucket.prototype.close = function close() {
  // Do not renew anymore
  this.timeout = false;
};

Bucket.prototype.renew = function renew(immediate) {
  var self = this;

  if (this.timeout === false) return;

  function doAction() {
    var id = new Buffer(self.start.length);

    // Pick random id
    for (var i = 0; i < id.length; i += 2) {
      var sword = self.start.readUInt16BE(i),
          eword = self.end.readUInt16BE(i);

      if (sword !== eword) {
        id.writeUInt16BE(~~(sword + Math.random() * (eword - sword)), i);
        break;
      } else {
        id.writeUInt16BE(sword, i);
      }
    }
    crypto.randomBytes(id.length - i).copy(id, i);

    // And perform query
    self.node.findNodes(id, function() {
      self.renew();
    });
  }

  if (immediate) process.nextTick(doAction);

  if (this.timouet) clearTimeout(this.timeout);
  this.timeout = setTimeout(doAction, this.timeouts.renew);
};

Bucket.prototype.getNodes = function getNodes() {
  var nodes = this.nodes;

  return Object.keys(nodes).map(function(id) {
    return nodes[id];
  });
};

Bucket.compare = function compare(a, b) {
  for (var i = 0; i < a.length; i += 2) {
    var aword = a.readUInt16BE(i),
        bword = b.readUInt16BE(i);

    if (aword === bword) continue;

    return aword > bword ? 1 : -1;
  }

  return 0;
};

Bucket.prototype.contains = function contains(id) {
  return Bucket.compare(this.start, id) <= 0 &&
         Bucket.compare(id, this.end) <= 0;
};

Bucket.prototype.add = function add(info) {
  var self = this,
      sid = info.id.toString('hex');

  if (this.nodes.hasOwnProperty(sid)) return this.nodes[sid];

  // If all slots are busy
  if (this.slots === 0) {
    // Evict bad old nodes
    var bad = Object.keys(this.nodes).filter(function(key) {
      return !this.nodes[key].good;
    }, this).sort(function(a, b) {
      return self.nodes[a].lastSeen - self.nodes[b].lastSeen;
    });

    // No bad nodes - fail
    if (bad.length === 0) return false;

    // Remove one node and continue
    this.remove(bad[0]);
  }

  var remote = info instanceof RemoteNode ?
                  info : new RemoteNode(this.node, info);

  this.nodes[sid] = remote;
  this.slots--;
  this.renew();

  return remote;
};

Bucket.prototype.remove = function remove(id) {
  var sid = id.toString('hex');
  if (!this.nodes.hasOwnProperty(sid)) return;

  this.nodes[sid].close();
  delete this.nodes[sid];
  this.slots++;
  this.renew();
};

Bucket.prototype.split = function split() {
  var rpos = new Buffer(this.end.length),
      lpos = new Buffer(this.end.length),
      overR = 1,
      overL = 1;

  // Big-small numbers :)
  for (var i = this.end.length - 2; i >= 0; i -= 2) {
    var word = this.end.readUInt16BE(i) + overR;

    overR = word & 0x10000;
    if (i !== 0) {
      word ^= overR;
      overR = overR >> 16;
    } else {
      overR = 0;
    }

    word = (word + this.start.readUInt16BE(i)) >> 1;
    rpos.writeUInt16BE(word, i);

    if (overL != 0){
      if (word - overL >= 0) {
        word -= overL;
        overL = 0;
      } else {
        word = 0xFFFF;
        overL = 1;
      }
    }

    lpos.writeUInt16BE(word, i);
  }

  var head = new Bucket(this.node, this.start, lpos),
      tail = new Bucket(this.node, rpos, this.end);

  // Relocate all nodes from this bucket into head and tail
  Object.keys(this.nodes).forEach(function(id) {
    var hid = new Buffer(id, 'hex');
    if (head.contains(hid)) {
      head.add(this.nodes[id]);
    } else {
      tail.add(this.nodes[id]);
    }
  }, this);

  this.close();

  return [head, tail];
};

// Node to store in a bucket
function RemoteNode(node, info) {
  this.node = node;
  this.id = info.id;
  this.address = info.address;
  this.port = info.port;

  this.firstSeen = +new Date;
  this.lastSeen = +new Date;

  this.timeouts = { ping : 15 * 60 * 1000 /* 15 minutes */ };
  this.timeout = null;
  this.good = true;
  this.bads = 0;

  this.schedulePing();
};

RemoteNode.prototype.close = function close() {
  if (this.timeout) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
}

RemoteNode.prototype.thank = function thank() {
  this.bads = 0;
  this.good = true;
  this.lastSeen = +new Date;
};

RemoteNode.prototype.curse = function curse() {
  this.bads++;
  if (this.bads > 2) {
    this.good = false;
  }
};

RemoteNode.prototype.schedulePing = function schedulePing() {
  var self = this;

  this.timeout = setTimeout(function() {
    self.ping(function() {
      self.schedulePing();
    });
  }, this.timeouts.ping);
};

RemoteNode.prototype._wrapCallback = function wrapCallback(callback) {
  var self = this;

  return function(err, data, rinfo) {
    if (err) {
      self.curse();
    } else {
      self.thank();
    }

    callback(err, data, rinfo);
  };
};

RemoteNode.prototype.ping = function ping(callback) {
  this.node.sendPing(this, this._wrapCallback(callback));
};

RemoteNode.prototype.findNode = function findNode(id, callback) {
  this.node.sendFindNode(this, id, this._wrapCallback(callback));
};

RemoteNode.prototype.getPeers = function getPeers(id, callback) {
  this.node.sendGetPeers(this, id, this._wrapCallback(callback));
};

RemoteNode.prototype.announcePeer = function announcePeer(token,
                                                          infohash,
                                                          callback)  {
  this.node.sendAnnouncePeer(this,
                             token,
                             infohash,
                             this._wrapCallback(callback));
};

function Peer(node, infohash, address, port) {
  EventEmitter.call(this);

  this.node = node;
  this.infohash = infohash;
  this.address = address;
  this.port = port;

  this.timeouts = {
    renew: 60 * 60 * 1000 // 1 hour
  };
  this.timeout = null;

  this.renew();
};
util.inherits(Peer, EventEmitter);

Peer.prototype.renew = function renew() {
  var self = this;

  if (this.timeout) clearTimeout(this.timeout);
  this.timeout = setTimeout(function() {
    var peers = self.node.peers[self.infohash.toString('hex')];
    this.timeout = null;

    var index = peers.indexOf(self);
    if (index === -1) return;

    peers.splice(index, 1);
    self.emit('timeout');
  }, this.timeouts.peer);
};
