var dht = require('../dht'),
    bn = dht.bn,
    util = require('util'),
    crypto = require('crypto'),
    assert = require('assert'),
    Buffer = require('buffer').Buffer,
    EventEmitter = require('events').EventEmitter;

function Bucket(node, start, end) {
  this.node = node;

  if (start && end) {
    this.start = start;
    this.end = end;
    this.first = false;
  } else {
    this.start = new Buffer(22);
    this.end = new Buffer(22);
    this.first = true;

    this.start.fill('\0');
    this.end.fill('\0');
    this.end[1] = 1; // 0x0001....
  }

  this.timeouts = {
    renew: 15 * 60 * 1000 // 15 minutes
  };
  this.timeout = null;
  this.nodes = {};
  this.peers = {};
  this.slots = node.K;
  this.peerSlots = node.K;
  this.depth = 0;

  this.renew(true);
};

exports.create = function create(node, start, end) {
  return new Bucket(node, start, end);
};

Bucket.prototype.close = function close() {
  // Do not renew anymore
  this.timeout = false;
};

Bucket.prototype.renew = function renew(immediate) {
  var self = this;

  if (this.timeout === false) return;

  function doAction() {
    // Perform query on random id
    self.node.findNodes(bn.random(self.start, self.end), function() {
      self.renew();
    });
  }

  if (immediate) process.nextTick(doAction);

  if (this.timeout) clearTimeout(this.timeout);
  this.timeout = setTimeout(doAction, this.timeouts.renew);
};

Bucket.prototype.getNodes = function getNodes() {
  var nodes = this.nodes;

  return Object.keys(nodes).map(function(id) {
    return nodes[id];
  });
};

Bucket.prototype.contains = function contains(id) {
  return bn.compare(this.start, id) <= 0 &&
         bn.compare(id, this.end) < 0;
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

Bucket.prototype.addPeer = function addPeer(infohash, address, port, ourport) {
  var self = this,
      sid = infohash.toString('hex'),
      peers = this.peers[sid],
      existing;

  if (!peers) {
    // Do not store additional infohashes
    if (this.peerSlots <= 0) return;
    this.peerSlots--;

    peers = this.peers[sid] = {
      port: ourport || 0,
      list: []
    };
  } else {
    peers.port = ourport || peers.port;
  }

  peers.list.some(function(peer) {
    if (peer.address !== address || peer.port !== port) return false;
    existing = peer;
    return true;
  });

  if (existing) {
    existing.renew();
  } else {
    var peer = new Peer(this.node, infohash, address, port);

    peer.once('timeout', function() {
      var index = peers.list.indexOf(peer);
      if (index === -1) return;

      self.node.emit('peer:delete', infohash, peer);

      peers.list.splice(index, 1);

      // Remove infohash from peers
      if (peers.list.length === 0 && peers.port === 0) {
        delete self.peers[sid];
      }
    });

    peers.list.push(peer);
    this.node.emit('peer:new',
                   infohash,
                   peer,
                   this.node.advertisements.indexOf(sid) !== -1);

    existing = peer;
  }

  return existing;
};

Bucket.prototype.getPeers = function getPeers(infohash) {
  var sid = infohash.toString('hex');
  if (this.peers.hasOwnProperty(sid)) {
    return this.peers[sid];
  }
};

Bucket.prototype.advertise = function advertise(infohash, port) {
  var hid = infohash.toString('hex');

  if (!this.peers.hasOwnProperty(hid)) {
    this.peers[hid] = {
      port: port,
      list: []
    };
  } else {
    this.peers[hid].port = port;
  }
};

Bucket.prototype.split = function split() {
  // Split is impossible when start + 1 === end
  if (this.depth >= 160) {
    return false;
  }

  var pos = bn.shr(bn.add(this.start, this.end)),
      head = new Bucket(this.node, this.start, pos),
      tail = new Bucket(this.node, pos, this.end);

  head.depth = this.depth + 1;
  tail.depth = this.depth + 1;

  // Relocate all nodes from this bucket into head and tail
  Object.keys(this.nodes).forEach(function(id) {
    var hid = new Buffer(id, 'hex');
    if (head.contains(hid)) {
      head.add(this.nodes[id]);
    } else {
      tail.add(this.nodes[id]);
    }
  }, this);

  // Relocate all peers
  Object.keys(this.peers).forEach(function(id) {
    var hid = new Buffer(id, 'hex'),
        peers = this.peers[id];

    if (head.contains(hid)) {
      push.call(this, head);
    } else {
      push.call(this, tail);
    }

    function push(bucket) {
      // if no peers then this was advertised, re-advertise in relevant bucket.
      if (peers.list.length === 0) {
        bucket.advertise(hid, peers.port);
      } else {
        peers.list.forEach(function(peer) {
          bucket.addPeer(hid, peer.address, peer.port, peers.port);

          // Detach peer from bucket
          peer.emit('timeout');
        }, this);
      }
    }

    delete this.peers[id];
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
};

RemoteNode.prototype.toJSON = function toJSON() {
  return {
    id: this.id.toString('hex'),
    address: this.address,
    port: this.port
  };
};

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
                                                          port,
                                                          callback)  {
  this.node.sendAnnouncePeer(this,
                             token,
                             infohash,
                             port,
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
    this.timeout = null;
    self.emit('timeout');
  }, this.timeouts.peer);
};
