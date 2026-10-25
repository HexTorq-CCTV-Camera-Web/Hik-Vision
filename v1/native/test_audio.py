import base64
import math
import unittest
from array import array
from fractions import Fraction
import av
from audio import PCMEncoder


class AudioTests(unittest.TestCase):
    def test_mono_8khz_becomes_valid_16khz_pcm_without_plane_padding(self):
        frame = av.AudioFrame(format='s16', layout='mono', samples=8000)
        source = array('h', [round(10000 * math.sin(2 * math.pi * 440 * n / 8000)) for n in range(8000)])
        frame.planes[0].update(source.tobytes())
        frame.sample_rate = 8000; frame.time_base = Fraction(1, 8000); frame.pts = 0
        packets = list(PCMEncoder().encode(frame))
        self.assertGreater(len(packets), 5)
        for packet in packets:
            self.assertEqual(packet['sampleRate'], 16000)
            self.assertEqual(len(base64.b64decode(packet['pcm'])), packet['samples'] * 2)
        samples = array('h'); samples.frombytes(base64.b64decode(packets[0]['pcm']))
        self.assertGreater(max(samples), 8000); self.assertLess(min(samples), -8000)

    def test_stereo_48khz_is_downmixed_to_mono(self):
        frame = av.AudioFrame(format='s16', layout='stereo', samples=48000)
        frame.planes[0].update(array('h', [4000, 0] * 48000).tobytes())
        frame.sample_rate = 48000; frame.time_base = Fraction(1, 48000); frame.pts = 0
        packets = list(PCMEncoder().encode(frame))
        self.assertGreater(len(packets), 5)
        samples = array('h'); samples.frombytes(base64.b64decode(packets[-1]['pcm']))
        self.assertGreater(sum(samples) / len(samples), 1000)
        self.assertEqual(len(samples), packets[-1]['samples'])


if __name__ == '__main__':
    unittest.main()
