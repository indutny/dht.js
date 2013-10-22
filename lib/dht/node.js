var assert = require('assert'),
    dgram = require('dgram'),
    crypto = require('crypto'),
    util = require('util'),
    async = require('async'),
    os = require('os'),
    Buffer = require('buffer').Buffer,
    EventEmitter = require('events').EventEmitter;

var dht = require('../dht'),
    bencode = dht.bencode,
    utils = dht.utils;

function Node(port) {
  var self = this,
      options;

  EventEmitter.call(this);

  if (typeof port === 'object' && port !== null) {
    options = port;
    port = 0;
  }

  this.closed = false;
  this.address = null;
  this.port = port;

  this.queries = {};
  this.timeouts = {
    response: 7000, // 7 seconds
    peer: 60 * 60 * 1000, // 1 hour
    announce: 15000, // 15 seconds
    token: 20 * 1000, // 20 seconds
    renew: 5 * 60 * 1000, // 5 minutes
  };

  // DHT configuration
  this.K = 8;
  this.buckets = [ dht.bucket.create(this) ];
  this.advertisements = [];
  this.tokens = {};

  this.announceInterval = setInterval(this.announce.bind(this),
                                      this.timeouts.announce);

  function onListening() {
    self.port = self.socket.address().port;
    self.address = self.socket.address().address;

    self.announce();

    process.nextTick(function() {
      self.emit('listening');
    });
  }

  if (options && options.socket) {
    // Wrap passed socket
    this.socket = utils.wrapSocket(options.socket,
                                   this.onmessage.bind(this),
                                   onListening);
  } else {
    // Create new socket
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', this.onmessage.bind(this));
    this.socket.once('listening', onListening);
  }

  // Try loading configuration, fall back to random one
  if (!options || !this.load(options)) {
    this.id = new Buffer(
      crypto.createHash('sha1').update(crypto.randomBytes(20)).digest('hex'),
      'hex'
    );

    // Do not bind wrapped socket
    if (!options || !options.socket) this.socket.bind(port || 0);
  }

  this.ips = [];
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function(iface) {
    ifaces[iface].forEach(function(addr) {
      this.ips.push(addr.address);
    }, this);
  }, this);

  this.renew();
};
util.inherits(Node, EventEmitter);

exports.create = function create(port) {
  return new Node(port);
};

Node.prototype.close = function close() {
  if (this.closed) return;
  this.closed = true;

  this.socket.close();
  clearInterval(this.announceInterval);
  this.announceInterval = null;
  clearTimeout(this.renewTimeout);
  this.renewTimeout = null;
};

Node.prototype.advertise = function advertise(infohash, port) {
  var sid = infohash.toString('hex');
  this.getBucket(infohash).advertise(infohash, port);

  if (this.advertisements.indexOf(sid) === -1) {
    this.advertisements.push(sid);
  }

  this.announce();
};

Node.prototype.connect = function connect(info) {
  if (info.id) {
    this.addNode(info);
  } else {
    this.sendPing(info, function() {
    });
  }
};

Node.prototype.save = function save() {
  return {
    id: this.id.toString('hex'),
    port: this.port,
    nodes: this.buckets.map(function(bucket) {
      return bucket.getNodes().map(function(node) {
        return node.toJSON();
      });
    }).reduce(function(acc, nodes) {
      return acc.concat(nodes);
    })
  };
};

Node.prototype.load = function load(config) {
  // Ignore incorrect configurations
  if (!config.id ||
      !Array.isArray(config.nodes)) {
    return false;
  }

  this.id = config.id instanceof Buffer ? config.id :
                                          new Buffer(config.id, 'hex');
  assert.equal(this.id.length, 20);
  if (!config.socket) this.socket.bind(config.port || 0);

  // Reconnect to known nodes
  config.nodes.forEach(function(node) {
    this.connect({
      id: new Buffer(node.id, 'hex'),
      address: node.address,
      port: node.port
    });
  }, this);

  return true;
};

// Internal APIs

Node.prototype.request = function request(target, type, args, callback) {
  if (this.closed) return callback(new Error('Socket closed'));

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
        callback: function(err, data, rinfo) {
          delete self.queries[key];
          clearTimeout(query.timeout);

          callback(err, data, rinfo);
        },
        timeout: setTimeout(function() {
          callback(new Error('Timed out'));
          if (self.queries[key] !== query) return;

          delete self.queries[key];
        }, this.timeouts.response)
      };

  this.queries[key] = query;
};

Node.prototype.respond = function respond(target, msg, args) {
  if (this.closed) return;

  args.id = this.id;

  var response = {
        t: msg.t,
        y: 'r',
        r: args
      },
      packet = bencode.encode(response);

  this.socket.send(packet, 0, packet.length, target.port, target.address);
};

Node.prototype.error = function error(target, msg, code, text) {
  if (this.closed) return;

  var response = {
        t: msg.t,
        y: 'e',
        e: [code, text || 'error']
      },
      packet = bencode.encode(response);

  this.socket.send(packet, 0, packet.length, target.port, target.address);
};

