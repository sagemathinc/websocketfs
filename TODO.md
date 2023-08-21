## Critical

- [ ] LARGE files  \(above 32\*1024 characters\) are always corrupted when written \(or read?\).  This probably causes many of the remaining problems.  I don't know why this is yet, but the stress.test.ts illustrates it.  Basically exactly the first 32\*1024 gets written and nothing more.  I thought I wrote
- [ ] "git log" on nontrivial content doesn't work, probably due to mmap?
- [ ] "git clone" doesn't work
- [ ] stat doesn't return blocks so "du" doesn't work.
- [ ] make it work over the network
- [ ] support api key auth

## Code Quality

- [ ] delete the "WEB" comments in code...
- [ ] redo all logging to use the debug module
- [ ] require require's to use static import syntax instead
  Once this is done, we have the option of using ESM modules.
  "module": "es2020" \(in tsconfig.json\).
- [ ] eliminate use of `var`
- [ ] there are a bunch of TODO's in the code still.
- [ ] support node v20
- [x] get rid of all the #if macro preprocess comments \(maybe grunt used them\). We can solve these problems for the web later, e.g., using polyfills or better code.
- [x] writing a LARGE file \-\- do we need to chunk it? Same question about reading.  It seems like we do. What about changing the params?
- [x] promote the node\-fuse stuff to be part of the main library instead of an example
- [x] finish implementing all fuse functions
- [x] github actions that does `pnpm test-all`...
- [x] implement reading contents from a file
- [x] upgrade to newest ws module.
- [x] fix all typescript errors
- [x] enable noUnusedLocals
- [x] enable noUnusedParameters
- [x] enable strictNullChecks

