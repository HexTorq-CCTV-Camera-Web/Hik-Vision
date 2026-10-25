# KPM 5 playback investigation — 2026-10-22

## Follow-up: working video and audio implementation

The standalone SDK receiver subsequently authenticated, received media, and decoded H265 video. CONFIG_OPEN_STREAMTRANS=2 with value 1 converts callback media to MPEG-PS suitable for PyAV. Browser MJPEG playback, HD/SD selection, and channel switching were verified, and the user confirmed working video. The older investigation sections below describe the discovery stage.

Renewed web JWT sessions are not SDK access tokens. The official SDK OAuth result contains a separate access_token. The browser bridge imports it only from the official `/custom/success` callback, including the browser's specific vendor 404 error page. The SDK open_id differs from the personal web user ID. Playback is restricted to channels discovered by the web account and independently authorized by the SDK. All credentials remain in server memory; restarting the server requires reconnecting and an available SDK login result.

On 2026-10-23, audio decoding, a session-protected PCM event stream, and browser mute/unmute controls were implemented. Synthetic audio and browser scheduling checks pass. All recorders were Offline, so actual camera audio remains unverified.

## Verified

- The signed-in India personal portal lists KPM 5 as Online. Its shared record has eight camera channels. Four other shared recorders are Offline.
- The user confirmed live video in both Hik-Connect mobile and iVMS-4200.
- The custom workspace lists KPM 5, its eight channels, and the Online state. Browser inspection showed a connected account with no notice/error.
- The desktop Video.C process has established outbound cloud TCP connections on port 7100 while playback is active. These socket endpoints do not identify a reusable HTTP/RTSP video URL or prove which socket carries media.
- Desktop playback logs contain StartRealPlay/RealPlay activity. No raw logs, account tokens, or encryption keys have been copied into this repository.
- The installed OpenNetStream.dll exports OpenSDK_StartRealPlayEx, OpenSDK_StartPlayWithStreamType, OpenSDK_SetDataCallBack, OpenSDK_AllocSessionEx, and SDK authentication functions.
- The installed SDK identifies itself as version 5.27; publicly available documentation below describes version 4.2. Binary compatibility has not been established.

## Receiver path to verify

1. Establish an authorized standalone SDK session for this shared account and India region.
2. Allocate a playback session and register the message and stream-data callbacks.
3. Start one permitted KPM 5 channel without a display window, if the installed SDK supports the documented behavior.
4. Verify success through the playback event and actual video bytes, then identify the delivered container/codec.
5. Feed the verified bytes into a browser delivery pipeline such as WebRTC or HLS. Select the pipeline after inspecting the actual stream format.
6. Stop and free sessions when the browser viewer closes.

The browser session used for device discovery is not a verified SDK access token. The app has no independent SDK authentication implementation, developer app key, verified video-byte receiver, or media endpoint. It must continue to show playback as pending.

## References

- [Official OpenSDK live-play APIs](https://open.ys7.com/doc/en/pc/group__play.html): documents the stream-data callback and streaming without a display window. A successful start return alone is insufficient; asynchronous playback status must also be checked.
- [Official OpenSDK initialization](https://open.ys7.com/doc/en/pc/group__init.html): documents application identity, platform/authentication addresses, and access-token setup.
- [Hikvision integration program](https://tpp.hikvision.com/products/HC-Integration): describes OpenAPI and browser decoder tooling with developer onboarding. Compatibility with existing personal-account shares must be verified.

No device settings, sharing permissions, or account ownership were changed during this investigation.
