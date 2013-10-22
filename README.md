# DHT.js

True, complete implementation of [DHT Protocol][0] written in javascript for
node.js runtime.

_Danger! This module is in development and isn't tested enough to use it in
production!_

## Motivation

DHT is a great tool for storing and searching data, and is widely adopted and
used in almost every existing torrent client. Since torrents are quite popular
nowadays, being able to connect to that network, storing or finding data inside
it can be really useful for building interesting distributed applications.

## Installation

```bash
npm install dht.js
```

## Usage

```javascript
var dht = require('dht.js');

// Create DHT node (server)
var node = dht.node.create(/* optional UDP port there */);

// Connect to known node in network
node.connect({
  id: new Buffer(/* 160bit node id */), /* <-- optional */
  address: '4.4.4.4',
  port: 13589
});

// Tell everyone that you have services to advertise
var hash = new Buffer(/* 160 bit infohash */);
node.advertise(hash, 13589 /* port */);

// Wait for someone to appear
node.on('peer:new', function (infohash, peer, isAdvertised) {
  // Ignore other services
  if (!isAdvertised) return;

  console.log(peer.address, peer.port);

  // Stop listening
  node.close();

  // Returns node's state as a javascript object
  var state = node.save();

  // Create node from existing state
  var old = dht.node.create(state);

  // Just cleaning up
  old.close();
});
```

### License

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2012.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

[0]: http://www.bittorrent.org/beps/bep_0005.html
