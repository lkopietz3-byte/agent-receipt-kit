// @types/node is not a dev dependency, so the vm module is loaded through a
// computed specifier and typed by hand. Values it returns come from another
// realm: their Object.prototype, Array.prototype and Date.prototype are not
// this realm's.
const vm = (await import(['node', 'vm'].join(':'))) as { runInNewContext(code: string): unknown }

export const runInNewRealm = (code: string): unknown => vm.runInNewContext(code)
