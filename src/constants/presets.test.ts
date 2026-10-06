import test from 'node:test';
import assert from 'node:assert';
import {
    savePreset,
    loadPreset,
    PRESET_STORAGE_KEY,
    DEFAULT_PRESET,
    type AnimationPreset
} from './presets.ts';

test('presets utility', async (t) => {
    // Save original global properties to restore later
    const originalLocalStorage = globalThis.localStorage;

    // A mock localStorage implementation
    const createMockStorage = () => {
        let store: Record<string, string> = {};
        return {
            getItem(key: string): string | null {
                return store[key] || null;
            },
            setItem(key: string, value: string): void {
                store[key] = value.toString();
            },
            removeItem(key: string): void {
                delete store[key];
            },
            clear(): void {
                store = {};
            },
            _getStore(): Record<string, string> {
                return store;
            }
        };
    };

    t.beforeEach(() => {
        const mockStorage = createMockStorage();
        Object.defineProperty(globalThis, 'localStorage', {
            value: mockStorage,
            writable: true,
            configurable: true
        });
    });

    t.after(() => {
        // Restore global state
        if (originalLocalStorage === undefined) {
            // @ts-ignore
            delete globalThis.localStorage;
        } else {
            Object.defineProperty(globalThis, 'localStorage', {
                value: originalLocalStorage,
                writable: true,
                configurable: true
            });
        }
    });

    await t.test('savePreset stores preset as JSON string in localStorage', () => {
        const testPreset: AnimationPreset = {
            ...DEFAULT_PRESET,
            rotationSpeed: 2.5,
            particleDensity: 0.5
        };

        savePreset(testPreset);

        const storedString = globalThis.localStorage.getItem(PRESET_STORAGE_KEY);
        assert.ok(storedString !== null);

        const parsed = JSON.parse(storedString as string);
        assert.deepStrictEqual(parsed, testPreset);
    });

    await t.test('savePreset handles exceptions gracefully', () => {
        // Mock setItem to throw an error (e.g., QuotaExceededError)
        const mockStorage = globalThis.localStorage;
        mockStorage.setItem = () => {
            throw new Error('QuotaExceededError');
        };

        const testPreset: AnimationPreset = { ...DEFAULT_PRESET };

        // This should not throw
        assert.doesNotThrow(() => {
            savePreset(testPreset);
        });
    });

    await t.test('loadPreset returns DEFAULT_PRESET when storage is empty', () => {
        globalThis.localStorage.clear();
        const loaded = loadPreset();
        assert.deepStrictEqual(loaded, DEFAULT_PRESET);
    });

    await t.test('loadPreset returns merged preset when storage contains partial data', () => {
        const partialData = { rotationSpeed: 5.0, bassResponse: 0.1 };
        globalThis.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(partialData));

        const loaded = loadPreset();

        const expected = {
            ...DEFAULT_PRESET,
            ...partialData
        };

        assert.deepStrictEqual(loaded, expected);
    });

    await t.test('loadPreset returns DEFAULT_PRESET when storage contains invalid JSON', () => {
        globalThis.localStorage.setItem(PRESET_STORAGE_KEY, '{ invalid_json: true');

        const loaded = loadPreset();
        assert.deepStrictEqual(loaded, DEFAULT_PRESET);
    });

    await t.test('loadPreset handles exceptions gracefully', () => {
        // Mock getItem to throw an error
        const mockStorage = globalThis.localStorage;
        mockStorage.getItem = () => {
            throw new Error('SecurityError: The operation is insecure.');
        };

        // This should not throw
        let loaded;
        assert.doesNotThrow(() => {
            loaded = loadPreset();
        });

        // Should fallback to default
        assert.deepStrictEqual(loaded, DEFAULT_PRESET);
    });
});
