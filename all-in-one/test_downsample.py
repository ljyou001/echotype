import sounddevice as sd
import numpy as np

print('Testing sounddevice callback data format...')
print('Device info:')
info = sd.query_devices(kind='input')
print(f'  Name: {info["name"]}')
print(f'  Channels: {info["max_input_channels"]}')

print('\nSimulating callback with 2 channels:')
# sounddevice callback returns (frames, channels)
indata = np.random.randn(2400, 2).astype(np.float32)
print(f'  indata.shape: {indata.shape}')  # (2400, 2)
print(f'  indata.ndim: {indata.ndim}')    # 2

print('\nDownsampling test - Current method:')
# Current: data[::3] takes every 3rd row
result1 = np.mean(indata[::3], axis=1)
print(f'  After data[::3] + mean: shape={result1.shape}, samples={len(result1)}')
print(f'  This gives: {len(result1)} samples (WRONG! Should be 800 per channel)')

print('\nDownsampling test - Correct method:')
# Need to downsample WITHIN each channel, not across frames
# For stereo (2400, 2), we should:
# 1. Take every 3rd sample in time dimension
# 2. Then average channels
result2 = np.mean(indata[::3], axis=1)  # This is same as above - WRONG
print(f'  Method 1 (wrong): {result2.shape}')

# Correct way: flatten to interleaved, then reshape
# But sounddevice gives us non-interleaved format (frames, channels)
# So data[::3] on axis 0 IS correct for time-domain downsampling!
print(f'\n  Actually data[::3] on (frames, channels) IS correct!')
print(f'  2400 frames / 3 = 800 frames at 16kHz')
print(f'  Mean across channels = mono')
