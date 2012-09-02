var dgram = require('dgram'),
    crypto = require('crypto'),
    util = require('util'),
    Buffer = require('buffer').Buffer,
    EventEmitter = require('events').EventEmitter;

var dht = require('../dht'),
    bencode = dht.bencode,
    utils = dht.utils;

function Node() {
  EventEmitter.call(this);

  this.socket = dgram.createSocket('udp4');
  this.id = new Buffer(
    crypto.createHash('sha1').update(crypto.randomBytes(20)).digest('hex'),
    'hex'
  );

  this.queries = {};
  this.timeouts = {
    response: 5000
  };
  this.buckets = [new Bucket()];
};
util.inherits(Node, EventEmitter);

exports.create = function create() {
  return new Node();
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

  this.socket.send(packet, target);

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
  var reponse = {
        t: msg.t,
        y: 'r',
        r: args
      },
      packet = bencode.encode(response);

  this.socket.send(packet, target);
};

Node.prototype.onmessage = function onmessage(packet, rinfo) {
  try {
    var msg = bencode.decode(packet);

    // Process response
    if (msg.y === 'r') {
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

    // Process requests
    this.processRequest(msg.q, msg, rinfo);

  } catch (e) {
    this.emit('error', e);
  }
};

Node.prototype.processRequest = function processRequest(type, msg, rinfo) {
  var args = msg.r;
  if (type === 'ping') {
    this.processPing(args, rinfo);
  } else if (type === 'find_node') {
    this.processFindNode(args, rinfo);
  } else if (type === 'get_peers') {
    this.processGetPeers(args, rinfo);
  } else if (type === 'announce_peer') {
    this.processAnnouncePeer(args, rinfo);
  } else {
    // Ignore
  }
};

Node.prototype.ping = function ping(target, callback) {
  this.request(target, 'ping', { id: this.id }, callback);
};

Node.prototype.findNode = function findNode(target, id, callback) {
  this.request(target, 'find_node', { id: this.id, target: id }, callback);
};

Node.prototype.getPeers = function getPeers(target, id, callback) {
  this.request(target, 'get_peers', { id: this.id, info_hash: id }, callback);
};

Node.prototype.announcePeer = function announcePeer(target, peer, callback)  {
  this.request(target, 'announce_peer', {
    id: this.id,
    info_hash: id,
    token: peer.token,
    port: peer.port
  }, callback);
};

Node.prototype.processPing = function processPing(args, rinfo) {
  this.respond(target, msg, { id: this.id });
  this.buckets.filter(function(bucket) {
    return bucket.covers(args.id);
  }).forEach(function(bucket) {
    bucket.addNode(args.id, rinfo);
  });
};

Node.prototype.processFindNode = function processFindNode(args, rinfo) {
};

Node.prototype.processGetPeers = function processGetPeers(args, rinfo) {
};

Node.prototype.processAnnouncePeer = function processAnnouncePeer(args, rinfo) {
};

function Bucket() {
};

Bucket.prototype.split = function split() {
};

Bucket.prototype.covers = function covers(id) {
};