Node.prototype.onmessage = function onmessage(packet, rinfo) {
  try {
    var msg = bencode.decode(packet),
        id;
  } catch (e) {
    return false;
  }

  if (msg.a && msg.a.id) {
    id = msg.a.id;
  } else if (msg.r && msg.r.id) {
    id = msg.r.id;
  }

  // Ignore malformed data
  if (!id || !Buffer.isBuffer(id) || id.length !== 20) {
    return this.error(rinfo, msg, 203, 'Id is required');
  }

  if (!msg.y || msg.y.length !== 1) {
    return this.error(rinfo, msg, 203, 'Y is required');
  }

  this.addNode({
    id: id,
    address: rinfo.address,
    port: rinfo.port
  });

  if (msg.y[0] === 0x71 /* q */) {
    if (!msg.a) return this.error(rinfo, msg, 203, 'A is required');
    if (!msg.q) return this.error(rinfo, msg, 203, 'Q is required');

    // Process requests
    this.processRequest(msg.q.toString(), msg, rinfo);
    return;
  }

  if (!msg.t) {
    return this.error(rinfo, msg, 203, 'T is required');
  }

  var id = msg.t.toString('hex'),
      query = this.queries[id];

  if (!this.queries.hasOwnProperty(id)) {
    return this.error(rinfo, msg, 201, 'Such t wasn\'t sent');
  }

  if (msg.y[0] === 0x72 /* r */) {
    query.callback(null, msg.r, rinfo);
  } else if (msg.y[0] === 0x65 /* e */ && query) {
    if (!Array.isArray(msg.e)) {
      return this.error(rinfo, msg, 203, 'Error with e');
    }

    query.callback(msg.e.join(''), msg.r, rinfo);
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
                                                            port,
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
      port: port || self.port
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
    return this.error(rinfo, msg, 203, 'get_peers without info_hash');
  }

  var token = this.issueToken(),
      peers = this.getBucket(msg.a.info_hash).getPeers(msg.a.info_hash);

  if (!peers) {
    this.respond(rinfo, msg, {
      token: token,
      nodes: utils.encodeNodes(this.getKClosest(msg.a.info_hash))
    });
    return;
  }

  this.respond(rinfo, msg, {
    token: token,
    values: utils.encodePeers(peers.list)
  });
};

Node.prototype.processAnnouncePeer = function processAnnouncePeer(msg, rinfo) {
  if (!msg.a.token ||
      !Buffer.isBuffer(msg.a.token) ||
      !this.verifyToken(msg.a.token)) {
    return this.error(rinfo, msg, 203, 'token is invalid');
  }

  if (!msg.a.info_hash ||
      !Buffer.isBuffer(msg.a.info_hash) ||
      msg.a.info_hash.length !== 20) {
    return this.error(rinfo, msg, 203, 'announce_peer without info_hash');
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

  this.advertisements.forEach(function(sid) {
    var infohash = new Buffer(sid, 'hex'),
        peers = this.getBucket(infohash).getPeers(infohash);

    if (!peers) {
      return this.emit('error',
                       new Error('Advertising infohash doesn\'t exist'));
    }

    var port = peers.port || 0;

    // Recursively find nodes
    this.findNodes(infohash, function() {});

    this.getKClosest(infohash).forEach(function(node) {
      node.getPeers(infohash, function(err, msg) {
        if (err) return;

        if (msg.nodes && Buffer.isBuffer(msg.nodes)) {
          // Add nodes that are close to the infohash
          var nodes = utils.decodeNodes(msg.nodes);
          nodes.forEach(function(node) {
            self.addNode(node);
          });
        } else {
          node.findNode(infohash, function(err, msg) {
            if (err) return;
            if (!msg || !Buffer.isBuffer(msg.nodes)) return;

            // Add nodes
            var nodes = utils.decodeNodes(msg.nodes);
            nodes.forEach(function(node) {
              self.addNode(node);
            });
          });
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

        if (msg.token && port !== 0) {
          // Add our info to node
          node.announcePeer(msg.token, infohash, port, function(err) {
            if (err) return;
            // Ignore?!
          });
        }
      });
    }, this);
  }, this);
};

Node.prototype.getKClosest = function getKClosest(id) {
  var bucket = this.getBucket(id),
      nodes = bucket.getNodes();

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
    var bucket = this.getBucket(info.id);

    // Add node to bucket
    if (node = bucket.add(info)) break;

    // Non-main bucket can't be split
    if (!bucket.contains(this.id)) break;

    // Bucket is full - split it and try again
    var split = bucket.split();
    if (!split) break;

    this.buckets.splice.apply(this.buckets, [
      this.buckets.indexOf(bucket),
      1
    ].concat(split));
  }

  return node;
};

Node.prototype.addPeer = function addPeer(infohash, address, port) {
  // Check if we're trying to add ourself
  if (this.ips.indexOf(address) !== -1 && this.port === port) return;

  var peer = this.getBucket(infohash).addPeer(infohash, address, port);

  // Bucket may be already full
  if (!peer) return;

  // Try reaching out peer
  this.sendPing(peer, function() {});
};

Node.prototype.issueToken = function issueToken() {
  var token = crypto.randomBytes(4),
      stoken = token.toString('hex');

  // Token should expire
  if (!this.tokens[stoken]) {
    var self = this;

    this.tokens[stoken] = true;
    setTimeout(function() {
      delete self.tokens[stoken];
    }, this.timeouts.token);
  }

  return token;
};

Node.prototype.verifyToken = function verifyToken(token) {
  return this.tokens.hasOwnProperty(token.toString('hex'));
};

Node.prototype.getBucket = function getBucket(id) {
  var result;

  this.buckets.some(function(bucket) {
    if (bucket.contains(id)) {
      result = bucket;
      return true;
    }
  });

  return result;
};

Node.prototype.renew = function renew() {
  var self = this;

  // Find nodes that're close to us
  this.findNodes(this.id, function() {});

  this.renewTimeout = setTimeout(function() {
    self.renew();
  }, this.timeouts.renew);
};
