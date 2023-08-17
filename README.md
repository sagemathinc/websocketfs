# websocketfs

**websocketfs:** like sshfs, but over a WebSocket and implemented in Typescript

I wish there was something like sshfs, but entirely over a websocket that doesn't use ssh at all. **Amazingly... I just implemented a prototype of this!** Anyway, I'm pretty excited to see this work. I found this [ancient and forgotten project from 8 years ago](https://github.com/lukaaash/vfs/tree/master), then rewrote it to not use sshfs at all and instead use libfuse2 bindings to nodejs. It is going to be like what sshfs provides, except entirely 100% using Typescript/Nodejs \+ a websocket for the transport and fuse bindings. This could also be extended to work in browser \(for WebAssembly with WASI\), providing basically "sshfs for the browser". The real work to make this possible is in [this also ancient forgotten implementation of the entire sftp protocol](https://github.com/lukaaash/sftp-ws) in Typescript from 8 years ago, as explained in [this blogpost](https://lukas.pokorny.eu/sftp-over-websockets/). 

Anyway, I so far have a proof of concept of this working, though to get this to be robust, I'll have to clean up and modernize this stuff, add some missing functionality, add more tests, etc.   The actual work feels similar to what was involved in building https://cowasm.org/ , but easier, since it's javascript instead of massive amounts of decades old C. 

## Quickstart

Nothing yet -- stay tuned!