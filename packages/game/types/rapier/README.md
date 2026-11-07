# Rapier declarations for NodeNext

The .d.ts files are unmodified copies from Dimforge’s Apache-2.0 release of
[@dimforge/rapier3d-compat 0.19.3](https://registry.npmjs.org/@dimforge/rapier3d-compat/-/rapier3d-compat-0.19.3.tgz).
The accompanying LICENSE is the upstream Apache License. Mirage supplies this directory's package.json.

The original declarations use extensionless file and directory imports. TypeScript NodeNext can follow those imports in this local CommonJS declaration scope. The game package selects this directory only for the Node types condition. Bundler uses the installed upstream declarations, preserving the identity of upstream classes. The JavaScript loader imports the official npm runtime in both cases.

When changing the pinned dependency, copy all .d.ts files from the integrity-checked release archive again, preserving their paths relative to package/. The packed consumer check compares the shipped file list and every declaration byte with the installed runtime dependency before compiling both modes.
