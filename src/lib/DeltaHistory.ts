/**
 * High-Performance Structural Sharing Delta Engine
 * Computes exact byte-level differences between two states for AAA undo/redo memory efficiency.
 */

export function computeDeltas(oldVal: any, newVal: any): { fwd: any, inv: any } | undefined {
    // If memory references match exactly, nothing changed down this entire tree branch!
    if (oldVal === newVal) return undefined;
    
    // Handle primitives and nulls
    if (typeof oldVal !== 'object' || oldVal === null || typeof newVal !== 'object' || newVal === null) {
        return { fwd: newVal, inv: oldVal };
    }
  
    // Handle Arrays
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        const fwd: any = { __isA__: true, l: newVal.length };
        const inv: any = { __isA__: true, l: oldVal.length };
        let hasChanges = oldVal.length !== newVal.length;
        
        for (let i = 0; i < Math.max(oldVal.length, newVal.length); i++) {
            if (i >= oldVal.length) {
                fwd[i] = newVal[i];
                inv[i] = { __rm__: true }; // Mark for removal on undo
                hasChanges = true;
            } else if (i >= newVal.length) {
                fwd[i] = { __rm__: true };
                inv[i] = oldVal[i];
                hasChanges = true;
            } else {
                const d = computeDeltas(oldVal[i], newVal[i]);
                if (d !== undefined) {
                    fwd[i] = d.fwd;
                    inv[i] = d.inv;
                    hasChanges = true;
                }
            }
        }
        return hasChanges ? { fwd, inv } : undefined;
    }
  
    // Handle Objects
    const fwd: any = {};
    const inv: any = {};
    let hasChanges = false;
    const allKeys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    
    for (const key of allKeys) {
        if (!(key in oldVal)) {
            fwd[key] = newVal[key];
            inv[key] = { __rm__: true };
            hasChanges = true;
        } else if (!(key in newVal)) {
            fwd[key] = { __rm__: true };
            inv[key] = oldVal[key];
            hasChanges = true;
        } else {
            const d = computeDeltas(oldVal[key], newVal[key]);
            if (d !== undefined) {
                fwd[key] = d.fwd;
                inv[key] = d.inv;
                hasChanges = true;
            }
        }
    }
    return hasChanges ? { fwd, inv } : undefined;
  }
  
  export function applyDelta(base: any, delta: any): any {
    if (delta === undefined) return base;
    if (typeof delta !== 'object' || delta === null) return delta;
    
    if (delta.__isA__) {
        const arr = Array.isArray(base) ? [...base] : [];
        arr.length = delta.l; // Native truncation for deleted elements
        for (const key in delta) {
            if (key !== '__isA__' && key !== 'l') {
                if (delta[key] && typeof delta[key] === 'object' && delta[key].__rm__) {
                    // Sparse removal
                } else {
                    arr[key as any] = applyDelta(arr[key as any], delta[key]);
                }
            }
        }
        return arr;
    }
  
    if (delta.__rm__) return undefined;
  
    const obj = (typeof base === 'object' && base !== null && !Array.isArray(base)) ? { ...base } : {};
    for (const key in delta) {
        if (delta[key] && typeof delta[key] === 'object' && delta[key].__rm__) {
            delete obj[key];
        } else {
            obj[key] = applyDelta(obj[key], delta[key]);
        }
    }
    return obj;
  }