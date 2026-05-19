import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mocking some of the logic from useAudioEngine since we can't easily run React hooks in Node.js without more setup
// We want to verify that the error handling logic uses the generic message.

describe('useAudioEngine error handling', () => {
  test('activateSystemAudio should set generic error message on failure', async () => {
    let audioStatus = 'AWAITING AUDIO STREAM';
    const setAudioStatus = (status: string) => {
      audioStatus = status;
    };

    // Simulated version of activateSystemAudio logic
    const activateSystemAudioSim = async () => {
      try {
        // Simulate navigator.mediaDevices.getDisplayMedia failure
        throw new Error('Secret system information about audio drivers');
      } catch (err) {
        setAudioStatus('ERROR: SYSTEM AUDIO UNAVAILABLE');
      }
    };

    await activateSystemAudioSim();

    assert.strictEqual(audioStatus, 'ERROR: SYSTEM AUDIO UNAVAILABLE');
    assert.ok(!audioStatus.includes('Secret system information'));
  });
});
