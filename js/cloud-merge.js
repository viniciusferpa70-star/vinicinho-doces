/* Three-way merge: preserve unrelated remote edits; reject conflicting writes. */
(function(root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function equal(a,b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b,key) && equal(a[key],b[key]));
  }
  function merge(base, local, remote, path = 'dados') {
    if (equal(local,base)) return clone(remote);
    if (equal(remote,base) || (base === undefined && equal(local,remote))) return clone(local);
    const objects = [base,local,remote].every(v => v && typeof v === 'object' && !Array.isArray(v));
    if (objects) {
      const result = {};
      for (const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
        const value = merge(base[key],local[key],remote[key],`${path}.${key}`);
        if (value !== undefined) Object.defineProperty(result,key,{value,writable:true,enumerable:true,configurable:true});
      }
      return result;
    }
    if ([base,local,remote].every(Array.isArray)) {
      // Legacy records without IDs use unique names; ambiguous lists stay atomic.
      const key = ['id','nome'].find(k => [base,local,remote].every(list => list.every(v => v && typeof v[k] === 'string' && v[k]) && new Set(list.map(v=>v[k])).size === list.length));
      if (key) {
        const maps = [base,local,remote].map(list => new Map(list.map(v => [v[key],v])));
        const result = [];
        for (const id of new Set([...remote.map(v=>v[key]),...local.map(v=>v[key])])) {
          const value = merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}[${id}]`);
          if (value !== undefined) result.push(value);
        }
        return result;
      }
    }
    const error = new Error(`Este registro mudou em outro computador (${path}). A alteração não foi salva. Atualize os dados e refaça a operação.`);
    error.code = 'sync/conflict';
    throw error;
  }
  const api = {clone,equal,merge};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VinicinhoMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
