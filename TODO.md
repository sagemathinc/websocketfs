# Critical

# Code Quality

- [ ] #now redo logging to use the debug module
- [ ] support node v20
  - See https://github.com/sagemathinc/websocketfs/issues/1 
  - May be entirely an issue for unit testing.

# DONE

- [x] there are a bunch of TODO's in the code still -- read them; delete ones that aren't relevant or address, or leave ones that may matter later.  Result: most of the worrisome ones are in copy functions that FUSE doesn't use.
- [x] Remove all auth (was: support auth, i.e., an optional symmetric key that clients must present to be allowed to mount the filesystem. This is useful for "defense in depth".). It's better to do the auth at a different level.
- [x] delete the "WEB" comments in code...
- [x] require require's to use static import syntax instead
      Once this is done, we have the option of using ESM modules.
      "module": "es2020" \(in tsconfig.json\).
- [x] eliminate use of `var`
- [x] make it work over the network
  - it technically does already work over a network, but I've only been using localhost for testing/demos. Need to try a real network situation.
- [x] benchmarking and make it a bit faster, e.g., maybe support some intense levels of caching...?
- [x] implement statfs so can do `df -h ...`
  - with luck, I just need to implement SftpVfsStats in sftp-misc.ts?!
- [x] set filesystem name
- [x] stat doesn't return blocks so "du" doesn't work.
- [x] tar gets confused \-\- "file changed as we read it", I think because our timestamps are a mess for stat \(1 second resolution and kind of random?\)
- [x] LARGE files \(above 32\*1024 characters\) are always corrupted when written \(or read?\). This probably causes many of the remaining problems. I don't know why this is yet, but the stress.test.ts illustrates it. Basically exactly the first 32\*1024 gets written and nothing more. I thought I wrote
- [x] "git log" on nontrivial content doesn't work, probably due to mmap?
- [x] "git clone" doesn't work
- [x] get rid of all the #if macro preprocess comments \(maybe grunt used them\). We can solve these problems for the web later, e.g., using polyfills or better code.
- [x] writing a LARGE file \-\- do we need to chunk it? Same question about reading. It seems like we do. What about changing the params?
- [x] promote the node\-fuse stuff to be part of the main library instead of an example
- [x] finish implementing all fuse functions
- [x] github actions that does `pnpm test-all`...
- [x] implement reading contents from a file
- [x] upgrade to newest ws module.
- [x] fix all typescript errors
- [x] enable noUnusedLocals
- [x] enable noUnusedParameters
- [x] enable strictNullChecks

