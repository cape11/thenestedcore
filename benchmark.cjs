const { performance } = require('perf_hooks');

class Color {
    constructor(hex) { this.hex = hex || 0; }
    setHex(hex) { this.hex = hex; }
}

const theme1 = { palette: [0xff0000, 0x00ff00, 0x0000ff] };
const theme2 = { palette: [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff] };
const theme3 = { palette: [0xff0000, 0x00ff00] };

const iterations = 100000;

// Baseline
let ref1 = { current: [] };
let t0 = performance.now();
for (let i = 0; i < iterations; i++) {
    const activeTheme = i % 3 === 0 ? theme1 : i % 3 === 1 ? theme2 : theme3;
    if (ref1.current.length !== activeTheme.palette.length) {
        ref1.current = activeTheme.palette.map(hex => new Color(hex));
    }
}
let t1 = performance.now();
console.log(`Baseline: ${t1 - t0} ms`);

// Optimized
let ref2 = { current: [] };
let t2 = performance.now();
for (let i = 0; i < iterations; i++) {
    const activeTheme = i % 3 === 0 ? theme1 : i % 3 === 1 ? theme2 : theme3;
    if (ref2.current.length !== activeTheme.palette.length) {
        const targetLen = activeTheme.palette.length;
        while (ref2.current.length < targetLen) {
            ref2.current.push(new Color());
        }
        ref2.current.length = targetLen;
        for (let j = 0; j < targetLen; j++) {
            ref2.current[j].setHex(activeTheme.palette[j]);
        }
    }
}
let t3 = performance.now();
console.log(`Optimized: ${t3 - t2} ms`);
