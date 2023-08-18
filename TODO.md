- [ ] delete the WEB comments
- [ ] redo all logging to use the debug module

- [ ] require require's to use static import syntax instead
Once this is done, we have the option of using ESM modules.
"module": "es2020" (in tsconfig.json).

- [ ] get rid of all the #if macro preprocess comments \(maybe grunt used them\). We can solve these problems for the web later, e.g., using polyfills or better code.
- [ ] eliminate use of `var`
- [ ] promote the node\-fuse stuff to be part of the main library instead of an example
- [ ] there are a bunch of TODO's in the code still.
- [x] upgrade to newest ws module.
- [x] fix all typescript errors
- [x] enable noUnusedLocals
- [x] enable noUnusedParameters
- [x] enable strictNullChecks

